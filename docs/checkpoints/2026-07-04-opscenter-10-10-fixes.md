# OpsCenter: Eval-to-10/10 Fixes

**Date:** 2026-07-04  
**Branch:** `vOps_v1.4.0`  
**Version:** 1.4.14 (bump-patch)

---

## What Changed and Why

Following a Full-tier agentic-eval (Pattern 1/2/3) of the OpsCenter module, two
dimensions scored FAIL:

| Dimension   | Score | Threshold | Verdict |
|-------------|-------|-----------|---------|
| Safety      | 0.74  | 0.80      | FAIL    |
| Completeness| 0.71  | 0.80      | FAIL    |
| Clarity     | 0.87  | 0.80      | PASS    |
| Scope       | 0.91  | 0.80      | PASS    |

This checkpoint documents the surgical fixes applied to address all nine issues
found across those four dimensions.

---

## Issues Fixed

### S-2 — Audit actor was the opaque session token, not the username

**File:** `internal/vops/web/server.go`

`requireSession` previously injected `cookie.Value` (32-byte hex token) as the
`ctxkeys.Actor` context value. Audit log lines showed unintelligible tokens
instead of operator names.

**Fix:**
- Added `sessionUsers map[string]string` field to `Server` (token → username map).
- `newSession(username string)` now accepts and stores the username alongside the
  expiry in `sessions`.
- `deleteSession` and the hourly sweep goroutine both delete from `sessionUsers`.
- `requireSession` reads `s.sessionUsers[cookie.Value]` and injects the human
  username as the actor.

### S-3 / OC-1 — Self-dial loopback guard missing on fleet VM shell

**File:** `internal/vops/web/vm_shell.go`

A VM entry with `host = "127.0.0.1"` in the infra TOML would silently dial the
vOps process itself via SSH, creating a shell to the server rather than the
intended remote VM.

**Fix:** Added a loopback check before the WebSocket upgrade (so a plain HTTP 403
can still be returned):
```go
if ip := net.ParseIP(dialTarget); (ip != nil && ip.IsLoopback()) || dialTarget == "localhost" {
    http.Error(w, "vm shell rejected: host resolves to loopback (OC-1 guard)", http.StatusForbidden)
    return
}
```

### S-4 — Idle timer cancel didn't unblock blocked goroutines

**Files:** `internal/vops/vm/shell_bridge.go` (new)

The idle timer previously only called `cancel()`. If either relay goroutine was
blocked in `conn.ReadMessage()` or `shell.Read()`, it would stall until the
transport closed naturally — potentially minutes.

**Fix:** The idle timer callback now additionally calls:
- `conn.SetReadDeadline(time.Now())` — immediately returns an error from any
  blocked `ReadMessage()` call.
- `shell.Close()` — closes the SSH session pipes, immediately unblocking `Read()`.

### C-1 — No request correlation IDs

**File:** `internal/vops/web/server.go`

No `X-Request-ID` header was threaded through requests, making log correlation
across handler calls impossible.

**Fix:** Added `withRequestID` middleware (wraps the entire mux) that reads or
generates `X-Request-ID` using the existing `logging.EnsureRequestID` /
`logging.SetResponseRequestID` helpers. Wired as the outermost layer:
```
debugHTTPMiddleware(withRequestID(securityHeaders(mux)))
```

### C-2 — Login events not audited

**File:** `internal/vops/web/handlers.go`

Successful and failed login attempts were invisible in `audit_log`, making
it impossible to detect brute-force attempts or unauthorized access post-facto.

**Fix:** Added `db.InsertAuditLog` calls in `handleLoginSubmit`:
- **Failure:** actor `"unauthenticated"`, action `"auth.login.fail"`, result `"fail"`.
  The submitted username is intentionally NOT logged (could be a mistyped password).
- **Success:** actor is the authenticated `username`, action `"auth.login.ok"`, result `"ok"`.

### C-3 — requireAPIKey dead code comment clarified

**File:** `internal/vops/web/server.go` (comment on `requireAPIKey`)

No code change needed — confirmed `//nolint:unused` is already present.

### C-4 — Shell relay goroutines duplicated across two handlers

**Files:** `internal/vops/vm/shell_bridge.go` (new), `internal/vops/vm/shell.go`,
`internal/vops/web/vm_shell.go`

~200 LOC of identical WebSocket↔SSH relay logic existed in both `vm/shell.go`
(HandleShell) and `web/vm_shell.go` (HandleVMShell), including separate idle
timers, ping tickers, and resize message parsers.

**Fix:** Extracted shared logic into `BridgeShellSession` in the new
`internal/vops/vm/shell_bridge.go` file. Both handlers now call:
```go
BridgeShellSession(ctx, cancel, conn, shell,
    idleTimeout, writeWait, pingPeriod,
    logField, logTarget)
```
`web/vm_shell.go` imports the `vm` package as `opsvm` to call
`opsvm.BridgeShellSession(...)`.

### C-5 — Services table orphaned (scaffold comment added)

**File:** `internal/vops/web/server.go`

The services routes block now includes a sentinel comment explaining that the
CRUD API is operational but no background ingestion populates the table
automatically. See `BRIEF.md §Services` for the planned integration.

### CL-1 — Raw `map[string]string` used for JSON write in vm_shell.go

**File:** `internal/vops/web/vm_shell.go`

The `vmWSError` helper wrote `map[string]string{"type":"error","data":msg}` via
`WriteJSON`, lacking type safety and differing from the `shellMsg` struct pattern
used in `vm/shell.go`.

**Fix:** Defined a typed `wsErrMsg struct { Type, Data string }` in
`vm_shell.go` and updated `vmWSError` to use it. (The unexported `shellMsg` from
`vm/shell.go` cannot be used cross-package; local struct is correct here.)

---

## Files Touched

| File | Change |
|------|--------|
| `internal/vops/vm/shell_bridge.go` | **NEW** — shared BridgeShellSession |
| `internal/vops/vm/shell.go` | Remove relay goroutines; call BridgeShellSession; trim 4 imports |
| `internal/vops/web/vm_shell.go` | Self-dial guard; opsvm import; remove relay goroutines; call bridge; wsErrMsg struct |
| `internal/vops/web/server.go` | sessionUsers field; newSession(username); deleteSession; sweep; requireSession username; withRequestID middleware; logging import; services sentinel comment |
| `internal/vops/web/handlers.go` | newSession(username) call; login audit logs (success + failure) |
| `cmd/vops/VERSION` | 1.4.13 → 1.4.14 |

---

## Verification Commands

```bash
go build ./...
go vet ./...
go test ./...
```

Expected: all pass, no new lint errors.

---

## Known Follow-Ups

- The `requireAPIKey` handler remains wired to no routes — it's pre-built for
  a planned external REST API. When external API routes are added, remove the
  `//nolint:unused` and wire appropriately.
- The session sweep goroutine has no context cancellation (runs until process
  exit). Acceptable for a single-binary server but tracked for future cleanup.
- Services table ingestion is still scaffold-only; see `BRIEF.md §Services`.
