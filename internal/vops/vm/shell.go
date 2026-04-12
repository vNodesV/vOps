package vm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	fleetssh "github.com/vNodesV/vProx/internal/fleet/ssh"
	opsdb "github.com/vNodesV/vProx/internal/vops/db"
)

const (
	shellIdleTimeout = 5 * time.Minute
	shellWriteWait   = 10 * time.Second
	shellPingPeriod  = 30 * time.Second
	shellReadBufSize = 4096
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		return r.Host != "" && (origin == "http://"+r.Host || origin == "https://"+r.Host)
	},
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
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("vm.shell: websocket upgrade failed", "err", err)
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
	actor, _ := r.Context().Value("vops-actor").(string)
	if actor == "" {
		actor = "unknown"
	}
	startTime := time.Now()
	h.auditShell(actor, "vm.shell.open", hostName, nil)

	// Context controls lifetime of both relay goroutines.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Idle timer — reset on every read/write.
	idleMu := &sync.Mutex{}
	idleTimer := time.AfterFunc(shellIdleTimeout, func() {
		slog.Info("vm.shell: idle timeout", "host", hostName)
		cancel()
	})
	defer idleTimer.Stop()

	resetIdle := func() {
		idleMu.Lock()
		idleTimer.Reset(shellIdleTimeout)
		idleMu.Unlock()
	}

	var wg sync.WaitGroup

	// ws → ssh: read WebSocket messages and write to SSH stdin.
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
					slog.Warn("vm.shell: ws read error", "host", hostName, "err", err)
				}
				return
			}
			resetIdle()

			// Check for resize message (JSON with type "resize").
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
				slog.Warn("vm.shell: ssh write error", "host", hostName, "err", err)
				return
			}
		}
	}()

	// ssh → ws: read SSH output and send as base64 JSON to WebSocket.
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cancel()

		pingTicker := time.NewTicker(shellPingPeriod)
		defer pingTicker.Stop()

		buf := make([]byte, shellReadBufSize)
		for {
			select {
			case <-ctx.Done():
				return
			case <-pingTicker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(shellWriteWait))
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
				_ = conn.SetWriteDeadline(time.Now().Add(shellWriteWait))
				if wErr := conn.WriteJSON(shellMsg{Type: "data", Data: encoded}); wErr != nil {
					slog.Warn("vm.shell: ws write error", "host", hostName, "err", wErr)
					return
				}
			}
			if err != nil {
				if err != io.EOF {
					slog.Warn("vm.shell: ssh read error", "host", hostName, "err", err)
				}
				return
			}
		}
	}()

	wg.Wait()

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
