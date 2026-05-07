# Checkpoint: VM Shell WebSocket + Apache2 Fix

**Date:** 2026-05-06
**Branch:** `vOps_v1.4.0`
**Version:** v1.4.13

---

## What Changed and Why

### Problem
Shell button in OpsCenter showed "unavailable" after the VM shell feature was implemented (v1.4.12). Two root causes identified:

1. **Go origin check bug** — `wsUpgrader()` and `vmWSUpgrader()` compared WebSocket `Origin` header against the configured bind address (`127.0.0.1:8889`). Behind Apache2 with `ProxyPreserveHost On`, the browser sends `Origin: https://vnodesv.net` → mismatch → 403 upgrade rejection.

2. **Apache2 missing WebSocket proxy rules** — The generic `<Location /vops/>` block uses `ProxyPass http://...`. Apache2's `mod_proxy_wstunnel` requires an explicit `ws://` scheme ProxyPass to handle WebSocket Upgrade negotiation — the HTTP proxy does not forward `Upgrade: websocket` headers correctly even with the module loaded.

### Fixes

**Go (v1.4.13):**
- `internal/vops/vm/shell.go` — `wsUpgrader()`: use `r.Host` as primary origin target; `h.allowedOrigin` is fallback only when `r.Host` is empty. Since Apache forwards the original Host header (`ProxyPreserveHost On`), `r.Host = "vnodesv.net"` and the check passes.
- `internal/vops/web/vm_shell.go` — `vmWSUpgrader()`: same fix; replaced hardcoded `bind:port` construction with `r.Host`.

**Apache2 (`docs/apache.web.conf` → deploy to `/etc/apache2/sites-available/web2.conf`):**
- Added two `<Location>` blocks with `ws://` ProxyPass, placed before the generic `<Location /vops/>`:
  ```apache
  <Location /vops/api/v1/fleet/vmshell>
      H2Upgrade off
      ProxyPreserveHost On
      ProxyPass        ws://127.0.0.1:8889/api/v1/fleet/vmshell retry=0 timeout=600
      ProxyPassReverse ws://127.0.0.1:8889/api/v1/fleet/vmshell
      Require ip 24.202.153.47
      Require ip 45.148.138.234
  </Location>

  <Location /vops/api/v1/vm/shell>
      H2Upgrade off
      ProxyPreserveHost On
      ProxyPass        ws://127.0.0.1:8889/api/v1/vm/shell retry=0 timeout=600
      ProxyPassReverse ws://127.0.0.1:8889/api/v1/vm/shell
      Require ip 24.202.153.47
      Require ip 45.148.138.234
  </Location>
  ```
- `H2Upgrade off` — prevents HTTP/2 from intercepting the WebSocket Upgrade handshake.
- `ProxyPreserveHost On` — ensures `r.Host` in Go equals the browser's origin host.

---

## Files/Symbols Touched

| File | Change |
|------|--------|
| `internal/vops/vm/shell.go` | `wsUpgrader()` — use `r.Host` as primary origin check |
| `internal/vops/web/vm_shell.go` | `vmWSUpgrader()` — use `r.Host` as primary origin check |
| `docs/apache.web.conf` | Full sync to live config + WebSocket Location blocks added |
| `cmd/vops/VERSION` | Bumped 1.4.12 → 1.4.13 |

---

## Verification Commands

```bash
# Go build
go build ./...     # must pass clean

# Deployed version
ssh www.qc "cat ~/vOps/cmd/vops/VERSION"   # expect 1.4.13
```

**Apache2 — PENDING (requires sudo on QC1):**
```bash
sudo cp ~/vOps/docs/apache.web.conf /etc/apache2/sites-available/web2.conf
sudo apache2ctl configtest     # must say "Syntax OK"
sudo systemctl reload apache2
```

After reload, test shell:
1. Open OpsCenter → click any online VM → Shell button
2. WebSocket should connect (no "unavailable" message)
3. Type `whoami` → expect username response

---

## Current State

- ✅ Go origin check fixed — v1.4.13 built and deployed on QC1
- ✅ Apache config updated in repo (`docs/apache.web.conf`)
- ⏳ **Apache2 reload on QC1 pending** — user must run the 3 sudo commands above
- ⏳ Shell end-to-end test pending (blocked on Apache reload)

---

## Known Follow-ups

- Shell renders raw ANSI escape codes in `<div>` elements — works for plain output but color/cursor sequences appear as garbage. Consider upgrading to xterm.js for proper terminal emulation.
- `vm.Handlers.HandleShell` (hypervisor-level shell at `/api/v1/vm/shell`) also needed the origin fix — done in this session.
