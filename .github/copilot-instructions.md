# GitHub Copilot Instructions — vOps / vProx

## Project Overview

This repo contains two Go binaries that operate together:

- **vProx** (`cmd/vprox`) — HTTP/WebSocket reverse proxy for Cosmos SDK nodes (RPC/REST/gRPC) with rate limiting, geo enrichment, and log archival.
- **vOps** (`cmd/vops`) — Infrastructure management dashboard and IP intelligence platform. Serves a React SPA (embedded in the binary) plus a REST API.

The frontend SPA (`internal/vops/web/frontend/`) is compiled by Vite and embedded at build time via `//go:embed static dist` — no separate web server needed.

**Module path:** `github.com/vNodesV/vOps`

---

## Build, Test, and Lint

```bash
# Go
go build ./...
go test ./...
go test -run TestFunctionName ./internal/path/to/pkg   # single test
go test -bench=. -benchtime=1x -run=^$ ./internal/... # benchmarks

# Linting / formatting
gofmt -l .
golangci-lint run --timeout=5m

# Frontend (React SPA)
cd internal/vops/web/frontend
npm run build   # production build (required before go:embed picks it up)
npm run dev     # Vite dev server (hot reload, proxies API to running vOps)
npm run lint    # ESLint

# Make shortcuts
make build           # build vOps binary → .build/vOps
make build-vprox     # build vProx binary → .build/vProx
make bump-patch      # increment patch version in cmd/vops/VERSION
make bump-minor      # increment minor version
make bump-major      # increment major version
```

**CI gate:** coverage must stay ≥ 60% (`go test -coverprofile=coverage.out ./...`).

---

## Versions

| Layer | Version |
|---|---|
| Go | 1.25 (go.mod) |
| TypeScript | ~5.9.3 |
| React | ^19.2.4 |
| TanStack Query | ^5.96.1 |
| React Router | ^7.14.0 |
| Tailwind CSS | ^4.2.2 |
| Vite | ^8.0.1 |
| Recharts | ^3.8.1 |
| SQLite driver | modernc.org/sqlite v1.46.1 |
| TOML parser | go-toml/v2 v2.2.4 |

---

## Architecture

### Go layer

```
cmd/
  vprox/   → proxy entrypoint
  vops/    → vOps CLI + server entrypoint (version in cmd/vops/VERSION)
internal/
  logging/         → shared structured log helpers (the only logger to use)
  metrics/         → Prometheus counters/histograms
  config/          → shared TOML config loading for vProx chains/nodes
  fleet/           → SSH-based fleet runner (push deployments to remote VMs)
  vops/
    config/        → vops.toml loader
    db/            → SQLite wrapper (schema + migrations in schema.go)
    ingest/        → archive ingestion + file watcher
    intel/         → IP enrichment (AbuseIPDB, Shodan, VirusTotal, OSINT)
    web/           → HTTP server, all API handlers, go:embed for SPA
    multiprox/     → multi-vProx aggregation
    services/      → service registry
    units/         → Cosmos node unit registry + SSH poller
    vm/            → libvirt/virsh VM management
    ufw/           → UFW firewall integration
```

### Frontend layer (`internal/vops/web/frontend/src/`)

```
api/
  client.ts  → apiFetch<T>, apiPost<T>, apiPut<T> wrappers + BASE prefix
  types.ts   → all shared TypeScript interfaces (single source of truth)
  index.ts   → re-exports; sse.ts for SSE stream helpers
pages/       → one file per route (Dashboard, Accounts, Services, etc.)
components/  → shared UI components (no page-level state)
contexts/    → React Context providers (TaskContext, etc.)
lib/         → pure utility modules (theme, etc.)
```

The Go server injects `<meta name="vops-base">` into `index.html` so the SPA knows its sub-path when hosted behind a reverse-proxied prefix. Always use `BASE` from `api/client.ts` when constructing `fetch` calls.

### Runtime paths

- Config: `~/.vOps/config/vops/vops.toml` and `~/.vProx/config/`
- Data / SQLite DB: `~/.vProx/data/`
- Log archives (JSONL): `~/.vProx/data/logs/archives/`

---

## Key Conventions

### Structured logging

Always use `internal/logging` — never `fmt.Println` or a raw `log.Printf` for structured output.

```go
// Standard log line
logging.Print("INF", "module-name", "event description", logging.F("key", value))

// Lifecycle event (no message token)
logging.PrintLifecycle("NEW", "backup", logging.F("ID", id), logging.F("status", "STARTED"))

// Typed correlation ID
id := logging.NewTypedID("API") // → API{24-uppercase-hex}
```

Log format (Cosmos SDK / journalctl-cat style):
```
10:23AM INF event description key=value module=backup
```

- Always include `ts`, `level`, `event` as baseline fields.
- Use `logging.EnsureRequestID(r)` at the top of every HTTP handler.
- Echo back with `logging.SetResponseRequestID(w, id)`.
- Log it as `request_id`.

### JSONL log schema (external interface)

`~/.vProx/data/logs/*.jsonl` files are treated as external interfaces. **Only additive changes** are allowed — never remove or rename existing fields. If a field name changes, keep the old key alongside the new one.

### SQLite

- Always open via `db.Open(path)` — it configures WAL mode, busy-timeout, and runs migrations.
- `SetMaxOpenConns(1)` is required — SQLite is single-writer.
- Schema changes go in `internal/vops/db/schema.go` via the `Migrate` function.

### Config (TOML)

All config uses `github.com/pelletier/go-toml/v2`. Config structs use `toml:"snake_case"` tags. Document every exported field with a `// Comment` above or inline.

### Versioning

- **Source of truth:** `cmd/vops/VERSION` (plain semver `MAJOR.MINOR.PATCH`)
- Version, commit, and build date are injected at build time via `-ldflags "$(VOPS_LDFLAGS)"`
- Use `make bump-patch / bump-minor / bump-major` — do not edit `VERSION` by hand
- Bump before every push that warrants a version update

### Checkpoints

After completing a discrete chunk of work, create:
```
docs/checkpoints/YYYY-MM-DD-<topic>.md
```
Include: what changed and why, files/symbols touched, verification commands + observed output, known follow-ups.

### Frontend patterns

- Functional components with hooks only (no class components)
- Server state via TanStack Query (`useQuery`, `useMutation`) — do not use `useState` for data that comes from the API
- All API calls go through `apiFetch` / `apiPost` / `apiPut` from `api/client.ts`
- All shared types live in `api/types.ts`; do not duplicate type definitions in component files
- Tailwind CSS 4 utility classes for styling; CSS custom properties for theme tokens (`var(--vn-primary)`, etc.)

### Linting

The `.golangci.yml` enables: `govet`, `staticcheck`, `errcheck`, `gosimple`, `ineffassign`, `unused`, `gosec`, `gofmt`, `goimports`, `misspell`, `bodyclose`, `noctx`, `exhaustive`.

`goimports` local-prefix is `github.com/vNodesV/vProx` — keep internal imports in a separate group.

`exhaustive` is configured with `default-signifies-exhaustive: true`.

G304 (file inclusion via variable) is intentionally suppressed in `internal/geo/`, `internal/backup/`, and `internal/config/`.

---

## Branching & Deployment

- Work on feature branches (e.g. `vOps_v1.0.0`), not directly on `main`.
- Push after each meaningful commit; your test environment pulls the branch tip for live testing.
- Do not squash or rebase mid-branch.

Standard post-implementation sequence:
```bash
go build ./... && go vet ./... && go test ./...
cd internal/vops/web/frontend && npm run build   # if frontend changed
make bump-patch
git add cmd/vops/VERSION && git commit -m "chore: bump vOps to $(cat cmd/vops/VERSION)"
git push origin <branch>
```
