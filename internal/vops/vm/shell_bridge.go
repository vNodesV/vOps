package vm

// shell_bridge.go — shared WebSocket↔SSH relay used by both HandleShell
// (hypervisor host shells) and the web package's HandleVMShell (fleet VMs).
//
// BridgeShellSession is the single implementation of the relay goroutine pair;
// callers supply the already-dialled SSH shell and WebSocket conn so the dial
// path (direct vs ProxyJump) stays outside this package.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	fleetssh "github.com/vNodesV/vOps/internal/fleet/ssh"
	"github.com/vNodesV/vOps/internal/logging"
)

// BridgeShellSession relays between a WebSocket connection and an open SSH shell.
//
// It runs two goroutines (ws→ssh and ssh→ws) that share ctx. Whichever
// goroutine exits first calls cancel(), causing the other to exit on the next
// loop iteration. The idle timer fires cancel() and immediately unblocks both
// blocked goroutines (WS ReadMessage via SetReadDeadline, SSH Read via
// shell.Close).
//
// logField and logTarget parameterise structured log lines:
//
//	"host", "hv1.dc1"   → hypervisor shell
//	"vm",   "cosmos-1"  → fleet VM shell
//
// BridgeShellSession blocks until both goroutines exit.
func BridgeShellSession(
	ctx context.Context,
	cancel context.CancelFunc,
	conn *websocket.Conn,
	shell *fleetssh.ShellSession,
	idleTimeout, writeWait, pingPeriod time.Duration,
	logField, logTarget string,
) {
	idleMu := &sync.Mutex{}
	idleTimer := time.AfterFunc(idleTimeout, func() {
		logging.Print("INF", "vm.shell", "idle timeout", logging.F(logField, logTarget))
		cancel()
		_ = conn.SetReadDeadline(time.Now()) // unblock blocked WS ReadMessage
		_ = shell.Close()                    // unblock blocked SSH Read
	})
	defer idleTimer.Stop()

	resetIdle := func() {
		idleMu.Lock()
		idleTimer.Reset(idleTimeout)
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
				// Suppress noisy errors caused by an intentional cancel/close.
				if ctx.Err() == nil {
					if websocket.IsUnexpectedCloseError(err,
						websocket.CloseNormalClosure,
						websocket.CloseGoingAway,
						websocket.CloseNoStatusReceived) {
						logging.Print("WRN", "vm.shell", "ws read error",
							logging.F(logField, logTarget), logging.F("err", err))
					}
				}
				return
			}
			resetIdle()

			// Intercept resize control messages before forwarding to SSH.
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
				logging.Print("WRN", "vm.shell", "ssh write error",
					logging.F(logField, logTarget), logging.F("err", err))
				return
			}
		}
	}()

	// ssh → ws: read SSH stdout and forward as base64-encoded JSON frames.
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cancel()

		pingTicker := time.NewTicker(pingPeriod)
		defer pingTicker.Stop()

		buf := make([]byte, shellReadBufSize)
		for {
			select {
			case <-ctx.Done():
				return
			case <-pingTicker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
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
				_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
				if wErr := conn.WriteJSON(shellMsg{Type: "data", Data: encoded}); wErr != nil {
					logging.Print("WRN", "vm.shell", "ws write error",
						logging.F(logField, logTarget), logging.F("err", wErr))
					return
				}
			}
			if err != nil {
				if err != io.EOF {
					logging.Print("WRN", "vm.shell", "ssh read error",
						logging.F(logField, logTarget), logging.F("err", err))
				}
				return
			}
		}
	}()

	wg.Wait()
}
