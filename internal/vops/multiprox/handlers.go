// Package multiprox provides multi-instance vProx management for vOps.
// This is a foundational v2 scaffold — full HA config-sync and log aggregation
// will be added in a subsequent build.
package multiprox

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Instance represents a registered vProx instance.
type Instance struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	Datacenter string `json:"datacenter"`
	Status     string `json:"status"`
	LastSeen   string `json:"last_seen,omitempty"`
	CreatedAt  string `json:"created_at,omitempty"`
	// APIKey is intentionally omitted from JSON output.
}

// Handlers exposes CRUD endpoints for vProx instance management.
type Handlers struct {
	db *sql.DB
}

// New creates a Handlers bound to the given database.
func New(db *sql.DB) *Handlers { return &Handlers{db: db} }

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

// HandleList returns all registered vProx instances.
func (h *Handlers) HandleList(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(
		`SELECT id, name, url, datacenter, status, last_seen, created_at FROM vprox_instances ORDER BY name`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := make([]Instance, 0)
	for rows.Next() {
		var inst Instance
		if scanErr := rows.Scan(&inst.ID, &inst.Name, &inst.URL, &inst.Datacenter,
			&inst.Status, &inst.LastSeen, &inst.CreatedAt); scanErr != nil {
			continue
		}
		list = append(list, inst)
	}
	writeJSON(w, http.StatusOK, map[string]any{"instances": list})
}

// HandleCreate registers a new vProx instance.
func (h *Handlers) HandleCreate(w http.ResponseWriter, r *http.Request) {
	// TODO(security): api_key is stored in plaintext. Consider envelope encryption before v1.0.
	var req struct {
		Name       string `json:"name"`
		URL        string `json:"url"`
		APIKey     string `json:"api_key"`
		Datacenter string `json:"datacenter"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if req.Name == "" || req.URL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and url required"})
		return
	}
	u, err := url.ParseRequestURI(req.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid URL: must be http or https"})
		return
	}
	_, err = h.db.Exec(
		`INSERT INTO vprox_instances (name, url, api_key, datacenter) VALUES (?,?,?,?)`,
		req.Name, req.URL, req.APIKey, req.Datacenter)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"ok": "registered"})
}

// HandleDelete removes a vProx instance registration.
func (h *Handlers) HandleDelete(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	result, err := h.db.Exec(`DELETE FROM vprox_instances WHERE name = ?`, name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "removed"})
}

// HandlePing attempts an HTTP health check against the instance URL and updates
// its status in the DB.  Returns the updated status.
func (h *Handlers) HandlePing(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var url, apiKey string
	row := h.db.QueryRow(`SELECT url, api_key FROM vprox_instances WHERE name = ?`, name)
	if err := row.Scan(&url, &apiKey); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found: " + name})
		return
	}

	status := "online"
	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url+"/healthz", nil)
	if err == nil && apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}
	offline := false
	if err != nil {
		offline = true
	} else {
		resp, doErr := client.Do(req)
		if doErr != nil {
			offline = true
		} else {
			defer resp.Body.Close()
			io.Copy(io.Discard, resp.Body) //nolint:errcheck
			offline = resp.StatusCode >= 400
		}
	}
	if offline {
		status = "offline"
	}

	now := time.Now().UTC().Format(time.RFC3339)
	h.db.Exec(`UPDATE vprox_instances SET status = ?, last_seen = ? WHERE name = ?`, //nolint:errcheck
		status, now, name)

	writeJSON(w, http.StatusOK, map[string]any{
		"name":      name,
		"status":    status,
		"last_seen": now,
	})
}

// HandlePingAll pings all registered instances concurrently and returns a
// summary. This is a best-effort operation — failures are reported per-instance.
func (h *Handlers) HandlePingAll(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT name, url, api_key FROM vprox_instances`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	type row struct{ name, url, apiKey string }
	var instances []row
	for rows.Next() {
		var inst row
		if scanErr := rows.Scan(&inst.name, &inst.url, &inst.apiKey); scanErr == nil {
			instances = append(instances, inst)
		}
	}
	rows.Close()

	type result struct {
		Name     string `json:"name"`
		Status   string `json:"status"`
		LastSeen string `json:"last_seen"`
	}
	results := make([]result, len(instances))
	done := make(chan struct{}, len(instances))
	for i, inst := range instances {
		i, inst := i, inst
		go func() {
			defer func() { done <- struct{}{} }()
			status := "online"
			client := &http.Client{Timeout: 5 * time.Second}
			req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, inst.url+"/healthz", nil)
			if err == nil && inst.apiKey != "" {
				req.Header.Set("X-API-Key", inst.apiKey)
			}
			if err != nil {
				status = "offline"
			} else if resp, doErr := client.Do(req); doErr != nil || resp.StatusCode >= 400 {
				status = "offline"
				if resp != nil {
					resp.Body.Close()
				}
			} else {
				resp.Body.Close()
			}
			now := time.Now().UTC().Format(time.RFC3339)
			h.db.Exec(`UPDATE vprox_instances SET status = ?, last_seen = ? WHERE name = ?`, //nolint:errcheck
				status, now, inst.name)
			results[i] = result{Name: inst.name, Status: status, LastSeen: now}
		}()
	}
	for range instances {
		<-done
	}

	online := 0
	for _, res := range results {
		if res.Status == "online" {
			online++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"instances": results,
		"summary":   fmt.Sprintf("%d/%d online", online, len(results)),
	})
}

// UpdateBody holds editable fields for an existing vProx instance.
type UpdateBody struct {
	URL        string `json:"url"`
	APIKey     string `json:"api_key"`
	Datacenter string `json:"datacenter"`
}

// HandleUpdate updates URL, api_key, and/or datacenter for an existing instance.
// Blank fields are kept as-is (COALESCE pattern).
func (h *Handlers) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing name"})
		return
	}
	var body UpdateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	// validate URL if provided
	if body.URL != "" {
		u, err := url.ParseRequestURI(body.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid URL"})
			return
		}
	}
	result, err := h.db.Exec(
		`UPDATE vprox_instances SET url=COALESCE(NULLIF(?,''),(SELECT url FROM vprox_instances WHERE name=?)),
         api_key=COALESCE(NULLIF(?,''),(SELECT api_key FROM vprox_instances WHERE name=?)),
         datacenter=COALESCE(NULLIF(?,''),(SELECT datacenter FROM vprox_instances WHERE name=?))
         WHERE name=?`,
		body.URL, name, body.APIKey, name, body.Datacenter, name, name,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "updated"})
}
