# Checkpoint — vOps Audit Fixes v1.3.1

**Date:** 2026-04-28
**Branch:** `vOps_v1.3.1` (isolated from `vOps_v1.3.0`)
**Commit:** `95dd309`
**Version:** 1.3.0 → 1.3.1

---

## What Changed and Why

Independent code audit of vOps v1.3.0 source produced 8 findings. This checkpoint covers
Phase 1 (6 files, all independent changes) shipped as a single security fix commit.

### H-1 + L-1 — Brute-force lockout bypass (`internal/vops/web/server.go`)

**Root cause:** `checkLoginLock` pruning condition used `now.Sub(att.lockedUntil)` for
unlocked IPs. When `lockedUntil` is zero, `now.Sub(time.Time{})` ≈ 56 years — always
exceeds the 30-min stale cutoff — so every unlocked IP was pruned on every check call
before it could accumulate 5 failures. Brute-force protection was silently broken.

**Secondary:** `att.lastAttempt` field was added in v1.2.0 M-6 fix but never written
in `recordLoginFailure`, so the now-correct pruning condition would still never prune.

**Fix:** Rewrite pruning to branch on `lockedUntil.IsZero()`. For unlocked IPs, use
`att.lastAttempt` as the cutoff. Set `att.lastAttempt = time.Now()` in `recordLoginFailure`.

### H-2 — Shell injection in fleet/api (`internal/fleet/api/api.go`)

**Root cause:** `vmName` (from `virsh list --all` output) was directly interpolated into
SSH shell command strings in `probeVMIP` and `probeGuestOSInfo`. The `shellescape()`
function in `vm/virsh.go` is unexported — fleet/api could not reach it.

**Fix:** Added `safeVMName()` (regex strip of `[^a-zA-Z0-9_.-]` + single-quote wrap)
local to fleet/api/api.go. Applied at both injection sites.

### H-9 — ip-api.com over HTTP (`internal/vops/intel/osint.go`)

**Fix:** Changed `http://ip-api.com/...` → `https://ip-api.com/...` in `checkIPInfo()`.
ip-api.com free tier supports TLS on the same endpoint. Previously all IP lookups were
plaintext — IP addresses of monitored nodes were leaked to network path.

### M-1 — SSE handlers killed at 30s (`internal/vops/web/units_ssh.go`)

**Root cause:** Server has a global `WriteTimeoutSec = 30`. Long-running SSE handlers
(enrichment, intel stream) already call `SetWriteDeadline(time.Time{})` to opt out.
`handleUnitLogStream` and `handleUnitDeploy` did not — journal tails were silently killed
after 30 seconds.

**Fix:** Added `http.NewResponseController(w).SetWriteDeadline(time.Time{})` immediately
after the Flusher check in both handlers.

### M-2 — Sessions map unbounded growth (`internal/vops/web/server.go`)

**Root cause:** Sessions were only removed by `validSession()` on active requests.
Long-running daemons accumulate orphaned entries indefinitely.

**Fix:** Added hourly sweep goroutine in `New()`, identical to existing autoBan sweep
pattern. Uses `sessionMu` lock already protecting the map.

### M-4 — RunCmd deprecation notice (`internal/fleet/runner/runner.go`)

**Root cause:** `RunCmd` accepts an arbitrary command string — no allowlist. The v1.2.0
audit marked C-2 as done (allowlist added), but `RunCmd` still exists as an exported API.

**Fix:** Added deprecation godoc comment. No current callers; prevents new ones.

### L-2 — vops_theme cookie Secure unconditionally true (`internal/vops/web/settings_handlers.go`)

**Fix:** Changed `Secure: true` → `Secure: r.TLS != nil`. On plain HTTP (local dev,
LAN), the cookie was silently dropped by browsers — theme reset to default on every reload.

---

## Files Touched

| File | Change |
|------|--------|
| `internal/vops/web/server.go` | H-1 pruning fix, L-1 lastAttempt, M-2 sweep goroutine |
| `internal/fleet/api/api.go` | H-2 safeVMName + 2 injection sites |
| `internal/vops/intel/osint.go` | H-9 HTTPS |
| `internal/vops/web/units_ssh.go` | M-1 SetWriteDeadline in 2 SSE handlers + import time |
| `internal/fleet/runner/runner.go` | M-4 deprecation comment |
| `internal/vops/web/settings_handlers.go` | L-2 Secure gate |
| `cmd/vops/VERSION` | 1.3.0 → 1.3.1 |

---

## Verification

```
go build ./...   → exit 0
go vet ./...     → exit 0
go test ./...    → all pass (12 packages with tests)
gofmt -w         → 3 files reformatted, no drift after
```

---

## Open — Phase 2 (not yet shipped)

| ID | Description | File |
|----|-------------|------|
| E  | Migrate log.Printf → internal/logging in web + fleet packages | handlers.go, intel_autoban.go, server.go, fleet/api/api.go |

Phase 2 depends on Phase 1 being merged to avoid server.go/api.go conflicts.

---

## Known Follow-ups

- C-1 residual (carry from v1.2.0): require explicit `known_hosts_path` at startup; warn if unset.
- L-3: CSP `style-src 'unsafe-inline'` — deferred until Tailwind CSS purge path is verified safe.
