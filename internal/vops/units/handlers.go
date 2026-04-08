// Package units provides HTTP handlers for the vOps Cosmos unit registry:
// validators, API nodes, full nodes, relayers, and any systemd-managed
// Cosmos SDK process running on a fleet VM.
package units

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Handlers provides CRUD operations for the units registry.
type Handlers struct {
	db *sql.DB
}

// NewHandlers creates units registry handlers backed by db.
func NewHandlers(db *sql.DB) *Handlers {
	return &Handlers{db: db}
}

// Unit mirrors the units table.
type Unit struct {
	ID               int64  `json:"id"`
	Name             string `json:"name"`
	ChainName        string `json:"chain_name"`
	ChainID          string `json:"chain_id"`
	NetworkType      string `json:"network_type"`
	NodeType         string `json:"node_type"`
	VMName           string `json:"vm_name"`
	Datacenter       string `json:"datacenter"`
	ServiceName      string `json:"service_name"`
	BinaryPath       string `json:"binary_path"`
	CosmovisorPath   string `json:"cosmovisor_path"`
	CosmovisorEnabled bool  `json:"cosmovisor_enabled"`
	ConfigDir        string `json:"config_dir"`
	RPCPort          int    `json:"rpc_port"`
	APIPort          int    `json:"api_port"`
	P2PPort          int    `json:"p2p_port"`
	Valoper          string `json:"valoper"`
	State            string `json:"state"`
	DeployedAt       string `json:"deployed_at"`
	Notes            string `json:"notes"`
}

// UnitStatus mirrors the unit_status table (single poll row).
type UnitStatus struct {
	ID            int64  `json:"id"`
	UnitName      string `json:"unit_name"`
	PolledAt      string `json:"polled_at"`
	Syncing       bool   `json:"syncing"`
	BlockHeight   int64  `json:"block_height"`
	Peers         int    `json:"peers"`
	VotingPower   int64  `json:"voting_power"`
	GovPending    int    `json:"gov_pending"`
	ServiceActive bool   `json:"service_active"`
	Error         string `json:"error,omitempty"`
}

// UnitWithStatus is a unit joined with its most recent status poll.
type UnitWithStatus struct {
	Unit
	Status *UnitStatus `json:"status,omitempty"`
}

// ── helpers ───────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// scanUnit reads one Unit row.
func scanUnit(row interface {
	Scan(...any) error
}) (Unit, error) {
	var u Unit
	var cosmovisorEnabled int
	err := row.Scan(
		&u.ID, &u.Name, &u.ChainName, &u.ChainID, &u.NetworkType, &u.NodeType,
		&u.VMName, &u.Datacenter, &u.ServiceName, &u.BinaryPath, &u.CosmovisorPath,
		&cosmovisorEnabled, &u.ConfigDir, &u.RPCPort, &u.APIPort, &u.P2PPort,
		&u.Valoper, &u.State, &u.DeployedAt, &u.Notes,
	)
	u.CosmovisorEnabled = cosmovisorEnabled != 0
	return u, err
}

const unitCols = `id, name, chain_name, chain_id, network_type, node_type,
	vm_name, datacenter, service_name, binary_path, cosmovisor_path,
	cosmovisor_enabled, config_dir, rpc_port, api_port, p2p_port,
	valoper, state, deployed_at, notes`

// ── GET /api/v1/units ─────────────────────────────────────────────────────────

// HandleList returns all registered units with their latest status.
func (h *Handlers) HandleList(w http.ResponseWriter, _ *http.Request) {
	rows, err := h.db.Query(`SELECT ` + unitCols + ` FROM units ORDER BY chain_name, name`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	units := make([]UnitWithStatus, 0)
	for rows.Next() {
		u, err := scanUnit(rows)
		if err != nil {
			continue
		}
		st := latestStatus(h.db, u.Name)
		units = append(units, UnitWithStatus{Unit: u, Status: st})
	}
	writeJSON(w, http.StatusOK, map[string]any{"units": units})
}

// ── GET /api/v1/units/{name} ──────────────────────────────────────────────────

// HandleGet returns a single unit by name.
func (h *Handlers) HandleGet(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	row := h.db.QueryRow(`SELECT `+unitCols+` FROM units WHERE name = ?`, name)
	u, err := scanUnit(row)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unit not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	st := latestStatus(h.db, name)
	writeJSON(w, http.StatusOK, UnitWithStatus{Unit: u, Status: st})
}

// ── POST /api/v1/units ────────────────────────────────────────────────────────

// HandleCreate registers a new unit.
func (h *Handlers) HandleCreate(w http.ResponseWriter, r *http.Request) {
	var u Unit
	if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
		return
	}
	u.Name = strings.TrimSpace(u.Name)
	if u.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	if u.NodeType == "" {
		u.NodeType = "node"
	}
	if u.NetworkType == "" {
		u.NetworkType = "mainnet"
	}
	if u.RPCPort == 0 {
		u.RPCPort = 26657
	}
	if u.APIPort == 0 {
		u.APIPort = 1317
	}
	if u.P2PPort == 0 {
		u.P2PPort = 26656
	}
	if u.State == "" {
		u.State = "unknown"
	}
	cosmovisorEnabled := 0
	if u.CosmovisorEnabled {
		cosmovisorEnabled = 1
	}

	now := time.Now().UTC().Format(time.RFC3339)
	_, err := h.db.Exec(`
		INSERT INTO units (name, chain_name, chain_id, network_type, node_type,
			vm_name, datacenter, service_name, binary_path, cosmovisor_path,
			cosmovisor_enabled, config_dir, rpc_port, api_port, p2p_port,
			valoper, state, deployed_at, notes)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		u.Name, u.ChainName, u.ChainID, u.NetworkType, u.NodeType,
		u.VMName, u.Datacenter, u.ServiceName, u.BinaryPath, u.CosmovisorPath,
		cosmovisorEnabled, u.ConfigDir, u.RPCPort, u.APIPort, u.P2PPort,
		u.Valoper, u.State, now, u.Notes,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "unit name already exists"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"ok": "created", "name": u.Name})
}

// ── PUT /api/v1/units/{name} ──────────────────────────────────────────────────

// HandleUpdate updates a unit's metadata.
func (h *Handlers) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var u Unit
	if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	cosmovisorEnabled := 0
	if u.CosmovisorEnabled {
		cosmovisorEnabled = 1
	}
	res, err := h.db.Exec(`
		UPDATE units SET chain_name=?, chain_id=?, network_type=?, node_type=?,
			vm_name=?, datacenter=?, service_name=?, binary_path=?, cosmovisor_path=?,
			cosmovisor_enabled=?, config_dir=?, rpc_port=?, api_port=?, p2p_port=?,
			valoper=?, state=?, notes=?
		WHERE name=?`,
		u.ChainName, u.ChainID, u.NetworkType, u.NodeType,
		u.VMName, u.Datacenter, u.ServiceName, u.BinaryPath, u.CosmovisorPath,
		cosmovisorEnabled, u.ConfigDir, u.RPCPort, u.APIPort, u.P2PPort,
		u.Valoper, u.State, u.Notes, name,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unit not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "updated"})
}

// ── DELETE /api/v1/units/{name} ───────────────────────────────────────────────

// HandleDelete removes a unit and its status history.
func (h *Handlers) HandleDelete(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	res, err := h.db.Exec(`DELETE FROM units WHERE name=?`, name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unit not found"})
		return
	}
	_, _ = h.db.Exec(`DELETE FROM unit_status WHERE unit_name=?`, name)
	writeJSON(w, http.StatusOK, map[string]string{"ok": "deleted"})
}

// ── POST /api/v1/units/{name}/status ─────────────────────────────────────────

// HandlePushStatus accepts a unit status poll from an external collector.
func (h *Handlers) HandlePushStatus(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var st UnitStatus
	if err := json.NewDecoder(r.Body).Decode(&st); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	st.UnitName = name
	st.PolledAt = time.Now().UTC().Format(time.RFC3339)
	syncing := 0
	if st.Syncing {
		syncing = 1
	}
	serviceActive := 0
	if st.ServiceActive {
		serviceActive = 1
	}
	_, err := h.db.Exec(`
		INSERT INTO unit_status (unit_name, polled_at, syncing, block_height, peers,
			voting_power, gov_pending, service_active, error)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		st.UnitName, st.PolledAt, syncing, st.BlockHeight, st.Peers,
		st.VotingPower, st.GovPending, serviceActive, st.Error,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "recorded"})
}

// ── GET /api/v1/units/{name}/status/history ───────────────────────────────────

// HandleStatusHistory returns recent status polls for a unit (last 100).
func (h *Handlers) HandleStatusHistory(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	rows, err := h.db.Query(`
		SELECT id, unit_name, polled_at, syncing, block_height, peers,
		       voting_power, gov_pending, service_active, error
		FROM unit_status
		WHERE unit_name = ?
		ORDER BY polled_at DESC LIMIT 100`, name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	hist := make([]UnitStatus, 0)
	for rows.Next() {
		var st UnitStatus
		var syncing, serviceActive int
		if err := rows.Scan(&st.ID, &st.UnitName, &st.PolledAt, &syncing, &st.BlockHeight,
			&st.Peers, &st.VotingPower, &st.GovPending, &serviceActive, &st.Error); err != nil {
			continue
		}
		st.Syncing = syncing != 0
		st.ServiceActive = serviceActive != 0
		hist = append(hist, st)
	}
	writeJSON(w, http.StatusOK, map[string]any{"history": hist})
}

// ── internal: latest status helper ───────────────────────────────────────────

func latestStatus(db *sql.DB, unitName string) *UnitStatus {
	row := db.QueryRow(`
		SELECT id, unit_name, polled_at, syncing, block_height, peers,
		       voting_power, gov_pending, service_active, error
		FROM unit_status
		WHERE unit_name = ?
		ORDER BY polled_at DESC LIMIT 1`, unitName)
	var st UnitStatus
	var syncing, serviceActive int
	if err := row.Scan(&st.ID, &st.UnitName, &st.PolledAt, &syncing, &st.BlockHeight,
		&st.Peers, &st.VotingPower, &st.GovPending, &serviceActive, &st.Error); err != nil {
		return nil
	}
	st.Syncing = syncing != 0
	st.ServiceActive = serviceActive != 0
	return &st
}
