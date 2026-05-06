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
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	fleetssh "github.com/vNodesV/vOps/internal/fleet/ssh"
	"github.com/vNodesV/vOps/internal/logging"
	"github.com/vNodesV/vOps/internal/vops/ctxkeys"
	opsdb "github.com/vNodesV/vOps/internal/vops/db"
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

	idleMu := &sync.Mutex{}
	idleTimer := time.AfterFunc(vmShellIdleTimeout, func() {
		logging.Print("INF", "web.vmshell", "idle timeout", logging.F("vm", vmName))
		cancel()
	})
	defer idleTimer.Stop()

	resetIdle := func() {
		idleMu.Lock()
		idleTimer.Reset(vmShellIdleTimeout)
		idleMu.Unlock()
	}

	var wg sync.WaitGroup

	// WebSocket → SSH stdin.
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			_, msg, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err,
					websocket.CloseNormalClosure,
					websocket.CloseGoingAway,
					websocket.CloseNoStatusReceived) {
					logging.Print("WRN", "web.vmshell", "ws read error",
						logging.F("vm", vmName), logging.F("err", err))
				}
				return
			}
			resetIdle()

			// Intercept resize control messages.
			if len(msg) > 0 && msg[0] == '{' {
				var resize struct {
					Type string `json:"type"`
					Rows int    `json:"rows"`
					Cols int    `json:"cols"`
				}
				if json.Unmarshal(msg, &resize) == nil && resize.Type == "resize" {
					if resize.Rows > 0 && resize.Cols > 0 {
						_ = shell.Resize(resize.Rows, resize.Cols)
					}
					continue
				}
			}

			if _, err := shell.Write(msg); err != nil {
				logging.Print("WRN", "web.vmshell", "ssh write error",
					logging.F("vm", vmName), logging.F("err", err))
				return
			}
		}
	}()

	// SSH stdout → WebSocket (base64-encoded JSON frames).
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cancel()

		pingTicker := time.NewTicker(vmShellPingPeriod)
		defer pingTicker.Stop()

		buf := make([]byte, 4096)
		for {
			select {
			case <-ctx.Done():
				return
			case <-pingTicker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(vmShellWriteWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
				continue
			default:
			}

			n, err := shell.Read(buf)
			if n > 0 {
				resetIdle()
				encoded := base64.StdEncoding.EncodeToString(buf[:n])
				_ = conn.SetWriteDeadline(time.Now().Add(vmShellWriteWait))
				if wErr := conn.WriteJSON(map[string]string{"type": "data", "data": encoded}); wErr != nil {
					logging.Print("WRN", "web.vmshell", "ws write error",
						logging.F("vm", vmName), logging.F("err", wErr))
					return
				}
			}
			if err != nil {
				if err != io.EOF {
					logging.Print("WRN", "web.vmshell", "ssh read error",
						logging.F("vm", vmName), logging.F("err", err))
				}
				return
			}
		}
	}()

	wg.Wait()

	_ = conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, "session ended"),
		time.Now().Add(vmShellWriteWait),
	)

	duration := time.Since(startTime)
	s.auditVMShell(actor, "fleet.shell.close", vmName, &duration)
}

// vmWSUpgrader returns a WebSocket upgrader that validates Origin against the
// server's configured bind address to prevent cross-origin hijacking.
func (s *Server) vmWSUpgrader() *websocket.Upgrader {
	allowed := fmt.Sprintf("%s:%d", s.cfg.VOps.BindAddress, s.cfg.VOps.Port)
	return &websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				host, _, _ := net.SplitHostPort(r.RemoteAddr)
				return host == "127.0.0.1" || host == "::1"
			}
			return origin == "http://"+allowed || origin == "https://"+allowed
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
func vmWSError(conn *websocket.Conn, msg string) {
	_ = conn.WriteJSON(map[string]string{"type": "error", "data": msg})
	_ = conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseInternalServerErr, msg),
		time.Now().Add(vmShellWriteWait),
	)
}
