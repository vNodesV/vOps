# Audit Phase 2 — log.Printf → internal/logging migration

**Branch:** `vOps_v1.3.1`  
**Commit:** 17dcd97  
**Date:** 2026-04-28

---

## What changed and why

Migrated all `log.Printf` calls in the web and fleet/api packages to the
project-standard `internal/logging` structured API. This eliminates unstructured
text logs that bypass the Cosmos SDK-style log pipeline and ensures consistent
`key=value` formatting for all server-side events.

**Finding M-3** (Phase 2 of the v1.3.0 audit) — fully resolved.

---

## Files / symbols touched

| File | Calls migrated | Import change |
|------|---------------|---------------|
| `internal/vops/web/handlers.go` | 23 | `"log"` → `internal/logging` |
| `internal/vops/web/intel_autoban.go` | 7 | `"log"` → `internal/logging` |
| `internal/fleet/api/api.go` | 8 | `"log"` → `internal/logging` |

**Total:** 38 calls migrated across 3 files.

### Log-level assignments
- `ERR` — all error paths (DB errors, exec failures, encode failures)
- `INF` — lifecycle events: `banned`, `unbanned`, `VM registered`, `ufw sync imported`

### Example transformation
```go
// Before
log.Printf("[autoban] banned %s for %s: %s", ip, duration, reason)

// After
logging.Print("INF", "autoban", "banned",
    logging.F("ip", ip),
    logging.F("duration", duration),
    logging.F("reason", reason))
```

---

## Verification

```
go build ./...   → exit 0
go vet ./...     → exit 0
go test ./...    → all pass (no regressions)
go fmt (changed) → 3 files formatted cleanly
```

---

## Audit completion status

| Phase | Status |
|-------|--------|
| Phase 1 (H-1, H-2, H-9, M-1, M-2, M-4, L-2) | ✅ done (95dd309) |
| Phase 2 (M-3 — log.Printf migration)           | ✅ done (17dcd97) |
| L-3 (CSP unsafe-inline)                        | ⏸ deferred — Tailwind CSS requires it |

All actionable audit findings for v1.3.1 are resolved.

---

## Known follow-ups

- L-3 (CSP): Revisit when Tailwind CSS is removed or when a nonce-based approach
  is feasible with the current Vite embed setup.
- `RunCmd` in `fleet/runner/runner.go`: Deprecated in Phase 1; schedule removal
  once no callers remain.
