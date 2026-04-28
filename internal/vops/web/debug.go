package web

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const debugRingSize = 200

// DebugEvent records a single SSH command execution for the debug console.
type DebugEvent struct {
	ID         int64  `json:"id"`
	Time       string `json:"time"`
	Source     string `json:"source"` // e.g. "hypervisor-scan", "host-scan", "vm-action"
	Host       string `json:"host"`   // dial address used
	Command    string `json:"command"`
	Output     string `json:"output,omitempty"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"duration_ms"`
}

// DebugRing is a fixed-size ring buffer of DebugEvents with an enable/disable toggle.
// All methods are safe for concurrent use.
type DebugRing struct {
	mu     sync.Mutex
	events [debugRingSize]DebugEvent
	head   int   // next write index
	count  int   // filled slots
	nextID int64 // monotonic event ID

	enabled atomic.Bool
}

// IsEnabled reports whether debug recording is active.
func (r *DebugRing) IsEnabled() bool { return r.enabled.Load() }

// SetEnabled turns debug recording on or off.
func (r *DebugRing) SetEnabled(on bool) { r.enabled.Store(on) }

// Emit records a command execution. No-op when disabled.
func (r *DebugRing) Emit(source, host, command, output, errStr string, durationMs int64) {
	if !r.enabled.Load() {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	id := r.nextID
	r.nextID++
	r.events[r.head] = DebugEvent{
		ID:         id,
		Time:       time.Now().UTC().Format("15:04:05.000"),
		Source:     source,
		Host:       host,
		Command:    command,
		Output:     output,
		Error:      errStr,
		DurationMs: durationMs,
	}
	r.head = (r.head + 1) % debugRingSize
	if r.count < debugRingSize {
		r.count++
	}
}

// Since returns all events with ID >= sinceID, in insertion order.
func (r *DebugRing) Since(sinceID int64) []DebugEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]DebugEvent, 0)
	count := r.count
	start := (r.head - count + debugRingSize) % debugRingSize
	for i := 0; i < count; i++ {
		e := r.events[(start+i)%debugRingSize]
		if e.ID >= sinceID {
			out = append(out, e)
		}
	}
	return out
}

// Clear removes all stored events and resets the ID counter.
func (r *DebugRing) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.count = 0
	r.head = 0
	r.nextID = 0
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

// handleAPIDebugMode handles GET and POST for debug mode toggle.
//
// GET  /api/v1/debug/mode  → {"enabled": bool}
// POST /api/v1/debug/mode  ← {"enabled": bool, "clear": bool}
func (s *Server) handleAPIDebugMode(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var body struct {
			Enabled bool `json:"enabled"`
			Clear   bool `json:"clear"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		s.debug.SetEnabled(body.Enabled)
		if body.Clear {
			s.debug.Clear()
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"enabled": s.debug.IsEnabled(),
	})
}

// handleAPIDebugEvents returns debug events recorded since the given ID.
//
// GET /api/v1/debug/events?since_id=N
func (s *Server) handleAPIDebugEvents(w http.ResponseWriter, r *http.Request) {
	var sinceID int64
	if v := r.URL.Query().Get("since_id"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			sinceID = n
		}
	}
	events := s.debug.Since(sinceID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"enabled": s.debug.IsEnabled(),
		"events":  events,
	})
}

// ── HTTP middleware ───────────────────────────────────────────────────────────

// debugHTTPMiddleware wraps the entire mux and records every API request when
// debug mode is enabled. Static assets and the debug polling endpoints
// themselves are excluded to avoid noise.
func (s *Server) debugHTTPMiddleware(next http.Handler) http.Handler {
	// Prefixes that are too noisy or would cause recursive logging.
	skipPrefixes := []string{
		"/api/v1/debug/",
		"/assets/",
		"/static/",
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.debug.IsEnabled() {
			next.ServeHTTP(w, r)
			return
		}
		for _, pfx := range skipPrefixes {
			if strings.HasPrefix(r.URL.Path, pfx) {
				next.ServeHTTP(w, r)
				return
			}
		}
		start := time.Now()
		rw := &debugResponseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)

		path := r.URL.Path
		if r.URL.RawQuery != "" {
			path += "?" + r.URL.RawQuery
		}
		statusStr := fmt.Sprintf("HTTP %d", rw.status)
		errStr := ""
		if rw.status >= 400 {
			errStr = fmt.Sprintf("HTTP %d", rw.status)
		}
		s.debug.Emit("http", r.RemoteAddr, r.Method+" "+path, statusStr, errStr,
			time.Since(start).Milliseconds())
	})
}

// debugResponseWriter wraps http.ResponseWriter to capture the status code.
type debugResponseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *debugResponseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *debugResponseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
