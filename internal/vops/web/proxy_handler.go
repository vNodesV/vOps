package web

import (
	"bufio"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// proxyStatusResponse is the JSON payload returned by GET /api/v1/proxy/status.
type proxyStatusResponse struct {
	Status    string `json:"status"`
	Error     string `json:"error"`
	UptimeSec int64  `json:"uptime_sec"`
}

// handleProxyStatus returns the current vProx controller state.
//
//	GET /api/v1/proxy/status
func (s *Server) handleProxyStatus(w http.ResponseWriter, _ *http.Request) {
	if s.proxyCtrl == nil {
		writeJSON(w, http.StatusOK, proxyStatusResponse{Status: "not_configured"})
		return
	}

	st, lastErr := s.proxyCtrl.State()
	resp := proxyStatusResponse{
		Status:    st.String(),
		UptimeSec: s.proxyCtrl.UptimeSec(),
	}
	if lastErr != nil {
		resp.Error = lastErr.Error()
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleProxyStart starts the embedded vProx server.
//
//	POST /api/v1/proxy/start
func (s *Server) handleProxyStart(w http.ResponseWriter, r *http.Request) {
	if s.proxyCtrl == nil {
		http.Error(w, `{"error":"proxy not configured"}`, http.StatusServiceUnavailable)
		return
	}
	if err := s.proxyCtrl.Start(r.Context()); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "starting"})
}

// handleProxyStop stops the embedded vProx server.
//
//	POST /api/v1/proxy/stop
func (s *Server) handleProxyStop(w http.ResponseWriter, _ *http.Request) {
	if s.proxyCtrl == nil {
		http.Error(w, `{"error":"proxy not configured"}`, http.StatusServiceUnavailable)
		return
	}
	if err := s.proxyCtrl.Stop(); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

// handleProxyRestart restarts the embedded vProx server.
//
//	POST /api/v1/proxy/restart
func (s *Server) handleProxyRestart(w http.ResponseWriter, r *http.Request) {
	if s.proxyCtrl == nil {
		http.Error(w, `{"error":"proxy not configured"}`, http.StatusServiceUnavailable)
		return
	}
	if err := s.proxyCtrl.Restart(r.Context()); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restarting"})
}

// handleProxyConfig reads (GET) or writes (POST) the vProx settings TOML file.
//
//	GET  /api/v1/proxy/config  → raw TOML string
//	POST /api/v1/proxy/config  → body = raw TOML, persists to disk
func (s *Server) handleProxyConfig(w http.ResponseWriter, r *http.Request) {
	if s.proxyCtrl == nil {
		if r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, map[string]string{"error": "proxy not configured"})
		} else {
			http.Error(w, `{"error":"proxy not configured"}`, http.StatusServiceUnavailable)
		}
		return
	}

	cfgPath := s.proxyCtrl.ConfigFilePath()

	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(cfgPath) //nolint:gosec // path is operator-controlled config
		if err != nil {
			if os.IsNotExist(err) {
				// No config file yet — return empty string so the editor starts blank.
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.WriteHeader(http.StatusOK)
				return
			}
			http.Error(w, fmt.Sprintf("read config: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)

	case http.MethodPost:
		var body strings.Builder
		if _, err := bufio.NewReader(r.Body).WriteTo(&body); err != nil {
			http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
			return
		}
		// Ensure parent directory exists (first-time setup).
		if err := os.MkdirAll(filepath.Dir(cfgPath), 0o750); err != nil {
			http.Error(w, "mkdir: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if err := os.WriteFile(cfgPath, []byte(body.String()), 0o640); err != nil { //nolint:gosec // operator-controlled path
			http.Error(w, "write config: "+err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// handleProxyLogs streams recent vProx log lines via Server-Sent Events.
//
//	GET /api/v1/proxy/logs
//
// If the log file is not readable (in-process proxy, no file yet, etc.) the
// stream emits a single "live_not_available" event so the UI can display a
// friendly message instead of a spinner.
func (s *Server) handleProxyLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	if s.proxyCtrl == nil {
		fmt.Fprintf(w, "event: live_not_available\ndata: proxy not configured\n\n")
		flusher.Flush()
		return
	}

	logPath := s.proxyCtrl.LogFilePath()
	f, err := os.Open(logPath) //nolint:gosec // operator-controlled path
	if err != nil {
		fmt.Fprintf(w, "event: live_not_available\ndata: log file not readable: %s\n\n", err.Error())
		flusher.Flush()
		return
	}
	defer f.Close()

	// Tail last 100 lines by scanning the whole file (log files are bounded).
	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if len(lines) > 100 {
		lines = lines[len(lines)-100:]
	}

	for _, line := range lines {
		// Escape newlines inside data value to keep SSE frame valid.
		safe := strings.ReplaceAll(line, "\n", " ")
		fmt.Fprintf(w, "data: %s\n\n", safe)
	}
	flusher.Flush()

	// Signal end of historical lines.
	fmt.Fprintf(w, "event: end\ndata: \n\n")
	flusher.Flush()

	// Hold the connection open until the client disconnects.
	<-r.Context().Done()
}
