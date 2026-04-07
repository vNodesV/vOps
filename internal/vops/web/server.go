// Package web provides an embedded HTTP server for the vOps dashboard.
//
// It serves a React 19 + TypeScript SPA (built by Vite into dist/) embedded
// via go:embed for single-binary deployment. All /api/* and /settings/api/*
// routes are served by Go handlers; all other GET routes serve the SPA index.html
// so that React Router can handle client-side navigation.
package web

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/vNodesV/vProx/internal/fleet"
	"github.com/vNodesV/vProx/internal/fleet/api"
	"github.com/vNodesV/vProx/internal/vops/config"
	"github.com/vNodesV/vProx/internal/vops/db"
	"github.com/vNodesV/vProx/internal/vops/ingest"
	"github.com/vNodesV/vProx/internal/vops/intel"
	"github.com/vNodesV/vProx/internal/vops/vm"
)

//go:embed static dist
var webFS embed.FS

// Server is the vOps HTTP server. It owns the ServeMux and references
// to the database and enrichment subsystems.
type Server struct {
	db       *db.DB
	enricher *intel.Enricher
	ingester *ingest.Ingester
	cfg      config.Config
	home     string
	cfgPath  string // resolved path to vops.toml (may be legacy or new layout)
	version   string // binary version string, set at startup
	commit    string // git commit SHA (short), set at startup
	buildDate string // build date (YYYY-MM-DD), set at startup
	httpSrv  *http.Server
	fleet    *api.Handlers // nil when fleet module is not configured
	fleetSvc *fleet.Service
	vmMgr    *vm.Handlers  // nil when no hypervisor hosts are configured
	debug    *DebugRing    // SSH command debug recorder

	// Session state for dashboard login.
	sessions   map[string]time.Time // token → expiry
	sessionMu  sync.RWMutex
	sessionKey []byte // 32-byte HMAC key, generated at startup

	// Brute-force protection: per-IP failed login tracking.
	loginMu      sync.Mutex
	loginAttempts map[string]*loginAttempt
}

// loginAttempt tracks failed login attempts for a single source IP.
type loginAttempt struct {
	count       int
	lockedUntil time.Time
}

// New creates a Server, registers all routes, and returns a server ready to Start().
// fleetSvc is optional — pass nil to disable the fleet module routes.
func New(d *db.DB, enricher *intel.Enricher, ingester *ingest.Ingester, cfg config.Config, fleetSvc *fleet.Service, cfgPath, appVersion, appCommit, appBuildDate string) (*Server, error) {
	// Build a sub-filesystem over the embedded dist/ directory so the SPA
	// handler can serve Vite build artifacts directly.
	distFS, err := fs.Sub(webFS, "dist")
	if err != nil {
		return nil, fmt.Errorf("web: embed dist sub: %w", err)
	}

	// Generate session HMAC key.
	sessionKey := make([]byte, 32)
	if _, err := rand.Read(sessionKey); err != nil {
		return nil, fmt.Errorf("web: generate session key: %w", err)
	}

	s := &Server{
		db:            d,
		enricher:      enricher,
		ingester:      ingester,
		cfg:           cfg,
		home:          config.FindHome(),
		cfgPath:       cfgPath,
		version:       appVersion,
		commit:        appCommit,
		buildDate:     appBuildDate,
		sessions:      make(map[string]time.Time),
		sessionKey:    sessionKey,
		loginAttempts: make(map[string]*loginAttempt),
		debug:         &DebugRing{},
	}
	if fleetSvc != nil {
		s.fleet = api.New(fleetSvc, d.DB)
		s.fleet.SetDebug(s.debug)
		s.fleetSvc = fleetSvc
		// Always create the VM manager so routes are available even when no
		// hypervisor hosts are configured yet; it returns empty lists until
		// infra is saved and fleet config is reloaded.
		// Pass fleetSvc (not a config snapshot) so HandleListHosts always
		// reflects the current in-memory fleet config after a settings save.
		s.vmMgr = vm.NewHandlers(
			fleetSvc,
			d.DB,
			22,
			cfg.VOps.Push.Defaults.KeyPath,
			cfg.VOps.Push.Defaults.KnownHostsPath,
		)
		s.vmMgr.SetDebug(s.debug)
	}

	mux := http.NewServeMux()

	// Login/logout routes — exempt from session check.
	mux.HandleFunc("POST /login", s.handleLoginSubmit)
	mux.HandleFunc("POST /logout", s.handleLogout)

	// Public metadata — no session required (used by login page before auth).
	mux.HandleFunc("GET /api/v1/version", s.handleAPIVersion)

	// Debug console routes — session-protected.
	mux.Handle("GET /api/v1/debug/mode", s.requireSession(http.HandlerFunc(s.handleAPIDebugMode)))
	mux.Handle("POST /api/v1/debug/mode", s.requireSession(http.HandlerFunc(s.handleAPIDebugMode)))
	mux.Handle("GET /api/v1/debug/events", s.requireSession(http.HandlerFunc(s.handleAPIDebugEvents)))

	// Static assets — exempt from session check.
	// Serve only the "static/" subtree to prevent path traversal to dist/.
	staticSub, err := fs.Sub(webFS, "static")
	if err != nil {
		return nil, fmt.Errorf("web: embed static sub: %w", err)
	}
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticSub))))

	// Vite-built JS/CSS bundles — served directly from dist/assets/, no session required.
	// These must be session-exempt: the login page loads them before the user authenticates.
	assetsSub, err := fs.Sub(distFS, "assets")
	if err != nil {
		return nil, fmt.Errorf("web: embed dist/assets sub: %w", err)
	}
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.FS(assetsSub))))

	// SPA handler — serves the React app for all page routes.
	// GET /login is served without session check so users can access the login page.
	// GET /settings/wizard serves the embedded configwizard HTML (bypasses React Router).
	// GET / (catch-all) enforces session; Go redirects to /login if unauthenticated.
	spa := buildSPAHandler(distFS, s.cfg.VOps.BasePath, func() string { return s.cfg.VOps.UI.Theme })
	mux.HandleFunc("GET /login", spa)
	mux.Handle("GET /settings/wizard", s.requireSession(http.HandlerFunc(s.handleWizardPage)))
	mux.Handle("GET /", s.requireSession(http.HandlerFunc(spa)))

	// When base_path is set (e.g. "/vops" for sub-path proxy without prefix stripping),
	// also register the base_path-prefixed login and root routes without session checks.
	// Without this, the redirect to "<base_path>/login" hits the catch-all GET /,
	// which requires a session and immediately redirects again → infinite loop.
	if bp := s.cfg.VOps.BasePath; bp != "" {
		mux.HandleFunc("POST "+bp+"/login", s.handleLoginSubmit)
		mux.HandleFunc("GET "+bp+"/login", spa)
	}
	mux.Handle("GET /settings/api/config/current", s.requireSession(http.HandlerFunc(s.handleAPISettingsCurrent)))
	mux.Handle("POST /settings/api/config/import", s.requireSession(http.HandlerFunc(s.handleAPISettingsImport)))
	mux.Handle("POST /settings/api/config/remove", s.requireSession(http.HandlerFunc(s.handleAPISettingsRemove)))
	mux.Handle("POST /settings/api/config/apply", s.requireSession(http.HandlerFunc(s.handleAPISettingsApply)))
	mux.Handle("POST /settings/api/config/ports", s.requireSession(http.HandlerFunc(s.handleAPISettingsSave("ports"))))
	mux.Handle("POST /settings/api/config/settings", s.requireSession(http.HandlerFunc(s.handleAPISettingsSave("settings"))))
	mux.Handle("POST /settings/api/config/chain", s.requireSession(http.HandlerFunc(s.handleAPISettingsSave("chain"))))
	mux.Handle("POST /settings/api/config/vops", s.requireSession(http.HandlerFunc(s.handleAPISettingsSave("vops"))))
	mux.Handle("POST /settings/api/config/fleet", s.requireSession(http.HandlerFunc(s.handleAPISettingsSave("fleet"))))
	mux.Handle("POST /settings/api/config/infra", s.requireSession(http.HandlerFunc(s.handleAPISettingsSave("infra"))))
	mux.Handle("POST /settings/api/config/backup", s.requireSession(http.HandlerFunc(s.handleAPISettingsSave("backup"))))
	mux.Handle("POST /settings/api/config/done", s.requireSession(http.HandlerFunc(s.handleAPISettingsDone)))
	mux.Handle("POST /settings/api/config/preferences", s.requireSession(http.HandlerFunc(s.handleAPISettingsPreferences)))
	mux.Handle("GET /settings/api/gen-api-key", s.requireSession(http.HandlerFunc(s.handleAPIGenAPIKey)))
	mux.Handle("POST /settings/api/hash-password", s.requireSession(http.HandlerFunc(s.handleAPIHashPassword)))
	mux.Handle("GET /settings/api/ssh-pub-key", s.requireSession(http.HandlerFunc(s.handleAPIGetSSHPubKey)))
	mux.Handle("POST /settings/api/gen-ssh-key", s.requireSession(http.HandlerFunc(s.handleAPIGenSSHKey)))

	// API routes — session-protected.
	mux.Handle("POST /api/v1/ingest", s.requireSession(http.HandlerFunc(s.handleAPIIngest)))
	mux.Handle("GET /api/v1/ingest/stats", s.requireSession(http.HandlerFunc(s.handleAPIArchiveStats)))
	mux.Handle("POST /api/v1/ingest/backup", s.requireSession(http.HandlerFunc(s.handleAPIBackupAndIngest)))
	mux.Handle("GET /api/v1/accounts", s.requireSession(http.HandlerFunc(s.handleAPIAccountList)))
	mux.Handle("GET /api/v1/accounts/{ip}", s.requireSession(http.HandlerFunc(s.handleAPIAccountDetail)))
	mux.Handle("POST /api/v1/enrich/{ip}", s.requireSession(http.HandlerFunc(s.handleAPIEnrich)))
	mux.Handle("POST /api/v1/osint/{ip}", s.requireSession(http.HandlerFunc(s.handleAPIosint)))
	mux.Handle("POST /api/v1/investigate/{ip}", s.requireSession(http.HandlerFunc(s.handleAPIInvestigate)))
	mux.Handle("POST /api/v1/block/{ip}", s.requireSession(http.HandlerFunc(s.handleAPIBlock)))
	mux.Handle("POST /api/v1/unblock/{ip}", s.requireSession(http.HandlerFunc(s.handleAPIUnblock)))
	mux.Handle("POST /api/v1/ufw/sync", s.requireSession(http.HandlerFunc(s.handleAPIUFWSync)))
	mux.Handle("GET /api/v1/stats", s.requireSession(http.HandlerFunc(s.handleAPIStats)))
	mux.Handle("GET /api/v1/chart", s.requireSession(http.HandlerFunc(s.handleAPIChart)))
	mux.Handle("GET /api/v1/probe", s.requireSession(http.HandlerFunc(s.handleAPIProbe)))
	mux.Handle("GET /api/v1/fleet/chains/traffic", s.requireSession(http.HandlerFunc(s.handleAPIChainTraffic)))

	// POST /api/v1/fleet/vms/scan is always registered so the UI never gets a
	// 405 Method Not Allowed from the Go 1.22 mux catch-all GET / pattern.
	// When fleet is not yet configured it returns 503 with a human-readable message.
	mux.Handle("POST /api/v1/fleet/vms/scan", s.requireSession(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.fleet == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "Fleet not configured — add a [[host]] entry in config/infra/<datacenter>.toml and restart vOps.",
			})
			return
		}
		s.fleet.HandleHypervisorScan(w, r)
	})))

	// Fleet module routes — only registered when fleet is configured.
	if s.fleet != nil {
		mux.Handle("GET /api/v1/fleet/vms",
			s.requireSession(http.HandlerFunc(s.fleet.HandleVMs)))
		mux.Handle("GET /api/v1/fleet/vms/status",
			s.requireSession(http.HandlerFunc(s.fleet.HandleVMStatus)))
		mux.Handle("GET /api/v1/fleet/chains",
			s.requireSession(http.HandlerFunc(s.fleet.HandleChains)))
		mux.Handle("GET /api/v1/fleet/chains/{chain}",
			s.requireSession(http.HandlerFunc(s.fleet.HandleChainStatus)))
		mux.Handle("GET /api/v1/fleet/deployments",
			s.requireSession(http.HandlerFunc(s.fleet.HandleDeployments)))
		mux.Handle("POST /api/v1/fleet/deploy",
			s.requireSession(http.HandlerFunc(s.fleet.HandleDeploy)))
		mux.Handle("GET /api/v1/fleet/chains/registered",
			s.requireSession(http.HandlerFunc(s.fleet.HandleRegisteredChains)))
		mux.Handle("POST /api/v1/fleet/chains/registered",
			s.requireSession(http.HandlerFunc(s.fleet.HandleRegisteredChains)))
		mux.Handle("DELETE /api/v1/fleet/chains/registered/{chain}",
			s.requireSession(http.HandlerFunc(s.fleet.HandleRegisteredChainDelete)))
		// POST alias for Apache environments that block DELETE method pass-through.
		mux.Handle("POST /api/v1/fleet/chains/registered/{chain}",
			s.requireSession(http.HandlerFunc(s.fleet.HandleRegisteredChainDelete)))
		mux.Handle("POST /api/v1/fleet/poll",
			s.requireSession(http.HandlerFunc(s.fleet.HandlePoll)))
		mux.Handle("POST /api/v1/fleet/vms/{name}/upgrade",
			s.requireSession(http.HandlerFunc(s.fleet.HandleVMUpgrade)))
		mux.Handle("GET /api/v1/fleet/vms/{name}/history",
			s.requireSession(http.HandlerFunc(s.fleet.HandleVMHistory)))
		mux.Handle("POST /api/v1/fleet/hosts/scan",
			s.requireSession(http.HandlerFunc(s.fleet.HandleHostScan)))
		mux.Handle("GET /api/v1/fleet/hosts",
			s.requireSession(http.HandlerFunc(s.fleet.HandleListHosts)))
		mux.Handle("GET /api/v1/audit",
			s.requireSession(http.HandlerFunc(s.fleet.HandleListAudit)))
	}

	// VM Manager routes — only registered when hypervisor hosts are configured.
	if s.vmMgr != nil {
		mux.Handle("GET /api/v1/vm/hosts",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleListHosts)))
		mux.Handle("GET /api/v1/vm/hosts/{host}/domains",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleListDomains)))
		mux.Handle("POST /api/v1/vm/hosts/{host}/domains/{domain}/action",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleDomainAction)))
		mux.Handle("GET /api/v1/vm/hosts/{host}/domains/{domain}/stats",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleDomainStats)))
		mux.Handle("GET /api/v1/vm/hosts/{host}/domains/{domain}/snapshots",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleListSnapshots)))
		mux.Handle("POST /api/v1/vm/hosts/{host}/domains/{domain}/snapshots",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleCreateSnapshot)))
		mux.Handle("POST /api/v1/vm/hosts/{host}/domains/{domain}/snapshots/{snap}/revert",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleRevertSnapshot)))
		mux.Handle("DELETE /api/v1/vm/hosts/{host}/domains/{domain}/snapshots/{snap}",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleDeleteSnapshot)))
		// POST alias for DELETE — useful behind Apache reverse proxies.
		mux.Handle("POST /api/v1/vm/hosts/{host}/domains/{domain}/snapshots/{snap}/delete",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleDeleteSnapshot)))
		// VM lifecycle management.
		mux.Handle("DELETE /api/v1/vm/hosts/{host}/domains/{domain}",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleDeleteDomain)))
		mux.Handle("POST /api/v1/vm/hosts/{host}/domains/{domain}/delete",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleDeleteDomain)))
		mux.Handle("POST /api/v1/vm/hosts/{host}/domains/{domain}/resize",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleResizeDomain)))
		mux.Handle("POST /api/v1/vm/hosts/{host}/domains",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleCreateDomain)))
		// Network inspection.
		mux.Handle("GET /api/v1/vm/hosts/{host}/networks",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleListNetworks)))
		mux.Handle("GET /api/v1/vm/hosts/{host}/domains/{domain}/interfaces",
			s.requireSession(http.HandlerFunc(s.vmMgr.HandleDomainInterfaces)))
	}

	readTimeout := time.Duration(cfg.VOps.Server.ReadTimeoutSec) * time.Second
	writeTimeout := time.Duration(cfg.VOps.Server.WriteTimeoutSec) * time.Second

	s.httpSrv = &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.VOps.BindAddress, cfg.VOps.Port),
		Handler:      s.debugHTTPMiddleware(securityHeaders(mux)),
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
	}

	return s, nil
}

// Start begins listening on the configured port. It blocks until the
// server is shut down or encounters a fatal error.
func (s *Server) Start() error {
	return s.httpSrv.ListenAndServe()
}

// requireSession redirects to /login if no valid session cookie is present.
// If auth is not configured (PasswordHash empty), this is a no-op pass-through.
func (s *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.VOps.Auth.PasswordHash == "" {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie("vops_session")
		if err != nil || !s.validSession(cookie.Value) {
			http.Redirect(w, r, s.cfg.VOps.BasePath+"/login", http.StatusFound)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// newSession creates a new HMAC-signed session token with 24h TTL.
func (s *Server) newSession() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("web: newSession rand: %w", err)
	}
	mac := hmac.New(sha256.New, s.sessionKey)
	mac.Write(raw)
	token := hex.EncodeToString(raw) + "." + hex.EncodeToString(mac.Sum(nil))
	s.sessionMu.Lock()
	s.sessions[token] = time.Now().Add(24 * time.Hour)
	s.sessionMu.Unlock()
	return token, nil
}

// validSession reports whether token exists and has not expired.
// Expired tokens are removed from the map to prevent unbounded growth.
func (s *Server) validSession(token string) bool {
	s.sessionMu.RLock()
	expiry, ok := s.sessions[token]
	s.sessionMu.RUnlock()
	if !ok {
		return false
	}
	if time.Now().After(expiry) {
		s.sessionMu.Lock()
		delete(s.sessions, token)
		s.sessionMu.Unlock()
		return false
	}
	return true
}

// deleteSession removes a session token.
func (s *Server) deleteSession(token string) {
	s.sessionMu.Lock()
	delete(s.sessions, token)
	s.sessionMu.Unlock()
}

// authEnabled reports whether dashboard login is configured.
func (s *Server) authEnabled() bool {
	return s.cfg.VOps.Auth.PasswordHash != ""
}

// checkCredentials validates username + password against the stored config.
func (s *Server) checkCredentials(username, password string) bool {
	if username != s.cfg.VOps.Auth.Username {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(s.cfg.VOps.Auth.PasswordHash), []byte(password)) == nil
}

// checkLoginLock returns (true, retryAfterSeconds) when clientIP is locked out,
// (false, 0) otherwise. Stale entries older than 30 min are pruned on each call.
func (s *Server) checkLoginLock(clientIP string) (locked bool, retryAfter int) {
	const lockDuration = 5 * time.Minute
	const staleCutoff = 30 * time.Minute

	s.loginMu.Lock()
	defer s.loginMu.Unlock()

	now := time.Now()
	// Prune stale entries.
	for ip, att := range s.loginAttempts {
		if now.Sub(att.lockedUntil) > staleCutoff && att.lockedUntil.IsZero() {
			delete(s.loginAttempts, ip)
		} else if !att.lockedUntil.IsZero() && now.Sub(att.lockedUntil) > staleCutoff {
			delete(s.loginAttempts, ip)
		}
	}

	att, ok := s.loginAttempts[clientIP]
	if !ok || att.lockedUntil.IsZero() {
		return false, 0
	}
	if now.Before(att.lockedUntil) {
		remaining := int(att.lockedUntil.Sub(now).Seconds()) + 1
		return true, remaining
	}
	// Lock expired — reset.
	att.count = 0
	att.lockedUntil = time.Time{}
	return false, 0
}

// recordLoginFailure increments the failed attempt counter for clientIP.
// After 5 failures, the IP is locked out for 5 minutes.
func (s *Server) recordLoginFailure(clientIP string) {
	const maxAttempts = 5
	const lockDuration = 5 * time.Minute

	s.loginMu.Lock()
	defer s.loginMu.Unlock()

	att, ok := s.loginAttempts[clientIP]
	if !ok {
		att = &loginAttempt{}
		s.loginAttempts[clientIP] = att
	}
	att.count++
	if att.count >= maxAttempts {
		att.lockedUntil = time.Now().Add(lockDuration)
		att.count = 0
	}
}

// clearLoginAttempts resets the failure counter for clientIP on successful login.
func (s *Server) clearLoginAttempts(clientIP string) {
	s.loginMu.Lock()
	delete(s.loginAttempts, clientIP)
	s.loginMu.Unlock()
}

// requireAPIKey is middleware that enforces API key authentication.
// The key must be provided via the X-API-Key request header.
// If the server's configured APIKey is empty, all requests are rejected (key not configured).
//
//nolint:unused // middleware registered dynamically in future auth expansion
func (s *Server) requireAPIKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.VOps.APIKey == "" {
			http.Error(w, "endpoint disabled: api_key not configured in vops.toml", http.StatusServiceUnavailable)
			return
		}
		if r.Header.Get("X-API-Key") != s.cfg.VOps.APIKey {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// securityHeaders adds standard HTTP security headers to every response.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Content-Security-Policy",
			"default-src 'self';"+
				" script-src 'self';"+
				" style-src 'self' 'unsafe-inline';"+
				" img-src 'self' data:;"+
				" connect-src 'self';"+
				" font-src 'self';")
		next.ServeHTTP(w, r)
	})
}

// Shutdown performs a graceful shutdown, waiting for in-flight requests
// to complete or the context to expire.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpSrv.Shutdown(ctx)
}

// handleAPIVersion returns build metadata — public endpoint, no session required.
// Used by the login page to display the current version and build info.
func (s *Server) handleAPIVersion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"version":    s.version,
		"commit":     s.commit,
		"build_date": s.buildDate,
	})
}

// buildSPAHandler returns an http.HandlerFunc that serves the React SPA.
//
// Requests for files that exist in distFS (JS bundles, CSS, images) are served
// directly. All other paths fall back to index.html so that React Router can
// handle client-side navigation.
//
// basePath is injected as <meta name="vops-base" content="..."> into index.html
// so the SPA client can build correct API URLs when served under a sub-path proxy
// (e.g. Apache ProxyPass /vlog/ → http://127.0.0.1:8889/ with prefix stripping).
//
// themeFunc is called per-request to inject the current theme as
// <meta name="vops-theme" content="..."> so the SPA can apply it before first paint.
func buildSPAHandler(distFS fs.FS, basePath string, themeFunc func() string) http.HandlerFunc {
	// Pre-read and patch index.html once at startup for the static basePath meta.
	indexHTML, err := fs.ReadFile(distFS, "index.html")
	if err != nil {
		panic("web: dist/index.html missing from embed: " + err.Error())
	}
	metaTag := `<meta name="vops-base" content="` + basePath + `">`
	basePatched := bytes.ReplaceAll(indexHTML, []byte("</head>"), []byte(metaTag+"</head>"))

	fileServer := http.FileServer(http.FS(distFS))
	return func(w http.ResponseWriter, r *http.Request) {
		// Normalise the URL path and resolve the file name relative to dist/.
		upath := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))
		name := strings.TrimPrefix(upath, "/")
		if name == "" {
			name = "."
		}

		// If the file exists in dist/ and is not a directory, serve it directly.
		f, err := distFS.Open(name)
		if err == nil {
			st, statErr := f.Stat()
			f.Close()
			if statErr == nil && !st.IsDir() {
				// Vite content-hashes JS/CSS filenames → safe to cache forever.
				if strings.HasPrefix(upath, "/assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		// Inject active theme per-request so CSS can apply it before first paint.
		theme := themeFunc()
		themeMeta := `<meta name="vops-theme" content="` + theme + `">`
		patchedHTML := bytes.ReplaceAll(basePatched, []byte("</head>"), []byte(themeMeta+"</head>"))

		// Fallback: serve patched index.html for all React Router paths.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(patchedHTML))
	}
}
