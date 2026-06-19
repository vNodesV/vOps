# vProx Installation Guide

This guide covers building, installing, and configuring vProx from source on a Linux host.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Install](#quick-install)
- [Build from Source](#build-from-source)
- [Full Install with make](#full-install-with-make)
- [Runtime Directory Layout](#runtime-directory-layout)
- [Configuration](#configuration)
  - [Environment Variables (.env)](#environment-variables-env)
  - [Default Ports (ports.toml)](#default-ports-portstoml)
  - [Per-Chain Config](#per-chain-config)
- [Geo Database](#geo-database)
- [Systemd Service](#systemd-service)
- [Running vProx](#running-vprox)
- [Observability](#observability)
- [Upgrading](#upgrading)
- [Installing vOps](#installing-vops)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Go | 1.25+ | See `go.mod` for exact version |
| git | Any | Clone the repo |
| make | GNU make | Build automation |
| gzip / gunzip | Standard | MMDB decompression (part of coreutils) |
| Linux | systemd host | For service installation |
| macOS | Any | Dev/build only; systemd not applicable |
| Node.js + npm | 18+ | **Frontend development only** — not required for standard install; the pre-built vOps UI is embedded in the repo |

Install Go: <https://go.dev/doc/install>

Verify:

```bash
go version   # go version go1.25.x linux/amd64
make --version
```

> **Node.js note**: The vOps web UI is a React/TypeScript SPA built with Vite. The compiled output (`internal/vops/web/dist/`) is committed to the repository so a standard `make install` requires **no Node.js**. Node.js is only needed if you modify the frontend source under `internal/vops/web/frontend/src/`. Install via [nvm](https://github.com/nvm-sh/nvm) or `brew install node` on macOS.

---

## Quick Install

```bash
git clone https://github.com/vNodesV/vOps.git
cd vOps
make install
```

`make install` does everything for a fresh box: validates Go, creates runtime directories, decompresses the geo database, sets up the default `.env`, writes sample configs, builds **both** `vOps` and `vProx`, and installs them to `$GOPATH/bin/`. It then prompts (y/n) once for copying both binaries to `/usr/local/bin/` and once per binary for installing the systemd unit.

---

## Build from Source

To build a binary only (no install, no service/sudo side effects):

```bash
make build-vops    # → .build/vOps
make build-vprox   # → .build/vProx
```

Or with raw Go tooling (keeps build artifacts outside the repo root):

```bash
go build -o .build/vProx ./cmd/vprox
```

To build and run directly without installing:

```bash
go run ./cmd/vprox
```

---

## Full Install with make

```bash
make install
```

This runs the following steps in order (all internal — not separately callable as their own `make` targets):

1. **validate-go** — Confirms `GOROOT` and `GOPATH` are set and prints the Go version.
2. **reset-stale-services** — Stops/disables/removes any leftover `vProx`/`vLog`/lowercase `vops` service units from an older layout.
3. **sudoers** — Writes `/etc/sudoers.d/$USER` with passwordless `systemctl`/`ufw`/`conntrack`/`apt` rules (needed later for `make upgrade` to stop/start services without a password prompt).
4. **dirs** — Creates the runtime directory tree under `$HOME/.vOps/` (idempotent).
5. **geo** — Decompresses `assets/geo/ip2location.mmdb.gz` → `$HOME/.vOps/data/geolocation/ip2location.mmdb` (skipped if already present).
6. **env / config / config-vops / config-vprox / samples** — Writes `.env` and sample/default TOML config files, but only if they don't already exist — `make install` never overwrites live config.
7. **system-user-vops** — Idempotently ensures a dedicated `vops` nologin system account exists (only used if you explicitly set `VOPS_USER=vops`; otherwise the service runs as your own user).
8. **build-vops / build-vprox** — Compiles both binaries to `.build/`.
9. **install binaries** — Copies both binaries into `$GOPATH/bin/`, then prompts (y/n) to also copy them to `/usr/local/bin/`.
10. **systemd** — Renders `vOps.service` and `vProx.service` from their templates, then prompts (y/n) for each to install it to `/etc/systemd/system/` and enable it.

Other targets:

```bash
make build-vops    # Compile vOps only → .build/vOps (no service restart, no sudo)
make build-vprox   # Compile vProx only → .build/vProx (no service restart, no sudo)
make upgrade       # Rebuild + redeploy BOTH binaries: stop services → copy → restart
make clean         # Remove .build/ directory
```

`build-vops`/`build-vprox` are pure compile steps — they never touch a running service or call `sudo`. After either one, deploy manually:

```bash
sudo systemctl stop vOps  && cp .build/vOps  $(go env GOPATH)/bin/vOps  && sudo systemctl start vOps
sudo systemctl stop vProx && cp .build/vProx $(go env GOPATH)/bin/vProx && sudo systemctl start vProx
```

Or skip the manual dance and run `make upgrade`, which does exactly that for both binaries (and re-syncs the systemd unit files if the templates changed). `make upgrade` requires the sudoers rule from `make install` to already be in place.

---

## Runtime Directory Layout

After `make install`, vProx uses the following layout under `$HOME/.vOps/`:

```
$HOME/.vOps/
├── .env                         # Environment variables (rate limits, geo paths)
├── config/
│   ├── ports.toml               # Default service ports for all chains
│   ├── chains/
│   │   ├── chain.sample.toml    # Sample chain configuration (reference only)
│   │   └── *.toml               # Your chain configs (create one per chain)
│   └── backup/
│       └── backup.toml          # Backup automation config
├── data/
│   ├── geolocation/
│   │   └── ip2location.mmdb     # IP geo database (decompressed by make install)
│   ├── access-counts.json       # Persisted source access counters
│   └── logs/
│       ├── main.log             # Structured proxy log
│       ├── rate-limit.jsonl     # JSONL rate limit events
│       └── archives/            # Compressed log backups (*.tar.gz)
├── internal/                    # Reserved for internal runtime state
└── service/
    └── vProx.service            # Rendered systemd unit file
```

Override the base path:

```bash
# Environment variable:
export VPROX_HOME=/opt/vprox

# CLI flag (overrides env var):
vops vprox --home /opt/vprox
```

---

## Configuration

### Environment Variables (.env)

The `.env` file lives at `$VPROX_HOME/.env`. `make install` creates a default one if absent. A reference with all available variables is at [`.env.example`](./.env.example).

Key variables:

```ini
# Geo database paths (auto-set by make install)
IP2LOCATION_MMDB=$HOME/.vOps/data/geolocation/ip2location.mmdb
GEOLITE2_COUNTRY_DB=
GEOLITE2_ASN_DB=

# Server
VPROX_ADDR=:3000

# Rate limiting
VPROX_RPS=25
VPROX_BURST=100
VPROX_AUTO_ENABLED=true
VPROX_AUTO_THRESHOLD=120
VPROX_AUTO_WINDOW_SEC=10
VPROX_AUTO_RPS=1
VPROX_AUTO_BURST=1
VPROX_AUTO_TTL_SEC=900
```

> **Note**: Backup automation is configured via `config/backup/backup.toml`, not `.env`.

### Default Ports (ports.toml)

`$HOME/.vOps/config/ports.toml` defines default service ports applied to all chains unless overridden per-chain:

```toml
rpc      = 26657
rest     = 1317
grpc     = 9090
grpc_web = 9091
api      = 1317
```

### Per-Chain Config

Create one `.toml` file per chain in `$HOME/.vOps/config/chains/`. A fully commented template is at [`config/chains/chain.sample.toml`](./config/chains/chain.sample.toml).

Minimal example (`$HOME/.vOps/config/chains/my-chain.toml`):

```toml
chain_name    = "my-chain"
host          = "my-chain.example.com"   # Host header vProx matches on
ip            = "127.0.0.1"              # Backend node IP
default_ports = true                     # Use ports from config/ports.toml

[services]
rpc       = true
rest      = true
websocket = true
grpc      = false
grpc_web  = false

[expose]
path  = true    # Enable /rpc, /rest, /websocket on the base host
vhost = false   # Enable rpc.<host>, api.<host> subdomains
```

**Path routing** (`path = true`): requests to `my-chain.example.com/rpc/...` are forwarded to `127.0.0.1:26657`.

**Vhost routing** (`vhost = true`): requests to `rpc.my-chain.example.com` are forwarded to `127.0.0.1:26657`. Requires DNS or a reverse proxy for each subdomain. Both `path` and `vhost` can be enabled simultaneously.

> After changing chain configs, restart vProx: `sudo systemctl restart vProx.service`

---

## Geo Database

The IP2Location MMDB provides country and ASN enrichment for log lines. It is bundled in the repo as a compressed archive (`assets/geo/ip2location.mmdb.gz`, 6.8 MB) and decompressed during `make install` to:

```
$HOME/.vOps/data/geolocation/ip2location.mmdb
```

`make install` skips re-extracting it if the file already exists. To force a fresh extract (no sudo required):

```bash
gunzip -c assets/geo/ip2location.mmdb.gz > $HOME/.vOps/data/geolocation/ip2location.mmdb
```

If the database is missing at runtime, geo enrichment is silently disabled — all other proxy functionality continues normally.

To use an alternative or updated database, set the path in `.env`:

```bash
# Override with a custom IP2Location database:
IP2LOCATION_MMDB=/path/to/your/ip2location.mmdb

# Or use GeoLite2 as a fallback:
GEOLITE2_COUNTRY_DB=/path/to/GeoLite2-Country.mmdb
GEOLITE2_ASN_DB=/path/to/GeoLite2-ASN.mmdb
```

The lookup cache refreshes every 10 minutes.

---

## Systemd Service

`make install` renders systemd unit files for both binaries from their templates:

```
$HOME/.vOps/service/vProx.service
$HOME/.vOps/service/vOps.service
```

and prompts (y/n), once per binary, to install and enable them. To install manually instead:

```bash
sudo cp $HOME/.vOps/service/vProx.service /etc/systemd/system/vProx.service
sudo systemctl daemon-reload
sudo systemctl enable vProx.service
sudo systemctl start vProx.service
```

Check service status:

```bash
sudo systemctl status vProx.service
```

Follow live logs in CosmosSDK-style line format:

```bash
journalctl -u vProx.service -f --output=cat
```

Start / stop / restart (via the `vops vprox` CLI — passwordless with sudoers rule):

```bash
vops vprox start -d     # start as daemon
vops vprox stop         # stop the service
vops vprox restart      # restart the service
```

Or directly with systemctl:

```bash
sudo systemctl stop vProx.service
sudo systemctl restart vProx.service
```

---

## Running vProx

**Development (no install):**

```bash
go run ./cmd/vprox start       # Start proxy (foreground, logs to stdout)
go run ./cmd/vprox --validate  # Validate config and exit
go run ./cmd/vprox --info      # Print resolved config summary
go run ./cmd/vprox --dry-run   # Load config without starting server
```

**After install (recommended — via `vops`):**

```bash
vops vprox start                # Start server foreground (default :3000)
vops vprox start -d             # Start as daemon (systemd service)
vops vprox stop                 # Stop the service
vops vprox restart              # Restart the service
vops vprox status               # Show service state and basic stats
vops vprox view                 # Tail vProx service logs
```

**Advanced flags (standalone `vProx` binary only — `.build/vProx` or `go run ./cmd/vprox`):**

```bash
vProx --addr :4000             # Override listen address
vProx --validate               # Validate config files
vProx --info --verbose         # Full runtime/config summary
vProx --new-backup             # Run one log backup cycle
vProx --new-backup --reset_count  # Backup + reset access counters
vProx --list-backup            # List backup archives
vProx --backup-status          # Show scheduler status
```

For the complete flag reference, see [`CLI_FLAGS_GUIDE.md`](./CLI_FLAGS_GUIDE.md).

---

## Observability

### Prometheus metrics (`/metrics`)

vProx exposes a Prometheus-compatible metrics endpoint at `/metrics` on the main listen port. The following 8 metrics are exported:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `vprox_requests_total` | Counter | `method`, `route`, `status_code` | Total proxied HTTP requests |
| `vprox_active_connections` | Gauge | — | Currently active proxy connections |
| `vprox_request_duration_seconds` | Histogram | `method`, `route` | Proxy request latency distribution |
| `vprox_proxy_errors_total` | Counter | `route`, `error_type` | Proxy errors (`backend_error`, `request_build_error`, `unknown_host`) |
| `vprox_rate_limit_hits_total` | Counter | — | Requests that received a 429 response |
| `vprox_geo_cache_hits_total` | Counter | — | Geo lookup cache hits |
| `vprox_geo_cache_misses_total` | Counter | — | Geo lookup cache misses |
| `vprox_backup_events_total` | Counter | `status` | Backup lifecycle events (`started`, `completed`, `failed`) |

Example Prometheus scrape configuration:

```yaml
scrape_configs:
  - job_name: "vprox"
    scrape_interval: 15s
    static_configs:
      - targets: ["localhost:3000"]
```

### Health check (`/healthz`)

The `/healthz` endpoint returns a JSON object with server status and uptime:

```json
{
  "status": "ok",
  "uptime": "2h15m30s"
}
```

Returns HTTP 200 when healthy, HTTP 503 when a subsystem has failed. Use this endpoint for load balancer health checks and uptime monitoring.

### pprof debug server

When the `VPROX_DEBUG=1` environment variable is set, vProx starts a separate pprof HTTP server on port 6060 (default). This exposes Go runtime profiling data at the standard `/debug/pprof/` paths.

```bash
VPROX_DEBUG=1 vProx start
# Then in another terminal:
go tool pprof http://localhost:6060/debug/pprof/heap
```

> **Warning**: The pprof server exposes internal runtime state. Never expose port 6060 publicly. It runs on a separate port specifically to prevent accidental exposure through the main proxy port.

---

## Upgrading

For a routine code update (no directory/config/systemd changes needed), pull and run `make upgrade` — it rebuilds both binaries, stops both services, copies the binaries into place, and restarts both services automatically:

```bash
cd vOps
git pull origin main
make upgrade
```

`make upgrade` requires the sudoers rule set up by `make install` to already be in place (true for any host that's been through `make install` once).

If you need to pick up new directories, sample configs, or systemd unit changes too (e.g. after a release that adds new config files), re-run the full install instead — it's idempotent and never overwrites existing config:

```bash
make install
```

For migration guidance when upgrading between major versions, see [`docs/UPGRADE.md`](./docs/UPGRADE.md).

---

## Installing vOps

vOps (formerly vLog) is the vProx management and intelligence binary. It embeds a React SPA web UI,
a log archive analyzer, IP threat intelligence, config wizard, and fleet management all in a single Go binary.

> **Backward compatibility**: `vlog` is a symlink alias to `vops` — existing scripts using `vlog start` continue to work.

### Build and install

```bash
make install
```

`make install` builds **both** `vProx` and `vOps` and installs them to `$GOPATH/bin/`. The vOps binary
embeds the pre-built React SPA from `internal/vops/web/dist/` — no Node.js required for a standard install.

To rebuild vOps alone (e.g. after a frontend change):

```bash
make build-vops    # rebuilds the frontend (if Node is present) + Go binary → .build/vOps
```

This only compiles — it doesn't touch a running service or call `sudo`. Deploy it manually:

```bash
sudo systemctl stop vOps && cp .build/vOps $(go env GOPATH)/bin/vOps && sudo systemctl start vOps
```

Or run `make upgrade` instead, which does that automatically for both `vOps` and `vProx` in one step.

`build-vops` always tries to rebuild the React SPA first — no separate frontend-only target exists. If Node.js isn't found, it skips that step and falls back to whatever's already committed in `internal/vops/web/dist/`, so a standard build still works without Node.

#### Frontend-only rebuild

Only needed if you modify files under `internal/vops/web/frontend/src/`:

```bash
# Install Node.js (one-time, if not present)
brew install node          # macOS
# or: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs

# Install npm dependencies (first time only)
cd internal/vops/web/frontend && npm install
cd ../../../../..

# Rebuild the SPA + Go binary together
make build-vops
```

### Configure

Copy the sample config and edit:

```bash
# Done automatically by make install if vops.toml doesn't already exist
cp .samples/vops/vops.sample $HOME/.vOps/config/vops/vops.toml
```

Edit `$HOME/.vOps/config/vops/vops.toml`:

```toml
[vops]
port         = 8889
bind_address = "127.0.0.1"   # keep loopback when behind Apache
base_path    = ""             # set to "/vops" if proxied at a sub-path
api_key      = ""             # generate: openssl rand -hex 32
db_path      = ""             # default: $HOME/.vOps/data/vops.db

[intel]
abuseipdb_key  = "your-key"
virustotal_key = "your-key"
shodan_key     = "your-key"
auto_enrich    = true
```

### Dashboard authentication

By default the dashboard is open with no login required. To enable password protection:

**Generate a bcrypt hash:**

```bash
# Using htpasswd (ships with apache2-utils / httpd-tools)
htpasswd -nbBC 12 admin yourpassword | cut -d: -f2

# Or with Python if htpasswd is unavailable
python3 -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt(rounds=12)).decode())"
```

| Flag | Purpose |
|------|---------|
| `-n` | Print to stdout (don't write a file) |
| `-b` | Read password from the command line |
| `-B` | Use bcrypt algorithm |
| `-C 12` | Cost factor 12 — OWASP minimum recommendation (~250ms/hash) |

**Add to `vops.toml`:**

```toml
[vops.auth]
username      = "admin"
password_hash = "$2y$12$..."   # paste hash here
```

Restart vOps after changing the hash. If `password_hash` is empty, authentication is bypassed — always set one in production.

### vOps API key

The `/api/v1/ingest` endpoint is a machine-to-machine (M2M) call. vProx pushes log archives to vOps after each backup using this key in the `X-API-Key` header.

```bash
# Generate a secure key
openssl rand -hex 32
```

```toml
# vops.toml
[vops]
api_key = "your-generated-key-here"
```

> The API key protects only the ingest endpoint. All dashboard and browser actions use session auth (login cookie), not the API key.

### Block and unblock

IP block/unblock controls are on the Accounts page. They require only an active login session — no API key needed from the browser.

### Systemd service

`make install` renders `vOps.service` and prompts (y/n) to install it to `/etc/systemd/system/` — see [Systemd Service](#systemd-service) above. There's no separate standalone target for this; re-run `make install` if you skipped the prompt and want to install the unit later.

### Run

```bash
vops start            # foreground server on :8889
vops start -d         # background daemon (sudo service vOps start)
vops stop             # stop the service
vops restart          # restart the service
vops status           # show database stats
vops ingest           # one-shot: scan archives and ingest
vops config --web     # open the config wizard in your browser

# Legacy aliases (backward compat)
vlog start            # same as vops start
```

### Config wizard

The config wizard is a 7-step browser SPA for configuring all vOps settings without editing TOML files directly.

```bash
vops config --web
```

Opens at `http://localhost:8889/settings/wizard`. Covers: Ports, Chains, vOps, Fleet, Infra, Backup, and Access settings. All changes are applied to the live config files.

### Apache reverse proxy

Proxy vOps behind Apache with IP restriction (admin-only). See `.vscode/vops.apache2` in the repo for a validated configuration template.

Key directives:

```apache
ProxyPass        /vops/ http://127.0.0.1:8889/
ProxyPassReverse /vops/ http://127.0.0.1:8889/
ProxyTimeout     60
# Allow only your admin IPs:
<Location /vops/>
  Require ip 10.0.0.0/8
</Location>
```

### vProx integration

To enable automatic archive ingest after each vProx backup, add to `$HOME/.vOps/config/ports.toml`:

```toml
vlog_url = "http://localhost:8889"
```

When `vlog_url` is set, vProx POSTs to `/api/v1/ingest` with the `X-API-Key` header after `--new-backup`. Ensure the key matches `api_key` in `vops.toml`. The call is non-fatal — if vOps is unavailable, vProx continues normally.

---

## Troubleshooting

### vProx won't start: "No configs found"

Ensure at least one chain config exists:

```bash
ls $HOME/.vOps/config/chains/*.toml
```

Ports config must also be present:

```bash
cat $HOME/.vOps/config/ports.toml
```

### Unknown host / 404 on all requests

The `host` field in your chain config must exactly match the `Host` header of incoming requests:

```toml
# In chains/my-chain.toml:
host = "my-chain.example.com"
```

Test with: `curl -H "Host: my-chain.example.com" http://localhost:3000/rpc/status`

### Geo not loading

Check the MMDB path in `.env` and confirm the file exists:

```bash
ls -lh $HOME/.vOps/data/geolocation/ip2location.mmdb
echo $IP2LOCATION_MMDB
```

Decompress it manually from the bundled archive: `gunzip -c assets/geo/ip2location.mmdb.gz > $HOME/.vOps/data/geolocation/ip2location.mmdb`.

### Rate limit too aggressive

Adjust `.env` values and restart:

```ini
VPROX_RPS=50
VPROX_BURST=200
VPROX_AUTO_THRESHOLD=300
```

### WebSocket connections dropping immediately

Check chain config timeouts:

```toml
[ws]
idle_timeout_sec = 3600    # 1 hour idle timeout
max_lifetime_sec = 0       # 0 = unlimited
```

### Binary not found after install

Ensure `$GOPATH/bin` is in your PATH:

```bash
export PATH="$PATH:$(go env GOPATH)/bin"
```

