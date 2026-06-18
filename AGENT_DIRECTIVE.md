# Agent directive (repo-local): vProx

This file is meant for future sessions (human or agent) to preserve conventions and reduce regressions.

## Operating mode (jarvis5.0)
This repo is worked on with the **jarvis5.0** agent workflow (supersedes jarvis4.0).
The Cosmos-SDK-specific parts apply only to knowledge of the upstream nodes being proxied,
**not** to vProx itself (which is a Go reverse proxy, not a Cosmos SDK application).
The execution discipline applies fully.

- Prefer small, testable changes; avoid broad refactors unless required.
- Before editing code, read enough surrounding context to avoid accidental API/behavior changes.
- Use repo-native patterns instead of introducing new ones.
- Validate frequently:
  - `gofmt` on touched files
  - `go build ./...` after meaningful changes
  - `go test ./...` when behavior could be impacted
- Don't "paper over" errors; fix root causes.
- Logging/schema changes are treated as API changes; prefer additive evolution.

### Checkpoints
When completing a discrete chunk of work, add a checkpoint under:
- `docs/checkpoints/YYYY-MM-DD-<topic>.md`

Include:
- what changed and why
- files/symbols involved
- how it was verified (commands + observed behavior)
- known follow-ups / risks

## Project summary
`vProx` is a Go reverse proxy with:
- HTTP proxying
- WebSocket proxying
- Rate limiting
- Optional geo enrichment
- Log archival/backup routines

## Conventions

### Structured logging
- Prefer structured, single-line logs everywhere.
- Use the shared helper in `internal/logging/logging.go`.
- Log lines in `main.log` should be stable and parseable:
  - include `ts`, `level`, `event` as baseline fields
  - avoid multi-line log blocks
  - use quoted strings where values may contain spaces

### Limiter JSONL compatibility
- `~/.vProx/data/logs/rate-limit.jsonl` is treated as an external interface.
- When standardizing fields, preserve existing keys if downstream tooling might depend on them.
  - Example: keep legacy `reason` while also providing standard `event`.
  - Example: keep legacy `ua` while also providing `user_agent`.

### Request correlation (`X-Request-ID`)
- Always ensure a request ID exists for request-scoped operations:
  - Use `logging.EnsureRequestID(r)` early in the request path.
  - Echo it back with `logging.SetResponseRequestID(w, id)`.
- Log it consistently as `request_id`.
- Validation: accept inbound IDs only if safe (length/charset); otherwise generate.
- Note: net/http canonicalizes header keys; clients may display `X-Request-Id`.

### Proxying behavior (future enhancement)
- If/when implementing upstream propagation:
  - Forward `X-Request-ID` to upstream HTTP requests.
  - Include it in WS dial headers.
  - Ensure this does not override an explicit upstream-provided ID unless intended.

## CLI / config
- CLI flags were expanded and documented in `FLAGS.md`.
- Expected operator modes include: validate/info/dry-run.

## Build & test
Typical commands:
- `go build ./...`
- `go test ./...`

When changing logging or middleware behavior:
- run a quick local request sequence
- verify `main.log` and `rate-limit.jsonl` schemas remain intact

## Deployment workflow
**Always push after major upgrades or any change that requires testing.**
The production test environment is a dedicated host (set its hostname/IP in your own infra config).
After each meaningful commit, push so the operator can install/reinstall vOps on that host for live testing.

```
# Standard post-implementation sequence
go build ./... && go vet ./... && go test ./...           # verify
cd internal/vops/web/frontend && npm run build            # rebuild SPA if frontend changed
make bump-patch                                           # increment version (on vOps_v1.0.0+ branches)
git add cmd/vops/VERSION && git commit -m "chore: bump vOps to $(cat cmd/vops/VERSION)"
cd /path/to/vProx && git push origin <branch>            # push for remote test-host deployment
```

- Push on the **working branch** (e.g., `vOps_v1.0.0`), not directly to `main`.
- Do not squash or rebase mid-branch; the test host pulls the branch tip for reinstall.
- If a push would break the running service, note it explicitly before pushing.

## vOps versioning
- **Source of truth**: `cmd/vops/VERSION` (semver `MAJOR.MINOR.PATCH`)
- **Starting version on `vOps_v1.0.0` branch**: `0.0.1`
- **Bump rules**: `make bump-patch` (fixes) · `make bump-minor` (new features) · `make bump-major` (milestones)
- **Ldflags**: version + commit hash + build date are injected at build time via `VOPS_LDFLAGS`
- **Check current version**: `make help` (shows current version) or `cat cmd/vops/VERSION`
- Always bump before a push when changes warrant a version update.

## Gotchas
- Avoid breaking file formats under `~/.vProx/data/logs/` without a migration strategy.
- Preserve current fields when "standardizing" output (additive changes are preferred).
