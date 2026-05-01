# 2026-06-28 — Contextual Settings Drawers + Setup Wizard Removal (v1.4.0)

## What Changed & Why

Implemented the contextual settings UX pattern requested by the user:
- Instead of navigating to a central `/settings` page, each module/widget now has a `⚙` gear button that opens a right slide-in drawer showing only the settings relevant to that section.
- Removed the non-functional Setup Wizard (button, callout, redirect links).
- Bumped to **v1.4.0** (minor — UX rework).

## Files & Symbols Touched

### Created
- `internal/vops/web/frontend/src/components/SettingsDrawer.tsx`
  - `SettingsDrawer` (default): portal-based right slide-in drawer; ESC + backdrop-click to close
  - `GearButton`: small ⚙ trigger (hover opacity, accessible `aria-label`)
  - `ConfigPanel`: render-prop that fetches `ConfigSnapshot` and passes it to children; handles loading/error state internally

### Modified
| File | Change |
|---|---|
| `src/App.tsx` | Add `GlobalSettingsDrawer` (VOpsPanel + BackupsPanel + PreferencesPanel); add `⚙` gear button in `nav-right` between debug and logout |
| `src/pages/Dashboard.tsx` | Gear on "Chain Status" (ChainProfilesPanel), "Archive Ingest" (BackupsPanel), "Servers" (FleetScanPanel + DatacentersPanel) |
| `src/pages/proxy/index.tsx` | Gear in page header → PortsPanel + ProxyControlsPanel |
| `src/pages/Accounts.tsx` | Gear in page header → SecurityPanel + AutoBanPanel |
| `src/pages/Operations.tsx` | Gear in page header → FleetScanPanel + FleetSSHPanel + DatacentersPanel |
| `src/pages/settings/index.tsx` | Remove Setup Wizard button + callout block + `BASE` import |
| `src/pages/settings/InfraPanel.tsx` | Remove "...or run the Setup Wizard" from empty state |
| `src/pages/settings/ProxyPanel.tsx` | Remove "...or run the Setup Wizard" from empty state |

### Prop quirks discovered (important for future work)
Some settings panels fetch their own config internally and take **no props**:
- `FleetScanPanel()` — no config prop
- `SecurityPanel()` — no config prop
- `PreferencesPanel()` — no config prop

Others require `config: ConfigSnapshot` passed in:
- `FleetSSHPanel`, `DatacentersPanel`, `PortsPanel`, `ProxyControlsPanel`, `ChainProfilesPanel`
- `VOpsPanel`, `BackupsPanel`, `AutoBanPanel`

`ConfigPanel` from `SettingsDrawer.tsx` handles the fetch for the "config-required" panels.

## Verification

```bash
cd internal/vops/web/frontend && npm run build
# → ✓ 661 modules transformed, built in 697ms — zero TS errors

go build ./... && go vet ./...
# → Go OK
```

## Commit
`89f7e2b` — `feat(ux): contextual settings drawers + remove setup wizard (v1.4.0)`

## Known Follow-ups
- `CosmosNodes.tsx` (Chains page) has no gear yet — could add one for ChainProfilesPanel if desired
- The `/settings` page still exists and is accessible via the "More" nav — could be hidden or deprioritized now that contextual access is available
- Drawer width is hardcoded at 480px — could be made responsive for narrow viewports
