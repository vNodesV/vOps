package web

// units_ssh.go — SSH-backed handlers for the Units module that require both
// the fleet service (SSH dial) and the units DB.  They live here (on Server)
// rather than in the units package to avoid circular imports.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	fleetssh "github.com/vNodesV/vProx/internal/fleet/ssh"
)

// ── GET /api/v1/units/{name}/logs ─────────────────────────────────────────────
//
// SSE-streams the last 200 lines of journalctl output for the unit's systemd
// service, then tails -f until the client disconnects.
// The unit's vm_name + service_name are looked up from the DB.

func (s *Server) handleUnitLogStream(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}

	// Look up vm_name + service_name from DB.
	row := s.db.DB.QueryRow(
		`SELECT vm_name, service_name FROM units WHERE name = ?`, name)
	var vmName, serviceName string
	if err := row.Scan(&vmName, &serviceName); err != nil {
		http.Error(w, "unit not found: "+name, http.StatusNotFound)
		return
	}

	// SSE headers.
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

	if s.fleetSvc == nil {
		sendEvent("error", "fleet service not available")
		return
	}

	vm := s.fleetSvc.FindVM(vmName)
	if vm == nil {
		sendEvent("error", "vm not found: "+vmName)
		return
	}

	var client *fleetssh.Client
	var err error
	if jp := s.fleetSvc.Config().ResolveProxyJump(vm); jp != nil {
		jumpAddr := jp.LanIP
		if jumpAddr == "" {
			jumpAddr = jp.Name
		}
		jumpPort := jp.Port
		if jumpPort == 0 {
			jumpPort = 22
		}
		client, err = fleetssh.DialViaProxy(jumpAddr, jumpPort, jp.User, jp.SSHKeyPath, "",
			vm.Host, vm.Port, vm.User, vm.KeyPath, vm.KnownHostsPath)
	} else {
		client, err = fleetssh.Dial(vm.Host, vm.Port, vm.User, vm.KeyPath, vm.KnownHostsPath)
	}
	if err != nil {
		sendEvent("error", fmt.Sprintf("ssh connect failed: %v", err))
		return
	}
	defer client.Close()
	sendEvent("connected", fmt.Sprintf("Connected to %s — streaming %s logs", vmName, serviceName))

	// Fetch recent history first.
	hist, err := client.Run(fmt.Sprintf(
		"journalctl -u %s -n 200 --no-pager 2>&1", serviceName))
	if err != nil {
		sendEvent("error", fmt.Sprintf("journalctl failed: %v", err))
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(hist), "\n") {
		sendEvent("log", line)
	}
	sendEvent("tail:start", "--- live tail ---")

	// Live tail — runs until the client disconnects or SSH session ends.
	// We use a pipe-based approach: stream output line-by-line.
	tailOut, tailErr := client.Run(fmt.Sprintf(
		"journalctl -u %s -f --no-pager 2>&1", serviceName))
	if tailErr != nil {
		// journalctl -f may return an error if the connection drops; that's fine.
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(tailOut), "\n") {
		sendEvent("log", line)
		select {
		case <-r.Context().Done():
			return
		default:
		}
	}
}

// ── POST /api/v1/units/{name}/deploy ─────────────────────────────────────────
//
// SSE-streams a cosmovisor bootstrap sequence on the VM hosting the unit.
// Steps: detect cosmovisor binary → create .cosmovisor dirs → write genesis
// symlink → write systemd service → daemon-reload + enable + start.

func (s *Server) handleUnitDeploy(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}

	var req struct {
		SudoPassword string `json:"sudo_password"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	// Also allow passing via query param (for EventSource which only supports GET).
	if q := r.URL.Query().Get("sudo_password"); q != "" && req.SudoPassword == "" {
		req.SudoPassword = q
	}

	// Look up unit details.
	row := s.db.DB.QueryRow(
		`SELECT vm_name, service_name, cosmovisor_path FROM units WHERE name = ?`, name)
	var vmName, serviceName, cosmovisorPath string
	if err := row.Scan(&vmName, &serviceName, &cosmovisorPath); err != nil {
		http.Error(w, "unit not found: "+name, http.StatusNotFound)
		return
	}
	if cosmovisorPath == "" {
		cosmovisorPath = fmt.Sprintf("/home/ubuntu/%s/cosmovisor", serviceName)
	}

	// SSE headers.
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

	if s.fleetSvc == nil {
		sendEvent("error", "fleet service not available")
		return
	}

	vm := s.fleetSvc.FindVM(vmName)
	if vm == nil {
		sendEvent("error", "vm not found: "+vmName)
		return
	}

	var client *fleetssh.Client
	var err error
	if jp := s.fleetSvc.Config().ResolveProxyJump(vm); jp != nil {
		jumpAddr := jp.LanIP
		if jumpAddr == "" {
			jumpAddr = jp.Name
		}
		jumpPort := jp.Port
		if jumpPort == 0 {
			jumpPort = 22
		}
		client, err = fleetssh.DialViaProxy(jumpAddr, jumpPort, jp.User, jp.SSHKeyPath, "",
			vm.Host, vm.Port, vm.User, vm.KeyPath, vm.KnownHostsPath)
	} else {
		client, err = fleetssh.Dial(vm.Host, vm.Port, vm.User, vm.KeyPath, vm.KnownHostsPath)
	}
	if err != nil {
		sendEvent("error", fmt.Sprintf("ssh connect failed: %v", err))
		return
	}
	defer client.Close()
	sendEvent("connected", fmt.Sprintf("Connected to %s", vmName))

	runSudo := func(cmd string) (string, error) {
		if req.SudoPassword != "" {
			return client.RunInput("sudo -S "+cmd, req.SudoPassword+"\n")
		}
		return client.Run("sudo -n " + cmd)
	}
	runUser := func(cmd string) (string, error) {
		return client.Run(cmd)
	}

	// Step 1 — check cosmovisor binary.
	sendEvent("check", "Checking cosmovisor binary…")
	out, err := runUser("which cosmovisor 2>/dev/null || echo MISSING")
	if err != nil || strings.Contains(out, "MISSING") {
		sendEvent("install", "cosmovisor not found — installing via go install…")
		goInstall := "export GOPATH=$HOME/go && export PATH=$PATH:$GOPATH/bin && " +
			"go install cosmossdk.io/tools/cosmovisor/cmd/cosmovisor@latest 2>&1"
		if out2, err2 := runUser(goInstall); err2 != nil {
			sendEvent("error", fmt.Sprintf("cosmovisor install failed: %v\n%s", err2, out2))
			return
		}
		sendEvent("install:done", "cosmovisor installed")
	} else {
		sendEvent("check:done", "cosmovisor found at "+strings.TrimSpace(out))
	}

	// Step 2 — create cosmovisor directory structure.
	sendEvent("dirs", "Creating cosmovisor directory structure…")
	dirs := fmt.Sprintf("mkdir -p %s/genesis/bin %s/upgrades", cosmovisorPath, cosmovisorPath)
	if out, err = runUser(dirs); err != nil {
		sendEvent("error", fmt.Sprintf("mkdir failed: %v\n%s", err, out))
		return
	}
	sendEvent("dirs:done", fmt.Sprintf("Directories created under %s", cosmovisorPath))

	// Step 3 — check for binary in genesis/bin.
	sendEvent("binary", "Checking genesis binary…")
	binCheck := fmt.Sprintf("ls %s/genesis/bin/ 2>&1", cosmovisorPath)
	if out, err = runUser(binCheck); err != nil || strings.TrimSpace(out) == "" {
		sendEvent("binary:warn", "No genesis binary found — place the chain binary in "+
			cosmovisorPath+"/genesis/bin/ and re-run deploy, or set it up manually.")
	} else {
		sendEvent("binary:found", "Genesis binary: "+strings.TrimSpace(out))
	}

	// Step 4 — write systemd service.
	sendEvent("systemd", "Writing systemd service…")
	unitContent := fmt.Sprintf(`[Unit]
Description=%s managed by cosmovisor
After=network-online.target

[Service]
User=%s
ExecStart=%s/bin/cosmovisor run start
Restart=always
RestartSec=3
LimitNOFILE=65535
Environment="DAEMON_HOME=%s"
Environment="DAEMON_NAME=%s"
Environment="DAEMON_ALLOW_DOWNLOAD_BINARIES=false"
Environment="DAEMON_RESTART_AFTER_UPGRADE=true"
Environment="UNSAFE_SKIP_BACKUP=true"

[Install]
WantedBy=multi-user.target
`, serviceName, vm.User, cosmovisorPath, cosmovisorPath, serviceName)

	// Write via tee to avoid shell quoting issues.
	writeUnit := fmt.Sprintf(
		"cat > /tmp/%s.service << 'EOSVC'\n%sEOSVC", serviceName, unitContent)
	if out, err = runUser(writeUnit); err != nil {
		sendEvent("error", fmt.Sprintf("write service file failed: %v\n%s", err, out))
		return
	}
	moveUnit := fmt.Sprintf("cp /tmp/%s.service /etc/systemd/system/%s.service", serviceName, serviceName)
	if out, err = runSudo(moveUnit); err != nil {
		sendEvent("error", fmt.Sprintf("install service file failed: %v\n%s", err, out))
		return
	}
	sendEvent("systemd:done", fmt.Sprintf("/etc/systemd/system/%s.service written", serviceName))

	// Step 5 — daemon-reload + enable + start.
	sendEvent("enable", "Reloading systemd and enabling service…")
	for _, cmd := range []string{"systemctl daemon-reload", "systemctl enable " + serviceName, "systemctl start " + serviceName} {
		if out, err = runSudo(cmd); err != nil {
			sendEvent("error", fmt.Sprintf("%s failed: %v\n%s", cmd, err, out))
			return
		}
		sendEvent("enable:step", cmd+" — OK")
	}
	sendEvent("complete", fmt.Sprintf("cosmovisor deploy complete for %s on %s", serviceName, vmName))
}
