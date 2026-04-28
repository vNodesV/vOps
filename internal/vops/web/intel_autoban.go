package web

import (
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/vNodesV/vOps/internal/logging"
	"github.com/vNodesV/vOps/internal/vops/ufw"
)

const (
	defaultAutoBanThreshold = 5 // rate-limit events before auto-ban
	defaultBanDuration      = 60 * time.Minute
)

// BannedIP records a single active auto-ban.
type BannedIP struct {
	IP        string    `json:"ip"`
	BannedAt  time.Time `json:"banned_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Reason    string    `json:"reason"`
}

// autoBanStore holds active auto-bans in memory, protected by a mutex.
type autoBanStore struct {
	mu         sync.RWMutex
	banned     map[string]BannedIP
	timers     map[string]*time.Timer
	sudoPass   string // empty = NOPASSWD required
	wlIPs      map[string]struct{}
	wlNetworks []*net.IPNet
}

func newAutoBanStore(sudoPass string, whitelist []string) *autoBanStore {
	wlIPs := make(map[string]struct{})
	var wlNetworks []*net.IPNet
	for _, entry := range whitelist {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			_, network, err := net.ParseCIDR(entry)
			if err == nil {
				wlNetworks = append(wlNetworks, network)
			}
		} else if net.ParseIP(entry) != nil {
			wlIPs[entry] = struct{}{}
		}
	}
	return &autoBanStore{
		banned:     make(map[string]BannedIP),
		timers:     make(map[string]*time.Timer),
		sudoPass:   sudoPass,
		wlIPs:      wlIPs,
		wlNetworks: wlNetworks,
	}
}

// isWhitelisted reports whether ip is in the never-ban list (plain IP or CIDR).
func (s *autoBanStore) isWhitelisted(ip string) bool {
	if _, ok := s.wlIPs[ip]; ok {
		return true
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, network := range s.wlNetworks {
		if network.Contains(parsed) {
			return true
		}
	}
	return false
}

// BanIP records the ban and fires UFW insert 1 deny. Schedules auto-expiry.
// Re-banning an already-banned IP resets its timer.
// UFW exec is performed inside the lock to prevent TOCTOU races with UnbanIP.
func (s *autoBanStore) BanIP(ip string, duration time.Duration, reason string) error {
	if net.ParseIP(ip) == nil {
		return fmt.Errorf("autoban: invalid IP: %q", ip)
	}
	now := time.Now()
	entry := BannedIP{IP: ip, BannedAt: now, ExpiresAt: now.Add(duration), Reason: reason}

	s.mu.Lock()
	if t, ok := s.timers[ip]; ok {
		t.Stop()
	}
	// UFW exec inside the lock serializes with UnbanIP, preventing a race
	// where UnbanIP clears the map and removes the UFW rule between our
	// BlockInsert call and our map write.
	if err := ufw.BlockInsert(ip, s.sudoPass); err != nil {
		logging.Print("ERR", "autoban", "ufw insert failed", logging.F("ip", ip), logging.F("err", err))
	}
	s.banned[ip] = entry
	t := time.AfterFunc(duration, func() {
		if err := s.UnbanIP(ip); err != nil {
			logging.Print("ERR", "autoban", "timer unban failed", logging.F("ip", ip), logging.F("err", err))
		}
	})
	s.timers[ip] = t
	s.mu.Unlock()

	logging.Print("INF", "autoban", "banned", logging.F("ip", ip), logging.F("duration", duration), logging.F("reason", reason))
	return nil
}

// UnbanIP removes the UFW rule and clears the in-memory entry.
// UFW exec is performed inside the lock to prevent TOCTOU races with BanIP.
func (s *autoBanStore) UnbanIP(ip string) error {
	s.mu.Lock()
	if t, ok := s.timers[ip]; ok {
		t.Stop()
		delete(s.timers, ip)
	}
	delete(s.banned, ip)
	// UFW exec inside the lock serializes with BanIP.
	err := ufw.Unblock(ip, s.sudoPass)
	s.mu.Unlock()

	if err != nil {
		logging.Print("ERR", "autoban", "ufw unblock failed", logging.F("ip", ip), logging.F("err", err))
		return err
	}
	logging.Print("INF", "autoban", "unbanned", logging.F("ip", ip))
	return nil
}

// IsBanned reports whether ip is currently in the active ban list.
func (s *autoBanStore) IsBanned(ip string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.banned[ip]
	return ok
}

// List returns a snapshot of all active bans.
func (s *autoBanStore) List() []BannedIP {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]BannedIP, 0, len(s.banned))
	for _, b := range s.banned {
		out = append(out, b)
	}
	return out
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

// handleAPIBannedList returns all active auto-bans.
func (s *Server) handleAPIBannedList(w http.ResponseWriter, _ *http.Request) {
	type bannedEntry struct {
		BannedIP
		RemainingSeconds int `json:"remaining_seconds"`
	}
	bans := s.autoBan.List()
	entries := make([]bannedEntry, 0, len(bans))
	for _, b := range bans {
		rem := int(time.Until(b.ExpiresAt).Seconds())
		if rem < 0 {
			rem = 0
		}
		entries = append(entries, bannedEntry{BannedIP: b, RemainingSeconds: rem})
	}
	writeJSON(w, http.StatusOK, map[string]any{"banned": entries})
}

// handleAPIBannedUnban removes an auto-ban for a specific IP.
func (s *Server) handleAPIBannedUnban(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	if net.ParseIP(ip) == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}
	if err := s.autoBan.UnbanIP(ip); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// autoBanSweep queries the DB and bans IPs that exceed the ratelimit threshold.
// Called from a background goroutine in the server.
func (s *Server) autoBanSweep(threshold int, banDuration time.Duration) {
	accounts, err := s.db.ListIPAccountsExceedingRatelimit(int64(threshold), 100)
	if err != nil {
		logging.Print("ERR", "autoban", "sweep DB error", logging.F("err", err))
		return
	}
	for _, acc := range accounts {
		if s.autoBan.IsBanned(acc.IP) || s.autoBan.isWhitelisted(acc.IP) {
			continue
		}
		reason := fmt.Sprintf("auto-ban: %d rate-limit events (threshold: %d)", acc.RatelimitEvents, threshold)
		if err := s.autoBan.BanIP(acc.IP, banDuration, reason); err != nil {
			logging.Print("ERR", "autoban", "failed to ban", logging.F("ip", acc.IP), logging.F("err", err))
		}
	}
}
