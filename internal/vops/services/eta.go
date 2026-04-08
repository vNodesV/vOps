package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ETAResult holds the sync progress estimation for a catching-up service.
type ETAResult struct {
	ServiceID    int64   `json:"service_id"`
	CatchingUp   bool    `json:"catching_up"`
	LocalHeight  int64   `json:"local_height"`
	ExtHeight    int64   `json:"ext_height"`
	BlocksBehind int64   `json:"blocks_behind"`
	AvgBlockSec  float64 `json:"avg_block_sec"`
	ETASeconds   int64   `json:"eta_seconds"`
	ETAHuman     string  `json:"eta_human"`
	PolledAt     string  `json:"polled_at"`
	Error        string  `json:"error,omitempty"`
}

// HandleETA computes the sync ETA for a node/validator/relayer service.
// GET /api/v1/services/{id}/eta
func (h *Handlers) HandleETA(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	var svcType, cfgRaw string
	err = h.db.QueryRow("SELECT service_type, config FROM services WHERE id=?", id).
		Scan(&svcType, &cfgRaw)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "service not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	var cfg map[string]any
	_ = json.Unmarshal([]byte(cfgRaw), &cfg)

	rpcURL, _ := cfg["rpc_url"].(string)
	refRPCURL, _ := cfg["ref_rpc_url"].(string)

	result := ETAResult{
		ServiceID: id,
		PolledAt:  time.Now().UTC().Format(time.RFC3339),
	}

	if rpcURL == "" {
		result.Error = "no rpc_url configured for this service"
		writeJSON(w, http.StatusOK, result)
		return
	}

	local, err := fetchCometStatus(r.Context(), rpcURL)
	if err != nil {
		result.Error = fmt.Sprintf("local RPC error: %v", err)
		writeJSON(w, http.StatusOK, result)
		return
	}

	result.LocalHeight = local.latestHeight
	result.CatchingUp = local.catchingUp

	if !local.catchingUp {
		result.ETAHuman = "synced"
		writeJSON(w, http.StatusOK, result)
		return
	}

	// Get ext_latest from reference RPC when available.
	extHeight := local.latestHeight
	if refRPCURL != "" {
		ref, err := fetchCometStatus(r.Context(), refRPCURL)
		if err == nil && ref.latestHeight > extHeight {
			extHeight = ref.latestHeight
		}
	}

	result.ExtHeight = extHeight
	result.BlocksBehind = extHeight - local.latestHeight
	if result.BlocksBehind < 0 {
		result.BlocksBehind = 0
	}

	avgSec := local.avgBlockSec
	if avgSec <= 0 {
		avgSec = 6.0 // reasonable default for Cosmos chains
	}
	result.AvgBlockSec = avgSec
	result.ETASeconds = int64(float64(result.BlocksBehind) * avgSec)
	result.ETAHuman = fmtDuration(result.ETASeconds)

	writeJSON(w, http.StatusOK, result)
}

// cometStatus holds the parsed fields from a CometBFT /status response.
type cometStatus struct {
	latestHeight int64
	latestTime   time.Time
	catchingUp   bool
	avgBlockSec  float64
}

// fetchCometStatus calls {rpcURL}/status and parses the CometBFT response.
// It also calls /blockchain to compute avg_block_sec from the last 20 blocks.
func fetchCometStatus(ctx context.Context, rpcURL string) (*cometStatus, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	base := strings.TrimRight(rpcURL, "/")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/status", nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var body struct {
		Result struct {
			SyncInfo struct {
				LatestBlockHeight string `json:"latest_block_height"`
				LatestBlockTime   string `json:"latest_block_time"`
				CatchingUp        bool   `json:"catching_up"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decode /status: %w", err)
	}

	h, _ := strconv.ParseInt(body.Result.SyncInfo.LatestBlockHeight, 10, 64)
	t, _ := time.Parse(time.RFC3339Nano, body.Result.SyncInfo.LatestBlockTime)

	cs := &cometStatus{
		latestHeight: h,
		latestTime:   t,
		catchingUp:   body.Result.SyncInfo.CatchingUp,
	}

	// Best-effort: compute avg_block_sec from last N blocks.
	if avg, err := fetchAvgBlockSec(ctx, base, h); err == nil {
		cs.avgBlockSec = avg
	}

	return cs, nil
}

// fetchAvgBlockSec queries /blockchain?minHeight=X&maxHeight=Y and derives
// average seconds per block from the header timestamps.
func fetchAvgBlockSec(ctx context.Context, base string, latestHeight int64) (float64, error) {
	const n = 20
	minH := latestHeight - n + 1
	if minH < 1 {
		minH = 1
	}
	url := fmt.Sprintf("%s/blockchain?minHeight=%d&maxHeight=%d", base, minH, latestHeight)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	var body struct {
		Result struct {
			BlockMetas []struct {
				Header struct {
					Time string `json:"time"`
				} `json:"header"`
			} `json:"block_metas"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, err
	}

	metas := body.Result.BlockMetas
	if len(metas) < 2 {
		return 0, fmt.Errorf("too few blocks")
	}

	// block_metas are ordered newest → oldest
	tOldest, err1 := time.Parse(time.RFC3339Nano, metas[len(metas)-1].Header.Time)
	tNewest, err2 := time.Parse(time.RFC3339Nano, metas[0].Header.Time)
	if err1 != nil || err2 != nil {
		return 0, fmt.Errorf("time parse failed")
	}

	delta := tNewest.Sub(tOldest).Seconds()
	count := float64(len(metas) - 1)
	if count <= 0 || delta <= 0 {
		return 0, fmt.Errorf("invalid delta")
	}
	return delta / count, nil
}

// fmtDuration formats a duration in seconds as human-readable text.
func fmtDuration(secs int64) string {
	if secs <= 0 {
		return "synced"
	}
	d := time.Duration(secs) * time.Second
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	s := secs % 60
	switch {
	case h > 0:
		return fmt.Sprintf("%dh %dm", h, m)
	case m > 0:
		return fmt.Sprintf("%dm %ds", m, s)
	default:
		return fmt.Sprintf("%ds", secs)
	}
}
