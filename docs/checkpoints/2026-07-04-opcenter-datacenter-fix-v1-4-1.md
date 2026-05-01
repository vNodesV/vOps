# OpsCenter Datacenter Fix — v1.4.1

**Date:** 2026-07-04  
**Branch:** `vOps_v1.4.0`  
**Version:** `1.4.1`  
**Commit:** `80f9442`

---

## Problem

All VMs in the Operations Center appeared under a single "Unknown" datacenter
group regardless of which physical datacenter they belonged to.

## Root Cause

`LoadFromInfraFiles` in `internal/fleet/config/config.go` auto-propagated
`host_ref` from the file's `[host].name` to child `[[vm]]` entries, but did
**not** propagate `[host].Datacenter`. Since `[[vm]]` entries in infra TOML
files have `datacenter = ''` (written by the UI save flow which lets the
backend derive datacenter from the filename), all loaded VMs had
`Datacenter == ""`. The UI grouped by `vm.datacenter || 'Unknown'`, putting
every VM under "Unknown".

## Fix

`internal/fleet/config/config.go` — in the per-VM loop inside `LoadFromInfraFiles`:

```go
// Inherit datacenter from host when the VM entry has none.
if f.VMs[i].Datacenter == "" && f.Host.Datacenter != "" {
    f.VMs[i].Datacenter = f.Host.Datacenter
}
```

No TOML changes needed — fix is purely in the loader. Takes effect on restart.

## Verification

```bash
ssh www.qc "curl -s http://localhost:8889/api/v1/fleet/vms/status | \
  python3 -c 'import json,sys; d=json.load(sys.stdin); \
  [print(v[\"name\"], \"dc:\", v.get(\"datacenter\",\"?\")) for v in d[\"vms\"]]'"
```

Output:
```
cheqd_testnet dc: QC1
memeQc dc: QC1
chihuahua dc: QC1
www dc: QC1
jarvis dc: QC1
crypWatch dc: QC1
cheqd-services dc: RBX1
sifchain dc: RBX1
cheqd dc: RBX1
elysRBX dc: RBX1
www.fr dc: RBX1
```

## Files Changed

- `internal/fleet/config/config.go` — datacenter inheritance in `LoadFromInfraFiles`
- `cmd/vops/VERSION` — `1.4.0` → `1.4.1`

## Notes

- No frontend changes needed
- No TOML migration needed — existing infra files are unmodified
- The Operations Center now shows two datacenter groups: QC1 and RBX1
