package web

// vm_shell.go — WebSocket shell bridge for fleet VMs.
//
// HandleVMShell opens an interactive SSH PTY session on the target VM,
// routing through a ProxyJump when required (e.g. VMs behind a vRack).
// The WebSocket protocol is identical to vm.Handlers.HandleShell so the
// same frontend component works for both hypervisor and VM targets.
//
// Protocol (server → client):
//
//	{"type": "data",  "data": "<base64-encoded terminal bytes>"}
//	{"type": "error", "data": "plain-text error message"}
//
// Protocol (client → server):
//
//	raw bytes  — written verbatim to SSH stdin
//	{"type": "resize", "rows": N, "cols": N}

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	fleetssh "github.com/vNodesV/vOps/internal/fleet/ssh"
	"github.com/vNodesV/vOps/internal/logging"
	"github.com/vNodesV/vOps/internal/vops/ctxkeys"
	opsdb "github.com/vNodesV/vOps/internal/vops/db"
	opsvm "github.com/vNodesV/vOps/internal/vops/vm"
)

const (
	vmShellIdleTimeout = 5 * time.Minute
	vmShellWriteWait   = 10 * time.Second
	vmShellPingPeriod  = 30 * time.Second
)

// HandleVMShell upgrades to WebSocket and bridges to an SSH PTY on a
// fleet VM, using ProxyJump transparently when the VM requires it.
//
// Query params:
//
//	vm=<name> — VM name as defined in the infra TOML
func (s *Server) HandleVMShell(w http.ResponseWriter, r *http.Request) {
	vmName := r.URL.Query().Get("vm")
	if vmName == "" {
		http.Error(w, `query parameter "vm" is required`, http.StatusBadRequest)
		return
	}

	if s.fleetSvc == nil {
		http.Error(w, "fleet service not available", http.StatusServiceUnavailable)
		return
	}

	fleetVM := s.fleetSvc.FindVM(vmName)
	if fleetVM == nil {
		http.Error(w, "vm not found: "+vmName, http.StatusNotFound)
		return
	}

	// OC-1: self-dial guard — reject VMs whose SSH host resolves to the loopback
	// interface. Without this check, a misconfigured vm.host = "127.0.0.1" in
	// the infra TOML would open a shell to the vOps process itself instead of
	// the intended remote VM (silent wrong-host connection).
	dialTarget := fleetVM.Host
	if dialTarget == "" {
		dialTarget = fleetVM.Name
	}
	if ip := net.ParseIP(dialTarget); (ip != nil && ip.IsLoopback()) || dialTarget == "localhost" {
		http.Error(w, "vm shell rejected: host resolves to loopback (OC-1 guard)", http.StatusForbidden)
		return
	}

	// Upgrade to WebSocket before opening SSH so the client knows the route
	// is valid before committing to a potentially slow dial.
	conn, err := s.vmWSUpgrader().Upgrade(w, r, nil)
	if err != nil {
		logging.Print("ERR", "web.vmshell", "websocket upgrade failed", logging.F("err", err))
		return
	}
	defer conn.Close()

	// Dial SSH, using ProxyJump if required.
	var sshClient *fleetssh.Client
	if jp := s.fleetSvc.Config().ResolveProxyJump(fleetVM); jp != nil {
		jumpAddr := jp.VRackIP
		if jumpAddr == "" {
			jumpAddr = jp.LanIP
		}
		if jumpAddr == "" {
			jumpAddr = jp.Name
		}
		jumpPort := jp.Port
		if jumpPort == 0 {
			jumpPort = 22
		}
		var dialErr error
		sshClient, dialErr = fleetssh.DialViaProxy(
			jumpAddr, jumpPort, jp.User, jp.SSHKeyPath, "",
			fleetVM.Host, fleetVM.Port, fleetVM.User, fleetVM.KeyPath, fleetVM.KnownHostsPath,
		)
		if dialErr != nil {
			vmWSError(conn, fmt.Sprintf("ssh connect failed: %v", dialErr))
			return
		}
	} else {
		var dialErr error
		sshClient, dialErr = fleetssh.Dial(
			fleetVM.Host, fleetVM.Port, fleetVM.User, fleetVM.KeyPath, fleetVM.KnownHostsPath,
		)
		if dialErr != nil {
			vmWSError(conn, fmt.Sprintf("ssh connect failed: %v", dialErr))
			return
		}
	}
	defer sshClient.Close()

	shell, err := sshClient.Shell()
	if err != nil {
		vmWSError(conn, fmt.Sprintf("ssh shell failed: %v", err))
		return
	}
	defer shell.Close()

	actor, _ := r.Context().Value(ctxkeys.Actor).(string)
	if actor == "" {
		actor = "unknown"
	}
	startTime := time.Now()
	s.auditVMShell(actor, "fleet.shell.open", vmName, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// BridgeShellSession manages the idle timer, ping keepalives, and the
	// ws↔ssh relay goroutines. It blocks until both goroutines exit.
	opsvm.BridgeShellSession(ctx, cancel, conn, shell,
		vmShellIdleTimeout, vmShellWriteWait, vmShellPingPeriod,
		"vm", vmName)

	_ = conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, "session ended"),
		time.Now().Add(vmShellWriteWait),
	)

	duration := time.Since(startTime)
	s.auditVMShell(actor, "fleet.shell.close", vmName, &duration)
}

// vmWSUpgrader returns a WebSocket upgrader that validates Origin against the
// request Host header to prevent cross-origin hijacking.
//
// Using r.Host (rather than the configured bind address) ensures correctness
// under reverse-proxy deployments where Apache/nginx forwards the original
// Host header via ProxyPreserveHost — r.Host equals the browser's origin host
// ("vnodesv.net"), not the backend's bind address ("127.0.0.1:8889").
func (s *Server) vmWSUpgrader() *websocket.Upgrader {
	return &websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				host, _, _ := net.SplitHostPort(r.RemoteAddr)
				return host == "127.0.0.1" || host == "::1"
			}
			target := r.Host
			if target == "" {
				target = fmt.Sprintf("%s:%d", s.cfg.VOps.BindAddress, s.cfg.VOps.Port)
			}
			return origin == "http://"+target || origin == "https://"+target
		},
	}
}

// auditVMShell writes a fleet shell-session audit entry. duration is nil on open.
func (s *Server) auditVMShell(actor, action, vmName string, duration *time.Duration) {
	if s.db == nil {
		return
	}
	params := "{}"
	if duration != nil {
		params = fmt.Sprintf(`{"duration_s":%.1f}`, duration.Seconds())
	}
	_ = opsdb.InsertAuditLog(s.db.DB, opsdb.AuditEntry{
		Actor:      actor,
		Action:     action,
		TargetType: "vm",
		TargetName: vmName,
		Params:     params,
		Result:     "ok",
	})
}

// vmWSError sends a JSON error frame over the WebSocket and closes it.
// wsErrMsg mirrors the shellMsg protocol used by BridgeShellSession so
// the browser client receives a consistent envelope on both error and data.
type wsErrMsg struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

func vmWSError(conn *websocket.Conn, msg string) {
	_ = conn.WriteJSON(wsErrMsg{Type: "error", Data: msg})
	_ = conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseInternalServerErr, msg),
		time.Now().Add(vmShellWriteWait),
	)
}
