package vm

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
)

const (
	shellIdleTimeout = 5 * time.Minute
	shellWriteWait   = 10 * time.Second
	shellPingPeriod  = 30 * time.Second
	shellReadBufSize = 4096
)

// wsUpgrader returns a websocket.Upgrader whose CheckOrigin validates the
// request Origin against r.Host to prevent cross-origin WebSocket hijacking.
//
// r.Host is used as the primary check: when deployed behind a reverse proxy
// with ProxyPreserveHost On, r.Host equals the browser's origin host
// ("example.com"), not the backend bind address ("127.0.0.1:8889").
// For direct connections r.Host also equals the browser's URL host, so the
// check is correct in both cases. h.allowedOrigin is only used as a fallback
// when r.Host is empty (non-standard; should never occur in practice).
func (h *Handlers) wsUpgrader() *websocket.Upgrader {
	return &websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				// Non-browser clients (no Origin header): allow only loopback.
				host, _, _ := net.SplitHostPort(r.RemoteAddr)
				return host == "127.0.0.1" || host == "::1"
			}
			target := r.Host
			if target == "" {
				target = h.allowedOrigin
			}
			return origin == "http://"+target || origin == "https://"+target
		},
	}
}

// shellMsg is the JSON envelope sent from server → client on the WebSocket.
type shellMsg struct {
	Type string `json:"type"` // "data", "error", "close"
	Data string `json:"data"` // base64-encoded for "data"; plain text for "error"/"close"
}

// HandleShell upgrades the HTTP connection to a WebSocket and bridges it to an
// SSH PTY session on the target hypervisor host.
//
// Query params:
//
//	host=<name> — hypervisor host name (looked up via findHost)
//
// WebSocket protocol:
//
//	Client → Server: raw bytes sent directly to SSH stdin
//	Server → Client: JSON messages { "type": "data"|"error"|"close", "data": "..." }
func (h *Handlers) HandleShell(w http.ResponseWriter, r *http.Request) {
	hostName := r.URL.Query().Get("host")
	if hostName == "" {
		http.Error(w, `query parameter "host" is required`, http.StatusBadRequest)
		return
	}

	hi, err := h.findHost(hostName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Upgrade to WebSocket before opening SSH — this lets the client know
	// the route is valid before committing to a potentially slow SSH dial.
	conn, err := h.wsUpgrader().Upgrade(w, r, nil)
	if err != nil {
		logging.Print("ERR", "vm.shell", "websocket upgrade failed", logging.F("err", err))
		return // Upgrade already wrote an HTTP error
	}
	defer conn.Close()

	// Dial SSH to the hypervisor host — reuses the same credential resolution
	// as all other VM Manager handlers.
	sshClient, err := h.dialHostRaw(hi)
	if err != nil {
		writeWSError(conn, fmt.Sprintf("ssh connect failed: %v", err))
		return
	}
	defer sshClient.Close()

	shell, err := sshClient.Shell()
	if err != nil {
		writeWSError(conn, fmt.Sprintf("ssh shell failed: %v", err))
		return
	}
	defer shell.Close()

	// Audit: record session open.
	actor, _ := r.Context().Value(ctxkeys.Actor).(string)
	if actor == "" {
		actor = "unknown"
	}
	startTime := time.Now()
	h.auditShell(actor, "vm.shell.open", hostName, nil)

	// Context controls lifetime of both relay goroutines.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// BridgeShellSession manages the idle timer, ping keepalives, and the
	// ws↔ssh relay goroutines. It blocks until both goroutines exit.
	BridgeShellSession(ctx, cancel, conn, shell,
		shellIdleTimeout, shellWriteWait, shellPingPeriod,
		"host", hostName)

	// Send close frame to the client.
	_ = conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, "session ended"),
		time.Now().Add(shellWriteWait),
	)

	// Audit: record session close.
	duration := time.Since(startTime)
	h.auditShell(actor, "vm.shell.close", hostName, &duration)
}

// dialHostRaw opens a raw *fleetssh.Client (not wrapped in the sshClient
// interface) so the caller has access to Shell().
func (h *Handlers) dialHostRaw(hi HostInfo) (*fleetssh.Client, error) {
	addr := hi.LanIP
	if addr == "" {
		addr = hi.Name
	}
	keyPath := hi.SSHKeyPath
	if keyPath == "" {
		keyPath = h.sshKeyPath
	}
	port := hi.Port
	if port == 0 {
		port = h.sshPort
	}
	if port == 0 {
		port = 22
	}
	return fleetssh.Dial(addr, port, hi.User, keyPath, h.knownHosts)
}

// auditShell writes a shell-session audit entry. duration is nil on open.
func (h *Handlers) auditShell(actor, action, hostName string, duration *time.Duration) {
	if h.db == nil {
		return
	}
	params := "{}"
	if duration != nil {
		params = fmt.Sprintf(`{"duration_s":%.1f}`, duration.Seconds())
	}
	_ = opsdb.InsertAuditLog(h.db, opsdb.AuditEntry{
		Actor:      actor,
		Action:     action,
		TargetType: "host",
		TargetName: hostName,
		Params:     params,
		Result:     "ok",
	})
}

// writeWSError sends a JSON error message over the WebSocket and closes it.
func writeWSError(conn *websocket.Conn, msg string) {
	_ = conn.WriteJSON(shellMsg{Type: "error", Data: msg})
	_ = conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseInternalServerErr, msg),
		time.Now().Add(shellWriteWait),
	)
}
