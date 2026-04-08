package units

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	pollHTTPTimeout     = 8 * time.Second
	maxStatusHistoryAge = 7 * 24 * time.Hour
)

// Poller polls CometBFT RPC endpoints for all registered units on a fixed interval
// and stores results in the unit_status table.
type Poller struct {
	db        *sql.DB
	lanIPFunc func(vmName string) string // returns "" when VM is unknown
	interval  time.Duration
	done      chan struct{}
	client    *http.Client
}

// NewPoller constructs a Poller. lanIPFunc should return the LAN IP for the given
// VM name, or "" when the VM is not yet configured.
func NewPoller(db *sql.DB, lanIPFunc func(string) string, interval time.Duration) *Poller {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &Poller{
		db:        db,
		lanIPFunc: lanIPFunc,
		interval:  interval,
		done:      make(chan struct{}),
		client:    &http.Client{Timeout: pollHTTPTimeout},
	}
}

// Start begins the background poll loop in a goroutine.
func (p *Poller) Start() { go p.run() }

// Stop signals the poll loop to exit cleanly.
func (p *Poller) Stop() {
	select {
	case <-p.done:
	default:
		close(p.done)
	}
}

func (p *Poller) run() {
	p.poll() // immediate first poll
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			p.poll()
		case <-p.done:
			return
		}
	}
}

func (p *Poller) poll() {
	rows, err := p.db.Query(
		`SELECT name, vm_name, rpc_port, api_port, service_name FROM units`)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var name, vmName, serviceName string
		var rpcPort, apiPort int
		if scanErr := rows.Scan(&name, &vmName, &rpcPort, &apiPort, &serviceName); scanErr != nil {
			continue
		}
		st := p.pollUnit(name, vmName, rpcPort, apiPort)
		p.saveStatus(st)
	}

	// Prune history older than 7 days to keep the table lean.
	cutoff := time.Now().UTC().Add(-maxStatusHistoryAge).Format(time.RFC3339)
	p.db.Exec(`DELETE FROM unit_status WHERE polled_at < ?`, cutoff) //nolint:errcheck
}

// ── RPC response shapes ───────────────────────────────────────────────────────

type cometStatusResp struct {
	Result struct {
		SyncInfo struct {
			LatestBlockHeight string `json:"latest_block_height"`
			CatchingUp        bool   `json:"catching_up"`
		} `json:"sync_info"`
	} `json:"result"`
}

type cometNetInfoResp struct {
	Result struct {
		NPeers int `json:"n_peers"`
	} `json:"result"`
}

// cometUpgradePlan is the shape of Cosmos REST /cosmos/upgrade/v1beta1/current_plan.
type cometUpgradePlan struct {
	Plan *struct {
		Name   string `json:"name"`
		Height string `json:"height"`
	} `json:"plan"`
}

// ── poll one unit ─────────────────────────────────────────────────────────────

func (p *Poller) pollUnit(name, vmName string, rpcPort, apiPort int) UnitStatus {
	st := UnitStatus{
		UnitName: name,
		PolledAt: time.Now().UTC().Format(time.RFC3339),
	}

	lanIP := p.lanIPFunc(vmName)
	if lanIP == "" {
		st.Error = "VM not found in fleet config"
		return st
	}
	if rpcPort == 0 {
		st.Error = "rpc_port not configured"
		return st
	}

	baseURL := fmt.Sprintf("http://%s:%d", lanIP, rpcPort)

	// /status ─────────────────────────────────────────────────────────────
	ctx, cancel := context.WithTimeout(context.Background(), pollHTTPTimeout)
	defer cancel()

	rpcSt, err := p.fetchStatus(ctx, baseURL)
	if err != nil {
		st.Error = err.Error()
		return st
	}

	var h int64
	fmt.Sscanf(rpcSt.Result.SyncInfo.LatestBlockHeight, "%d", &h) //nolint:errcheck
	st.BlockHeight = h
	st.Syncing = rpcSt.Result.SyncInfo.CatchingUp
	st.ServiceActive = true

	// /net_info ───────────────────────────────────────────────────────────
	ctx2, cancel2 := context.WithTimeout(context.Background(), pollHTTPTimeout)
	defer cancel2()
	if ni, niErr := p.fetchNetInfo(ctx2, baseURL); niErr == nil {
		st.Peers = ni.Result.NPeers
	}

	// /cosmos/upgrade/v1beta1/current_plan (REST, best-effort) ────────────
	if apiPort > 0 {
		restBase := fmt.Sprintf("http://%s:%d", lanIP, apiPort)
		ctx3, cancel3 := context.WithTimeout(context.Background(), pollHTTPTimeout)
		defer cancel3()
		if up, upErr := p.fetchUpgradePlan(ctx3, restBase); upErr == nil && up.Plan != nil {
			st.UpgradeName = up.Plan.Name
			fmt.Sscanf(up.Plan.Height, "%d", &st.UpgradeHeight) //nolint:errcheck
		}
	}

	return st
}

func (p *Poller) fetchStatus(ctx context.Context, baseURL string) (*cometStatusResp, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/status", nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, err
	}
	var r cometStatusResp
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("parse /status: %w", err)
	}
	return &r, nil
}

func (p *Poller) fetchNetInfo(ctx context.Context, baseURL string) (*cometNetInfoResp, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/net_info", nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32*1024))
	if err != nil {
		return nil, err
	}
	var r cometNetInfoResp
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("parse /net_info: %w", err)
	}
	return &r, nil
}

func (p *Poller) fetchUpgradePlan(ctx context.Context, restBase string) (*cometUpgradePlan, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		restBase+"/cosmos/upgrade/v1beta1/current_plan", nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
	if err != nil {
		return nil, err
	}
	var r cometUpgradePlan
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("parse upgrade plan: %w", err)
	}
	return &r, nil
}

// ── persistence ───────────────────────────────────────────────────────────────

func (p *Poller) saveStatus(st UnitStatus) {
	syncing := 0
	if st.Syncing {
		syncing = 1
	}
	svcActive := 0
	if st.ServiceActive {
		svcActive = 1
	}
	p.db.Exec( //nolint:errcheck
		`INSERT INTO unit_status
			(unit_name, polled_at, syncing, block_height, peers, voting_power, gov_pending,
			 service_active, upgrade_name, upgrade_height, error)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		st.UnitName, st.PolledAt,
		syncing, st.BlockHeight, st.Peers,
		st.VotingPower, st.GovPending, svcActive,
		st.UpgradeName, st.UpgradeHeight, st.Error,
	)
}
