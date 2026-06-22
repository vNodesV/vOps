package web

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// proxyStatusResponse is the JSON payload returned by GET /api/v1/proxy/status.
type proxyStatusResponse struct {
	Status    string `json:"status"`
	Error     string `json:"error"`
	UptimeSec int64  `json:"uptime_sec"`
	LogPath   string `json:"log_path,omitempty"`
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
		LogPath:   s.proxyCtrl.LogFilePath(),
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

// handleProxyLogs streams vProx log lines via Server-Sent Events.
//
//	GET /api/v1/proxy/logs
//
// Sends the last 100 historical lines, fires an "end" event to signal the
// transition to live mode, then tails the file every second for new content.
// Handles log rotation: if the file shrinks the stream reopens the file.
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

	// Send last 100 historical lines.
	var hist []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		hist = append(hist, sc.Text())
	}
	if len(hist) > 100 {
		hist = hist[len(hist)-100:]
	}
	for _, line := range hist {
		fmt.Fprintf(w, "data: %s\n\n", strings.ReplaceAll(line, "\n", " "))
	}
	flusher.Flush()

	// Signal end of historical lines; client stays connected for live tail.
	fmt.Fprintf(w, "event: end\ndata: \n\n")
	flusher.Flush()

	// Record current file offset — tail from here.
	offset, err := f.Seek(0, io.SeekCurrent)
	if err != nil {
		<-r.Context().Done()
		return
	}

	// Live tail: poll every second for new content.
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			// Rotation check: if file is smaller than our offset, reopen.
			fi, statErr := f.Stat()
			if statErr != nil || fi.Size() < offset {
				_ = f.Close()
				f, err = os.Open(logPath) //nolint:gosec
				if err != nil {
					continue
				}
				offset = 0
			}

			// Seek to known offset and scan new lines.
			if _, err = f.Seek(offset, io.SeekStart); err != nil {
				continue
			}
			sc2 := bufio.NewScanner(f)
			wrote := false
			for sc2.Scan() {
				fmt.Fprintf(w, "data: %s\n\n", strings.ReplaceAll(sc2.Text(), "\n", " "))
				wrote = true
			}
			// Advance offset to current position.
			if pos, seekErr := f.Seek(0, io.SeekCurrent); seekErr == nil {
				offset = pos
			}
			if wrote {
				flusher.Flush()
			}
		}
	}
}
