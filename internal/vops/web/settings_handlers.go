package web

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	bkp "github.com/vNodesV/vOps/internal/backup"
	proxycfg "github.com/vNodesV/vOps/internal/config"
	"github.com/vNodesV/vOps/internal/logging"
	"golang.org/x/crypto/ssh"

	"github.com/pelletier/go-toml/v2"
	fleetcfg "github.com/vNodesV/vOps/internal/fleet/config"
	vopscfg "github.com/vNodesV/vOps/internal/vops/config"
)

// vopsSecretDir returns the path to ~/.vprox/secret and ensures it exists (0700).
func vopsSecretDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".vOps", "secret")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

// sshKeyPaths returns the private and public key file paths inside the secret dir.
func sshKeyPaths() (priv, pub string, err error) {
	dir, err := vopsSecretDir()
	if err != nil {
		return "", "", err
	}
	return filepath.Join(dir, "vops_ssh_key"),
		filepath.Join(dir, "vops_ssh_key.pub"),
		nil
}

// handleAPIGetSSHPubKey returns the current vOps SSH public key (if any).
// GET /settings/api/ssh-pub-key → {"pub_key":"ssh-ed25519 ...", "exists":true}
//
// Resolution order:
//  1. ~/.vprox/secret/vops_ssh_key.pub  (standard generated location)
//  2. <fleet.defaults.key_path>.pub      (configured fleet key)
//  3. Private key at either location — public key derived in-memory (no file written)
func (s *Server) handleAPIGetSSHPubKey(w http.ResponseWriter, _ *http.Request) {
	privPath, pubPath, err := sshKeyPaths()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Build ordered candidate lists for .pub and private key files.
	pubCandidates := []string{pubPath}
	privCandidates := []string{privPath}
	if kp := strings.TrimSpace(s.cfg.VOps.Push.Defaults.KeyPath); kp != "" {
		pubCandidates = append(pubCandidates, kp+".pub")
		privCandidates = append(privCandidates, kp)
	}

	// 1. Try reading an existing .pub file.
	for _, p := range pubCandidates {
		data, readErr := os.ReadFile(p)
		if readErr == nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"exists":     true,
				"public_key": strings.TrimSpace(string(data)),
				"path":       p,
			})
			return
		}
	}

	// 2. No .pub file found — attempt to derive the public key from the private key.
	for _, p := range privCandidates {
		data, readErr := os.ReadFile(p)
		if readErr != nil {
			continue
		}
		signer, parseErr := ssh.ParsePrivateKey(data)
		if parseErr != nil {
			continue
		}
		pubKeyStr := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey())))
		writeJSON(w, http.StatusOK, map[string]any{
			"exists":     true,
			"public_key": pubKeyStr,
			"path":       p,
			"derived":    true, // derived from private key — no .pub file on disk
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"exists": false, "public_key": ""})
}

// handleAPIGenSSHKey generates a new ed25519 SSH key pair, stores it in
// ~/.vprox/secret/ and returns the public key.
// POST /settings/api/gen-ssh-key → {"pub_key":"ssh-ed25519 ...", "path":"~/.vprox/secret/vops_ssh_key"}
func (s *Server) handleAPIGenSSHKey(w http.ResponseWriter, _ *http.Request) {
	privPath, pubPath, err := sshKeyPaths()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cannot create secret dir: " + err.Error()})
		return
	}

	// Generate ed25519 key pair.
	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key generation failed: " + err.Error()})
		return
	}

	// Marshal private key to OpenSSH PEM format.
	privPEM, err := ssh.MarshalPrivateKey(privKey, "vops_ssh_key")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "marshal private key: " + err.Error()})
		return
	}
	privBytes := pem.EncodeToMemory(privPEM)

	// Marshal public key to OpenSSH authorized_keys format.
	sshPub, err := ssh.NewPublicKey(pubKey)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "marshal public key: " + err.Error()})
		return
	}
	pubBytes := ssh.MarshalAuthorizedKey(sshPub)

	// Write private key (0600).
	if err := os.WriteFile(privPath, privBytes, 0600); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "write private key: " + err.Error()})
		return
	}
	// Write public key (0644).
	if err := os.WriteFile(pubPath, pubBytes, 0644); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "write public key: " + err.Error()})
		return
	}

	logging.Print("INF", "vops", "SSH key pair generated", logging.F("path", privPath))
	writeJSON(w, http.StatusOK, map[string]any{
		"public_key":       strings.TrimSpace(string(pubBytes)),
		"private_key_path": privPath,
	})
}

// ── Config path helpers ───────────────────────────────────────────────────

// vopsConfigPath returns the effective path to vops.toml.
func (s *Server) vopsConfigPath() string {
	if s.cfgPath != "" {
		return s.cfgPath
	}
	return filepath.Join(s.home, "config", "vops", "vops.toml")
}

// vproxHome returns the vProx home directory. When Vprox.ConfigPath is set in
// vops.toml (external vProx install), it is used directly; otherwise the vOps
// home directory is shared.
func (s *Server) vproxHome() string {
	if p := strings.TrimSpace(s.cfg.Vprox.ConfigPath); p != "" {
		return p
	}
	return s.home
}

// patchTOMLTheme surgically updates the `theme = "..."` line inside [vops.ui]
// in the given vops.toml file without touching any other field or comment.
// If the file doesn't exist yet it is created with just the [vops.ui] section.
// If [vops.ui] exists but has no `theme` key, one is appended before the next
// section header (or at the end of file). This avoids the full marshal round-trip
// that would silently clobber user-edited values.
func patchTOMLTheme(path, theme string) error {
	raw, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read vops.toml: %w", err)
	}

	lines := strings.Split(string(raw), "\n")
	inUISection := false
	themeLineIdx := -1
	uiSectionIdx := -1
	nextSectionIdx := -1

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") {
			if trimmed == "[vops.ui]" {
				inUISection = true
				uiSectionIdx = i
			} else if inUISection {
				// Hit the next section — record it and stop scanning.
				nextSectionIdx = i
				break
			} else {
				inUISection = false
			}
			continue
		}
		if inUISection && strings.HasPrefix(trimmed, "theme") {
			key, _, ok := strings.Cut(trimmed, "=")
			if ok && strings.TrimSpace(key) == "theme" {
				themeLineIdx = i
			}
		}
	}

	newLine := `theme = "` + theme + `"`

	switch {
	case themeLineIdx >= 0:
		// Replace existing theme line, preserving leading whitespace.
		lines[themeLineIdx] = newLine
	case uiSectionIdx >= 0:
		// [vops.ui] exists but no theme key — insert after the section header.
		insertAt := uiSectionIdx + 1
		if nextSectionIdx > 0 {
			insertAt = nextSectionIdx
		}
		lines = append(lines[:insertAt], append([]string{newLine}, lines[insertAt:]...)...)
	default:
		// No [vops.ui] section at all — append it.
		if len(lines) > 0 && lines[len(lines)-1] != "" {
			lines = append(lines, "")
		}
		lines = append(lines, "[vops.ui]", newLine)
	}

	out := strings.Join(lines, "\n")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	return os.WriteFile(path, []byte(out), 0o600)
}

// writeConfig atomically writes data to path, creating parent dirs as needed.
func writeConfig(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write tmp: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// ── JSON map extraction helpers ───────────────────────────────────────────

func mapStr(m map[string]any, key string) (string, bool) {
	v, ok := m[key]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

func mapInt(m map[string]any, key string) (int, bool) {
	v, ok := m[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	}
	return 0, false
}

func mapBool(m map[string]any, key string) (bool, bool) {
	v, ok := m[key]
	if !ok {
		return false, false
	}
	b, ok := v.(bool)
	return b, ok
}

func asMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

// ── Snapshot helpers ──────────────────────────────────────────────────────

// redactVopsConfig returns a copy of cfg with secret fields replaced by "[REDACTED]".
func redactVopsConfig(cfg vopscfg.Config) vopscfg.Config {
	if cfg.VOps.Intel.Keys.AbuseIPDB != "" {
		cfg.VOps.Intel.Keys.AbuseIPDB = "[REDACTED]"
	}
	if cfg.VOps.Intel.Keys.VirusTotal != "" {
		cfg.VOps.Intel.Keys.VirusTotal = "[REDACTED]"
	}
	if cfg.VOps.Intel.Keys.Shodan != "" {
		cfg.VOps.Intel.Keys.Shodan = "[REDACTED]"
	}
	if cfg.VOps.Auth.PasswordHash != "" {
		cfg.VOps.Auth.PasswordHash = "[REDACTED]"
	}
	return cfg
}

// buildFleetTOML synthesises a TOML string in the format FleetSSHPanel's
// parseTOML expects: [ssh], [poll], [defaults] sections.
func buildFleetTOML(cfg vopscfg.Config) string {
	d := cfg.VOps.Push.Defaults
	port := cfg.VOps.Auth.SSHPort
	if port == 0 {
		port = 22
	}
	poll := cfg.VOps.Push.PollIntervalSec
	if poll == 0 {
		poll = 60
	}
	return fmt.Sprintf(
		"[ssh]\nuser = %q\nkey_path = %q\nknown_hosts_path = %q\nport = %d\ntimeout_sec = 15\n\n[poll]\ninterval_sec = %d\n\n[defaults]\ndatacenter = \"\"\n",
		d.User, d.KeyPath, d.KnownHostsPath, port, poll,
	)
}

// readBackupTOML returns the contents of backup.toml as a string.
func (s *Server) readBackupTOML() string {
	vh := s.vproxHome()
	paths := []string{
		filepath.Join(vh, "config", "backup", "backup.toml"),
		filepath.Join(vh, "config", "backup.toml"),
	}
	for _, p := range paths {
		if b, err := os.ReadFile(p); err == nil {
			return string(b)
		}
	}
	// Return marshaled defaults.
	cfg := bkp.DefaultConfig()
	b, _ := toml.Marshal(cfg)
	return string(b)
}

// readPortsTOML returns the contents of ports.toml as a string.
func (s *Server) readPortsTOML() string {
	vh := s.vproxHome()
	paths := []string{
		filepath.Join(vh, "config", "chains", "ports.toml"),
		filepath.Join(vh, "config", "ports.toml"),
	}
	for _, p := range paths {
		if b, err := os.ReadFile(p); err == nil {
			return string(b)
		}
	}
	return ""
}

// readProxySettingsTOML returns the contents of vprox/settings.toml as a string.
func (s *Server) readProxySettingsTOML() string {
	p := filepath.Join(s.vproxHome(), "config", "vprox", "settings.toml")
	if b, err := os.ReadFile(p); err == nil {
		return string(b)
	}
	return ""
}

// infraEntry mirrors the InfraEntry shape the UI expects.
type infraEntry struct {
	File       string           `json:"file"`
	Datacenter string           `json:"datacenter"`
	Host       map[string]any   `json:"host"`
	Vprox      map[string]any   `json:"vprox"`
	VMs        []map[string]any `json:"vms"`
}

// readInfraEntries scans the infra dir and returns structured entries.
func (s *Server) readInfraEntries() []infraEntry {
	dir := s.cfg.VOps.Push.InfraDir
	if dir == "" {
		dir = filepath.Join(s.home, "config", "infra")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []infraEntry{}
	}
	var result []infraEntry
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".toml" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var schema struct {
			Host  fleetcfg.Host `toml:"host"`
			Vprox struct {
				User       string `toml:"user"`
				SSHKeyPath string `toml:"ssh_key_path"`
			} `toml:"vprox"`
			VMs []fleetcfg.VM `toml:"vm"`
		}
		if err := toml.Unmarshal(data, &schema); err != nil {
			continue
		}
		dc := strings.TrimSuffix(e.Name(), ".toml")
		entry := infraEntry{
			File:       e.Name(),
			Datacenter: dc,
			Host: map[string]any{
				"name":         schema.Host.Name,
				"lan_ip":       schema.Host.LanIP,
				"public_ip":    schema.Host.PublicIP,
				"vrack_ip":     schema.Host.VRackIP,
				"user":         schema.Host.User,
				"ssh_key_path": schema.Host.SSHKeyPath,
				"port":         schema.Host.Port,
			},
			Vprox: map[string]any{
				"user":         schema.Vprox.User,
				"ssh_key_path": schema.Vprox.SSHKeyPath,
			},
			VMs: make([]map[string]any, 0, len(schema.VMs)),
		}
		for _, vm := range schema.VMs {
			entry.VMs = append(entry.VMs, map[string]any{
				"name":            vm.Name,
				"host":            vm.Host,
				"host_ref":        vm.HostRef,
				"lan_ip":          vm.LanIP,
				"public_ip":       vm.PublicIP,
				"port":            vm.Port,
				"user":            vm.User,
				"key_path":        vm.KeyPath,
				"datacenter":      vm.Datacenter,
				"type":            vm.Type,
				"chain_name":      vm.ChainName,
				"ping_country":    vm.Ping.Country,
				"ping_provider":   vm.Ping.Provider,
				"proxy_jump_host": vm.ProxyJumpHost,
			})
		}
		result = append(result, entry)
	}
	if result == nil {
		return []infraEntry{}
	}
	return result
}

// chainEntry mirrors the ChainEntry shape the UI expects.
type chainEntry struct {
	File   string         `json:"file"`
	Name   string         `json:"name"`
	Raw    string         `json:"raw,omitempty"`
	Fields map[string]any `json:"fields,omitempty"`
}

// readChainEntries scans the chains dir and returns structured entries.
func (s *Server) readChainEntries() []chainEntry {
	dir := s.cfg.VOps.Push.ChainsDir
	if dir == "" {
		dir = filepath.Join(s.home, "config", "chains")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []chainEntry{}
	}
	var result []chainEntry
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".toml" {
			continue
		}
		if !proxycfg.IsChainTOML(e.Name()) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var cc proxycfg.ChainConfig
		if err := toml.Unmarshal(data, &cc); err != nil {
			continue
		}
		result = append(result, chainEntry{
			File: e.Name(),
			Name: cc.ChainName,
			Raw:  string(data),
			Fields: map[string]any{
				"chain_name":          cc.ChainName,
				"chain_id":            cc.ChainID,
				"dashboard_name":      cc.DashboardName,
				"explorer_base":       cc.ExplorerBase,
				"chain_ping_country":  cc.ChainPing.Country,
				"chain_ping_provider": cc.ChainPing.Provider,
			},
		})
	}
	if result == nil {
		return []chainEntry{}
	}
	return result
}

func (s *Server) handleAPISettingsCurrent(w http.ResponseWriter, _ *http.Request) {
	cfg, err := vopscfg.Load(s.vopsConfigPath())
	if err != nil && !os.IsNotExist(err) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not read vops.toml"})
		return
	}
	if os.IsNotExist(err) {
		cfg = vopscfg.DefaultConfig(s.home)
	}

	// Marshal redacted config as TOML string for the vops panel.
	redacted := redactVopsConfig(cfg)
	vopsData, _ := toml.Marshal(redacted)

	snapshot := map[string]any{
		"vops":     string(vopsData),
		"fleet":    buildFleetTOML(cfg),
		"backup":   s.readBackupTOML(),
		"ports":    s.readPortsTOML(),
		"settings": s.readProxySettingsTOML(),
		"infras":   s.readInfraEntries(),
		"chains":   s.readChainEntries(),
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleAPISettingsImport(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "config wizard removed"})
}

func (s *Server) handleAPISettingsRemove(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "config wizard removed"})
}

func (s *Server) handleAPISettingsApply(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	var req struct {
		Steps []string `json:"steps"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	stepSet := make(map[string]struct{}, len(req.Steps))
	for _, raw := range req.Steps {
		step := strings.ToLower(strings.TrimSpace(raw))
		if step == "" {
			continue
		}
		stepSet[step] = struct{}{}
	}

	requires := make(map[string]struct{})
	softReloaded := make([]string, 0, 1)

	_, needsFleet := stepSet["fleet"]
	_, needsChain := stepSet["chain"]
	_, needsInfra := stepSet["infra"]
	if needsFleet || needsChain || needsInfra {
		if s.fleetSvc != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
			defer cancel()
			s.reloadFleetRuntime(ctx)
			softReloaded = append(softReloaded, "fleet")
		} else {
			requires["vops"] = struct{}{}
		}
	}

	if _, ok := stepSet["vops"]; ok {
		requires["vops"] = struct{}{}
	}
	if _, ok := stepSet["backup"]; ok {
		requires["vops"] = struct{}{}
	}
	if _, ok := stepSet["ports"]; ok {
		requires["vprox"] = struct{}{}
	}
	if _, ok := stepSet["settings"]; ok {
		requires["vprox"] = struct{}{}
	}

	restartTargets := make([]string, 0, len(requires))
	for target := range requires {
		restartTargets = append(restartTargets, target)
	}
	sort.Strings(restartTargets)
	sort.Strings(softReloaded)

	message := "No runtime changes were applied."
	switch {
	case len(softReloaded) > 0 && len(restartTargets) == 0:
		message = "Settings applied with soft reload."
	case len(softReloaded) > 0 && len(restartTargets) > 0:
		message = "Fleet reloaded. Some modules still require a service restart."
	case len(restartTargets) > 0:
		message = "Changes saved. Service restart required to apply all updates."
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":           "ok",
		"applied_steps":    req.Steps,
		"soft_reloaded":    softReloaded,
		"requires_restart": restartTargets,
		"message":          message,
	})
}

// reloadFleetRuntime reloads fleet config from disk and updates the in-memory
// fleet service. Called after infra/fleet/chain settings are saved so that
// fleet scan, VM status, and VM manager immediately reflect new TOML content
// without requiring a service restart.
func (s *Server) reloadFleetRuntime(ctx context.Context) {
	if s.fleetSvc == nil {
		return
	}
	defs := fleetcfg.FleetDefaults{
		User:           s.cfg.VOps.Push.Defaults.User,
		KeyPath:        s.cfg.VOps.Push.Defaults.KeyPath,
		KnownHostsPath: s.cfg.VOps.Push.Defaults.KnownHostsPath,
	}
	runtimeCfg, err := fleetcfg.LoadRuntimeConfig(s.home, defs, s.cfg.VOps.Push.ChainsDir, s.cfg.VOps.Push.InfraDir)
	if err != nil {
		logging.Print("ERR", "settings", "fleet runtime reload failed", logging.F("err", err))
		return
	}
	s.fleetSvc.SetConfig(runtimeCfg)
	pollCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	s.fleetSvc.Poll(pollCtx)
}

// ── Section savers ────────────────────────────────────────────────────────

func (s *Server) saveVopsSection(raw any) error {
	cfgPath := s.vopsConfigPath()
	cfg, err := vopscfg.Load(cfgPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("load vops.toml: %w", err)
	}
	if os.IsNotExist(err) {
		cfg = vopscfg.DefaultConfig(s.home)
	}
	switch p := raw.(type) {
	case map[string]any:
		if v, ok := mapInt(p, "port"); ok {
			cfg.VOps.Port = v
		}
		if v, ok := mapStr(p, "bind_address"); ok {
			cfg.VOps.BindAddress = v
		}
		if v, ok := mapStr(p, "base_path"); ok {
			cfg.VOps.BasePath = v
		}
		if v, ok := mapStr(p, "username"); ok {
			cfg.VOps.Auth.Username = v
		}
		if v, ok := mapBool(p, "auto_enrich"); ok {
			cfg.VOps.Intel.AutoEnrich = v
		}
		if v, ok := mapInt(p, "cache_ttl_hours"); ok {
			cfg.VOps.Intel.CacheTTLHours = v
		}
		if v, ok := mapInt(p, "rate_limit_rpm"); ok {
			cfg.VOps.Intel.RateLimitRPM = v
		}
		if v, ok := mapInt(p, "watch_interval_sec"); ok {
			cfg.VOps.WatchIntervalSec = v
		}
		if v, ok := mapInt(p, "poll_interval_sec"); ok {
			cfg.VOps.Push.PollIntervalSec = v
		}
		if v, ok := mapBool(p, "auto_ban_enabled"); ok {
			cfg.VOps.Intel.AutoBanEnabled = v
		}
		if v, ok := mapInt(p, "auto_ban_threshold"); ok {
			cfg.VOps.Intel.AutoBanThreshold = v
		}
		if v, ok := mapInt(p, "ban_duration_seconds"); ok {
			cfg.VOps.Intel.BanDurationSeconds = v
		}
		if v, ok := mapBool(p, "ban_permanent"); ok {
			cfg.VOps.Intel.BanPermanent = v
		}
		if v, ok := mapStr(p, "ban_whitelist"); ok {
			if v == "" {
				cfg.VOps.Intel.BanWhitelist = nil
			} else {
				parts := strings.Split(v, ",")
				cfg.VOps.Intel.BanWhitelist = make([]string, 0, len(parts))
				for _, part := range parts {
					if t := strings.TrimSpace(part); t != "" {
						cfg.VOps.Intel.BanWhitelist = append(cfg.VOps.Intel.BanWhitelist, t)
					}
				}
			}
		}
	case string:
		var overlay vopscfg.Config
		if err := toml.Unmarshal([]byte(p), &overlay); err != nil {
			return fmt.Errorf("parse vops TOML: %w", err)
		}
		cfg = overlay
	}
	data, err := toml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal vops.toml: %w", err)
	}
	return writeConfig(cfgPath, data)
}

func (s *Server) saveFleetSection(raw any) error {
	cfgPath := s.vopsConfigPath()
	cfg, err := vopscfg.Load(cfgPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("load vops.toml: %w", err)
	}
	if os.IsNotExist(err) {
		cfg = vopscfg.DefaultConfig(s.home)
	}
	if p, ok := asMap(raw); ok {
		if v, ok := mapStr(p, "ssh_user"); ok {
			cfg.VOps.Push.Defaults.User = v
		}
		if v, ok := mapStr(p, "ssh_key_path"); ok {
			cfg.VOps.Push.Defaults.KeyPath = v
		}
		if v, ok := mapStr(p, "known_hosts_path"); ok {
			cfg.VOps.Push.Defaults.KnownHostsPath = v
		}
		if v, ok := mapInt(p, "poll_interval_sec"); ok {
			cfg.VOps.Push.PollIntervalSec = v
		}
		if v, ok := mapInt(p, "ssh_port"); ok {
			cfg.VOps.Auth.SSHPort = v
		}
	}
	data, err := toml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal vops.toml (fleet): %w", err)
	}
	return writeConfig(cfgPath, data)
}

func (s *Server) saveBackupSection(raw any) error {
	vh := s.vproxHome()
	path := filepath.Join(vh, "config", "backup", "backup.toml")
	// Prefer new path; fall back to legacy.
	legacyPath := filepath.Join(vh, "config", "backup.toml")
	if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
		if _, legErr := os.Stat(legacyPath); legErr == nil {
			path = legacyPath
		}
	}
	cfg, _, err := bkp.LoadConfig(path)
	if err != nil {
		return fmt.Errorf("load backup.toml: %w", err)
	}
	if p, ok := asMap(raw); ok {
		if v, ok := mapBool(p, "automation"); ok {
			cfg.Backup.Automation = v
		}
		if v, ok := mapInt(p, "interval_days"); ok {
			cfg.Backup.IntervalDays = v
		}
		if v, ok := mapInt(p, "max_size_mb"); ok {
			cfg.Backup.MaxSizeMB = int64(v)
		}
		if v, ok := mapInt(p, "check_interval_min"); ok {
			cfg.Backup.CheckIntervalMin = v
		}
		if v, ok := mapStr(p, "destination"); ok {
			cfg.Backup.Destination = v
		}
		if v, ok := mapStr(p, "compression"); ok && v != "" {
			cfg.Backup.Compression = v
		}
	} else if str, ok := raw.(string); ok {
		if err := toml.Unmarshal([]byte(str), &cfg); err != nil {
			return fmt.Errorf("parse backup TOML: %w", err)
		}
	}
	data, err := toml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal backup.toml: %w", err)
	}
	return writeConfig(path, data)
}

func (s *Server) savePortsSection(raw any) error {
	vh := s.vproxHome()
	// Prefer legacy config/ports.toml if it already exists.
	path := filepath.Join(vh, "config", "chains", "ports.toml")
	legacyPath := filepath.Join(vh, "config", "ports.toml")
	if _, err := os.Stat(legacyPath); err == nil {
		path = legacyPath
	}
	var ports proxycfg.Ports
	if b, err := os.ReadFile(path); err == nil {
		_ = toml.Unmarshal(b, &ports)
	}
	if p, ok := asMap(raw); ok {
		if v, ok := mapInt(p, "rpc"); ok {
			ports.RPC = v
		}
		if v, ok := mapInt(p, "rest"); ok {
			ports.REST = v
		}
		if v, ok := mapInt(p, "grpc"); ok {
			ports.GRPC = v
		}
		if v, ok := mapInt(p, "grpc_web"); ok {
			ports.GRPCWeb = v
		}
		if v, ok := mapInt(p, "api"); ok {
			ports.API = v
		}
		if v, ok := mapStr(p, "vops_url"); ok {
			ports.VOpsURL = v
		}
	} else if str, ok := raw.(string); ok {
		if err := toml.Unmarshal([]byte(str), &ports); err != nil {
			return fmt.Errorf("parse ports TOML: %w", err)
		}
	}
	data, err := toml.Marshal(ports)
	if err != nil {
		return fmt.Errorf("marshal ports.toml: %w", err)
	}
	return writeConfig(path, data)
}

// proxySettingsFile mirrors the vprox proxySettings struct for TOML marshaling.
type proxySettingsFile struct {
	RateLimit struct {
		RPS   float64 `toml:"rps"`
		Burst int     `toml:"burst"`
	} `toml:"rate_limit"`
	AutoQuarantine struct {
		Enabled   *bool `toml:"enabled"`
		Threshold int   `toml:"threshold"`
		WindowSec int   `toml:"window_sec"`
		TTLSec    int   `toml:"ttl_sec"`
	} `toml:"auto_quarantine"`
	Debug struct {
		Enabled bool `toml:"enabled"`
		Port    int  `toml:"port"`
	} `toml:"debug"`
}

func (s *Server) saveProxySettingsSection(raw any) error {
	path := filepath.Join(s.vproxHome(), "config", "vprox", "settings.toml")
	var ps proxySettingsFile
	if b, err := os.ReadFile(path); err == nil {
		_ = toml.Unmarshal(b, &ps)
	}
	if p, ok := asMap(raw); ok {
		if v, ok := p["rps"]; ok {
			if f, fok := v.(float64); fok {
				ps.RateLimit.RPS = f
			}
		}
		if v, ok := mapInt(p, "burst"); ok {
			ps.RateLimit.Burst = v
		}
		if v, ok := mapBool(p, "aq_enabled"); ok {
			ps.AutoQuarantine.Enabled = &v
		}
		if v, ok := mapInt(p, "aq_threshold"); ok {
			ps.AutoQuarantine.Threshold = v
		}
		if v, ok := mapInt(p, "aq_window_sec"); ok {
			ps.AutoQuarantine.WindowSec = v
		}
		if v, ok := mapInt(p, "aq_ttl_sec"); ok {
			ps.AutoQuarantine.TTLSec = v
		}
		if v, ok := mapBool(p, "debug_enabled"); ok {
			ps.Debug.Enabled = v
		}
		if v, ok := mapInt(p, "debug_port"); ok {
			ps.Debug.Port = v
		}
	} else if str, ok := raw.(string); ok {
		if err := toml.Unmarshal([]byte(str), &ps); err != nil {
			return fmt.Errorf("parse settings TOML: %w", err)
		}
	}
	data, err := toml.Marshal(ps)
	if err != nil {
		return fmt.Errorf("marshal settings.toml: %w", err)
	}
	return writeConfig(path, data)
}

// vmJSON is a local struct for JSON-decoding VMs from the frontend vms_json field.
type vmJSON struct {
	Name          string `json:"name"`
	Host          string `json:"host"`
	HostRef       string `json:"host_ref"`
	LanIP         string `json:"lan_ip"`
	PublicIP      string `json:"public_ip"`
	Port          int    `json:"port"`
	User          string `json:"user"`
	KeyPath       string `json:"key_path"`
	Datacenter    string `json:"datacenter"`
	Type          string `json:"type"`
	ChainName     string `json:"chain_name"`
	PingCountry   string `json:"ping_country"`
	PingProvider  string `json:"ping_provider"`
	ProxyJumpHost string `json:"proxy_jump_host"`
}

func (s *Server) saveInfraSection(raw any) error {
	p, ok := asMap(raw)
	if !ok {
		return fmt.Errorf("infra section requires a JSON object payload")
	}
	datacenter, _ := mapStr(p, "datacenter")
	if datacenter == "" {
		return fmt.Errorf("datacenter name is required")
	}
	infraDir := s.cfg.VOps.Push.InfraDir
	if infraDir == "" {
		infraDir = filepath.Join(s.home, "config", "infra")
	}
	path := filepath.Join(infraDir, datacenter+".toml")

	// Load existing to preserve unknown fields.
	var schema struct {
		Host  fleetcfg.Host `toml:"host"`
		Vprox struct {
			User       string `toml:"user"`
			SSHKeyPath string `toml:"ssh_key_path"`
		} `toml:"vprox"`
		VMs []fleetcfg.VM `toml:"vm"`
	}
	if b, err := os.ReadFile(path); err == nil {
		_ = toml.Unmarshal(b, &schema)
	}

	if v, ok := mapStr(p, "host_name"); ok {
		schema.Host.Name = v
	}
	if v, ok := mapStr(p, "host_lan_ip"); ok {
		schema.Host.LanIP = v
	}
	if v, ok := mapStr(p, "host_public_ip"); ok {
		schema.Host.PublicIP = v
	}
	if v, ok := mapStr(p, "host_vrack_ip"); ok {
		schema.Host.VRackIP = v
	}
	if v, ok := mapStr(p, "host_user"); ok {
		schema.Host.User = v
	}
	if v, ok := mapStr(p, "host_ssh_key_path"); ok {
		schema.Host.SSHKeyPath = v
	}
	if v, ok := mapInt(p, "host_port"); ok {
		schema.Host.Port = v
	}
	if v, ok := mapStr(p, "vprox_user"); ok {
		schema.Vprox.User = v
	}
	if v, ok := mapStr(p, "vprox_ssh_key_path"); ok {
		schema.Vprox.SSHKeyPath = v
	}
	if vmsJSON, ok := mapStr(p, "vms_json"); ok && vmsJSON != "" {
		var jvms []vmJSON
		if err := json.Unmarshal([]byte(vmsJSON), &jvms); err != nil {
			return fmt.Errorf("parse vms_json: %w", err)
		}
		vms := make([]fleetcfg.VM, 0, len(jvms))
		for _, jv := range jvms {
			port := jv.Port
			if port == 0 {
				port = 22
			}
			vms = append(vms, fleetcfg.VM{
				Name:          jv.Name,
				Host:          jv.Host,
				HostRef:       jv.HostRef,
				LanIP:         jv.LanIP,
				PublicIP:      jv.PublicIP,
				Port:          port,
				User:          jv.User,
				KeyPath:       jv.KeyPath,
				Datacenter:    jv.Datacenter,
				Type:          jv.Type,
				ChainName:     jv.ChainName,
				Ping:          fleetcfg.VMPing{Country: jv.PingCountry, Provider: jv.PingProvider},
				ProxyJumpHost: jv.ProxyJumpHost,
			})
		}
		schema.VMs = vms
	}

	data, err := toml.Marshal(schema)
	if err != nil {
		return fmt.Errorf("marshal infra TOML: %w", err)
	}
	return writeConfig(path, data)
}

func (s *Server) saveChainSection(raw any) error {
	p, ok := asMap(raw)
	if !ok {
		return fmt.Errorf("chain section requires a JSON object payload")
	}
	chainName, _ := mapStr(p, "chain_name")
	if chainName == "" {
		return fmt.Errorf("chain_name is required")
	}
	chainsDir := s.cfg.VOps.Push.ChainsDir
	if chainsDir == "" {
		chainsDir = filepath.Join(s.home, "config", "chains")
	}
	path := filepath.Join(chainsDir, chainName+".toml")

	var cc proxycfg.ChainConfig
	if b, err := os.ReadFile(path); err == nil {
		_ = toml.Unmarshal(b, &cc)
	}
	cc.ChainName = chainName
	if v, ok := mapStr(p, "chain_id"); ok {
		cc.ChainID = v
	}
	if v, ok := mapStr(p, "dashboard_name"); ok {
		cc.DashboardName = v
	}
	if v, ok := mapStr(p, "explorer_base"); ok {
		cc.ExplorerBase = v
	}
	if v, ok := mapStr(p, "chain_ping_country"); ok {
		cc.ChainPing.Country = v
	}
	if v, ok := mapStr(p, "chain_ping_provider"); ok {
		cc.ChainPing.Provider = v
	}

	data, err := toml.Marshal(cc)
	if err != nil {
		return fmt.Errorf("marshal chain TOML: %w", err)
	}
	return writeConfig(path, data)
}

func (s *Server) handleAPISettingsSave(section string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
		var raw any
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil && !errors.Is(err, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		var saveErr error
		switch section {
		case "vops":
			saveErr = s.saveVopsSection(raw)
		case "backup":
			saveErr = s.saveBackupSection(raw)
		case "fleet":
			saveErr = s.saveFleetSection(raw)
		case "infra":
			saveErr = s.saveInfraSection(raw)
		case "ports":
			saveErr = s.savePortsSection(raw)
		case "settings":
			saveErr = s.saveProxySettingsSection(raw)
		case "chain":
			saveErr = s.saveChainSection(raw)
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown section"})
			return
		}
		if saveErr != nil {
			logging.Print("ERR", "settings", "config save failed",
				logging.F("section", section),
				logging.F("err", saveErr))
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save config"})
			return
		}
		logging.Print("INF", "settings", "config saved", logging.F("section", section))
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "section": section})
	}
}

func (s *Server) handleAPIIntelKeys(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4*1024)
	var req struct {
		AbuseIPDB  string `json:"abuseipdb"`
		VirusTotal string `json:"virustotal"`
		Shodan     string `json:"shodan"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	cfgPath := s.vopsConfigPath()
	cfg, err := vopscfg.Load(cfgPath)
	if err != nil && !os.IsNotExist(err) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load config"})
		return
	}
	if os.IsNotExist(err) {
		cfg = vopscfg.DefaultConfig(s.home)
	}
	// Only update keys that are non-empty — empty = keep existing.
	if v := strings.TrimSpace(req.AbuseIPDB); v != "" {
		cfg.VOps.Intel.Keys.AbuseIPDB = v
	}
	if v := strings.TrimSpace(req.VirusTotal); v != "" {
		cfg.VOps.Intel.Keys.VirusTotal = v
	}
	if v := strings.TrimSpace(req.Shodan); v != "" {
		cfg.VOps.Intel.Keys.Shodan = v
	}
	data, err := toml.Marshal(cfg)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not marshal config"})
		return
	}
	if err := writeConfig(cfgPath, data); err != nil {
		logging.Print("ERR", "settings", "intel keys save failed", logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save config"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleAPISettingsPreferences persists UI preferences (theme) to vops.toml,
// updates the in-memory config, and sets a vops_theme cookie for flash-free load.
func (s *Server) handleAPISettingsPreferences(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4*1024)
	var req struct {
		Theme string `json:"theme"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if req.Theme != "axiom" && req.Theme != "vthemedgr" && req.Theme != "vthemedbl" && req.Theme != "vthemedlite" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown theme: must be axiom, vthemedgr, vthemedbl, or vthemedlite"})
		return
	}

	// Surgically update only the `theme` field in vops.toml.
	// A full toml.Marshal(struct) round-trip would clobber comments, field order,
	// and any values added post-startup that differ from the in-memory struct.
	cfgPath := s.cfgPath
	if cfgPath == "" {
		cfgPath = filepath.Join(s.home, "config", "vops", "vops.toml")
	}
	if err := patchTOMLTheme(cfgPath, req.Theme); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update theme in vops.toml"})
		return
	}

	// Update in-memory config so next page render picks up the new theme.
	s.cfg.VOps.UI.Theme = req.Theme

	// Set a cookie for flash-free theme on page reload.
	http.SetCookie(w, &http.Cookie{
		Name:     "vops_theme",
		Value:    req.Theme,
		Path:     "/",
		SameSite: http.SameSiteStrictMode,
		HttpOnly: true,
		Secure:   true,
	})

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "theme": req.Theme})
}

// handleWizardPage is a stub — the config wizard has been removed.
func (s *Server) handleWizardPage(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "config wizard removed", http.StatusNotImplemented)
}

// handleAPISettingsDone is called by the wizard "Done" button.
// It simply acknowledges completion — no server-side action needed.
func (s *Server) handleAPISettingsDone(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "done"})
}

// handleAPIGenAPIKey generates a cryptographically random 32-byte hex API key.
// GET /settings/api/gen-api-key → {"key": "vops_<64 hex chars>"}
func (s *Server) handleAPIGenAPIKey(w http.ResponseWriter, _ *http.Request) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate key"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"key": "vops_" + hex.EncodeToString(b)})
}

// handleAPIHashPassword hashes a plaintext password with bcrypt cost=12.
// POST /settings/api/hash-password  body: {"password":"..."}
// → {"hash": "$2a$12$..."}
func (s *Server) handleAPIHashPassword(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Password) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password is required"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "bcrypt failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"hash": string(hash)})
}
