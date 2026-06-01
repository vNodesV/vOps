package web

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"github.com/vNodesV/vOps/internal/logging"
	"golang.org/x/crypto/ssh"

	"github.com/pelletier/go-toml/v2"
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

	// Load, patch, and write back vops.toml using the resolved config path.
	cfgPath := s.cfgPath
	if cfgPath == "" {
		cfgPath = filepath.Join(s.home, "config", "vops", "vops.toml")
	}
	cfg, err := vopscfg.Load(cfgPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load vops.toml"})
		return
	}
	cfg.VOps.UI.Theme = req.Theme

	data, err := toml.Marshal(cfg)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not marshal config"})
		return
	}
	// Ensure parent directory exists (in case vops.toml doesn't exist yet).
	if mkErr := os.MkdirAll(filepath.Dir(cfgPath), 0o755); mkErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create config directory"})
		return
	}
	if err := os.WriteFile(cfgPath, data, 0o600); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not write vops.toml"})
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
