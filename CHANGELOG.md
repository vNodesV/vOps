# Changelog

All notable changes to vProx are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [v1.5.2] — 2026-06-01 (branch: `vOps_v1.5.5`)

### Added
- **Supply-chain integrity**: integrity manifests + CI verification workflow (`supply-chain-integrity.yml`) — `a5aef82`
- **vProx build target**: `make build-vprox` with VERSION + ldflags; vProx binary now embeds version/commit — `65bf7f1`
- **IP disconnect**: sever live connections via conntrack (`POST /api/v1/accounts/{ip}/sever`) — `9fc7514`

### Fixed
- **Settings API**: return full config snapshot instead of 501 Not Implemented — `ca304b2`
- **vProx log path**: display correct `main.log` path in UI; include `log_path` in API response — `81f5d55`
- **SSH key rename**: `id.push` → `vops_ssh_key` for fleet operations; deploy script moved to internal_memo — `3025d9f`
- **vProx home default**: `.vProx` → `.vOps`; consolidate deploy + sudoers in Makefile — `ecf2686`
- **Deploy scripts**: `install-*` (local) split from `deploy-*` (remote SSH); `install-fix-bins` uses `ln -sf` — `35f4b77`, `64cf0a3`
- **Deploy sudoers**: SSH `-tt` flag for interactive sudo password prompt — `7640ecd`

### Performance
- **vProx HTTP transport**: tune upstream connection reuse (keep-alive, idle conns, timeouts) — `5c3cd39`

---

## [v1.5.0] — 2026-05-13 (branch: `vOps_v1.5.0`)

### Added
- **Login page**: Matrix rain animation, vNodes[V] header, tagline, button color — `5deee74`, `caa39e3`
- **Auto-ban**: automatic IP ban after configurable rate-limit threshold — `caa39e3`
- **GR theme**: sitewide rebrand (footer/nav), online/offline Badge fixes — `7a33961`
- **ChainDetailDrawer + VMDetailDrawer**: T5+T6 — inline chain/VM detail drawers replace page navigation — `301d9b0`
- **vProx standalone build**: `make build-vprox` target — `65bf7f1`

### Fixed
- **Security**: SSRF guard (`isPrivateIP`) + safe config path (`safeConfigPath`) — `6588b7f`
- **Security**: All audit findings remediated — H-B, L-A, M-C, M-D, I-B, M-B, I-A, L-B, L-C, CSRF — `23cc5e6`
- **Dashboard**: validator bonded count uses `service_active` instead of `voting_power` — `f614dfc`
- **Fleet**: Topology blank canvas, VM duplicates (seen-dedup in MergeInfraConfig), isPrivateIP CIDR pre-compile — `0cc0176`
- **CSP**: `unsafe-inline` added to `style-src` for ReactFlow inline positioning — `902a21a`
- **Apache config**: resolve agentic-eval B-1/B-2/B-3 findings in `web2.conf` — `c542e68`
- **OpsCenter RBX**: `sameSubnet24` auto-infers ProxyJump when host has `vrack_ip` set — `f49347f`
- **IP Accounts**: DISMISS no-op, blank page at `accounts/<IP>`, sort loss on investigation complete — `dd7f62b`
- **Dashboard perf**: `MaxOpenConns(1)→10` + `MaxIdleConns(5)` — fixes 17s page-load burst — `119afdf`
- **Dashboard charts**: restore static ChartPanel ×2 (requests_over_time + ips_over_time) — `e5d37ba`
- **Makefile**: `build-vops` never touches config TOMLs — `410c202`

### Removed
- **Topology page**: ReactFlow/dagre dropped; bundle −212 KB — `c03abb0`

---

## [v1.4.5] — 2026-04-06 (branch: `vLog_v1.4.5`)

### Added — vOps v1.4.5

**IP Accounts UX**
- **Scan badge**: `IntelUpdatedAt` timestamp displayed as a green dot + formatted date in the Accounts table "Scanned" column; dash when never scanned
- **Investigate modal metadata**: Org, Requests, Rate Limits, and Threat Score now populate in the modal header under the IP address (populated from the `IPAccount` record, no extra fetch required)
- **UFW Sync modal**: clicking "Sync UFW" now opens a password-input popup for optional `sudo -S` piping; empty password falls back to NOPASSWD path (`sudo -n`)
- **No auto-sort after scan**: `invalidateQueries` called with `refetchType: 'none'` so table order is preserved until the next natural background poll

**Dashboard — Servers Panel**
- `ServersPanel` component added to the Dashboard page between the Chain Status and Ingest sections
- Each VM rendered as a metric card: Name, OS, datacenter, LAN IP, CPU/Memory/Disk progress bars, Load Average, pending `apt` updates count, Status badge, and per-VM **Upgrade** button
- Upgrade button opens `UpgradeModal` with streaming log output

**Fleet — Live Servers Section**
- `ServersLiveSection` component added to the top of the Fleet page (above registered chains)
- Same metric-card grid as the Dashboard Servers Panel; queries `GET /api/v1/fleet/vms/status`; auto-refreshes every 60 s
- `MiniBar` sub-component for inline CPU/Mem/Disk progress bars

**UpgradeModal component**
- New reusable component: three-phase state machine (`input` → `running` → `done/error`)
- Phase 1: optional sudo password input field (omit for NOPASSWD systems)
- Phase 2: SSE streaming log — color-coded step labels (`update:start`, `update:done`, `upgrade:start`, `upgrade:done`, `complete`); close button disabled during active upgrade
- Phase 3: success or error summary with Dismiss

**Backend — Fleet API**
- `POST /api/v1/fleet/vms/{name}/upgrade` — SSE endpoint; runs `apt update` then `apt upgrade -y` on the target VM over SSH; accepts `{"sudo_password":"..."}` in the request body; streams structured events with `X-Accel-Buffering: no` for Apache compatibility
- `RunInput(cmd, stdinData string)` method added to `internal/fleet/ssh` — pipes a string to the SSH session's stdin for non-interactive `sudo -S` without TTY
- `OS string` field added to `VMStatus` struct — collected via `lsb_release -ds` as the 6th value in the single SSH compound command round-trip

**Frontend API layer**
- `VMStatus` TypeScript interface added to `api/types.ts` (20 fields matching Go struct)
- `getVMStatus()` and `vmUpgradeURL(name)` helper functions added to `api/index.ts`
- `openSSEStream()` extended with an optional `body?: unknown` parameter — when provided, the request is sent as `POST` with `Content-Type: application/json` (required for the upgrade endpoint)

**SortableHeader**
- `align?: 'left' | 'center' | 'right'` prop added; Requests and Rate Limits columns now centered in the Accounts table

### Changed — vOps v1.4.5

- Accounts page: `investigateIP` state replaced by `investigateAcct: IPAccount | null` — full account object forwarded to `InvestigateModal` so metadata is available without an extra API call
- Accounts page: Requests and Rate Limits columns use `align="center"` via `SortableHeader`
- InvestigateModal: accepts `acct?: IPAccount` prop and renders Org/Requests/Rate Limits/Score in the modal header

### Skills

- `debian-linux-triage` skill installed (`.github/skills/debian-linux-triage/`) — Ubuntu fleet management patterns

---

## [v1.4.0] — 2026-03-18 (branch: `vLog_v1.4.0`)

This release ships **vOps v1.4.0** — a full ground-up rebuild of the vLog dashboard as a React/TypeScript SPA.

### Added — vOps v1.4.0

- **Binary rename**: `vlog` → `vops`; `vlog` alias symlink retained for backward compatibility
- **React 18 + Vite SPA** — replaces htmx/html-template UI; TypeScript, `@tanstack/react-query`, Vite; built with `make frontend` and embedded via `go:embed`
- **SPA routing under sub-path**: `BASE_URL = import.meta.env.BASE_URL` from Vite config; all `fetch()` and redirect calls prefixed — prevents blank-page under Apache `/vlog/` sub-path
- **Config Wizard** (`internal/configwizard/`) — 7-step web wizard for full vOps/vProx configuration: ports, settings, chains, vOps keys, fleet, infra, backup; launched via `vops config --web`; auto-opens browser; `enforceLocalhost` + CSRF + `slug` validation
- **Settings page** — inline per-section editor (replaces modal); covers chains, infra VMs, vOps/vProx keys, fleet SSH, ports, and backup
- **Auth system**: 32-byte hex session tokens, HMAC-SHA256, 24 h TTL; bcrypt Cost=12; `HttpOnly`/`SameSite=Strict` cookie; `requireSession` middleware; `[vops.auth]` section in `vops.toml`
- **IP Accounts / Threats page**: URL-driven sort, pagination, search; `InvestigateModal` with SSE two-phase investigation (TI 0–50 % + OSINT 50–100 %) and three animated progress bars
- **Fleet backend** (`internal/fleet/`): `VMStatus` struct (`CPUPct`, `MemPct`, `StoragePct`, `LoadAvg`, `AptCount`, `PolledAt`); SSH compound command polling; `HandleVMStatus` → `GET /api/v1/fleet/vms/status`
- **UFW sync**: `POST /api/v1/fleet/ufw/sync` — rebuilds UFW rules from blocked IPs in the database
- **Theme system** — three CSS themes (vnodes / dark-blue / light-blue) with per-theme logo, favicon, background, and OG image assets in `internal/vops/web/static/2026_logos/`
- **Dual-mode wizard** — `new` (fresh install) and `upgrade` / `migration` (import existing TOML) modes; VM deduplication on import; legacy `config/push/vms.toml` import support
- **Chain Settings**: proxy_vhost_prefix/suffix fields; syncs to legacy `config/chains/<chain>.toml`; chain/infra remove unregisters aliases from fleet state DB

### Changed — vOps v1.4.0

- Config section renamed from `[vlog]` to `[vops]`; Go struct fields: `VOpsSection` / `VOps`; service name: `vOps`
- Config file path: `config/vops/vops.toml` (was `config/vlog/vlog.toml`)
- Fleet poll pruning: `pollAll()` now prunes stale statuses not in current VM or registered-chain active set
- Settings snapshot/import APIs redact vOps/infra secrets; save preserves secrets from existing config or import source

### Fixed — vOps v1.4.0

- `GetIPAccount` returns `(nil, nil)` on no-rows; silently dropped all investigation results for first-time IPs — fixed: `if err != nil || acc == nil {`
- Chain dedup: `chainBaseSlug` + `FindVMForChain` resolve `"cheqd-testnet"` (SQLite) vs `"cheqd"` (VM) double-rendering
- Apache `DELETE` 405: fleet mutations use `POST` alias routes; JS client updated accordingly
- `openFleetDB()`: reads `cfg.VLog.Push.DBPath` with safe fallback (was hardcoded `data/push.db`)

---

## [v1.3.0] — 2026-03-10 (branch: `vLog_v1.3.x`)

### Added — vLog v1.3.0

- **Fleet module** (`internal/fleet/`) — renamed from `push`; centralized SSH control plane
  - SSH dispatcher (`internal/fleet/ssh/`) using `golang.org/x/crypto/ssh`
  - Remote bash runner (`internal/fleet/runner/`)
  - SQLite state store (`internal/fleet/state/`) — deployments + registered chains
  - Cosmos RPC poller (`internal/fleet/status/`) — block height, governance, upgrade plan, sync status
  - HTTP API (`internal/fleet/api/`) — VM status, chain registration, deploy, deployments list
  - `VMStatus` struct: `Online bool`, `CPUPct`, `MemPct`, `StoragePct`, `LoadAvg`, `AptCount`, `PolledAt`
- **Config restructure**: `config/fleet/settings.toml` replaces deprecated `config/push/vms.toml`; all `*.toml` files under `config/infra/` scanned for VM inventory; `[vm.ping]` subtable for per-VM probe country/provider
- **`RemoveRegisteredChain`**: checks `RowsAffected()`, returns `state.ErrNotFound` when 0
- **vLog dashboard**: Deploy Wizard panel + Chain Status Table panel; chain-delete moved to `vprox fleet unregister` CLI only
- **vLog dashboard v2 auth**: bcrypt Cost=12 + HMAC-SHA256 session tokens (24 h TTL); `HttpOnly`/`SameSite=Strict` cookie
- **Settings page** (inline editor): chain/service tree controls, legacy TOML import, `features.mask_rpc` rewrite parity

### Changed — vLog v1.3.0

- `FleetConfig` / `FleetDefaults` renamed from `PushConfig` / `PushDefaults` in config structs
- `pollAll()` uses `FindVMForChain` with slug-dedup instead of `FindVM`
- `wired ChainStatus.PingCountry` / `.PingProvider` from `[vm.ping]` subtable

---

## [v1.2.0] — 2026-03-03

This release ships **vProx v1.2.0** and **vLog v1.0.0** together as **vProxVL v1.2.0**.

### Added — vLog v1.0.0

- **vLog module**: standalone log archive analyzer binary (`vlog`)
  - SQLite database (`$VPROX_HOME/data/vlog.db`) for IP accounts, request events, and rate-limit events
  - Ingests vProx log archives (`*.tar.gz`) from `$VPROX_HOME/data/logs/archives` — oldest-first, with deduplication via `ingested_archives` table
  - Background FS watcher for automatic ingestion of new archives
  - **IP Security Assessment**: AbuseIPDB v2 + VirusTotal v3 + Shodan — composite threat score (0–100); parallelized (3 concurrent goroutines); ~10s vs former ~30s
  - **OSINT engine**: 5 concurrent ops (DNS, port scan, ip-api.com, protocol probe, Cosmos RPC) via `sync.WaitGroup`; ~5s vs former ~23s
  - CRM-like IP account profiles with threat flags, notes, enrichment history, block/unblock status
  - **Accounts page**: server-side search (IP/country/row ID), per-page selector (25/50/100/200/All), sortable columns with URL-based sort persistence (back-nav safe), Status column (ALLOWED/BLOCKED), Org lookup via ip-api.com
  - **Dashboard**: dual-line Chart.js request charts; standalone endpoint status panel with 3 probe columns (Local | 🇨🇦 | 🌍), CSS spinner, node hover tooltips
  - **Multi-location endpoint probe** (`GET /api/v1/probe`): local SSRF-guarded probe discovers reachable URL; concurrent CA (Vancouver) + worldwide probes via check-host.net HTTP-check API (submit + poll); response: `{host, url, local, ca, ww}` per-location result with `{ok, code, latency_ms, error, node}`
  - REST API: `/api/v1/ingest`, `/api/v1/accounts`, `/api/v1/probe`, `/api/v1/enrich/:ip`, `/api/v1/osint/:ip`, `/api/v1/investigate/:ip`, `/api/v1/stats`, `/api/v1/block/:ip`, `/api/v1/unblock/:ip`, `/api/v1/chart`
  - CLI: `vlog start [-d]`, `vlog stop`, `vlog restart`, `vlog ingest`, `vlog status`
  - vProx integration: optional POST to vLog after `--new-backup` via `vlog_url` in `config/ports.toml`
  - Config: `$VPROX_HOME/config/vlog.toml` (sample: `config/vlog/vlog.sample.toml`)
- **`modernc.org/sqlite v1.46.1`** — pure-Go SQLite driver (no CGO required)

### Added — vProx v1.2.0

- **vLog dashboard authentication** — bcrypt (Cost=12) + session tokens; configurable via `[vlog.auth]` in `vlog.toml`; optional (backward compatible)
- **Prometheus metrics** — `/metrics` endpoint with 8 metrics: request counters, active connections, duration histogram, proxy errors, rate-limit hits, geo cache hit/miss, backup events
- **Health endpoint** — `/healthz` returns JSON status + uptime; 503 on subsystem failure
- **pprof debug server** — separate port, `VPROX_DEBUG=1` only
- **GeoIP MMDB bundled** — `assets/geo/ip2location.mmdb.gz` ships with repo; `make geo` installs to `~/.vProx/data/geolocation/`
- **golangci-lint CI** — 14 linters enforced on every PR
- **Coverage gate** — CI fails if test coverage drops below 60%
- **Release workflow** — automated cross-compilation for linux/darwin × amd64/arm64
- Chain log auto-discovery: `--new-backup` auto-includes all `*.log` files from `data/logs/` (except `main.log`); per-chain logs included without manual declaration
- vLog push hook: vProx POSTs to `vlog_url` after `--new-backup` (non-fatal if vLog unreachable)
- Typed request IDs: `RPC{24HEX}`, `API{24HEX}`, `REQ{24HEX}` stamped on every proxied request (vhost + alias routes included)

### Changed — vProx v1.2.0

- `internal/` packages extracted from `cmd/vprox/main.go`: `config`, `counter`, `logging`, `metrics`
- `ip2l/` folder renamed to `assets/geo/` (conventional asset directory)
- vLog block/unblock no longer requires API key from browser UI (session auth sufficient)
- **Chain config format refactored** (`config/chains/*.toml`):
  - `msg = bool` split into `msg_rpc = bool` and `msg_api = bool` (independent per-service banner control)
  - `[aliases]` sub-table removed; replaced by flat top-level `rpc_aliases`, `rest_aliases`, `api_aliases` string arrays
  - `features.inject_rpc_index` renamed to `features.rpc_address_masking`
  - `features.inject_rest_swagger` removed
  - `features.mask_rpc string` added (replacement label for masked local-IP links; empty = remove)
  - `features.swagger_masking bool` added (reserved; not yet implemented)
  - `[ports]` section now explicitly noted as optional when `default_ports = true`
  - `config/backup.sample.toml` default changed to `automation = false` (safe opt-in default)
- Banner injection bug fixed: `msg_rpc`/`msg_api` flags now correctly gate banner content; address masking (`rpc_address_masking`) operates independently of banner flags

### Fixed — vProx v1.2.0

- **SEC-H3**: XFF trust scoped to configured CIDR ranges; untrusted XFF headers ignored
- **SEC-M4**: WebSocket origin enforcement (same-origin by default; configurable)
- **SEC-M6**: Admin state sweep removed from auto-refresh path
- **SEC-L1**: SQL LIKE metacharacter escaping in vLog search
- **SEC-L4**: Security policy header removed from proxy responses
- **CR-2**: Backup nil pointer panic on missing file
- **CR-6**: Geo DB mutex-guarded nil assignment
- **CR-8**: `time.Tick` replaced with `time.NewTicker` (no goroutine leak)
- Request ID missing on vhost-mode and alias routes (api.*, grpc) — now always assigned before log
- REST probe path stripped `/api/` prefix incorrectly — now probes `/cosmos/base/tendermint/v1beta1/node_info` directly
- Banner (`rpc_msg`) injected even when `msg = false` — root cause: injection gated on `InjectRPCIndex` only, ignoring `Msg` flag; now fully decoupled

---

## [v1.0.2] — included in v1.2.0

### Added
- `internal/logging`: `NewTypedID(prefix)` — generates `{PREFIX}{24HEX_UPPER}` correlation IDs (API, RPC, WSS, BUP, etc.)
- `internal/logging`: `LineLifecycle()` / `PrintLifecycle()` — `NEW`/`UPD` structured lifecycle log format (no event token; fields-first)
- `internal/backup/config.go` — `BackupConfig` structs, `DefaultConfig()`, `LoadConfig()` for `backup.toml`
- `config/backup/backup.sample.toml` — annotated backup config; installed by `make config`
- CLI commands: `start`, `stop`, `restart` with `runServiceCommand()` → `sudo service vProx start|stop|restart`
- CLI flag: `-d` / `--daemon` — start as systemd service
- CLI flags: `--new-backup`, `--list-backup`, `--backup-status`
- Makefile `systemd:` target creates `/etc/sudoers.d/vprox` for passwordless service management
- Unified structured log format across all modules:
  - **API/RPC requests**: `NEW ID=API{hex} status=COMPLETED method=GET from=IP count=N to=HOST endpoint=/PATH latency=Xms userAgent=... country=XX module=vProx`
  - **WebSocket connect**: `NEW ID=WSS{hex} status=CONNECTED ... module=vProx` (emitted at handshake completion)
  - **WebSocket close**: `UPD ID=WSS{hex} status=CLOSED reason=IDLE duration=Xs upload=XMiB download=XMiB averageRate=XMiB/s module=ws`
  - **Backup start**: `NEW ID=BUP{hex} status=STARTED method=AUTO|MANUAL timestamp=... compression=TAR.GZ source=... list=loaded|default to=... size=... module=backup`
  - **Backup done**: `UPD ID=BUP{hex} status=COMPLETED location=... compressedSize=... module=backup`

### Changed
- `logRequestSummary`: migrated from `Line("INFO","access","request",...)` to `LineLifecycle("NEW","vProx",...)` with renamed fields (`from`, `count`, `to`, `endpoint`, `latency`, `userAgent`) and uppercase values; `pathPrefix()` helper derives ID prefix from URL path
- `ws.HandleWS`: WSS ID (`WSS{hex}`) generated at connection entry and set via `X-Request-ID` header; `LogRequestSummary` moved to post-handshake (emits CONNECTED); session-end `applog.Print` replaced by `PrintLifecycle("UPD",...)`
- `internal/backup/backup.go`: `newBupID()`, multi-file `writeTarGz`, rewritten `RunOnce`, extended `Options` (Method/ExtraFiles/ListSource), `StartAuto` sets `Method=AUTO`
- `cmd/vprox/main.go`: loads `backup.toml`, `resolveBackupExtraFiles` helper, wires config into both `RunOnce` and `StartAuto`; env vars still override TOML values
- Backup automation driven solely by `backup.toml` `automation` bool (removed `VPROX_BACKUP_ENABLED` env var)
- Chain sample moved from `chains/chain.sample.toml` → `config/chains/chain.sample.toml`
- Makefile `config` target installs chain and backup samples to `config/chains/` and `config/backup/`
- Makefile no longer creates legacy `$HOME/.vProx/chains/` directory (legacy dir still scanned if present)

### Removed
- `VPROX_BACKUP_ENABLED` env var — backup automation now controlled solely by `backup.toml`
- `internal/backup/cfg/config.json` and `config.toml` — dead legacy config files

### Fixed
- **P0** `gzipResponseWriter.WriteHeader()` committed response headers before `Content-Encoding: gzip` was set; status code is now buffered and forwarded after headers are finalized
- **P0** Per-request disk I/O: `saveAccessCountsLocked()` did JSON marshal + atomic write on every request while holding mutex. Moved to 1-second background ticker with dirty flag
- **P1** `intToBytes` produced empty output for negative integers (`for i > 0` loop); replaced with `strconv.Itoa`
- **P1** `Forwarded` header parser split on `;` before `,`; failed for multi-hop proxy chains. Now splits by comma (hops) first, then semicolon (params) per RFC 7239
- **P1** Rate limiter `sync.Map` entries (`pool`, `autoState`, `lastAllowLog`) never evicted; ~270 bytes/IP unbounded growth. Added 5-minute sweeper goroutine
- **P1** `io.ReadAll` on upstream HTML response with no size limit; OOM risk. Wrapped with `io.LimitReader(reader, 10<<20)`
- **P2** `rewriteLinks` compiled regexes per request on hot path; now cached per (IP, host) pair
- **P2** `geo.Close()` did not reset `sync.Once`; geo permanently disabled after close. Now resets init guard for hot-reload
- **P2** WebSocket `hardTimer` called `cConn.Close()`/`bConn.Close()` from timer goroutine while pump goroutines still running (gorilla/websocket not concurrent-safe). Replaced with done-channel coordination
- **P3** `clientIP()` returned raw header values without validation; log injection risk. Added `net.ParseIP` validation
- **P3** `ip2lPaths` evaluated `os.Getenv("HOME")` at package init; missed later `VPROX_HOME` override. Moved to `initDB()` resolution
- **P3** Geo cache entries only evicted on re-access; slow unbounded growth. Added periodic 5-minute sweep

### Planned (P4 — feature improvements)
- Move `access-counts.json` to `data/logs/` + include in backup tar.gz
- Webserver CLI subcommands: `vProx webserver new|list|validate|remove`
- Makefile: "Install vProx WebServer? {y/N}" prompt + `make install webserver`
- `.env` `[WebServer]` section with `AUTO_START` boolean
- Config architecture: `vprox.toml` (proxy), `webserver.toml` (webserver module), per-host `~/.vProx/vhosts/*.toml`
- Analyze separate systemd service for webserver module
- Explore web GUI for vProx/vProxWeb management

---

## [v1.0.1-beta] — 2026-02-22

### Added
- `approval-gate.yml` — unified PR approval workflow; `/approve` comment from `@vNodesV` triggers approval after all CI checks pass
- `INSTALLATION.md` — comprehensive install guide (build, configure, systemd, troubleshoot)
- `docs/UPGRADE.md` — upgrade guide for v0.x → v1.x migrations (replaces MIGRATION.md)
- `CHANGELOG.md` — this file

### Changed
- `ip2l/ip2location.mmdb` → `ip2l/ip2location.mmdb.gz` — MMDB compressed (17 MB → 6.8 MB; 60% clone size reduction)
- `Makefile` `geo` target — now decompresses `.gz` instead of copying uncompressed file
- `README.md` — rewritten as concise project overview (~50 lines); links to INSTALLATION.md and MODULES.md
- `MODULES.md` — expanded to full operations reference (490+ lines); integrates CLI flags quick reference; fixes `make GEO=true install` documentation error
- `.gitignore` — added `ip2l/ip2location.mmdb` rule; added `!docs/UPGRADE.md` exception

### Removed
- `required-reviewer.yml` — replaced by `approval-gate.yml`
- `jb-auto-approve.yml` — replaced by `approval-gate.yml`
- `FLAGS.md` — content integrated into `MODULES.md §9`
- `MIGRATION.md` — moved to `docs/UPGRADE.md`

### Security
- Approval workflow now requires all CI checks (build/test/lint, CodeQL, Dependency Review) to pass before any review can be submitted; unauthorized approval attempts are silently rejected

---

## [v1.0.0] — 2026-02-20

### Added
- Initial public release
- Per-chain TOML config (path and vhost routing modes)
- HTTP/WebSocket reverse proxy (`gorilla/websocket`)
- IP-based rate limiting with auto-quarantine (`golang.org/x/time/rate`)
- Geo enrichment via IP2Location / GeoLite2 MMDB (`oschwald/geoip2-golang`)
- Structured dual-sink logging (stdout + `main.log`)
- JSONL rate-limit audit log with backward-compatible field aliases
- Automated log backup with copy-truncate semantics
- Access counter persistence across restarts (`access-counts.json`)
- `make install` — full install: binary, directories, geo DB, .env, systemd unit
- `vprox.service.template` — systemd unit template
- `.env.example` — environment variable reference
- `chains/chain.sample.toml` — annotated chain configuration template
