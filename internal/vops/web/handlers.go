package web

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/vNodesV/vOps/internal/logging"
	"github.com/vNodesV/vOps/internal/vops/conntrack"
	"github.com/vNodesV/vOps/internal/vops/ctxkeys"
	"github.com/vNodesV/vOps/internal/vops/db"
	"github.com/vNodesV/vOps/internal/vops/intel"
	"github.com/vNodesV/vOps/internal/vops/ufw"
)

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

func (s *Server) handleAPIIngest(w http.ResponseWriter, _ *http.Request) {
	processed, err := s.ingester.IngestAll()
	if err != nil {
		logging.Print("ERR", "web", "internal error", logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	sum, _ := s.db.ArchiveSummary()
	writeJSON(w, http.StatusOK, map[string]any{"processed": processed, "summary": sum})
}

// handleAPIArchiveStats returns aggregate archive ingestion stats.
func (s *Server) handleAPIArchiveStats(w http.ResponseWriter, _ *http.Request) {
	sum, err := s.db.ArchiveSummary()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, sum)
}

// handleAPIBackupAndIngest runs `vprox --new-backup` then ingests the result.
func (s *Server) handleAPIBackupAndIngest(w http.ResponseWriter, r *http.Request) {
	bin := s.cfg.VOps.VProxBin
	if bin == "" {
		var err error
		bin, err = exec.LookPath("vprox")
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "vprox binary not found in PATH; set vprox_bin in vops.toml",
			})
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	args := []string{"--new-backup"}
	if home := s.cfg.Vprox.ConfigPath; home != "" {
		args = append([]string{"--home", home}, args...)
	}
	out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput() //nolint:gosec
	if err != nil {
		logging.Print("ERR", "web", "backup failed", logging.F("err", err), logging.F("output", string(out)))
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error":  fmt.Sprintf("backup failed: %v", err),
			"output": string(out),
		})
		return
	}

	processed, err := s.ingester.IngestAll()
	if err != nil {
		logging.Print("ERR", "web", "ingest after backup failed", logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "ingest failed after backup"})
		return
	}

	sum, _ := s.db.ArchiveSummary()
	writeJSON(w, http.StatusOK, map[string]any{
		"processed": processed,
		"summary":   sum,
		"output":    string(out),
	})
}

// accountSortCols maps safe frontend column names to DB column names.
var accountSortCols = map[string]string{
	"IP":              "ip",
	"Country":         "country",
	"Org":             "org",
	"TotalRequests":   "total_requests",
	"RatelimitEvents": "ratelimit_events",
	"ThreatScore":     "threat_score",
	"Status":          "status",
	"LastSeen":        "last_seen",
}

func (s *Server) handleAPIAccountList(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)
	search := r.URL.Query().Get("search")

	sortCol := "last_seen"
	if col, ok := accountSortCols[r.URL.Query().Get("sort")]; ok {
		sortCol = col
	}
	sortDir := "DESC"
	if r.URL.Query().Get("dir") == "asc" {
		sortDir = "ASC"
	}

	var (
		accounts []*db.IPAccount
		err      error
	)
	if search != "" {
		accounts, err = s.db.SearchIPAccounts(search, sortCol, sortDir, limit, offset)
	} else {
		accounts, err = s.db.ListIPAccounts(sortCol, sortDir, limit, offset)
	}
	if err != nil {
		logging.Print("ERR", "web", "internal error", logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, accounts)
}

func (s *Server) handleAPIAccountDetail(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	if ip == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing ip"})
		return
	}

	account, err := s.db.GetIPAccount(ip)
	if err != nil {
		logging.Print("ERR", "web", "internal error", logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if account == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	activeConns, _ := conntrack.Count(ip)
	writeJSON(w, http.StatusOK, struct {
		*db.IPAccount
		ActiveConnections int `json:"ActiveConnections"`
	}{account, activeConns})
}

func (s *Server) handleAPIEnrich(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	if net.ParseIP(ip) == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}
	if isPrivateIP(ip) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}

	if s.enricher == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "enricher not configured"})
		return
	}

	// Stream progress via Server-Sent Events so the client can show real steps.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no") // tell nginx/apache not to buffer
	w.WriteHeader(http.StatusOK)

	// Remove write deadline — enrichment can take >30s at low rate-limit RPM.
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})

	flusher, canFlush := w.(http.Flusher)

	var wMu sync.Mutex
	flush := func() {
		if canFlush {
			flusher.Flush()
		}
	}

	// Keepalive: send an SSE comment every 15s so Apache's idle-connection
	// timer never fires during slow provider lookups.
	kaDone := make(chan struct{})
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-kaDone:
				return
			case <-t.C:
				wMu.Lock()
				fmt.Fprintf(w, ": ping\n\n")
				flush()
				wMu.Unlock()
			}
		}
	}()
	defer close(kaDone)

	emit := func(p intel.EnrichProgress) {
		data, _ := json.Marshal(p)
		wMu.Lock()
		fmt.Fprintf(w, "data: %s\n\n", data)
		flush()
		wMu.Unlock()
	}

	// Use context.Background() so provider saves complete even if the Apache
	// proxy closes the HTTP connection mid-stream.
	if _, err := s.enricher.EnrichStream(context.Background(), ip, true, emit); err != nil {
		logging.Print("ERR", "web", "enrich failed", logging.F("ip", ip), logging.F("err", err))
	}
}

func (s *Server) handleAPIosint(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	if net.ParseIP(ip) == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}
	if isPrivateIP(ip) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}

	if s.enricher == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "enricher not configured"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	// Remove write deadline — OSINT scan can take >30s (port probes, latency).
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})

	flusher, canFlush := w.(http.Flusher)

	var wMu sync.Mutex
	flush := func() {
		if canFlush {
			flusher.Flush()
		}
	}

	// Keepalive: send an SSE comment every 15s so Apache's idle-connection
	// timer never fires during the port-probe phase.
	kaDone := make(chan struct{})
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-kaDone:
				return
			case <-t.C:
				wMu.Lock()
				fmt.Fprintf(w, ": ping\n\n")
				flush()
				wMu.Unlock()
			}
		}
	}()
	defer close(kaDone)

	emit := func(p intel.EnrichProgress) {
		data, _ := json.Marshal(p)
		wMu.Lock()
		fmt.Fprintf(w, "data: %s\n\n", data)
		flush()
		wMu.Unlock()
	}

	// Use context.Background() so the OSINT scan completes and saves even if
	// Apache closes the proxy connection mid-stream.
	if _, err := s.enricher.OSINTStream(context.Background(), ip, emit); err != nil {
		logging.Print("ERR", "web", "osint failed", logging.F("ip", ip), logging.F("err", err))
	}
}

// handleAPIInvestigate runs a full investigation: TI enrichment then OSINT scan,
// streaming progress via SSE. Each event carries a "phase" prefix in Step so
// the client popup can track two distinct stages in one stream.
func (s *Server) handleAPIInvestigate(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	if net.ParseIP(ip) == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}
	if isPrivateIP(ip) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}

	if s.enricher == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "enricher not configured"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})

	flusher, canFlush := w.(http.Flusher)

	var wMu sync.Mutex
	flush := func() {
		if canFlush {
			flusher.Flush()
		}
	}

	// Keepalive: send an SSE comment every 15s so Apache's idle-connection
	// timer never fires during the silent gap between EnrichStream and
	// OSINTStream (or during slow port-probe phases). SSE comments are
	// ignored by browsers and the ReadableStream client.
	kaDone := make(chan struct{})
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-kaDone:
				return
			case <-t.C:
				wMu.Lock()
				fmt.Fprintf(w, ": ping\n\n")
				flush()
				wMu.Unlock()
			}
		}
	}()
	defer close(kaDone)

	emitPhase := func(phase string) func(intel.EnrichProgress) {
		return func(p intel.EnrichProgress) {
			p.Step = phase + ":" + p.Step
			p.Pct = p.Pct / 2 // scale each phase to 0-50 range
			if phase == "osint" {
				p.Pct += 50 // shift OSINT phase to 50-100
			}
			data, _ := json.Marshal(p)
			wMu.Lock()
			fmt.Fprintf(w, "data: %s\n\n", data)
			flush()
			wMu.Unlock()
		}
	}

	// Phase 1: TI enrichment (0-50%). Use context.Background() so saves complete
	// even if the Apache proxy times out and cancels the HTTP connection context.
	if _, err := s.enricher.EnrichStream(context.Background(), ip, true, emitPhase("ti")); err != nil {
		logging.Print("ERR", "web", "investigate enrich failed", logging.F("ip", ip), logging.F("err", err))
	}

	// Phase 2: OSINT scan (50-100%).
	if _, err := s.enricher.OSINTStream(context.Background(), ip, emitPhase("osint")); err != nil {
		logging.Print("ERR", "web", "investigate osint failed", logging.F("ip", ip), logging.F("err", err))
	}
}

func (s *Server) handleAPIStats(w http.ResponseWriter, _ *http.Request) {
	stats, err := s.db.Stats()
	if err != nil {
		logging.Print("ERR", "web", "internal error", logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleAPIChart(w http.ResponseWriter, r *http.Request) {
	chartType := r.URL.Query().Get("type")
	daysStr := r.URL.Query().Get("days")
	days := 30
	if d, err := strconv.Atoi(daysStr); err == nil && d > 0 && d <= 365 {
		days = d
	}

	// Multi-series types return ChartSeries instead of []ChartPoint.
	switch chartType {
	case "ips_over_time":
		series, err := s.db.IPsOverTimeMulti(days)
		if err != nil {
			logging.Print("ERR", "web", "internal error", logging.F("err", err))
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		writeJSON(w, http.StatusOK, series)
		return
	case "requests_over_time":
		series, err := s.db.RequestsOverTimeMulti(days)
		if err != nil {
			logging.Print("ERR", "web", "internal error", logging.F("err", err))
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		writeJSON(w, http.StatusOK, series)
		return
	case "endpoint_summary":
		stats, err := s.db.EndpointSummary(30)
		if err != nil {
			logging.Print("ERR", "web", "internal error", logging.F("err", err))
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		if stats == nil {
			stats = []db.EndpointStat{}
		}
		writeJSON(w, http.StatusOK, stats)
		return
	}

	var (
		points []db.ChartPoint
		err    error
	)
	switch chartType {
	case "ratelimits_over_time":
		points, err = s.db.RateLimitsOverTime(days)
	case "top_countries":
		points, err = s.db.TopCountries(10)
	case "status_breakdown":
		points, err = s.db.StatusBreakdown()
	case "threat_distribution":
		points, err = s.db.ThreatDistribution()
	case "top_ips_by_requests":
		points, err = s.db.TopIPsByRequests(10)
	case "requests_by_country":
		points, err = s.db.RequestsByCountry(10)
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown chart type"})
		return
	}
	if err != nil {
		logging.Print("ERR", "web", "internal error", logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if points == nil {
		points = []db.ChartPoint{}
	}
	writeJSON(w, http.StatusOK, points)
}

// ---------------------------------------------------------------------------
// Multi-location probe
// ---------------------------------------------------------------------------

// caProbeNodes and wwProbeNodes are check-host.net node IDs used for external
// probing. One is chosen at random each probe invocation.
// Node list sourced from https://check-host.net/nodes/hosts (verified live).
var caProbeNodes = []string{
	"ca1.node.check-host.net", // Vancouver, CA
}

var wwProbeNodes = []string{
	"fr2.node.check-host.net", // Paris, FR
	"de1.node.check-host.net", // Nuremberg, DE
	"de4.node.check-host.net", // Frankfurt, DE
	"nl1.node.check-host.net", // Amsterdam, NL
	"uk1.node.check-host.net", // Coventry, GB
	"fi1.node.check-host.net", // Helsinki, FI
	"jp1.node.check-host.net", // Tokyo, JP
	"sg1.node.check-host.net", // Singapore
	"us1.node.check-host.net", // Los Angeles, US
	"us2.node.check-host.net", // Dallas, US
	"br1.node.check-host.net", // Sao Paulo, BR
	"in1.node.check-host.net", // Mumbai, IN
}

// countryNodes maps ISO 3166-1 alpha-2 country codes to available check-host.net nodes.
// Used by handleAPIProbe when ?country= is provided to select a datacenter-local probe node.
var countryNodes = map[string][]string{
	"CA": {"ca1.node.check-host.net"},
	"US": {"us1.node.check-host.net", "us2.node.check-host.net"},
	"FR": {"fr2.node.check-host.net"},
	"DE": {"de1.node.check-host.net", "de4.node.check-host.net"},
	"NL": {"nl1.node.check-host.net"},
	"GB": {"uk1.node.check-host.net"},
	"UK": {"uk1.node.check-host.net"}, // common alias for GB
	"FI": {"fi1.node.check-host.net"},
	"JP": {"jp1.node.check-host.net"},
	"SG": {"sg1.node.check-host.net"},
	"BR": {"br1.node.check-host.net"},
	"IN": {"in1.node.check-host.net"},
}

// sanitizeProbeNode validates that the given short node id (e.g. "ca1") or
// full hostname maps to a known check-host.net node, returning the full hostname.
// Returns "" if the node is not in the whitelist (SSRF guard).
func sanitizeProbeNode(node string) string {
	if !strings.HasSuffix(node, ".node.check-host.net") {
		node = node + ".node.check-host.net"
	}
	for _, nodes := range countryNodes {
		for _, n := range nodes {
			if n == node {
				return node
			}
		}
	}
	return ""
}

type locResult struct {
	Code      int    `json:"code,omitempty"`
	LatencyMs int64  `json:"latency_ms,omitempty"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
	Node      string `json:"node,omitempty"`
}

type multiProbeResult struct {
	Host  string    `json:"host"`
	URL   string    `json:"url"`
	Local locResult `json:"local"`
	CA    locResult `json:"ca"`
	WW    locResult `json:"ww"`
}

// checkHostProbe submits an HTTP probe via check-host.net and polls for the
// result. Blocks for up to ~10 s. ctx cancellation is respected.
func checkHostProbe(ctx context.Context, targetURL, node string) locResult {
	shortNode := strings.TrimSuffix(node, ".node.check-host.net")
	client := &http.Client{Timeout: 5 * time.Second}

	// Submit.
	q := url.Values{"host": {targetURL}, "node": {node}}
	submitURL := "https://check-host.net/check-http?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, submitURL, nil)
	if err != nil {
		return locResult{Error: "bad req", Node: shortNode}
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return locResult{Error: "submit failed", Node: shortNode}
	}
	var submit struct {
		RequestID string `json:"request_id"`
	}
	json.NewDecoder(resp.Body).Decode(&submit) //nolint:errcheck
	resp.Body.Close()
	if submit.RequestID == "" {
		return locResult{Error: "no request id", Node: shortNode}
	}

	// Poll until result or deadline.
	pollURL := "https://check-host.net/check-result/" + submit.RequestID
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return locResult{Error: "canceled", Node: shortNode}
		case <-time.After(2 * time.Second):
		}
		req2, _ := http.NewRequestWithContext(ctx, http.MethodGet, pollURL, nil)
		req2.Header.Set("Accept", "application/json")
		resp2, err2 := client.Do(req2)
		if err2 != nil {
			continue
		}
		var result map[string]json.RawMessage
		decErr := json.NewDecoder(resp2.Body).Decode(&result)
		resp2.Body.Close()
		if decErr != nil {
			continue
		}
		raw, ok := result[node]
		if !ok || string(raw) == "null" {
			continue // not ready yet
		}
		// Actual shape: [[status_int, latency_secs, msg_str, code_str|null, ip_str|null]]
		// status==1 → success; status==0 → failure.
		var rows [][]json.RawMessage
		if err4 := json.Unmarshal(raw, &rows); err4 != nil || len(rows) == 0 || len(rows[0]) == 0 {
			return locResult{Error: "parse error", Node: shortNode}
		}
		row := rows[0]
		var status float64
		if json.Unmarshal(row[0], &status) != nil {
			return locResult{Error: "bad status", Node: shortNode}
		}
		// row[1] = latency (float seconds)
		var latMs int64
		if len(row) > 1 {
			var lat float64
			if json.Unmarshal(row[1], &lat) == nil && lat > 0 {
				latMs = int64(lat * 1000)
			}
		}
		if status == 1 {
			// row[3] = HTTP code as string (e.g. "200", "301")
			var code int
			if len(row) > 3 {
				var codeStr string
				if json.Unmarshal(row[3], &codeStr) == nil {
					fmt.Sscanf(codeStr, "%d", &code) //nolint:errcheck
				}
			}
			return locResult{OK: true, Code: code, LatencyMs: latMs, Node: shortNode}
		}
		// row[2] = error message string
		var errMsg string
		if len(row) > 2 {
			json.Unmarshal(row[2], &errMsg) //nolint:errcheck
		}
		if errMsg == "" {
			errMsg = "probe error"
		}
		return locResult{Error: errMsg, Node: shortNode}
	}
	return locResult{Error: "timeout", Node: shortNode}
}

func (s *Server) handleAPIProbe(w http.ResponseWriter, r *http.Request) {
	host := strings.TrimSpace(r.URL.Query().Get("host"))
	if host == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "host required"})
		return
	}
	if strings.ContainsAny(host, "/:?#@") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid host"})
		return
	}

	// Optional parameters.
	rpcURL := strings.TrimSpace(r.URL.Query().Get("rpc_url"))
	countryParam := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("country")))
	providerParam := strings.TrimSpace(r.URL.Query().Get("provider"))

	// SSRF guard — only hosts present in ingested data.
	// M-5: EndpointSummary is a full table scan; cache the result for 30 s.
	s.probeHostCacheMu.RLock()
	stats := s.probeHostCache
	cacheAge := time.Since(s.probeHostCacheAt)
	s.probeHostCacheMu.RUnlock()
	if stats == nil || cacheAge > 30*time.Second {
		var err error
		stats, err = s.db.EndpointSummary(500)
		if err != nil {
			logging.Print("ERR", "web", "internal error", logging.F("err", err))
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		s.probeHostCacheMu.Lock()
		s.probeHostCache = stats
		s.probeHostCacheAt = time.Now()
		s.probeHostCacheMu.Unlock()
	}
	hostKey := normalizeProbeHost(host)
	hostSet := make(map[string]struct{}, len(stats))
	for _, e := range stats {
		if h := normalizeProbeHost(e.Host); h != "" {
			hostSet[h] = struct{}{}
		}
	}
	fleetHosts := s.fleetHostSet()
	for h := range fleetHosts {
		hostSet[h] = struct{}{}
	}
	if hostKey == "" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "host not authorized"})
		return
	}
	if _, ok := hostSet[hostKey]; !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "host not authorized"})
		return
	}

	// Additional SSRF layer: reject literal private/loopback IPs that are not
	// part of the configured fleet hosts.
	if ip := net.ParseIP(host); ip != nil && isPrivateIP(host) {
		if _, ok := fleetHosts[hostKey]; !ok {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "private address not allowed"})
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 14*time.Second)
	defer cancel()

	// Step 1: local probe — either use provided rpc_url or discover one.
	var localR locResult
	var bestURL string
	if rpcURL != "" {
		// SSRF guard: validate rpc_url against the same allowlist used for host.
		parsed, parseErr := url.Parse(rpcURL)
		if parseErr != nil || parsed.Host == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid rpc_url"})
			return
		}
		urlHostname := parsed.Hostname()
		urlHostKey := normalizeProbeHost(urlHostname)
		if urlHostKey == "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "rpc_url host not authorized"})
			return
		}
		// Block private/loopback IPs unless they are an explicitly registered fleet host.
		if net.ParseIP(urlHostname) != nil && isPrivateIP(urlHostname) {
			if _, ok := fleetHosts[urlHostKey]; !ok {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "rpc_url host not authorized"})
				return
			}
		} else if _, ok := hostSet[urlHostKey]; !ok {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "rpc_url host not authorized"})
			return
		}
		localR, bestURL = probeURL(rpcURL)
	} else {
		// Otherwise, discover the best reachable URL.
		localR, bestURL = localProbe(host)
	}

	// Step 2: fire external probes concurrently using the discovered/provided URL.
	var caR, wwR locResult
	if bestURL == "" {
		caR = locResult{Error: "no reachable URL"}
		wwR = locResult{Error: "no reachable URL"}
	} else {
		caNode := caProbeNodes[rand.Intn(len(caProbeNodes))] //nolint:gosec // G404: probe node selection is not security-sensitive
		// Override CA node with datacenter-specific probe if requested.
		if providerParam != "" {
			if n := sanitizeProbeNode(providerParam); n != "" {
				caNode = n
			}
		} else if countryParam != "" {
			if nodes, ok := countryNodes[countryParam]; ok && len(nodes) > 0 {
				caNode = nodes[rand.Intn(len(nodes))] //nolint:gosec // G404: probe node selection is not security-sensitive
			}
		}
		wwNode := wwProbeNodes[rand.Intn(len(wwProbeNodes))] //nolint:gosec // G404: probe node selection is not security-sensitive
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); caR = checkHostProbe(ctx, bestURL, caNode) }()
		go func() { defer wg.Done(); wwR = checkHostProbe(ctx, bestURL, wwNode) }()
		wg.Wait()
	}

	writeJSON(w, http.StatusOK, multiProbeResult{
		Host:  host,
		URL:   bestURL,
		Local: localR,
		CA:    caR,
		WW:    wwR,
	})
}

// probeURL probes a single URL and returns the result and URL.
func probeURL(url string) (locResult, string) {
	client := &http.Client{Timeout: 5 * time.Second}
	start := time.Now()
	resp, err := client.Get(url) //nolint:noctx
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return locResult{Error: err.Error()}, ""
	}
	defer resp.Body.Close()
	code := resp.StatusCode
	if code < 400 {
		return locResult{OK: true, Code: code, LatencyMs: lat}, url
	}
	return locResult{Code: code, LatencyMs: lat}, url
}

// localProbe tries candidate URLs for host in order, returning the first 2xx
// result (or first reachable non-2xx as fallback) plus the URL that was used.
func localProbe(host string) (locResult, string) {
	client := &http.Client{Timeout: 5 * time.Second}
	var fallbackR *locResult
	var fallbackURL string
	for _, target := range []string{
		"https://" + host + "/rpc/status",
		"https://" + host + "/cosmos/base/tendermint/v1beta1/node_info",
		"https://" + host + "/rpc/health",
		"https://" + host + "/",
		"http://" + host + "/rpc/status",
		"http://" + host + "/cosmos/base/tendermint/v1beta1/node_info",
		"http://" + host + "/rpc/health",
		"http://" + host + "/",
	} {
		start := time.Now()
		resp, err := client.Get(target) //nolint:noctx
		lat := time.Since(start).Milliseconds()
		if err != nil {
			continue
		}
		code := resp.StatusCode
		resp.Body.Close()
		if code < 400 {
			return locResult{OK: true, Code: code, LatencyMs: lat}, target
		}
		if fallbackR == nil {
			r := locResult{Code: code, LatencyMs: lat}
			fallbackR = &r
			fallbackURL = target
		}
	}
	if fallbackR != nil {
		return *fallbackR, fallbackURL
	}
	return locResult{Error: "unreachable"}, ""
}

func (s *Server) handleAPIBlock(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	if net.ParseIP(ip) == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}

	// Parse optional reason from query param
	reason := r.URL.Query().Get("reason")
	if reason == "" {
		reason = "manual block"
	}

	if err := s.db.BlockIP(ip, reason); err != nil {
		logging.Print("ERR", "web", "internal error", logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	ufwOK := true
	if err := ufw.Block(ip, ""); err != nil {
		logging.Print("ERR", "web", "ufw block failed", logging.F("ip", ip), logging.F("err", err))
		ufwOK = false
	}

	resp := map[string]any{
		"ip":      ip,
		"blocked": true,
		"ufw":     ufwOK,
		"reason":  reason,
	}

	// ?sever=true also severs all existing connections via conntrack.
	if r.URL.Query().Get("sever") == "true" {
		severed, err := conntrack.Sever(ip)
		if err != nil {
			logging.Print("WRN", "web", "conntrack sever failed", logging.F("ip", ip), logging.F("err", err))
		}
		resp["severed"] = severed
		resp["conntrack"] = err == nil
		logging.Print("INF", "web", "connections severed", logging.F("ip", ip), logging.F("count", severed))
	}

	writeJSON(w, http.StatusOK, resp)

	actor, _ := r.Context().Value(ctxkeys.Actor).(string)
	params, _ := json.Marshal(map[string]string{"reason": reason})
	_ = db.InsertAuditLog(s.db.DB, db.AuditEntry{
		Actor:      actor,
		Action:     "ip.block",
		TargetType: "ip",
		TargetName: ip,
		Params:     string(params),
		Result:     "ok",
	})
}

func (s *Server) handleAPIUnblock(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	if net.ParseIP(ip) == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}

	if err := s.db.UnblockIP(ip); err != nil {
		logging.Print("ERR", "web", "internal error", logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	ufwOK := true
	if err := ufw.Unblock(ip, ""); err != nil {
		logging.Print("ERR", "web", "ufw unblock failed", logging.F("ip", ip), logging.F("err", err))
		ufwOK = false
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ip":      ip,
		"blocked": false,
		"ufw":     ufwOK,
	})

	actor, _ := r.Context().Value(ctxkeys.Actor).(string)
	_ = db.InsertAuditLog(s.db.DB, db.AuditEntry{
		Actor:      actor,
		Action:     "ip.unblock",
		TargetType: "ip",
		TargetName: ip,
		Result:     "ok",
	})
}

// handleAPISever severs all active kernel connections from the given IP by
// deleting their conntrack entries, causing the kernel to send TCP RSTs.
// POST /api/v1/sever/{ip}
func (s *Server) handleAPISever(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	if net.ParseIP(ip) == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid IP"})
		return
	}

	severed, err := conntrack.Sever(ip)
	if err != nil {
		logging.Print("ERR", "web", "conntrack sever failed", logging.F("ip", ip), logging.F("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "sever failed: " + err.Error()})
		return
	}

	logging.Print("INF", "web", "connections severed", logging.F("ip", ip), logging.F("count", severed))
	writeJSON(w, http.StatusOK, map[string]any{
		"ip":        ip,
		"severed":   severed,
		"conntrack": conntrack.IsAvailable(),
	})

	actor, _ := r.Context().Value(ctxkeys.Actor).(string)
	params, _ := json.Marshal(map[string]int{"severed": severed})
	_ = db.InsertAuditLog(s.db.DB, db.AuditEntry{
		Actor:      actor,
		Action:     "ip.sever",
		TargetType: "ip",
		TargetName: ip,
		Params:     string(params),
		Result:     "ok",
	})
}
// into the blocked_ips table. Already-blocked IPs are skipped (idempotent).
// POST /api/v1/ufw/sync
// Accepts optional JSON body: {"sudo_password": "..."} for servers without NOPASSWD.
func (s *Server) handleAPIUFWSync(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SudoPassword string `json:"sudo_password"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body)

	ips, err := ufw.ListBlocked(body.SudoPassword)
	if err != nil {
		logging.Print("ERR", "web", "ufw sync failed", logging.F("err", err))
		// Provide actionable guidance when sudo permission is missing.
		note := err.Error()
		if strings.Contains(note, "password") || strings.Contains(note, "askpass") {
			note = "sudo permission denied — add to /etc/sudoers:\n" +
				"  Cmnd_Alias VLOG_UFW = /usr/sbin/ufw deny from *, " +
				"/usr/sbin/ufw delete deny from *, /usr/sbin/ufw status numbered\n" +
				"  www-data ALL=(ALL) NOPASSWD: VLOG_UFW"
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": note})
		return
	}
	if ips == nil {
		writeJSON(w, http.StatusOK, map[string]any{"imported": 0, "note": "ufw not available"})
		return
	}

	var imported int
	for _, ip := range ips {
		already, err := s.db.IsBlocked(ip)
		if err != nil || already {
			continue
		}
		if err := s.db.BlockIP(ip, "ufw sync"); err != nil {
			logging.Print("ERR", "web", "ufw sync block failed", logging.F("ip", ip), logging.F("err", err))
		} else {
			imported++
		}
	}
	logging.Print("INF", "web", "ufw sync imported", logging.F("imported", imported), logging.F("total", len(ips)))
	writeJSON(w, http.StatusOK, map[string]any{
		"total":    len(ips),
		"imported": imported,
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		logging.Print("ERR", "web", "json encode failed", logging.F("err", err))
	}
}

// isPrivateIP reports whether the given IP string is a loopback, link-local,
// or private RFC1918/RFC4193 address. Used to prevent SSRF attacks.
// The CIDR list is parsed once at package init to avoid per-call allocations.
var privateNets []*net.IPNet

func init() {
	for _, cidr := range []string{
		"127.0.0.0/8",    // loopback
		"::1/128",        // IPv6 loopback
		"10.0.0.0/8",     // RFC1918
		"172.16.0.0/12",  // RFC1918
		"192.168.0.0/16", // RFC1918
		"169.254.0.0/16", // link-local
		"fe80::/10",      // IPv6 link-local
		"fc00::/7",       // IPv6 unique local (RFC4193)
		"100.64.0.0/10",  // shared address space (RFC6598)
	} {
		_, network, err := net.ParseCIDR(cidr)
		if err == nil {
			privateNets = append(privateNets, network)
		}
	}
}

func isPrivateIP(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	for _, network := range privateNets {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func normalizeProbeHost(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(raw); err == nil {
		raw = host
	}
	raw = strings.Trim(raw, "[]")
	return strings.ToLower(raw)
}

func (s *Server) fleetHostSet() map[string]struct{} {
	if s.fleet == nil {
		return nil
	}
	return s.fleet.ProbeHostMap()
}

func queryInt(r *http.Request, key string, fallback int) int {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return fallback
	}
	return n
}

// ---------------------------------------------------------------------------
// Auth handlers
// ---------------------------------------------------------------------------

// handleLoginSubmit processes login form submission.
func (s *Server) handleLoginSubmit(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	// Extract real client IP.
	// Only trust X-Real-IP when the TCP connection is from a trusted proxy on
	// localhost; otherwise an unauthenticated caller can forge the header to
	// bypass brute-force lockout.
	rawAddr := r.RemoteAddr
	tcpIP := rawAddr
	if i := strings.LastIndex(rawAddr, ":"); i >= 0 {
		tcpIP = rawAddr[:i]
	}
	clientIP := tcpIP
	if tcpIP == "127.0.0.1" || tcpIP == "::1" {
		if xrip := strings.TrimSpace(r.Header.Get("X-Real-IP")); xrip != "" {
			clientIP = xrip
		} else if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// Take the leftmost address only — the one the first-hop proxy recorded.
			// Subsequent hops are client-controlled and must not be trusted.
			if first, _, found := strings.Cut(xff, ","); found {
				clientIP = strings.TrimSpace(first)
			} else {
				clientIP = strings.TrimSpace(xff)
			}
		}
	}

	// Enforce brute-force lockout before checking credentials.
	if locked, retryAfter := s.checkLoginLock(clientIP); locked {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
		http.Error(w, "too many failed login attempts", http.StatusTooManyRequests)
		return
	}

	username := r.FormValue("username")
	password := r.FormValue("password")

	if !s.checkCredentials(username, password) {
		s.recordLoginFailure(clientIP)
		_ = db.InsertAuditLog(s.db.DB, db.AuditEntry{
			Actor:      "unauthenticated",
			Action:     "auth.login.fail",
			TargetType: "session",
			TargetName: clientIP,
			Params:     `{}`,
			Result:     "fail",
		})
		http.Redirect(w, r, s.cfg.VOps.BasePath+"/login?error=invalid", http.StatusFound)
		return
	}

	s.clearLoginAttempts(clientIP)
	token, err := s.newSession(username)
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	csrfTok, err := newCSRFToken()
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	_ = db.InsertAuditLog(s.db.DB, db.AuditEntry{
		Actor:      username,
		Action:     "auth.login.ok",
		TargetType: "session",
		TargetName: clientIP,
		Params:     `{}`,
		Result:     "ok",
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "vops_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   86400, // 24h
	})
	setCSRFCookie(w, csrfTok)
	http.Redirect(w, r, s.cfg.VOps.BasePath+"/", http.StatusFound)
}

// handleLogout invalidates the session and redirects to login.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("vops_session"); err == nil {
		s.deleteSession(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "vops_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
	clearCSRFCookie(w)
	http.Redirect(w, r, s.cfg.VOps.BasePath+"/login", http.StatusFound)
}
