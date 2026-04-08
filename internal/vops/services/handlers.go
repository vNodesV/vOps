// Package services provides HTTP handlers for the vOps service registry:
// validator, api/rpc, node, relayer, webserver, vProx, and other service types.
package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Handlers provides CRUD operations for the services registry.
type Handlers struct {
	db *sql.DB
}

// NewHandlers creates service registry handlers backed by db.
func NewHandlers(db *sql.DB) *Handlers {
	return &Handlers{db: db}
}

// Service mirrors the services table.
type Service struct {
	ID          int64           `json:"id"`
	Name        string          `json:"name"`
	ServiceType string          `json:"service_type"`
	VMName      string          `json:"vm_name"`
	Datacenter  string          `json:"datacenter"`
	ChainID     string          `json:"chain_id"`
	State       string          `json:"state"`
	Config      json.RawMessage `json:"config"`
	CreatedAt   string          `json:"created_at"`
	UpdatedAt   string          `json:"updated_at"`
}

// ServiceStatus mirrors the service_status table (latest poll).
type ServiceStatus struct {
	ID        int64           `json:"id"`
	ServiceID int64           `json:"service_id"`
	PolledAt  string          `json:"polled_at"`
	Online    bool            `json:"online"`
	Metrics   json.RawMessage `json:"metrics"`
}

// ── GET /api/v1/services ─────────────────────────────────────────────────────

// HandleList returns all registered services, newest first.
func (h *Handlers) HandleList(w http.ResponseWriter, _ *http.Request) {
	rows, err := h.db.Query(`
		SELECT id, name, service_type, vm_name, datacenter, chain_id, state, config, created_at, updated_at
		FROM services ORDER BY id ASC`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	svcs := make([]Service, 0)
	for rows.Next() {
		var s Service
		var cfg string
		if err := rows.Scan(&s.ID, &s.Name, &s.ServiceType, &s.VMName, &s.Datacenter, &s.ChainID, &s.State, &cfg, &s.CreatedAt, &s.UpdatedAt); err != nil {
			continue
		}
		s.Config = json.RawMessage(cfg)
		svcs = append(svcs, s)
	}
	writeJSON(w, http.StatusOK, map[string]any{"services": svcs})
}

// ── POST /api/v1/services ─────────────────────────────────────────────────────

type createRequest struct {
	Name        string          `json:"name"`
	ServiceType string          `json:"service_type"`
	VMName      string          `json:"vm_name"`
	Datacenter  string          `json:"datacenter"`
	ChainID     string          `json:"chain_id"`
	Config      json.RawMessage `json:"config"`
}

// HandleCreate registers a new service.
func (h *Handlers) HandleCreate(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.ServiceType == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and service_type are required"})
		return
	}
	if !validType(req.ServiceType) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("unknown service_type %q", req.ServiceType)})
		return
	}
	cfg := "{}"
	if len(req.Config) > 0 {
		cfg = string(req.Config)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := h.db.Exec(`
		INSERT INTO services (name, service_type, vm_name, datacenter, chain_id, state, config, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'unknown', ?, ?, ?)`,
		req.Name, req.ServiceType, req.VMName, req.Datacenter, req.ChainID, cfg, now, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "service name already exists"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "name": req.Name})
}

// ── GET /api/v1/services/{id} ─────────────────────────────────────────────────

// HandleGet returns one service by ID.
func (h *Handlers) HandleGet(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	var s Service
	var cfg string
	err = h.db.QueryRow(`
		SELECT id, name, service_type, vm_name, datacenter, chain_id, state, config, created_at, updated_at
		FROM services WHERE id = ?`, id).
		Scan(&s.ID, &s.Name, &s.ServiceType, &s.VMName, &s.Datacenter, &s.ChainID, &s.State, &cfg, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.Config = json.RawMessage(cfg)

	// Attach latest status if present.
	var st ServiceStatus
	var metrics string
	err = h.db.QueryRow(`
		SELECT id, service_id, polled_at, online, metrics
		FROM service_status WHERE service_id = ? ORDER BY polled_at DESC LIMIT 1`, id).
		Scan(&st.ID, &st.ServiceID, &st.PolledAt, &st.Online, &metrics)
	if err == nil {
		st.Metrics = json.RawMessage(metrics)
	}
	writeJSON(w, http.StatusOK, map[string]any{"service": s, "status": st})
}

// ── PUT /api/v1/services/{id} ─────────────────────────────────────────────────

type updateRequest struct {
	VMName     string          `json:"vm_name"`
	Datacenter string          `json:"datacenter"`
	ChainID    string          `json:"chain_id"`
	State      string          `json:"state"`
	Config     json.RawMessage `json:"config"`
}

// HandleUpdate replaces mutable fields of a service.
func (h *Handlers) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	var req updateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	cfg := "{}"
	if len(req.Config) > 0 {
		cfg = string(req.Config)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := h.db.Exec(`
		UPDATE services SET vm_name=?, datacenter=?, chain_id=?, state=?, config=?, updated_at=?
		WHERE id=?`,
		req.VMName, req.Datacenter, req.ChainID, req.State, cfg, now, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": id})
}

// ── DELETE /api/v1/services/{id} ──────────────────────────────────────────────

// HandleDelete removes a service and its status history.
func (h *Handlers) HandleDelete(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	_, _ = h.db.Exec("DELETE FROM service_status WHERE service_id=?", id)
	res, err := h.db.Exec("DELETE FROM services WHERE id=?", id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": id})
}

// ── POST /api/v1/services/{id}/status ─────────────────────────────────────────

type statusPushRequest struct {
	Online  bool            `json:"online"`
	Metrics json.RawMessage `json:"metrics"`
}

// HandlePushStatus records a status poll for a service.
func (h *Handlers) HandlePushStatus(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	var req statusPushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	metrics := "{}"
	if len(req.Metrics) > 0 {
		metrics = string(req.Metrics)
	}
	online := 0
	if req.Online {
		online = 1
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = h.db.Exec(`
		INSERT INTO service_status (service_id, polled_at, online, metrics) VALUES (?, ?, ?, ?)`,
		id, now, online, metrics)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	// Update state on the parent service.
	state := "down"
	if req.Online {
		state = "online"
	}
	_, _ = h.db.Exec("UPDATE services SET state=?, updated_at=? WHERE id=?", state, now, id)
	writeJSON(w, http.StatusCreated, map[string]any{"recorded": now})
}

// ── Helpers ───────────────────────────────────────────────────────────────────

var validServiceTypes = map[string]bool{
	"validator": true,
	"api":       true,
	"rpc":       true,
	"node":      true,
	"relayer":   true,
	"webserver": true,
	"vprox":     true,
	"other":     true,
}

func validType(t string) bool { return validServiceTypes[t] }

func pathID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
