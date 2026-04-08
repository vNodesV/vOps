// Package api exposes fleet Service functionality as HTTP JSON handlers.
// Handlers are methods on Handlers and are wired into the vOps mux by server.go.
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/vNodesV/vProx/internal/fleet"
	"github.com/vNodesV/vProx/internal/fleet/config"
	fleetssh "github.com/vNodesV/vProx/internal/fleet/ssh"
	"github.com/vNodesV/vProx/internal/fleet/state"
	"github.com/vNodesV/vProx/internal/fleet/status"
	opsdb "github.com/vNodesV/vProx/internal/vops/db"
)

// DebugEmitter is satisfied by *web.DebugRing; it allows the fleet API package
// to emit SSH command traces without importing the web package.
type DebugEmitter interface {
	IsEnabled() bool
	Emit(source, host, command, output, errStr string, durationMs int64)
}

// Handlers holds a reference to the fleet Service and an optional metrics DB.
type Handlers struct {
	svc      *fleet.Service
	db       *sql.DB // may be nil when metrics storage is not wired
	debug    DebugEmitter
	infraDir string // path to config/infra/ directory for VM registration
}

// New returns a Handlers backed by svc. db is optional; when non-nil, VM
// metrics are stored on each status poll and history endpoints are enabled.
func New(svc *fleet.Service, db *sql.DB) *Handlers { return &Handlers{svc: svc, db: db} }

// SetDebug attaches a DebugEmitter to record SSH commands when debug mode is on.
func (h *Handlers) SetDebug(d DebugEmitter) { h.debug = d }

// SetInfraDir sets the path to the config/infra/ directory so that
// HandleRegisterDiscoveredVM can append [[vm]] stanzas to the right file.
func (h *Handlers) SetInfraDir(dir string) { h.infraDir = dir }

// debugRun executes cmd on client, emitting a debug event if debug mode is on.
// It is a transparent wrapper around client.Run that adds timing + logging.
func (h *Handlers) debugRun(client *fleetssh.Client, source, host, cmd string) (string, error) {
	start := time.Now()
	out, err := client.Run(cmd)
	if h.debug != nil && h.debug.IsEnabled() {
		errStr := ""
		if err != nil {
			errStr = err.Error()
		}
		h.debug.Emit(source, host, cmd, out, errStr, time.Since(start).Milliseconds())
	}
	return out, err
}

// parseVirshIP extracts the first routable IPv4 address from the tabular output
// of "virsh domifaddr".  All three --source modes (lease/arp/agent) use the same
// table format; we skip loopback (127.x) and link-local (169.254.x) addresses
// because --source agent lists every interface including lo.
func parseVirshIP(out string) string {
	for _, line := range strings.Split(out, "\n") {
		if !strings.Contains(line, "ipv4") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 4 {
			continue
		}
		ip := parts[3]
		if idx := strings.Index(ip, "/"); idx >= 0 {
			ip = ip[:idx]
		}
		parsed := net.ParseIP(ip)
		if parsed == nil {
			continue
		}
		if parsed.IsLoopback() || parsed.IsLinkLocalUnicast() {
			continue // skip lo (127.0.0.1) and APIPA (169.254.x.x)
		}
		return ip
	}
	return ""
}

// probeVMIP tries three virsh domifaddr sources in order (agent → arp → lease)
// and returns the first IPv4 address found.  agent is tried first because
// qemu-guest-agent is now installed on all VMs; arp covers bridged VMs without
// agent; lease covers libvirt-managed NAT networks.
func (h *Handlers) probeVMIP(hc *fleetssh.Client, dialAddr, vmName string) string {
	for _, src := range []string{"agent", "arp", "lease"} {
		cmd := "virsh -c qemu:///system domifaddr " + vmName + " --source " + src + " 2>&1"
		out, err := h.debugRun(hc, "hypervisor-scan", dialAddr, cmd)
		if err != nil {
			continue
		}
		if ip := parseVirshIP(out); ip != "" {
			return ip
		}
	}
	return ""
}

// ── GET /api/v1/fleet/vms/status ──────────────────────────────────────────────

// HandleVMStatus polls all VMs concurrently via SSH and returns live metrics.
// The response includes a "hosts" array for tree grouping in the dashboard.
func (h *Handlers) HandleVMStatus(w http.ResponseWriter, r *http.Request) {
	results := status.PollAllVMs(h.svc.Config())

	// Store metrics in history table when DB is wired.
	if h.db != nil {
		for _, vm := range results {
			if !vm.Online {
				continue
			}
			_ = opsdb.InsertVMMetric(h.db, vm.Name,
				vm.CPUPct, vm.MemPct, vm.StoragePct,
				vm.LoadAvg, vm.AptCount,
			)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"vms":   results,
		"hosts": h.svc.Hosts(),
	})
}

// ── POST /api/v1/fleet/vms/scan ───────────────────────────────────────────────

// VirshVM is one VM discovered by querying virsh on the hypervisor host.
type VirshVM struct {
	Name       string  `json:"name"`
	Datacenter string  `json:"datacenter"`
	LanIP      string  `json:"lan_ip,omitempty"`
	State      string  `json:"state"`
	Online     bool    `json:"online"`
	OSVersion  string  `json:"os_version,omitempty"`
	CPUPct     float64 `json:"cpu_pct,omitempty"`
	LoadAvg    string  `json:"load_avg,omitempty"`
	MemPct     float64 `json:"mem_pct,omitempty"`
	Error      string  `json:"error,omitempty"`
}

// parseVirtTopMetrics parses one cycle of "virt-top -n 1" output and returns
// a map of VM name → [CPUPct, MemPct].  The parser is header-aware so it
// handles both old and new virt-top column orderings.
func parseVirtTopMetrics(out string) map[string][2]float64 {
	result := make(map[string][2]float64)
	cpuIdx, memIdx, nameIdx := -1, -1, -1

	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) == 0 {
			continue
		}
		// Detect header: first field is "ID" (case-insensitive).
		if strings.EqualFold(fields[0], "ID") {
			for i, h := range fields {
				switch strings.ToUpper(strings.TrimPrefix(h, "%")) {
				case "CPU":
					cpuIdx = i
				case "MEM":
					memIdx = i
				case "NAME":
					nameIdx = i
				}
			}
			continue
		}
		if cpuIdx < 0 || memIdx < 0 {
			continue
		}
		// Data line: first field must be a numeric domain ID.
		if _, err := strconv.Atoi(fields[0]); err != nil {
			continue
		}
		name := ""
		if nameIdx >= 0 && nameIdx < len(fields) {
			name = fields[nameIdx]
		} else if len(fields) > 0 {
			name = fields[len(fields)-1]
		}
		if name == "" || cpuIdx >= len(fields) || memIdx >= len(fields) {
			continue
		}
		cpu, errC := strconv.ParseFloat(strings.TrimSuffix(fields[cpuIdx], "%"), 64)
		mem, errM := strconv.ParseFloat(strings.TrimSuffix(fields[memIdx], "%"), 64)
		if errC != nil || errM != nil {
			continue
		}
		result[name] = [2]float64{cpu, mem}
	}
	return result
}

// collectVirtTopMetrics runs two virt-top cycles on the hypervisor and returns
// CPU%/MEM% for every running domain.  The first cycle is a warmup baseline
// (CPU delta = 0); the second cycle contains the real measured values.
// A single SSH command replaces per-VM SSH tunnels for these two metrics.
func (h *Handlers) collectVirtTopMetrics(hc *fleetssh.Client, dialAddr string) map[string][2]float64 {
	out, err := h.debugRun(hc, "hypervisor-scan", dialAddr,
		"virt-top -n 2 --connect qemu:///system 2>&1")
	if err != nil {
		return nil
	}
	return parseVirtTopMetrics(out)
}

// probeGuestOSInfo retrieves the OS pretty-name from the qemu-guest-agent via
// "virsh qemu-agent-command guest-get-osinfo".  Runs on the hypervisor — no
// SSH tunnel into the VM required.
func (h *Handlers) probeGuestOSInfo(hc *fleetssh.Client, dialAddr, vmName string) string {
	cmd := `virsh -c qemu:///system qemu-agent-command ` + vmName +
		` '{"execute":"guest-get-osinfo"}' 2>&1`
	out, err := h.debugRun(hc, "hypervisor-scan", dialAddr, cmd)
	if err != nil {
		return ""
	}
	var resp struct {
		Return struct {
			PrettyName string `json:"pretty-name"`
			Name       string `json:"name"`
			VersionID  string `json:"version-id"`
		} `json:"return"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &resp); err != nil {
		return ""
	}
	if resp.Return.PrettyName != "" {
		return resp.Return.PrettyName
	}
	if resp.Return.Name != "" && resp.Return.VersionID != "" {
		return resp.Return.Name + " " + resp.Return.VersionID
	}
	return resp.Return.Name
}

// HandleHypervisorScan SSHes to each configured hypervisor host, discovers
// running VMs via `virsh list --all`, probes their IPs with `virsh domifaddr`,
// then SSHes into each running VM to collect live metrics.
//
// When no hypervisor hosts are configured it falls back to HandleVMStatus
// (standard SSH poll of the known VM list).
//
// Response: {"discovered":[…], "vms":[…], "hosts":[…], "scanned_at":"…"}
func (h *Handlers) HandleHypervisorScan(w http.ResponseWriter, r *http.Request) {
	cfg := h.svc.Config()
	if cfg == nil || len(cfg.Hosts) == 0 {
		// No hypervisor hosts configured — fall back to standard VM poll.
		h.HandleVMStatus(w, r)
		return
	}

	var mu sync.Mutex
	var discovered []VirshVM
	var wg sync.WaitGroup

	for _, host := range cfg.Hosts {
		host := host
		wg.Add(1)
		go func() {
			defer wg.Done()

			sshKey := host.SSHKeyPath
			user := host.User
			dialAddr := host.LanIP
			if dialAddr == "" {
				dialAddr = host.Name
			}

			port := host.Port
		if port == 0 {
			port = 22
		}
		hc, err := fleetssh.Dial(dialAddr, port, user, sshKey, "")
			if err != nil {
				if h.debug != nil && h.debug.IsEnabled() {
					h.debug.Emit("hypervisor-scan", dialAddr, "ssh dial", "", err.Error(), 0)
				}
				mu.Lock()
				discovered = append(discovered, VirshVM{
					Name:       host.Name,
					Datacenter: host.Datacenter,
					State:      "host-unreachable",
					Error:      fmt.Sprintf("SSH to hypervisor %s: %v", dialAddr, err),
				})
				mu.Unlock()
				return
			}
			defer hc.Close()

			listOut, err := h.debugRun(hc, "hypervisor-scan", dialAddr, "virsh -c qemu:///system list --all 2>&1")
			if err != nil {
				mu.Lock()
				discovered = append(discovered, VirshVM{
					Name:       host.Name,
					Datacenter: host.Datacenter,
					State:      "virsh-error",
					Error:      fmt.Sprintf("virsh list: %v", err),
				})
				mu.Unlock()
				return
			}

			// Parse virsh list --all.  Header is 2 lines (column names + separator).
			// Columns: <Id>  <Name>  <State words…>
			type rawVM struct{ name, state string }
			var rawVMs []rawVM
			for i, line := range strings.Split(listOut, "\n") {
				if i < 2 {
					continue
				}
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "-") {
					continue
				}
				f := strings.Fields(line)
				if len(f) < 3 {
					continue
				}
				rawVMs = append(rawVMs, rawVM{name: f[1], state: strings.Join(f[2:], " ")})
			}

			// One virt-top invocation gives CPU%/MEM% for all domains at once.
			virtTopMetrics := h.collectVirtTopMetrics(hc, dialAddr)

			var vmWg sync.WaitGroup
			for _, rv := range rawVMs {
				rv := rv
				vmWg.Add(1)
				go func() {
					defer vmWg.Done()
					dvm := VirshVM{
						Name:       rv.name,
						Datacenter: host.Datacenter,
						State:      rv.state,
					}

					if !strings.Contains(rv.state, "running") {
						mu.Lock()
						discovered = append(discovered, dvm)
						mu.Unlock()
						return
					}

					// Get VM IP — agent first (qemu-guest-agent installed), then arp/lease.
					dvm.LanIP = h.probeVMIP(hc, dialAddr, rv.name)

					// Apply virt-top CPU/MEM (hypervisor-side, no tunnel needed).
					if m, ok := virtTopMetrics[rv.name]; ok {
						dvm.CPUPct = m[0]
						dvm.MemPct = m[1]
					}

					// OS info via guest agent — no SSH tunnel required.
					dvm.OSVersion = h.probeGuestOSInfo(hc, dialAddr, rv.name)

					// Resolve SSH credentials: prefer per-VM config, fall back to [vprox] defaults.
					vmUser := host.VMUser
					vmKey := host.VMKeyPath
					vmPort := 22
					if known := cfg.FindVM(rv.name); known != nil {
						if known.User != "" {
							vmUser = known.User
						}
						if known.KeyPath != "" {
							vmKey = known.KeyPath
						}
						if known.Port > 0 {
							vmPort = known.Port
						}
					}

					if dvm.LanIP != "" && vmUser != "" && vmKey != "" {
						// Tunnel through the already-open hypervisor connection (hc)
						// — equivalent to ssh -J hypervisor user@vm, no separate dial.
						dialStart := time.Now()
						vmClient, err := hc.DialThrough(dvm.LanIP, vmPort, vmUser, vmKey, "")
						if h.debug != nil && h.debug.IsEnabled() {
							dialCmd := fmt.Sprintf("ssh -J %s %s@%s -p %d", dialAddr, vmUser, dvm.LanIP, vmPort)
							errStr := ""
							if err != nil {
								errStr = err.Error()
							}
							h.debug.Emit("vm-probe", dvm.LanIP, dialCmd, "", errStr, time.Since(dialStart).Milliseconds())
						}
						if err == nil {
							defer vmClient.Close()
							// virt-top already gave us CPU/MEM; we only need load average.
							// If virt-top missed this VM, fall back to the full compound command.
							probeCmd := `cut -d' ' -f1 /proc/loadavg`
							if _, hasMetrics := virtTopMetrics[rv.name]; !hasMetrics {
								probeCmd = `cat /proc/loadavg && free -m | awk '/Mem:/{printf "\n%.1f", $3/$2*100}'`
							}
							out, err := h.debugRun(vmClient, "vm-probe", dvm.LanIP, probeCmd)
							if err == nil {
								dvm.Online = true
								lines := strings.Split(strings.TrimSpace(out), "\n")
								if len(lines) >= 1 {
									if parts := strings.Fields(lines[0]); len(parts) >= 1 {
										dvm.LoadAvg = parts[0]
									}
								}
								// Only parse mem% if virt-top didn't provide it.
								if len(lines) >= 2 && dvm.MemPct == 0 {
									dvm.MemPct, _ = strconv.ParseFloat(strings.TrimSpace(lines[1]), 64)
								}
							} else {
								dvm.Error = fmt.Sprintf("VM SSH probe: %v", err)
							}
						} else {
							dvm.Error = fmt.Sprintf("VM SSH: %v", err)
						}
					} else if dvm.LanIP != "" {
						// Credentials missing — tell the user exactly what to fix.
						missing := []string{}
						if vmUser == "" {
							missing = append(missing, "user")
						}
						if vmKey == "" {
							missing = append(missing, "ssh_key_path")
						}
						msg := fmt.Sprintf("VM SSH skipped: missing %s — add [vprox] %s to infra TOML",
							strings.Join(missing, " and "), strings.Join(missing, "/"))
						if h.debug != nil && h.debug.IsEnabled() {
							h.debug.Emit("vm-probe", dvm.LanIP, "ssh dial", "", msg, 0)
						}
						dvm.Error = msg
					}

					mu.Lock()
					discovered = append(discovered, dvm)
					mu.Unlock()
				}()
			}
			vmWg.Wait()
		}()
	}
	wg.Wait()

	if discovered == nil {
		discovered = []VirshVM{}
	}

	// Also run the standard SSH poll for the configured VM list.
	vmResults := status.PollAllVMs(cfg)
	if h.db != nil {
		for _, vm := range vmResults {
			if !vm.Online {
				continue
			}
			_ = opsdb.InsertVMMetric(h.db, vm.Name,
				vm.CPUPct, vm.MemPct, vm.StoragePct, vm.LoadAvg, vm.AptCount,
			)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"discovered": discovered,
		"vms":        vmResults,
		"hosts":      h.svc.Hosts(),
		"scanned_at": time.Now().Format(time.RFC3339),
	})
}



// ── POST /api/v1/fleet/vms/register ──────────────────────────────────────────

// registerVMRequest is the JSON body accepted by HandleRegisterDiscoveredVM.
type registerVMRequest struct {
	Name       string `json:"name"`
	LanIP      string `json:"lan_ip"`
	Datacenter string `json:"datacenter"`
}

// HandleRegisterDiscoveredVM appends a [[vm]] stanza for a virsh-discovered VM
// to the appropriate infra TOML file.  It finds the file by matching the
// datacenter name, then checks for duplicate names before appending.
func (h *Handlers) HandleRegisterDiscoveredVM(w http.ResponseWriter, r *http.Request) {
	var req registerVMRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request: name is required"})
		return
	}

	dir := h.infraDir
	if dir == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "infra directory not configured"})
		return
	}

	// Find the infra file that owns this datacenter.
	entries, err := os.ReadDir(dir)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cannot read infra dir: " + err.Error()})
		return
	}

	var targetFile string
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".toml" {
			continue
		}
		fPath := filepath.Join(dir, e.Name())
		data, err := os.ReadFile(fPath)
		if err != nil {
			continue
		}
		// Match by datacenter field value in the file content.
		if strings.Contains(string(data), `"`+req.Datacenter+`"`) || strings.Contains(string(data), `'`+req.Datacenter+`'`) {
			targetFile = fPath
			break
		}
	}

	// If no matching file found, create one named after the datacenter.
	if targetFile == "" {
		safeName := strings.NewReplacer(" ", "_", "/", "_", "\\", "_").Replace(req.Datacenter)
		targetFile = filepath.Join(dir, safeName+".toml")
	}

	// Read existing content to check for duplicates.
	existing, err := os.ReadFile(targetFile)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if strings.Contains(string(existing), `name = "`+req.Name+`"`) ||
		strings.Contains(string(existing), `name = '`+req.Name+`'`) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "already_registered": true, "file": targetFile})
		return
	}

	// Build and append the [[vm]] stanza.
	stanza := fmt.Sprintf(
		"\n[[vm]]\nname       = %q\nhost_ref   = %q\nhost       = %q\nlan_ip     = %q\ndatacenter = %q\ntype       = \"node\"\n",
		req.Name, req.Datacenter, req.LanIP, req.LanIP, req.Datacenter,
	)
	f, err := os.OpenFile(targetFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cannot open infra file: " + err.Error()})
		return
	}
	defer f.Close()
	if _, err := f.WriteString(stanza); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "write failed: " + err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "already_registered": false, "file": targetFile})
}


// Query param: hours (default 24, max 48).
func (h *Handlers) HandleVMHistory(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "metrics storage not available"})
		return
	}
	name := r.PathValue("name")
	hours := 24
	if q := r.URL.Query().Get("hours"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 48 {
			hours = n
		}
	}
	pts, err := opsdb.GetVMHistory(h.db, name, hours)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if pts == nil {
		pts = []opsdb.VMMetricPoint{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"history": pts})
}

// ── GET /api/v1/fleet/vms ─────────────────────────────────────────────────────

type vmView struct {
	Name       string `json:"name"`
	Host       string `json:"host"`
	Datacenter string `json:"datacenter"`
	Type       string `json:"type"`
}

// HandleVMs returns the list of registered VMs.
func (h *Handlers) HandleVMs(w http.ResponseWriter, r *http.Request) {
	vms := h.svc.VMs()
	out := make([]vmView, 0, len(vms))
	for _, vm := range vms {
		out = append(out, vmView{Name: vm.Name, Host: vm.Host, Datacenter: vm.Datacenter, Type: vm.Type})
	}
	writeJSON(w, http.StatusOK, map[string]any{"vms": out})
}

// ── GET /api/v1/fleet/chains ──────────────────────────────────────────────────

// HandleChains returns all chain statuses (VM-managed + registered).
func (h *Handlers) HandleChains(w http.ResponseWriter, r *http.Request) {
	statuses := h.svc.AllStatuses()
	writeJSON(w, http.StatusOK, map[string]any{"chains": statuses})
}

// ── GET /api/v1/fleet/chains/{chain} ──────────────────────────────────────────

// HandleChainStatus returns the polled status for a single chain.
func (h *Handlers) HandleChainStatus(w http.ResponseWriter, r *http.Request) {
	chain := r.PathValue("chain")
	if chain == "" {
		http.Error(w, "chain required", http.StatusBadRequest)
		return
	}
	st := h.svc.Status(chain)
	if st == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "chain not found or not yet polled"})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// ── GET /api/v1/fleet/deployments ─────────────────────────────────────────────

// HandleDeployments returns recent deployment history.
func (h *Handlers) HandleDeployments(w http.ResponseWriter, r *http.Request) {
	chain := r.URL.Query().Get("chain")
	deps, err := h.svc.DB().ListDeployments(chain)
	if err != nil {
		log.Printf("[fleet/api] list deployments: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deployments": deps})
}

// ── POST /api/v1/fleet/deploy ─────────────────────────────────────────────────

type deployRequest struct {
	VM        string            `json:"vm"`
	Chain     string            `json:"chain"`
	Component string            `json:"component"`
	Script    string            `json:"script"`
	DryRun    bool              `json:"dry_run"`
	Env       map[string]string `json:"env"`
}

// HandleDeploy runs a chain script on a VM and records the result.
func (h *Handlers) HandleDeploy(w http.ResponseWriter, r *http.Request) {
	var req deployRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.VM == "" || req.Chain == "" || req.Component == "" || req.Script == "" {
		http.Error(w, "vm, chain, component, script required", http.StatusBadRequest)
		return
	}

	vm := h.svc.FindVM(req.VM)
	if vm == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "vm not found: " + req.VM})
		return
	}

	id, err := h.svc.DB().InsertDeployment(req.Chain, req.Component, req.VM)
	if err != nil {
		log.Printf("[fleet/api] insert deployment: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Run asynchronously so the HTTP response returns immediately.
	go func(vm config.VM, id int64) {
		_ = h.svc.DB().UpdateDeployment(id, "running", "")
		result := h.svc.Runner().Deploy(vm, req.Chain, req.Component, req.Script, req.DryRun, req.Env)
		status := "done"
		if result.Err != nil {
			status = "failed"
		}
		if err := h.svc.DB().UpdateDeployment(id, status, result.Output); err != nil {
			log.Printf("[fleet/api] update deployment %d: %v", id, err)
		}
	}(*vm, id)

	writeJSON(w, http.StatusAccepted, map[string]any{"deployment_id": id, "status": "running"})
}

// ── GET+POST+DELETE /api/v1/fleet/chains/registered ───────────────────────────

type registerRequest struct {
	Chain   string `json:"chain"`
	RPCURL  string `json:"rpc_url"`
	RESTURL string `json:"rest_url"`
	Note    string `json:"note"`
}

// HandleRegisteredChains handles GET (list) and POST (add) for registered chains.
func (h *Handlers) HandleRegisteredChains(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		chains, err := h.svc.DB().ListRegisteredChains()
		if err != nil {
			log.Printf("[fleet/api] list registered: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"registered_chains": chains})

	case http.MethodPost:
		var req registerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if req.Chain == "" || req.RPCURL == "" {
			http.Error(w, "chain and rpc_url required", http.StatusBadRequest)
			return
		}
		if err := h.svc.DB().AddRegisteredChain(req.Chain, req.RPCURL, req.RESTURL, req.Note); err != nil {
			log.Printf("[fleet/api] add registered chain: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"status": "added", "chain": req.Chain})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleRegisteredChainDelete handles DELETE /api/v1/fleet/chains/registered/{chain}.
func (h *Handlers) HandleRegisteredChainDelete(w http.ResponseWriter, r *http.Request) {
	chain := r.PathValue("chain")
	if chain == "" {
		http.Error(w, "chain required", http.StatusBadRequest)
		return
	}
	if err := h.svc.DB().RemoveRegisteredChain(chain); err != nil {
		if errors.Is(err, state.ErrNotFound) {
			http.Error(w, "chain not registered", http.StatusNotFound)
			return
		}
		log.Printf("[fleet/api] remove registered chain: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h.svc.RemoveStatus(chain)
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed", "chain": chain})
}

// ── POST /api/v1/fleet/register ────────────────────────────────────────────────

type vmRegisterRequest struct {
	Name       string `json:"name"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	KeyPath    string `json:"key_path"`
	Datacenter string `json:"datacenter"`
	Type       string `json:"type"` // validator | sp | relayer
}

// HandleVMRegister handles POST /api/v1/fleet/register — VM self-registration.
func (h *Handlers) HandleVMRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req vmRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.Host == "" {
		http.Error(w, "name and host required", http.StatusBadRequest)
		return
	}

	vm := config.VM{
		Name:       req.Name,
		Host:       req.Host,
		Port:       req.Port,
		User:       req.User,
		KeyPath:    req.KeyPath,
		Datacenter: req.Datacenter,
		Type:       req.Type,
	}

	h.svc.RegisterVM(vm)
	log.Printf("[fleet/api] VM %q registered from %s (type=%s)", req.Name, req.Host, req.Type)
	writeJSON(w, http.StatusOK, map[string]string{"status": "registered", "name": req.Name})
}

// ── POST /api/v1/fleet/vms/{name}/upgrade ─────────────────────────────────────

type upgradeRequest struct {
	SudoPassword string `json:"sudo_password"`
}

// HandleVMUpgrade SSE-streams apt update + apt upgrade -y on the named VM.
// Body: {"sudo_password": "..."} — omit (or leave blank) when NOPASSWD is set.
func (h *Handlers) HandleVMUpgrade(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}

	vm := h.svc.FindVM(name)
	if vm == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "vm not found: " + name})
		return
	}

	var req upgradeRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	// SSE headers — must be set before WriteHeader.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	sendEvent := func(step, msg string) {
		b, _ := json.Marshal(map[string]string{"step": step, "msg": msg})
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}

	// Build sudo runner helpers.
	runSudo := func(client *fleetssh.Client, aptArgs string) (string, error) {
		if req.SudoPassword != "" {
			return client.RunInput("sudo -S "+aptArgs, req.SudoPassword+"\n")
		}
		return client.Run("sudo -n " + aptArgs)
	}

	// Connect.
	var err error
	var client *fleetssh.Client
	if jp := h.svc.Config().ResolveProxyJump(vm); jp != nil {
		jumpAddr := jp.LanIP
		if jumpAddr == "" { jumpAddr = jp.Name }
		jumpPort := jp.Port
		if jumpPort == 0 { jumpPort = 22 }
		client, err = fleetssh.DialViaProxy(jumpAddr, jumpPort, jp.User, jp.SSHKeyPath, "", vm.Host, vm.Port, vm.User, vm.KeyPath, vm.KnownHostsPath)
	} else {
		client, err = fleetssh.Dial(vm.Host, vm.Port, vm.User, vm.KeyPath, vm.KnownHostsPath)
	}
	if err != nil {
		sendEvent("error", fmt.Sprintf("ssh connect failed: %v", err))
		return
	}
	defer client.Close()
	sendEvent("connected", fmt.Sprintf("Connected to %s (%s)", vm.Name, vm.Host))

	// apt update.
	sendEvent("update:start", "Running apt update…")
	updateOut, err := runSudo(client, "apt update -q 2>&1")
	if err != nil {
		sendEvent("update:error", fmt.Sprintf("apt update failed: %v\n%s", err, strings.TrimSpace(updateOut)))
		return
	}
	sendEvent("update:done", strings.TrimSpace(updateOut))

	// apt upgrade -y.
	sendEvent("upgrade:start", "Running apt upgrade -y…")
	upgradeOut, err := runSudo(client, "DEBIAN_FRONTEND=noninteractive apt upgrade -y 2>&1")
	if err != nil {
		sendEvent("upgrade:error", fmt.Sprintf("apt upgrade failed: %v\n%s", err, strings.TrimSpace(upgradeOut)))
		return
	}
	sendEvent("upgrade:done", strings.TrimSpace(upgradeOut))
	sendEvent("complete", "Upgrade complete on "+vm.Name)
}

// ── helper ────────────────────────────────────────────────────────────────────

// HandlePoll triggers an immediate concurrent poll of all chains, waits up to
// 10 s for results, then returns the fresh status map.
func (h *Handlers) HandlePoll(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	h.svc.Poll(ctx)
	writeJSON(w, http.StatusOK, map[string]any{"chains": h.svc.AllStatuses()})
}

// ProbeHostMap returns the set of hosts referenced by configured VMs and
// registered chains. Used by the dashboard probe API to authorize requests.
func (h *Handlers) ProbeHostMap() map[string]struct{} {
	if h == nil || h.svc == nil {
		return nil
	}
	hosts := make(map[string]struct{})

	addHost := func(raw string) {
		if host := parseProbeHost(raw); host != "" {
			hosts[strings.ToLower(host)] = struct{}{}
		}
	}

	cfg := h.svc.Config()
	if cfg != nil {
		for _, vm := range cfg.VMs {
			addHost(vm.Host)
			addHost(vm.LanIP)
			addHost(vm.PublicIP)
			addHost(vm.RPC())
			addHost(vm.REST())
			addHost(vm.DisplayLanIP())
		}
	}

	if regs, err := h.svc.DB().ListRegisteredChains(); err == nil {
		for _, rc := range regs {
			addHost(rc.RPCURL)
			addHost(rc.RESTURL)
		}
	}
	return hosts
}

func parseProbeHost(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, "://") {
		if u, err := url.Parse(raw); err == nil {
			if host := u.Hostname(); host != "" {
				return host
			}
			if u.Host != "" {
				if host, _, err := net.SplitHostPort(u.Host); err == nil {
					return host
				}
				return u.Host
			}
		}
	}
	if host, _, err := net.SplitHostPort(raw); err == nil {
		return host
	}
	if idx := strings.IndexAny(raw, "/:"); idx >= 0 {
		return raw[:idx]
	}
	return raw
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[fleet/api] encode response: %v", err)
	}
}
