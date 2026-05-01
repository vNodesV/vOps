# OpsCenter SSH Fix + Logging Migration — v1.4.2

**Branch:** `vOps_v1.4.0`  
**Commit:** `30335a5`  
**VERSION:** `1.4.1 → 1.4.2`

---

## What Changed

### OC-2 — ProxyJump VRackIP preference (`fleet/status/vmstatus.go`)

`dialVM` previously resolved the SSH ProxyJump host address using only `jp.LanIP`.
For cross-datacenter VMs (RBX hypervisor reachable via vRack `10.1.0.3` from QC),
`LanIP` is either empty or the RBX-local LAN address — unreachable from QC.

**Fix:** Priority order is now `VRackIP → LanIP → Name`.  
With `proxy_jump_host` set on RBX VMs pointing to the `[host]` that has
`vrack_ip = '10.1.0.3'`, the jump now routes correctly through the vRack.

### OC-3 — `slog` removal from `vm/shell.go`

6 direct `slog.*` calls replaced with `logging.Print(...)` matching project convention.
`log/slog` import removed.

### Phase E — `log.Printf` elimination

All remaining raw `log.Printf` calls replaced with `logging.Print`:

| File | Calls | New level |
|------|-------|-----------|
| `internal/vops/intel/intel.go` | 9 | WRN / ERR |
| `internal/vops/web/settings_handlers.go` | 2 | INF / ERR |
| `internal/vops/multiprox/handlers.go` | 2 | WRN |

---

## Network Topology Context (for future reference)

- vOps runs on `www-qc` (10.0.0.65 / vRack 10.1.0.5)
- QC hypervisor: `10.0.0.1` — directly reachable from www-qc
- RBX hypervisor: `10.1.0.3` — reachable via vRack from `10.1.0.5`
- RBX VMs: `10.0.0.x` on RBX's local LAN — only reachable via ProxyJump through rbx-host
- vRack `10.1.0.0/24` is REMOTE-only; local VMs (`10.1.0.2`) are NOT reachable via vRack

## Config Fixes Still Needed (on live server, not in repo)

Apply to `~/.vOps/config/infra/` on www-qc:

**qc1.toml:**
- `[host].ssh_key_path` → `/home/vnodesv/.vOps/secret/vops_ssh_key`
- `cheqd_testnet` + `memeQc` VMs: same key fix
- `jarvis` + `crypWatch`: add `user = 'vnodesv'`, `key_path = '~/.vOps/secret/vops_ssh_key'`
- All VMs: `host_ref = 'qc.vnodesv.net'`, `datacenter = 'QC1'`
- `www` VM: `host = '10.0.0.65'` (remove loopback self-dial)

**rbx1.toml:**
- All 5 VMs: `proxy_jump_host = 'rbx.vnodesv.net'`
- All 5 VMs: `host_ref = 'rbx.vnodesv.net'`, `datacenter = 'RBX1'`

---

## Verification

```
go build ./...   ✅
go vet ./...     ✅
go test ./...    ✅ (all pass, 0 failures)
git push         ✅ vOps_v1.4.0 → 30335a5
```

## Known Follow-ups

- Apply live config fixes above on www-qc
- After deploy + config fix: verify RBX VMs turn green in OpsCenter
- OC-1 (self-dial guard for `www` VM): handled by config fix; no code needed if `127.0.0.1` is removed
