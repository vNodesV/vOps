# Feature Audit Fixes — vOps v1.2.0

**Date:** 2026-04-27  
**Branch:** `vOps_v1.2.0`  
**Commits:** `e36cbfb`, `20a3de1`, `ab63001`, `a202ef3`

---

## What changed and why

### P0 — Critical (commit `e36cbfb`)
| Fix | File | Detail |
|-----|------|--------|
| Delete dead VMs.tsx | `pages/VMs.tsx` | 2537-line page never imported by router |
| Theme persistence URL | `App.tsx:69` | Was `/api/v1/settings/config`; now `/settings/api/config/preferences` to match actual route |
| Nav label | `App.tsx:88` | "Services" → "Cosmos Nodes" |
| Import alias | `App.tsx` | `./pages/Services` → `./pages/CosmosNodes` (after rename) |
| parseTOML `[[section]]` | `settings/shared.tsx` | Was silently skipped; now treated same as `[section]` |
| parseTOML dotted keys | `settings/shared.tsx` | Keys containing `.` now stored both as `section.key` and bare `key` so ProxyPanel lookups work |
| Go theme whitelist | `settings_handlers.go:338` | `vnodes/dark-blue/light-blue` → `axiom/vthemedgr/vthemedbl/vthemedlite` to match frontend IDs |

### P1 — Security (commit `20a3de1`)
| Fix | File | Detail |
|-----|------|--------|
| CIDR whitelist | `intel_autoban.go` | `autoBanStore` now has `wlIPs map[string]struct{}` + `wlNetworks []*net.IPNet`; CIDRs parsed via `net.ParseCIDR`; `isWhitelisted` checks both |
| AutoBan partial save | `settings/SecurityPanel.tsx` | `AutoBanPanel.saveMut` now spreads all current vops config fields before applying autoban overrides |
| Dead chain traffic endpoint | `handlers.go`, `server.go`, `api/index.ts` | Removed `handleAPIChainTraffic`, route `GET /api/v1/fleet/chains/traffic`, and orphaned comment |

### P1 — UX (commit `ab63001`)
| Fix | File | Detail |
|-----|------|--------|
| Audit error message | `Audit.tsx:100` | Removed false "Fleet must be configured" implication |
| Empty audit state | `Audit.tsx` | More descriptive guidance text |
| Snapshot revert confirm() | `Operations.tsx` | Replaced `confirm()` with `confirmRevert` boolean state; 2-click Revert/Confirm pattern |
| MultiProx delete confirm() | `MultiProx.tsx` | Replaced `confirm()` in `InstanceRow.handleDelete` with `confirmDelete` state |

### P2 — Quality (commit `a202ef3`)
| Fix | File | Detail |
|-----|------|--------|
| Time utilities | `lib/time.ts` *(new)* | Shared `fmtDate`, `fmtRelative`, `timeAgo` functions |
| Services → CosmosNodes | `pages/CosmosNodes.tsx` | `git mv` rename |
| BASE import | `CosmosNodes.tsx` | Removed inline `const BASE = import.meta.env...`; imports from `api/client` |
| Hex colors | `CosmosNodes.tsx` | `NODE_TYPE_COLORS`, `NET_COLORS`, `STATE_COLORS` now use `var(--vn-*)` CSS custom properties |
| Local time helpers | `CosmosNodes.tsx` | Removed duplicated `fmtTime`/`timeAgo`; `fmtTime` delegates to `lib/time.fmtDate` |
| No-op useMemo | `Accounts.tsx` | Removed `displayedAccounts = useMemo(() => accounts)` and unused `useMemo` import |
| Shodan extraPorts | `AccountDetail.tsx` | Parses `ShodanData.ports` JSON and passes as `extraPorts` to `PortGrid` |
| PortGrid non-standard ports | `PortGrid.tsx` | Added optional `extraPorts?: number[]`; non-standard ports rendered in amber |
| ThreatScore CSS var | `ThreatScore.tsx` | `--vn-warning-medium` (non-existent) → `--vn-warning` |
| WS URL | `Operations.tsx:652` | Removed `VITE_API_BASE` env fallback; uses `BASE` directly |
| MemModal shrink warning | `Operations.tsx` | Added danger note when new memory < current memory (requires reboot) |

---

## Verification

```bash
go build ./...          # exit 0
go vet ./...            # exit 0
cd internal/vops/web/frontend && npm run build
# ✓ 659 modules, 850 KiB JS, 86 KiB CSS, built in ~640ms
```

---

## Known follow-ups

- `AutoBanPanel` still hardcodes default fallback values when current TOML fields are absent; a future refactor should use typed config structs from the API response.
- CSS custom properties `--vn-primary-dim`, `--vn-info-dim`, `--vn-success-dim`, `--vn-warning-dim` referenced in CosmosNodes.tsx may need to be added to the theme files if they are not already defined.
