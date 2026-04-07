package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	fleetssh "github.com/vNodesV/vProx/internal/fleet/ssh"
	opsdb "github.com/vNodesV/vProx/internal/vops/db"
)

// hostHealthCmd collects host metrics in a single SSH round-trip.
// Output: 6 newline-separated fields: os, kernel, uptime_sec, disk_pct_root, load_avg_1m_5m_15m, apt_pending
const hostHealthCmd = `set -o pipefail
printf '%s\n%s\n%s\n%s\n%s\n%s\n' \
  "$(awk -F= '/^PRETTY_NAME/{gsub(/\"/,"",$2); print $2}' /etc/os-release 2>/dev/null || echo Linux)" \
  "$(uname -r)" \
  "$(awk '{print int($1)}' /proc/uptime)" \
  "$(df / | awk 'NR==2{gsub(/%/,"",$5); print $5+0}')" \
  "$(awk '{print $1,$2,$3}' /proc/loadavg)" \
  "$(apt list --upgradable 2>/dev/null | grep -c '/' || echo 0)"`

// hostScanResult is the per-host result returned by HandleHostScan.
type hostScanResult struct {
	Name       string  `json:"name"`
	Datacenter string  `json:"datacenter"`
	LanIP      string  `json:"lan_ip"`
	VRackIP    string  `json:"vrack_ip,omitempty"`
	OS         string  `json:"os,omitempty"`
	Kernel     string  `json:"kernel,omitempty"`
	UptimeSec  int64   `json:"uptime_sec,omitempty"`
	DiskPct    float64 `json:"disk_pct,omitempty"`
	LoadAvg    string  `json:"load_avg,omitempty"`
	AptPending int     `json:"apt_pending,omitempty"`
	Status     string  `json:"status"`
	Error      string  `json:"error,omitempty"`
}

// HandleHostScan SSHes to each configured hypervisor host, collects health metrics,
// and stores results in datacenter_inventory.
// POST /api/v1/fleet/hosts/scan
func (h *Handlers) HandleHostScan(w http.ResponseWriter, r *http.Request) {
	cfg := h.svc.Config()
	if cfg == nil || len(cfg.Hosts) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"hosts":      []any{},
			"scanned_at": time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	var mu sync.Mutex
	var results []hostScanResult
	var wg sync.WaitGroup

	for _, host := range cfg.Hosts {
		host := host
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := hostScanResult{
				Name:       host.Name,
				Datacenter: host.Datacenter,
				LanIP:      host.LanIP,
				VRackIP:    host.VRackIP,
				Status:     "unreachable",
			}

			dialAddr := host.LanIP
			if dialAddr == "" {
				dialAddr = host.Name
			}
			port := host.Port
			if port == 0 {
				port = 22
			}

			client, err := fleetssh.Dial(dialAddr, port, host.User, host.SSHKeyPath, "")
			if err != nil {
				res.Error = fmt.Sprintf("SSH: %v", err)
				mu.Lock()
				results = append(results, res)
				mu.Unlock()
				if h.db != nil {
					_ = opsdb.UpsertHostInventory(h.db, opsdb.HostInventory{
						Name:       host.Name,
						HostName:   host.Name,
						LanIP:      host.LanIP,
						PublicIP:   host.PublicIP,
						VRackIP:    host.VRackIP,
						Datacenter: host.Datacenter,
						Status:     "unreachable",
					})
				}
				return
			}
			defer client.Close()

			out, err := client.Run(hostHealthCmd)
			if err != nil {
				res.Error = fmt.Sprintf("health cmd: %v", err)
				res.Status = "error"
			} else {
				lines := strings.Split(strings.TrimSpace(out), "\n")
				for len(lines) < 6 {
					lines = append(lines, "")
				}
				res.OS = strings.TrimSpace(lines[0])
				res.Kernel = strings.TrimSpace(lines[1])
				if v, err2 := strconv.ParseInt(strings.TrimSpace(lines[2]), 10, 64); err2 == nil {
					res.UptimeSec = v
				}
				if v, err2 := strconv.ParseFloat(strings.TrimSpace(lines[3]), 64); err2 == nil {
					res.DiskPct = v
				}
				res.LoadAvg = strings.TrimSpace(lines[4])
				if v, err2 := strconv.Atoi(strings.TrimSpace(lines[5])); err2 == nil {
					res.AptPending = v
				}
				res.Status = "online"
			}

			mu.Lock()
			results = append(results, res)
			mu.Unlock()

			if h.db != nil {
				_ = opsdb.UpsertHostInventory(h.db, opsdb.HostInventory{
					Name:       host.Name,
					HostName:   host.Name,
					LanIP:      host.LanIP,
					PublicIP:   host.PublicIP,
					VRackIP:    host.VRackIP,
					Datacenter: host.Datacenter,
					OS:         res.OS,
					Kernel:     res.Kernel,
					UptimeSec:  res.UptimeSec,
					DiskPct:    res.DiskPct,
					LoadAvg:    res.LoadAvg,
					AptPending: res.AptPending,
					Status:     res.Status,
				})
			}
		}()
	}
	wg.Wait()

	writeJSON(w, http.StatusOK, map[string]any{
		"hosts":      results,
		"scanned_at": time.Now().UTC().Format(time.RFC3339),
	})
}

// HandleListHosts returns the stored host inventory from DB, or a config-only
// snapshot when the DB is not wired.
// GET /api/v1/fleet/hosts
func (h *Handlers) HandleListHosts(w http.ResponseWriter, r *http.Request) {
	if h.db != nil {
		inv, err := opsdb.ListHostInventory(h.db)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if inv == nil {
			inv = []opsdb.HostInventory{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"hosts": inv})
		return
	}

	// No DB — return live config snapshot.
	cfg := h.svc.Config()
	if cfg == nil {
		writeJSON(w, http.StatusOK, map[string]any{"hosts": []any{}})
		return
	}
	type configHost struct {
		Name       string `json:"name"`
		LanIP      string `json:"lan_ip"`
		PublicIP   string `json:"public_ip"`
		VRackIP    string `json:"vrack_ip"`
		Datacenter string `json:"datacenter"`
		Status     string `json:"status"`
	}
	hosts := make([]configHost, 0, len(cfg.Hosts))
	for _, hst := range cfg.Hosts {
		hosts = append(hosts, configHost{
			Name:       hst.Name,
			LanIP:      hst.LanIP,
			PublicIP:   hst.PublicIP,
			VRackIP:    hst.VRackIP,
			Datacenter: hst.Datacenter,
			Status:     "unknown",
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"hosts": hosts})
}

// HandleListAudit returns recent entries from the audit log.
// GET /api/v1/audit
func (h *Handlers) HandleListAudit(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]any{"entries": []any{}})
		return
	}
	limit, offset := 100, 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	entries, err := opsdb.ListAuditLog(h.db, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if entries == nil {
		entries = []opsdb.AuditEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}
