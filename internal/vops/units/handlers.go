// Package units provides HTTP handlers for the vOps Cosmos unit registry:
// validators, API nodes, full nodes, relayers, and any systemd-managed
// Cosmos SDK process running on a fleet VM.
package units

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var lcdClient = &http.Client{Timeout: 12 * time.Second}

// Handlers provides CRUD operations for the units registry.
type Handlers struct {
	db        *sql.DB
	lanIPFunc func(string) string // resolves VM name → LAN IP
}

// NewHandlers creates units registry handlers backed by db.
// lanIPFunc resolves a VM name to its LAN IP; pass nil to disable tx-history proxy.
func NewHandlers(db *sql.DB, lanIPFunc func(string) string) *Handlers {
	return &Handlers{db: db, lanIPFunc: lanIPFunc}
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
	UpgradeName   string `json:"upgrade_name,omitempty"`
	UpgradeHeight int64  `json:"upgrade_height,omitempty"`
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
	// Materialize before closing rows. With MaxOpenConns=1, calling latestStatus
	// (db.QueryRow) while rows is still open would deadlock on the single connection.
	var all []Unit
	for rows.Next() {
		u, err := scanUnit(rows)
		if err != nil {
			continue
		}
		all = append(all, u)
	}
	rows.Close()

	result := make([]UnitWithStatus, 0, len(all))
	for _, u := range all {
		st := latestStatus(h.db, u.Name)
		result = append(result, UnitWithStatus{Unit: u, Status: st})
	}
	writeJSON(w, http.StatusOK, map[string]any{"units": result})
}

// HandleResetStatus deletes all rows from unit_status, giving a clean history slate.
// POST /api/v1/units/reset-status
func (h *Handlers) HandleResetStatus(w http.ResponseWriter, _ *http.Request) {
	res, err := h.db.Exec(`DELETE FROM unit_status`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	n, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]any{"ok": "status history cleared", "deleted": n})
}

// HandleResetAll deletes all units AND their status history.
// POST /api/v1/units/reset-all
func (h *Handlers) HandleResetAll(w http.ResponseWriter, _ *http.Request) {
	if _, err := h.db.Exec(`DELETE FROM unit_status`); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "clear status: " + err.Error()})
		return
	}
	res, err := h.db.Exec(`DELETE FROM units`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "clear units: " + err.Error()})
		return
	}
	n, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]any{"ok": "all units and history cleared", "units_deleted": n})
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
			voting_power, gov_pending, service_active, upgrade_name, upgrade_height, error)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		st.UnitName, st.PolledAt, syncing, st.BlockHeight, st.Peers,
		st.VotingPower, st.GovPending, serviceActive, st.UpgradeName, st.UpgradeHeight, st.Error,
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
		       voting_power, gov_pending, service_active,
		       COALESCE(upgrade_name,''), COALESCE(upgrade_height,0), error
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
			&st.Peers, &st.VotingPower, &st.GovPending, &serviceActive,
			&st.UpgradeName, &st.UpgradeHeight, &st.Error); err != nil {
			continue
		}
		st.Syncing = syncing != 0
		st.ServiceActive = serviceActive != 0
		hist = append(hist, st)
	}
	writeJSON(w, http.StatusOK, map[string]any{"history": hist})
}

// ── GET /api/v1/units/{name}/txs ─────────────────────────────────────────────
//
// Proxies a tx-history query to the unit's own Cosmos LCD (api_port, default 1317)
// using the Cosmos SDK REST format — NOT the ping.pub API or CometBFT tx_search.
//
// Query params:
//
//	address  – bech32 sender address to query (defaults to the unit's valoper)
//	mode     – "account" (all txs) or "staking" (staking module only); default "account"
//	limit    – number of results, 1–50; default 20
func (h *Handlers) HandleTxHistory(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"})
		return
	}

	address := strings.TrimSpace(r.URL.Query().Get("address"))
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "account"
	}
	limit := 20
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= 50 {
		limit = n
	}

	// Resolve unit → LAN IP + api_port.
	if h.lanIPFunc == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "tx proxy not configured"})
		return
	}
	var vmName string
	var apiPort int
	var valoper string
	row := h.db.QueryRow(`SELECT vm_name, api_port, valoper FROM units WHERE name = ?`, name)
	if err := row.Scan(&vmName, &apiPort, &valoper); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unit not found"})
		return
	}
	if apiPort == 0 {
		apiPort = 1317
	}
	if address == "" {
		address = valoper
	}
	lanIP := h.lanIPFunc(vmName)
	if lanIP == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "VM LAN IP not resolved"})
		return
	}

	// Build the Cosmos SDK REST URL.
	// Cosmos SDK REST accepts repeated `events` params for AND-filtering.
	base := fmt.Sprintf("http://%s:%d/cosmos/tx/v1beta1/txs", lanIP, apiPort)
	q := url.Values{}
	q.Set("events", fmt.Sprintf("message.sender='%s'", address))
	if mode == "staking" {
		q.Add("events", "message.module='staking'")
	}
	q.Set("pagination.limit", strconv.Itoa(limit))
	q.Set("order_by", "ORDER_BY_DESC")

	endpoint := base + "?" + q.Encode()

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "build request: " + err.Error()})
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := lcdClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "LCD request failed: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "read response: " + err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

// HandleCurrentStatus returns the most recent status poll for a unit.
func (h *Handlers) HandleCurrentStatus(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	st := latestStatus(h.db, name)
	if st == nil {
		writeJSON(w, http.StatusOK, map[string]any{"status": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": st})
}

// ── internal: latest status helper ───────────────────────────────────────────

func latestStatus(db *sql.DB, unitName string) *UnitStatus {
	row := db.QueryRow(`
		SELECT id, unit_name, polled_at, syncing, block_height, peers,
		       voting_power, gov_pending, service_active,
		       COALESCE(upgrade_name,''), COALESCE(upgrade_height,0), error
		FROM unit_status
		WHERE unit_name = ?
		ORDER BY polled_at DESC LIMIT 1`, unitName)
	var st UnitStatus
	var syncing, serviceActive int
	if err := row.Scan(&st.ID, &st.UnitName, &st.PolledAt, &syncing, &st.BlockHeight,
		&st.Peers, &st.VotingPower, &st.GovPending, &serviceActive,
		&st.UpgradeName, &st.UpgradeHeight, &st.Error); err != nil {
		return nil
	}
	st.Syncing = syncing != 0
	st.ServiceActive = serviceActive != 0
	return &st
}
