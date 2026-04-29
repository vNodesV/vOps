// Package vprox provides an embeddable vProx reverse-proxy server.
//
// The Server type wraps the full proxy startup/shutdown lifecycle so it can
// be embedded inside the vOps suite binary (via Controller) or run standalone
// via cmd/vprox.
//
// Dependency constraint: this package MUST NOT import internal/vops/db,
// internal/vops/web, or internal/vops/config.
package vprox

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	_ "net/http/pprof" //nolint:gosec // G108: pprof intentionally exposed on debug port (localhost only)
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	toml "github.com/pelletier/go-toml/v2"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	backup "github.com/vNodesV/vOps/internal/backup"
	"github.com/vNodesV/vOps/internal/config"
	"github.com/vNodesV/vOps/internal/cosmos"
	"github.com/vNodesV/vOps/internal/counter"
	"github.com/vNodesV/vOps/internal/geo"
	"github.com/vNodesV/vOps/internal/limit"
	applog "github.com/vNodesV/vOps/internal/logging"
	"github.com/vNodesV/vOps/internal/metrics"
	ws "github.com/vNodesV/vOps/internal/ws"
)

// Config holds startup parameters for a vProx Server.
// Home is the only required field; all other fields are optional overrides.
type Config struct {
	Home string // VPROX_HOME — required

	// Optional path overrides (empty = derive from Home).
	Addr      string // listen address; default ":3000"
	ConfigDir string // override $Home/config
	ChainsDir string // override $Home/chains
	LogFile   string // override $Home/data/logs/main.log

	// Rate limiting overrides (0 = use settings.toml / env defaults).
	RPS   float64
	Burst int

	// Auto-quarantine overrides.
	AutoRPS   float64
	AutoBurst int

	// External marks this as an externally-managed vProx instance.
	// When true, the Controller does NOT run an embedded Server goroutine.
	// Start/Stop/Restart delegate to systemctl; State queries systemd.
	External bool

	// ServiceName is the systemd unit name to control when External = true.
	// Default: "vProx"  (unit file: "vProx.service").
	ServiceName string

	// Feature flags.
	Verbose       bool
	DisableAuto   bool
	DisableBackup bool

	// Pre-start modes — Start() executes the mode and returns nil immediately.
	DryRun   bool // load everything, print dry-run summary, do NOT serve
	Validate bool // validate configs and print summary
	Info     bool // print config info
}

// --------------------- CONSTANTS ---------------------

const (
	rpcPrefix     = "/rpc"
	restPrefix    = "/rest"
	grpcPrefix    = "/grpc"
	grpcWebPrefix = "/grpc-web"
	apiPrefix     = "/api"
)

// --------------------- SERVER ---------------------

// Server is a configured, startable vProx reverse proxy.
// Create with New; start with Start.
type Server struct {
	cfg  Config
	home string

	// Proxy state (populated during Start).
	chains       map[string]*config.ChainConfig
	defaultPorts config.Ports

	// Directory paths (derived from home or cfg overrides).
	configDir       string
	chainsDir       string
	dataDir         string
	logsDir         string
	archiveDir      string
	chainsConfigDir string
	backupConfigDir string
	accessCountsPath string

	// Rewrite regex cache.
	rewriteCacheMu sync.RWMutex
	rewriteCache   map[string]*rewriteRegexes

	// Per-chain log files.
	chainLoggerMu sync.Mutex
	chainLoggers  map[string]*log.Logger
	chainLogFiles map[string]*os.File

	// Deprecation warning dedup.
	deprecationWarned sync.Map

	// HTTP server.
	httpSrv   *http.Server
	startTime time.Time

	// Cleanup hooks set during Start.
	stopCounterTicker func()
	stopBackup        func()
	lim               limit.Limiter
}

// New creates a Server from cfg. Call Start to run it.
func New(cfg Config) *Server {
	if cfg.Home == "" {
		cfg.Home = resolveVProxHome()
	}
	return &Server{
		cfg:          cfg,
		chains:       make(map[string]*config.ChainConfig),
		rewriteCache: make(map[string]*rewriteRegexes),
		chainLoggers: make(map[string]*log.Logger),
		chainLogFiles: make(map[string]*os.File),
	}
}

// resolveVProxHome returns VPROX_HOME or ~/.vProx.
func resolveVProxHome() string {
	if v := strings.TrimSpace(os.Getenv("VPROX_HOME")); v != "" {
		return v
	}
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return filepath.Join(h, ".vProx")
	}
	return ".vProx"
}

// Start initialises state, loads config files, and serves until ctx is cancelled.
// It blocks until shutdown is complete.
func (s *Server) Start(ctx context.Context) error {
	s.startTime = time.Now()
	s.home = s.cfg.Home
	if s.home != "" {
		_ = os.Setenv("VPROX_HOME", s.home)
	}

	// Resolve directories.
	s.configDir = filepath.Join(s.home, "config")
	if s.cfg.ConfigDir != "" {
		if filepath.IsAbs(s.cfg.ConfigDir) {
			s.configDir = s.cfg.ConfigDir
		} else {
			s.configDir = filepath.Join(s.home, s.cfg.ConfigDir)
		}
	}
	s.chainsDir = filepath.Join(s.home, "chains")
	if s.cfg.ChainsDir != "" {
		if filepath.IsAbs(s.cfg.ChainsDir) {
			s.chainsDir = s.cfg.ChainsDir
		} else {
			s.chainsDir = filepath.Join(s.home, s.cfg.ChainsDir)
		}
	}
	s.dataDir = filepath.Join(s.home, "data")
	s.logsDir = filepath.Join(s.dataDir, "logs")
	s.archiveDir = filepath.Join(s.logsDir, "archives")
	s.accessCountsPath = filepath.Join(s.dataDir, "access-counts.json")
	s.chainsConfigDir = filepath.Join(s.configDir, "chains")
	s.backupConfigDir = filepath.Join(s.configDir, "backup")

	// Create directories.
	for _, dir := range []string{s.configDir, s.chainsConfigDir, s.backupConfigDir, s.dataDir, s.logsDir, s.archiveDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("vprox: create dir %s: %w", dir, err)
		}
	}

	// Resolve log file.
	mainLogPath := filepath.Join(s.logsDir, "main.log")
	if s.cfg.LogFile != "" {
		if filepath.IsAbs(s.cfg.LogFile) {
			mainLogPath = s.cfg.LogFile
		} else {
			mainLogPath = filepath.Join(s.logsDir, s.cfg.LogFile)
		}
	}

	// Open log file.
	if err := os.MkdirAll(filepath.Dir(mainLogPath), 0o755); err != nil {
		return fmt.Errorf("vprox: create log dir: %w", err)
	}
	f, err := os.OpenFile(mainLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("vprox: open log: %w", err)
	}
	defer f.Close()
	log.SetOutput(&applog.SplitLogWriter{Stdout: os.Stdout, File: f, Colorize: true})
	log.SetFlags(0)

	// Geo status.
	applog.Print("INFO", "geo", "status", applog.F("message", geo.Info()))
	counter.Load(s.accessCountsPath)
	s.stopCounterTicker = counter.StartTicker(s.accessCountsPath)

	// Load ports config.
	portsPath := ""
	for _, candidate := range []string{
		filepath.Join(s.chainsConfigDir, "services.toml"),
		filepath.Join(s.chainsConfigDir, "ports.toml"),
		filepath.Join(s.configDir, "ports.toml"),
	} {
		if _, err := os.Stat(candidate); err == nil {
			portsPath = candidate
			break
		}
	}
	if portsPath == "" {
		return fmt.Errorf("vprox: ports config missing: expected config/chains/services.toml, config/chains/ports.toml, or config/ports.toml")
	}
	s.defaultPorts, err = config.LoadPorts(portsPath)
	if err != nil {
		return fmt.Errorf("vprox: load ports: %w", err)
	}

	// Load chain configs.
	foundChains := false
	for _, scanDir := range []string{s.chainsConfigDir, s.chainsDir} {
		if !config.HasChainConfigs(scanDir) {
			continue
		}
		if err := s.loadChains(scanDir); err != nil {
			return fmt.Errorf("vprox: load chains from %s: %w", scanDir, err)
		}
		foundChains = true
		applog.Print("INFO", "config", "chains_loaded", applog.F("dir", scanDir))
	}
	if !foundChains {
		return fmt.Errorf("vprox: no chain configs found in %s or %s", s.chainsConfigDir, s.chainsDir)
	}

	// ── Pre-start diagnostic modes ──────────────────────────────────────────
	if s.cfg.Validate {
		log.Println("")
		log.Println("CONFIG VALIDATION SUCCESSFUL #############################")
		log.Printf("[VALIDATE] Loaded %d chains", len(s.chains))
		for host := range s.chains {
			log.Printf("  • %s", host)
		}
		log.Printf("[VALIDATE] Default ports: RPC=%d, REST=%d, gRPC=%d, gRPC-Web=%d, API=%d",
			s.defaultPorts.RPC, s.defaultPorts.REST, s.defaultPorts.GRPC, s.defaultPorts.GRPCWeb, s.defaultPorts.API)
		log.Println("[VALIDATE] All configs OK")
		return nil
	}
	if s.cfg.Info {
		log.Println("")
		log.Println("VPROX CONFIGURATION INFO #############################")
		log.Printf("VPROX_HOME:        %s", s.home)
		log.Printf("Config directory:  %s", s.configDir)
		log.Printf("Chains directory:  %s", s.chainsDir)
		log.Printf("Data directory:    %s", s.dataDir)
		log.Printf("Logs directory:    %s", s.logsDir)
		log.Println("")
		log.Printf("Loaded chains: %d", len(s.chains))
		for host, ch := range s.chains {
			log.Printf("  • %s (%s) @ %s", host, ch.ChainName, ch.IP)
		}
		log.Println("")
		log.Printf("Default ports: RPC=%d, REST=%d, gRPC=%d, gRPC-Web=%d, API=%d",
			s.defaultPorts.RPC, s.defaultPorts.REST, s.defaultPorts.GRPC, s.defaultPorts.GRPCWeb, s.defaultPorts.API)
		return nil
	}

	// Build rate limiter.
	proxyCfg := s.loadProxySettings()
	defaultRPS, defaultBurst, limOpts := s.buildLimiterOpts(proxyCfg)
	s.lim = limit.New(
		limit.RateSpec{RPS: defaultRPS, Burst: defaultBurst},
		nil,
		limOpts...,
	)

	// Backup scheduler.
	bupCfg, bupLoaded, bupErr := backup.LoadConfig(s.resolveBackupConfigPath())
	if bupErr != nil {
		applog.Print("WARN", "backup", "config_load_failed", applog.F("error", bupErr.Error()))
	}
	backupEnabled := bupCfg.Backup.Automation && !s.cfg.DisableBackup
	if s.cfg.DisableBackup {
		if err := disableBackupInConfig(s.resolveBackupConfigPath()); err != nil {
			applog.Print("WARN", "backup", "config_persist_failed", applog.F("error", err.Error()))
		}
	}
	if backupEnabled {
		listSrc := "default"
		if bupLoaded {
			listSrc = "loaded"
		}
		rotateExtra, extraFiles := resolveBackupExtraFiles(bupCfg, s.dataDir, s.logsDir, s.configDir, mainLogPath)
		envInt := func(key string, def int) int {
			v := strings.TrimSpace(os.Getenv(key))
			if v == "" {
				return def
			}
			var n int
			if _, err := fmt.Sscan(v, &n); err == nil {
				return n
			}
			return def
		}
		envBytes := func(key string) int64 {
			v := strings.TrimSpace(os.Getenv(key))
			if v == "" {
				return 0
			}
			var n int64
			if _, err := fmt.Sscan(v, &n); err == nil {
				return n
			}
			return 0
		}
		intervalDays := envInt("VPROX_BACKUP_INTERVAL_DAYS", bupCfg.Backup.IntervalDays)
		maxBytes := envBytes("VPROX_BACKUP_MAX_BYTES")
		if maxBytes == 0 && bupCfg.Backup.MaxSizeMB > 0 {
			maxBytes = bupCfg.Backup.MaxSizeMB * 1024 * 1024
		}
		checkMin := envInt("VPROX_BACKUP_CHECK_MINUTES", bupCfg.Backup.CheckIntervalMin)

		var startErr error
		s.stopBackup, startErr = backup.StartAuto(backup.Options{
			LogPath:       mainLogPath,
			ArchiveDir:    s.archiveDir,
			StatePath:     filepath.Join(s.dataDir, "backup.last"),
			IntervalDays:  intervalDays,
			MaxBytes:      maxBytes,
			CheckInterval: time.Duration(checkMin) * time.Minute,
			RotateExtra:   rotateExtra,
			ExtraFiles:    extraFiles,
			ListSource:    listSrc,
		})
		if startErr != nil {
			applog.Print("ERROR", "backup", "auto_start_failed", applog.F("error", startErr.Error()))
		}
	}

	// DryRun: load everything but don't serve.
	if s.cfg.DryRun {
		addr := ":3000"
		if v := strings.TrimSpace(os.Getenv("VPROX_ADDR")); v != "" {
			addr = v
		}
		if s.cfg.Addr != "" {
			addr = s.cfg.Addr
		}
		log.Println("")
		log.Println("DRY-RUN MODE #############################")
		log.Printf("Would listen on: %s", addr)
		log.Printf("Loaded chains: %d", len(s.chains))
		log.Printf("Backup enabled: %v", backupEnabled)
		log.Println("[DRY-RUN] All systems ready (not starting server)")
		s.cleanup()
		return nil
	}

	// Build mux and routes.
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", s.healthHandler)

	// Wire metric hooks.
	limit.OnRateLimitHit = metrics.RecordRateLimitHit
	geo.OnCacheHit = metrics.RecordGeoCacheHit
	geo.OnCacheMiss = metrics.RecordGeoCacheMiss
	backup.OnBackupEvent = metrics.RecordBackupEvent

	mux.HandleFunc("/websocket", ws.HandleWS(ws.Deps{
		ClientIP:          clientIP,
		LogRequestSummary: s.logRequestSummary,
		BackendWSParams: func(host string) (string, time.Duration, time.Duration, bool) {
			host = normalizeHost(host)
			ch, ok := s.chains[host]
			if !ok || !ch.Services.WebSocket || !ch.Services.RPC {
				return "", 0, 0, false
			}
			eff := s.defaultPorts
			if !ch.DefaultPorts && ch.Ports.RPC != 0 {
				eff.RPC = ch.Ports.RPC
			}
			backendURL := fmt.Sprintf("ws://%s:%d/websocket", ch.IP, eff.RPC)
			idle := time.Duration(ch.WS.IdleTimeoutSec) * time.Second
			if idle <= 0 {
				idle = 3600 * time.Second
			}
			hard := time.Duration(ch.WS.MaxLifetimeSec) * time.Second
			return backendURL, idle, hard, true
		},
	}))

	for _, prefix := range []string{rpcPrefix, restPrefix, grpcPrefix, grpcWebPrefix, apiPrefix} {
		mux.HandleFunc(prefix, s.handler)
		mux.HandleFunc(prefix+"/", s.handler)
	}
	mux.HandleFunc("/", s.handler)

	// Optional pprof debug server.
	if os.Getenv("VPROX_DEBUG") == "1" || os.Getenv("VPROX_DEBUG_PORT") != "" {
		debugPort := "6060"
		if p := os.Getenv("VPROX_DEBUG_PORT"); p != "" {
			debugPort = p
		}
		go func() {
			applog.Print("INFO", "debug", "pprof_server_started", applog.F("addr", ":"+debugPort))
			if err := http.ListenAndServe(":"+debugPort, http.DefaultServeMux); err != nil { //nolint:gosec // G114: debug server intentionally uses default timeouts
				applog.Print("ERROR", "debug", "pprof_server_error", applog.F("error", err.Error()))
			}
		}()
	}

	// Resolve listen address.
	addr := ":3000"
	if v := strings.TrimSpace(os.Getenv("VPROX_ADDR")); v != "" {
		addr = v
	}
	if s.cfg.Addr != "" {
		addr = s.cfg.Addr
	}

	s.httpSrv = &http.Server{
		Addr:              addr,
		Handler:           s.lim.Middleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	applog.Print("INFO", "server", "started", applog.F("addr", addr))

	errCh := make(chan error, 1)
	go func() {
		errCh <- s.httpSrv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		s.cleanup()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("vprox: server error: %w", err)
		}
		return nil
	case <-ctx.Done():
		applog.Print("INFO", "server", "shutdown_requested")
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		shutErr := s.httpSrv.Shutdown(shutCtx)
		s.cleanup()
		return shutErr
	}
}

// Shutdown performs a graceful HTTP server shutdown.
// For embedded use: prefer cancelling the context passed to Start.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpSrv == nil {
		return nil
	}
	err := s.httpSrv.Shutdown(ctx)
	s.cleanup()
	return err
}

// cleanup releases resources acquired during Start.
func (s *Server) cleanup() {
	if s.stopCounterTicker != nil {
		s.stopCounterTicker()
		s.stopCounterTicker = nil
	}
	if s.stopBackup != nil {
		s.stopBackup()
		s.stopBackup = nil
	}
	if s.lim != nil {
		_ = s.lim.Close()
	}
	geo.Close()
	s.closeChainLoggers()
}

// --------------------- LIMITER SETUP ---------------------

func (s *Server) buildLimiterOpts(proxyCfg proxySettings) (rps float64, burst int, opts []limit.Option) {
	settingsRPS := 25.0
	if proxyCfg.RateLimit.RPS > 0 {
		settingsRPS = proxyCfg.RateLimit.RPS
	}
	settingsBurst := 100
	if proxyCfg.RateLimit.Burst > 0 {
		settingsBurst = proxyCfg.RateLimit.Burst
	}
	settingsAutoEnabled := true
	if proxyCfg.AutoQuarantine.Enabled != nil {
		settingsAutoEnabled = *proxyCfg.AutoQuarantine.Enabled
	}
	settingsThreshold := 120
	if proxyCfg.AutoQuarantine.Threshold > 0 {
		settingsThreshold = proxyCfg.AutoQuarantine.Threshold
	}
	settingsWindowSec := 10
	if proxyCfg.AutoQuarantine.WindowSec > 0 {
		settingsWindowSec = proxyCfg.AutoQuarantine.WindowSec
	}
	settingsPenaltyRPS := 1.0
	if proxyCfg.AutoQuarantine.PenaltyRPS > 0 {
		settingsPenaltyRPS = proxyCfg.AutoQuarantine.PenaltyRPS
	}
	settingsPenaltyBurst := 1
	if proxyCfg.AutoQuarantine.PenaltyBurst > 0 {
		settingsPenaltyBurst = proxyCfg.AutoQuarantine.PenaltyBurst
	}
	settingsTTL := 900
	if proxyCfg.AutoQuarantine.TTLSec > 0 {
		settingsTTL = proxyCfg.AutoQuarantine.TTLSec
	}

	defaultRPS := envFloat("VPROX_RPS", settingsRPS)
	defaultBurst := envInt("VPROX_BURST", settingsBurst)
	autoEnabled := envBoolDefault("VPROX_AUTO_ENABLED", settingsAutoEnabled)
	autoThreshold := envInt("VPROX_AUTO_THRESHOLD", settingsThreshold)
	autoWindowSec := envInt("VPROX_AUTO_WINDOW_SEC", settingsWindowSec)
	autoPenaltyRPS := envFloat("VPROX_AUTO_RPS", settingsPenaltyRPS)
	autoPenaltyBurst := envInt("VPROX_AUTO_BURST", settingsPenaltyBurst)
	autoTTL := envInt("VPROX_AUTO_TTL_SEC", settingsTTL)

	// Apply CLI overrides.
	if s.cfg.RPS > 0 {
		defaultRPS = s.cfg.RPS
	}
	if s.cfg.Burst > 0 {
		defaultBurst = s.cfg.Burst
	}
	if s.cfg.DisableAuto {
		autoEnabled = false
	}
	if s.cfg.AutoRPS > 0 {
		autoPenaltyRPS = s.cfg.AutoRPS
	}
	if s.cfg.AutoBurst > 0 {
		autoPenaltyBurst = s.cfg.AutoBurst
	}

	opts = []limit.Option{
		limit.WithTrustProxy(true),
		limit.WithLogPath(filepath.Join(s.logsDir, "rate-limit.jsonl")),
		limit.WithLogOnlyImportant(),
		limit.WithMirrorToMainLog(),
		limit.WithDefaultActionDrop(),
	}
	if len(s.defaultPorts.TrustedProxies) > 0 {
		opts = append(opts, limit.WithTrustedProxies(s.defaultPorts.TrustedProxies))
	}
	if autoEnabled {
		opts = append(opts, limit.WithAutoQuarantine(limit.AutoRule{
			Threshold: autoThreshold,
			Window:    time.Duration(autoWindowSec) * time.Second,
			Penalty:   limit.RateSpec{RPS: autoPenaltyRPS, Burst: autoPenaltyBurst},
			TTL:       time.Duration(autoTTL) * time.Second,
		}))
	}
	return defaultRPS, defaultBurst, opts
}

// --------------------- PROXY SETTINGS ---------------------

// proxySettings holds values loaded from config/vprox/settings.toml.
type proxySettings struct {
	RateLimit struct {
		RPS   float64 `toml:"rps"`
		Burst int     `toml:"burst"`
	} `toml:"rate_limit"`
	AutoQuarantine struct {
		Enabled      *bool   `toml:"enabled"`
		Threshold    int     `toml:"threshold"`
		WindowSec    int     `toml:"window_sec"`
		PenaltyRPS   float64 `toml:"penalty_rps"`
		PenaltyBurst int     `toml:"penalty_burst"`
		TTLSec       int     `toml:"ttl_sec"`
	} `toml:"auto_quarantine"`
	Debug struct {
		Enabled bool `toml:"enabled"`
		Port    int  `toml:"port"`
	} `toml:"debug"`
}

func (s *Server) loadProxySettings() proxySettings {
	var ps proxySettings
	data, err := os.ReadFile(filepath.Join(s.configDir, "vprox", "settings.toml"))
	if err != nil {
		return ps
	}
	_ = toml.Unmarshal(data, &ps)
	return ps
}

func (s *Server) resolveBackupConfigPath() string {
	newPath := filepath.Join(s.configDir, "backup", "backup.toml")
	if _, err := os.Stat(newPath); err == nil {
		return newPath
	}
	return filepath.Join(s.configDir, "backup.toml")
}

// --------------------- CHAIN LOADING ---------------------

func (s *Server) registerHost(host string, c *config.ChainConfig) error {
	if host == "" {
		return nil
	}
	if existing, ok := s.chains[host]; ok {
		if existing.ChainName != c.ChainName {
			return fmt.Errorf("duplicate host %q in chain %q conflicts with %q", host, c.ChainName, existing.ChainName)
		}
	}
	s.chains[host] = c
	return nil
}

func (s *Server) loadChains(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	type chainEntry struct {
		name string
		slug string
		cfg  config.ChainConfig
	}

	var parsed []chainEntry
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !config.IsChainTOML(name) {
			continue
		}
		fpath := filepath.Join(dir, name)
		f, err := os.Open(fpath)
		if err != nil {
			return err
		}
		var c config.ChainConfig
		decErr := toml.NewDecoder(f).Decode(&c)
		f.Close()
		if decErr != nil {
			return fmt.Errorf("decode %s: %w", name, decErr)
		}
		if err := config.ValidateConfig(&c); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		slug := ""
		if c.ChainID != "" {
			slug = c.ChainName
			if slug == "" {
				slug = strings.SplitN(c.ChainID, "-", 2)[0]
			}
		}
		s.warnChainProxyDeprecation(dir, name, &c)
		parsed = append(parsed, chainEntry{name: name, slug: slug, cfg: c})
	}

	if len(parsed) > 0 {
		var wg sync.WaitGroup
		for i := range parsed {
			if parsed[i].slug == "" {
				continue
			}
			wg.Add(1)
			go func(e *chainEntry) {
				defer wg.Done()
				cosmos.Enrich(e.slug, &e.cfg.DashboardName, &e.cfg.NetworkType, &e.cfg.RecommendedVersion, &e.cfg.Explorers)
			}(&parsed[i])
		}
		wg.Wait()
	}

	for i := range parsed {
		name := parsed[i].name
		c := &parsed[i].cfg
		for j, a := range c.RPCAliases {
			c.RPCAliases[j] = strings.ToLower(strings.TrimSpace(a))
		}
		for j, a := range c.RESTAliases {
			c.RESTAliases[j] = strings.ToLower(strings.TrimSpace(a))
		}
		for j, a := range c.APIAliases {
			c.APIAliases[j] = strings.ToLower(strings.TrimSpace(a))
		}

		base := c.Host
		if err := s.registerHost(base, c); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		if c.Expose.VHost {
			rp := c.Expose.VHostPrefix.RPC
			ap := c.Expose.VHostPrefix.REST
			if err := s.registerHost(rp+"."+base, c); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
			if err := s.registerHost(ap+"."+base, c); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
		}
		for _, h := range c.RPCAliases {
			if h != "" {
				if err := s.registerHost(h, c); err != nil {
					return fmt.Errorf("%s: %w", name, err)
				}
			}
		}
		for _, h := range c.RESTAliases {
			if h != "" {
				if err := s.registerHost(h, c); err != nil {
					return fmt.Errorf("%s: %w", name, err)
				}
			}
		}
		for _, h := range c.APIAliases {
			if h != "" {
				if err := s.registerHost(h, c); err != nil {
					return fmt.Errorf("%s: %w", name, err)
				}
			}
		}
	}

	if len(s.chains) == 0 {
		return fmt.Errorf("no chain configs found in %s", dir)
	}
	return nil
}

func (s *Server) warnChainProxyDeprecation(dir, filename string, c *config.ChainConfig) {
	hasProxy := c.Services.RPC || c.Services.REST || c.Services.GRPC ||
		c.Services.GRPCWeb || c.Services.WebSocket || c.Services.APIAlias ||
		c.Expose.Path || c.Expose.VHost ||
		c.Ports.RPC != 0 || c.Ports.REST != 0
	if !hasProxy {
		return
	}
	base := strings.TrimSuffix(filename, ".toml")
	samplePath := filepath.Join(dir, base+".sample")
	if _, err := os.Stat(samplePath); err != nil {
		return
	}
	if _, loaded := s.deprecationWarned.LoadOrStore(base, struct{}{}); loaded {
		return
	}
	log.Printf("[DEPRECATED] config/chains/%s.toml contains proxy fields. "+
		"Migrate to config/services/nodes/<node>.toml. "+
		"See config/chains/%s.sample for the identity-only format.",
		base, base)
}

// --------------------- REWRITE UTILS ---------------------

// rewriteRegexes holds pre-compiled patterns for a given (IP, host) pair.
type rewriteRegexes struct {
	rpcIP, rpcHost   *regexp.Regexp
	restIP, restHost *regexp.Regexp
}

func (s *Server) getRewriteRegexes(internalIP, baseHost string) *rewriteRegexes {
	key := internalIP + "|" + baseHost
	s.rewriteCacheMu.RLock()
	if r, ok := s.rewriteCache[key]; ok {
		s.rewriteCacheMu.RUnlock()
		return r
	}
	s.rewriteCacheMu.RUnlock()

	r := &rewriteRegexes{
		rpcIP:    regexp.MustCompile(`(?i)(https?:)?//` + regexp.QuoteMeta(internalIP) + `:26657/?`),
		rpcHost:  regexp.MustCompile(`(?i)(https?:)?//` + regexp.QuoteMeta(baseHost) + `:26657/?`),
		restIP:   regexp.MustCompile(`(?i)(https?:)?//` + regexp.QuoteMeta(internalIP) + `:1317/?`),
		restHost: regexp.MustCompile(`(?i)(https?:)?//` + regexp.QuoteMeta(baseHost) + `:1317/?`),
	}
	s.rewriteCacheMu.Lock()
	s.rewriteCache[key] = r
	s.rewriteCacheMu.Unlock()
	return r
}

func (s *Server) rewriteLinks(html, routePrefix, internalIP, baseHost, absoluteHost, maskRPC string, rpcVHost bool) string {
	re := s.getRewriteRegexes(internalIP, baseHost)
	switch routePrefix {
	case rpcPrefix:
		mask := strings.TrimSpace(maskRPC)
		mask = strings.TrimPrefix(mask, "https://")
		mask = strings.TrimPrefix(mask, "http://")
		mask = strings.TrimPrefix(mask, "//")
		mask = strings.TrimSuffix(mask, "/")
		if mask != "" {
			repl := "//" + mask + "/"
			html = re.rpcIP.ReplaceAllString(html, repl)
			html = re.rpcHost.ReplaceAllString(html, repl)
		} else {
			repl := "/rpc/"
			if rpcVHost {
				repl = "/"
			}
			html = re.rpcIP.ReplaceAllString(html, repl)
			html = re.rpcHost.ReplaceAllString(html, repl)
			if rpcVHost {
				html = strings.ReplaceAll(html, `href="/rpc/`, `href="/`)
				html = strings.ReplaceAll(html, `src="/rpc/`, `src="/`)
			}
		}
	case restPrefix, apiPrefix:
		html = re.restIP.ReplaceAllString(html, "/")
		html = re.restHost.ReplaceAllString(html, "/")
	}
	if absoluteHost != "" {
		switch routePrefix {
		case rpcPrefix:
			if rpcVHost {
				html = strings.ReplaceAll(html, `href="/`, `href="https://`+absoluteHost+`/`)
				html = strings.ReplaceAll(html, `src="/`, `src="https://`+absoluteHost+`/`)
			} else {
				html = strings.ReplaceAll(html, `href="/rpc`, `href="https://`+absoluteHost+`/rpc`)
				html = strings.ReplaceAll(html, `src="/rpc`, `src="https://`+absoluteHost+`/rpc`)
			}
		case restPrefix:
			html = strings.ReplaceAll(html, `href="/rest`, `href="https://`+absoluteHost+`/rest`)
			html = strings.ReplaceAll(html, `src="/rest`, `src="https://`+absoluteHost+`/rest`)
		case apiPrefix:
			html = strings.ReplaceAll(html, `href="/api`, `href="https://`+absoluteHost+`/api`)
			html = strings.ReplaceAll(html, `src="/api`, `src="https://`+absoluteHost+`/api`)
		}
	}
	return html
}

func injectBannerFromString(html, banner string) string {
	if strings.TrimSpace(banner) == "" {
		return html
	}
	return strings.Replace(html, "<body>", "<body>\n<div class=\"banner\">\n"+banner+"\n</div>\n", 1)
}

func injectBannerFile(html, bannerPath string) (string, error) {
	b, err := os.ReadFile(bannerPath)
	if err != nil {
		return "", err
	}
	return strings.Replace(html, "<body>", "<body>\n<div class=\"banner\">\n"+string(b)+"\n</div>\n", 1), nil
}

func (s *Server) bannerPath(chain, routePrefix string) string {
	chain = strings.ToLower(chain)
	switch routePrefix {
	case rpcPrefix:
		return filepath.Join(s.configDir, "msg", chain, "rpc.msg")
	case restPrefix, apiPrefix:
		return filepath.Join(s.configDir, "msg", chain, "rest.msg")
	}
	return ""
}

// --------------------- LOGGING ---------------------

func clientIP(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); v != "" {
		if ip := sanitizeIP(v); ip != "" {
			return ip
		}
	}
	if v := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); v != "" {
		if ip := sanitizeIP(strings.TrimSpace(strings.Split(v, ",")[0])); ip != "" {
			return ip
		}
	}
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return h
	}
	return r.RemoteAddr
}

func sanitizeIP(s string) string {
	if net.ParseIP(s) != nil {
		return s
	}
	return ""
}

func (s *Server) logRequestSummary(r *http.Request, proxied bool, route string, host string, start time.Time, statusCode int) {
	src := clientIP(r)
	hostNorm := normalizeHost(host)
	srcQty := counter.Increment(src)
	durMS := time.Since(start).Milliseconds()
	dst := r.URL.RequestURI()
	ua := r.Header.Get("User-Agent")
	country := strings.TrimSpace(r.Header.Get("CF-IPCountry"))
	if country == "" {
		country = geo.Country(clientIP(r))
	}
	if country == "" {
		country = "--"
	}
	var logID string
	switch {
	case strings.HasPrefix(route, "ws") || strings.HasPrefix(route, "websocket"):
		logID = applog.EnsureRequestID(r)
	default:
		if id := applog.RequestIDFrom(r); id != "" {
			logID = id
		} else {
			logID = applog.NewTypedID(config.PathPrefix(dst))
		}
	}
	limStatus := strings.ToUpper(limit.StatusOf(r))
	status := "COMPLETED"
	if limStatus != "" && limStatus != "OK" {
		status = limStatus
	}
	switch route {
	case "websocket":
		status = "CONNECTED"
	case "ws-deny":
		status = "DENIED"
	case "ws-upgrade-fail", "ws-backend-fail":
		status = "FAILED"
	}
	line := applog.LineLifecycle("NEW", "vProx",
		applog.F("ID", logID),
		applog.F("status", status),
		applog.F("method", r.Method),
		applog.F("statusCode", statusCode),
		applog.F("from", src),
		applog.F("count", srcQty),
		applog.F("to", strings.ToUpper(hostNorm)),
		applog.F("chainId", hostNorm),
		applog.F("endpoint", dst),
		applog.F("latency", fmt.Sprintf("%dms", durMS)),
		applog.F("userAgent", ua),
		applog.F("country", country),
	)
	log.Println(line)
	if ch, ok := s.chains[hostNorm]; ok {
		if cl := s.getChainLogger(ch); cl != nil {
			cl.Println(line)
		}
	}
}

// --------------------- CHAIN LOGGERS ---------------------

func (s *Server) getChainLogger(c *config.ChainConfig) *log.Logger {
	if c == nil {
		return nil
	}
	file := strings.TrimSpace(c.Logging.File)
	if file == "" {
		return nil
	}
	if !filepath.IsAbs(file) {
		if strings.HasPrefix(file, "logs"+string(os.PathSeparator)) || strings.HasPrefix(file, "logs/") {
			file = filepath.Join(s.home, file)
		} else {
			file = filepath.Join(s.logsDir, file)
		}
	}
	s.chainLoggerMu.Lock()
	defer s.chainLoggerMu.Unlock()
	if lg, ok := s.chainLoggers[file]; ok {
		return lg
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return nil
	}
	f, err := os.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil
	}
	lg := log.New(f, "", 0)
	s.chainLoggers[file] = lg
	s.chainLogFiles[file] = f
	return lg
}

func (s *Server) closeChainLoggers() {
	s.chainLoggerMu.Lock()
	defer s.chainLoggerMu.Unlock()
	for path, f := range s.chainLogFiles {
		_ = f.Close()
		delete(s.chainLogFiles, path)
		delete(s.chainLoggers, path)
	}
}

// --------------------- HEALTH ---------------------

func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	status := "ok"
	httpCode := http.StatusOK
	if !geo.IsReady() {
		status = "degraded"
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpCode)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  status,
		"version": "1.0.0",
		"uptime":  time.Since(s.startTime).Round(time.Second).String(),
	})
}

// --------------------- CORE HANDLER ---------------------

var httpClient = &http.Client{
	Timeout: 5 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:    100,
		IdleConnTimeout: 90 * time.Second,
	},
}

func (s *Server) handler(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	metrics.IncActiveConnections()
	defer metrics.DecActiveConnections()
	host := normalizeHost(r.Host)

	chain, ok := s.chains[host]
	if !ok {
		http.Error(w, "Unknown host", http.StatusBadRequest)
		metrics.RecordProxyError("direct", "unknown_host")
		metrics.RecordRequest(r.Method, "direct", http.StatusBadRequest, time.Since(start))
		s.logRequestSummary(r, false, "direct", host, start, http.StatusBadRequest)
		return
	}

	eff := s.defaultPorts
	if !chain.DefaultPorts {
		if chain.Ports.RPC != 0 {
			eff.RPC = chain.Ports.RPC
		}
		if chain.Ports.REST != 0 {
			eff.REST = chain.Ports.REST
		}
		if chain.Ports.GRPC != 0 {
			eff.GRPC = chain.Ports.GRPC
		}
		if chain.Ports.GRPCWeb != 0 {
			eff.GRPCWeb = chain.Ports.GRPCWeb
		}
		if chain.Ports.API != 0 {
			eff.API = chain.Ports.API
		}
	}

	isRPCvhost, isRESTvhost := false, false
	if chain.Expose.VHost {
		rp := chain.Expose.VHostPrefix.RPC
		ap := chain.Expose.VHostPrefix.REST
		if rp == "" {
			rp = "rpc"
		}
		if ap == "" {
			ap = "api"
		}
		isRPCvhost = strings.HasPrefix(host, rp+".") || config.InList(chain.RPCAliases, host)
		isRESTvhost = strings.HasPrefix(host, ap+".") || config.InList(chain.RESTAliases, host) || config.InList(chain.APIAliases, host)
	}

	var (
		targetURL   string
		bannerFile  string
		bannerHTML  string
		injectHTML  bool
		routePrefix string
		route       string
	)

	if isRPCvhost && chain.Services.RPC {
		targetURL = fmt.Sprintf("http://%s:%d%s", chain.IP, eff.RPC, r.URL.Path)
		route = "direct"
		routePrefix = rpcPrefix
		if chain.Features.RPCAddressMasking && (r.URL.Path == "/" || r.URL.Path == "") {
			injectHTML = true
			if chain.MsgRPC {
				bannerHTML = chain.Message.RPCMsg
				bannerFile = s.bannerPath(chain.ChainName, rpcPrefix)
			}
		}
	} else if isRESTvhost && chain.Services.REST {
		targetURL = fmt.Sprintf("http://%s:%d%s", chain.IP, eff.REST, r.URL.Path)
		route = "direct"
		routePrefix = restPrefix
	} else {
		if chain.Expose.Path {
			switch {
			case strings.HasPrefix(r.URL.Path, rpcPrefix) && chain.Services.RPC:
				targetURL = fmt.Sprintf("http://%s:%d%s", chain.IP, eff.RPC, strings.TrimPrefix(r.URL.Path, rpcPrefix))
				route = "rpc"
				routePrefix = rpcPrefix
				if chain.Features.RPCAddressMasking && (r.URL.Path == "/rpc" || r.URL.Path == "/rpc/") {
					injectHTML = true
					if chain.MsgRPC {
						bannerHTML = chain.Message.RPCMsg
						bannerFile = s.bannerPath(chain.ChainName, rpcPrefix)
					}
				}
			case strings.HasPrefix(r.URL.Path, restPrefix) && chain.Services.REST:
				targetURL = fmt.Sprintf("http://%s:%d%s", chain.IP, eff.REST, strings.TrimPrefix(r.URL.Path, restPrefix))
				route = "rest"
				routePrefix = restPrefix
			case strings.HasPrefix(r.URL.Path, grpcPrefix) && chain.Services.GRPC:
				targetURL = fmt.Sprintf("http://%s:%d%s", chain.IP, eff.GRPC, strings.TrimPrefix(r.URL.Path, grpcPrefix))
				route = "rest"
			case strings.HasPrefix(r.URL.Path, grpcWebPrefix) && chain.Services.GRPCWeb:
				targetURL = fmt.Sprintf("http://%s:%d%s", chain.IP, eff.GRPCWeb, strings.TrimPrefix(r.URL.Path, grpcWebPrefix))
				route = "rest"
			case strings.HasPrefix(r.URL.Path, apiPrefix) && chain.Services.APIAlias:
				targetURL = fmt.Sprintf("http://%s:%d%s", chain.IP, eff.API, strings.TrimPrefix(r.URL.Path, apiPrefix))
				route = "rest"
				routePrefix = apiPrefix
			case (r.URL.Path == "/" || r.URL.Path == "") && chain.Services.REST:
				targetURL = fmt.Sprintf("http://%s:%d/", chain.IP, eff.REST)
				route = "rest"
			}
		}
	}

	if targetURL == "" {
		http.Error(w, "Not Found or service disabled", http.StatusNotFound)
		metrics.RecordProxyError("direct", "unknown_host")
		metrics.RecordRequest(r.Method, "direct", http.StatusNotFound, time.Since(start))
		s.logRequestSummary(r, false, "direct", host, start, http.StatusNotFound)
		return
	}

	requestID := applog.NewTypedID(config.RouteIDPrefix(routePrefix, route, isRPCvhost, isRESTvhost))
	r.Header.Set(applog.RequestIDHeader, requestID)
	applog.SetResponseRequestID(w, requestID)

	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		http.Error(w, "Request build error", http.StatusInternalServerError)
		metrics.RecordProxyError(route, "request_build_error")
		metrics.RecordRequest(r.Method, route, http.StatusInternalServerError, time.Since(start))
		s.logRequestSummary(r, false, route, host, start, http.StatusInternalServerError)
		return
	}
	req.Header = r.Header.Clone()
	if requestID != "" {
		req.Header.Set(applog.RequestIDHeader, requestID)
	}
	req.Header.Set("X-Forwarded-Host", host)
	if xf := req.Header.Get("X-Forwarded-For"); xf == "" {
		req.Header.Set("X-Forwarded-For", clientIP(r))
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		http.Error(w, "Backend error", http.StatusBadGateway)
		metrics.RecordProxyError(route, "backend_error")
		metrics.RecordRequest(r.Method, route, http.StatusBadGateway, time.Since(start))
		s.logRequestSummary(r, false, route, host, start, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	ctype := resp.Header.Get("Content-Type")
	willModify := injectHTML && strings.HasPrefix(ctype, "text/html")

	for k, v := range resp.Header {
		lk := strings.ToLower(k)
		if lk == "content-length" {
			continue
		}
		if willModify && lk == "content-encoding" {
			continue
		}
		for _, vv := range v {
			w.Header().Add(k, vv)
		}
	}
	if !willModify {
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		metrics.RecordRequest(r.Method, route, resp.StatusCode, time.Since(start))
		s.logRequestSummary(r, true, route, host, start, resp.StatusCode)
		return
	}

	var reader io.Reader = resp.Body
	if strings.Contains(resp.Header.Get("Content-Encoding"), "gzip") {
		gzReader, err := gzip.NewReader(resp.Body)
		if err != nil {
			http.Error(w, "Gzip error", http.StatusInternalServerError)
			metrics.RecordProxyError(route, "backend_error")
			metrics.RecordRequest(r.Method, route, http.StatusInternalServerError, time.Since(start))
			s.logRequestSummary(r, false, route, host, start, http.StatusInternalServerError)
			return
		}
		defer gzReader.Close()
		reader = gzReader
	}
	w.WriteHeader(resp.StatusCode)

	var absoluteHost string
	switch strings.ToLower(chain.Features.AbsoluteLinks) {
	case "always":
		absoluteHost = host
	case "never":
		absoluteHost = ""
	default:
		if strings.Contains(r.Header.Get("X-Forwarded-Host"), ".cosmos.directory") ||
			strings.Contains(r.Header.Get("Referer"), ".cosmos.directory") {
			absoluteHost = host
		}
	}

	rawHTML, _ := io.ReadAll(io.LimitReader(reader, 10<<20))
	html := string(rawHTML)
	html = s.rewriteLinks(html, routePrefix, chain.IP, chain.Host, absoluteHost, chain.Features.MaskRPC, isRPCvhost)

	if injectHTML {
		if strings.TrimSpace(bannerHTML) != "" {
			html = injectBannerFromString(html, bannerHTML)
		} else if bannerFile != "" {
			if mod, err := injectBannerFile(html, bannerFile); err == nil {
				html = mod
			}
		}
	}

	_, _ = w.Write([]byte(html))
	metrics.RecordRequest(r.Method, route, resp.StatusCode, time.Since(start))
	s.logRequestSummary(r, true, route, host, start, resp.StatusCode)
}

// --------------------- UTILS ---------------------

func normalizeHost(raw string) string {
	h := strings.ToLower(strings.TrimSpace(raw))
	if h == "" {
		return h
	}
	if strings.HasPrefix(h, "[") {
		if host, _, err := net.SplitHostPort(h); err == nil {
			return host
		}
		return strings.Trim(h, "[]")
	}
	if strings.Count(h, ":") > 1 {
		return h
	}
	if host, _, err := net.SplitHostPort(h); err == nil {
		return host
	}
	return h
}

func envBoolDefault(key string, def bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	return v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
}

func envInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscan(v, &n); err == nil {
		return n
	}
	return def
}

func envFloat(key string, def float64) float64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	var f float64
	if _, err := fmt.Sscan(v, &f); err == nil {
		return f
	}
	return def
}

// --------------------- BACKUP UTILITIES ---------------------

func disableBackupInConfig(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return os.WriteFile(path, []byte("[backup]\nautomation = false\n"), 0o600)
		}
		return err
	}
	content := string(data)
	if strings.Contains(content, "automation = true") {
		content = strings.ReplaceAll(content, "automation = true", "automation = false")
	} else if !strings.Contains(content, "automation") {
		if idx := strings.Index(content, "[backup]"); idx >= 0 {
			eol := strings.Index(content[idx:], "\n")
			if eol >= 0 {
				insert := idx + eol + 1
				content = content[:insert] + "automation = false\n" + content[insert:]
			} else {
				content += "\nautomation = false\n"
			}
		} else {
			content += "\n[backup]\nautomation = false\n"
		}
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

func resolveBackupExtraFiles(cfg backup.BackupConfig, dataDir, logsDir, configDir, mainLogPath string) (rotate, extra []string) {
	splitNames := func(entries []string) []string {
		var out []string
		for _, entry := range entries {
			for _, name := range strings.Split(entry, ",") {
				name = strings.TrimSpace(name)
				if name != "" {
					out = append(out, name)
				}
			}
		}
		return out
	}
	mainLogClean := filepath.Clean(mainLogPath)
	if entries, err := os.ReadDir(logsDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".log") {
				continue
			}
			p := filepath.Join(logsDir, e.Name())
			if filepath.Clean(p) == mainLogClean {
				continue
			}
			rotate = append(rotate, p)
		}
	}
	for _, name := range splitNames(cfg.Backup.Files.Logs) {
		p := filepath.Join(logsDir, name)
		if filepath.Clean(p) == mainLogClean {
			continue
		}
		if strings.HasSuffix(name, ".log") {
			if !config.ContainsString(rotate, p) {
				rotate = append(rotate, p)
			}
		} else {
			extra = append(extra, p)
		}
	}
	for _, name := range splitNames(cfg.Backup.Files.Data) {
		extra = append(extra, filepath.Join(dataDir, name))
	}
	for _, name := range splitNames(cfg.Backup.Files.Config) {
		extra = append(extra, filepath.Join(configDir, name))
	}
	return rotate, extra
}
