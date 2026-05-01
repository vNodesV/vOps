#!/usr/bin/env bash
# upgrade-1.2.1-to-1.4.4.sh — Migrate vProx v1.2.x → vOps v1.4.4
#
# Usage (from dev machine, via Makefile):
#   make upgrade-1.2.1-1.4.4                        # targets www.fr
#   make upgrade-1.2.1-1.4.4 UPGRADE_HOST=other     # override host
#
# Or directly on the target server:
#   bash ~/vOps/scripts/upgrade-1.2.1-to-1.4.4.sh
#
# What this does:
#   1. Validates preconditions
#   2. Backs up ~/.vProx to timestamped snapshot
#   3. Creates full ~/.vOps directory tree
#   4. Migrates all config files (with format transforms for v1.4.x schema)
#   5. Copies data assets (GeoIP DB, log archives)
#   6. Checks out vOps_v1.4.0 branch and rebuilds the binary
#   7. Reloads systemd and restarts vOps
#
# Idempotent: any file that already exists in ~/.vOps is skipped.
# Re-running is safe — nothing is overwritten.
#
# Config migrations performed:
#   vops.toml   → adds [vprox] section (config_path, external, service_name)
#                 sets archives_dir to absolute path
#                 removes infra_dir (unknown field in v1.4.x schema)
#   rbx.toml    → renamed rbx1.toml (naming convention alignment)
#   qc.toml     → renamed qc1.toml, stray [vm] / vm=[] removed
#   all others  → copied as-is (no schema changes)

set -euo pipefail

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; YEL='\033[1;33m'; GRN='\033[0;32m'; BLU='\033[0;34m'; RST='\033[0m'
ok()      { echo -e "${GRN}  ✓${RST} $*"; }
warn()    { echo -e "${YEL}  ⚠${RST} $*"; }
err()     { echo -e "${RED}  ✗${RST} $*" >&2; }
inf()     { echo -e "${BLU}  →${RST} $*"; }
section() { echo ""; echo "── $* "; echo "────────────────────────────────────────────────────────"; }

# ── paths ─────────────────────────────────────────────────────────────────────
VPROX_HOME="${HOME}/.vProx"
VOPS_HOME="${HOME}/.vOps"
TS=$(date +%Y%m%d_%H%M%S)
BACKUP="${HOME}/.vProx-backup-${TS}"
REPO="${HOME}/vOps"

OLD_CFG="${VPROX_HOME}/config"
NEW_CFG="${VOPS_HOME}/config"

# ─────────────────────────────────────────────────────────────────────────────
section "Pre-flight checks"

if [[ ! -d "${VPROX_HOME}" ]]; then
    err "~/.vProx not found — nothing to migrate."
    err "This script requires an existing v1.2.x vProx installation."
    exit 1
fi

if [[ ! -f "${OLD_CFG}/vops/vops.toml" ]]; then
    err "~/.vProx/config/vops/vops.toml not found."
    err "Expected a v1.2.x vProx config layout."
    exit 1
fi

if [[ ! -d "${REPO}" ]]; then
    err "~/vOps repo not found at ${REPO}."
    exit 1
fi

command -v go >/dev/null 2>&1 || { err "go not found in PATH"; exit 1; }
ok "Source: ${VPROX_HOME}"
ok "Target: ${VOPS_HOME}"
ok "Repo:   ${REPO}"

# ─────────────────────────────────────────────────────────────────────────────
section "Backup ~/.vProx → ${BACKUP}"

cp -a "${VPROX_HOME}" "${BACKUP}"
ok "Backup complete: ${BACKUP}"

# ─────────────────────────────────────────────────────────────────────────────
section "Creating ~/.vOps directory structure"

dirs=(
    "${VOPS_HOME}/config/vops"
    "${VOPS_HOME}/config/vops/chains"
    "${VOPS_HOME}/config/vprox"
    "${VOPS_HOME}/config/chains"
    "${VOPS_HOME}/config/infra"
    "${VOPS_HOME}/config/fleet"
    "${VOPS_HOME}/config/backup"
    "${VOPS_HOME}/data/geolocation"
    "${VOPS_HOME}/data/logs/archives"
    "${VOPS_HOME}/service"
    "${VOPS_HOME}/.samples"
)
for d in "${dirs[@]}"; do
    mkdir -p "${d}"
    ok "dir: ${d}"
done

# ─────────────────────────────────────────────────────────────────────────────
section "Migrating vops.toml  (adds [vprox] section)"

VOPS_TOML_DST="${NEW_CFG}/vops/vops.toml"
VOPS_TOML_SRC="${OLD_CFG}/vops/vops.toml"

if [[ -f "${VOPS_TOML_DST}" ]]; then
    warn "vops.toml already exists at destination — skipping"
else
    # Stage to a temp file before finalising
    TMP_VOPS=$(mktemp)
    cp "${VOPS_TOML_SRC}" "${TMP_VOPS}"

    # Remove infra_dir — field removed in v1.4.x schema (go-toml strict-mode safe)
    sed -i '/^[[:space:]]*infra_dir[[:space:]]*=/d' "${TMP_VOPS}"

    # Set archives_dir to the new absolute path (was empty in v1.2.x)
    sed -i "s|^archives_dir[[:space:]]*=.*|archives_dir = '${VOPS_HOME}/data/logs/archives'|" "${TMP_VOPS}"

    # Append [vprox] section if not already present
    if ! grep -q '^\[vprox\]' "${TMP_VOPS}"; then
        cat >> "${TMP_VOPS}" << VPROX_SECTION

# ── vProx integration (added by upgrade-1.2.1-to-1.4.4) ──────────────────
# v1.4.0: vOps and vProx share the same home directory.
# config_path must be the absolute path to the vOps home (no ~ expansion).
# external = true because vProx runs as a standalone systemd service.
[vprox]
config_path  = '${VOPS_HOME}'
external     = true
service_name = 'vProx'
VPROX_SECTION
    fi

    mv "${TMP_VOPS}" "${VOPS_TOML_DST}"
    ok "vops.toml migrated → ${VOPS_TOML_DST}"
    inf "  + [vprox] section added (config_path=${VOPS_HOME}, external=true)"
    inf "  + archives_dir set to ${VOPS_HOME}/data/logs/archives"
    inf "  + infra_dir removed (v1.4.x schema)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Migrating vprox/settings.toml"

_migrate_simple() {
    local src="$1" dst="$2" label="$3"
    if [[ -f "${dst}" ]]; then
        warn "${label} already exists — skipping"
    elif [[ -f "${src}" ]]; then
        cp "${src}" "${dst}"
        ok "${label} → ${dst}"
    else
        warn "${label} not found at source — skipping"
    fi
}

_migrate_simple \
    "${OLD_CFG}/vprox/settings.toml" \
    "${NEW_CFG}/vprox/settings.toml" \
    "vprox/settings.toml"

# ─────────────────────────────────────────────────────────────────────────────
section "Migrating infra TOML files"

# rbx.toml → rbx1.toml  (naming convention; remove stray vm = [] if present)
RBX_DST="${NEW_CFG}/infra/rbx1.toml"
if [[ -f "${RBX_DST}" ]]; then
    warn "infra/rbx1.toml already exists — skipping"
elif [[ -f "${OLD_CFG}/infra/rbx.toml" ]]; then
    # Remove stray scalar 'vm = []' at line 1 (TOML array-table conflict bug)
    sed '1{/^vm[[:space:]]*=[[:space:]]*\[\]/d}' "${OLD_CFG}/infra/rbx.toml" > "${RBX_DST}"
    ok "infra/rbx.toml  → infra/rbx1.toml"
else
    warn "infra/rbx.toml not found at source — skipping"
fi

# qc.vnodesv.net.toml → qc1.toml  (rename; remove stray [vm] empty table)
QC_DST="${NEW_CFG}/infra/qc1.toml"
if [[ -f "${QC_DST}" ]]; then
    warn "infra/qc1.toml already exists — skipping"
elif [[ -f "${OLD_CFG}/infra/qc.vnodesv.net.toml" ]]; then
    # Remove bare [vm] section header with no [[vm]] entries (causes parse noise)
    grep -v '^[[:space:]]*\[vm\][[:space:]]*$' "${OLD_CFG}/infra/qc.vnodesv.net.toml" > "${QC_DST}"
    ok "infra/qc.vnodesv.net.toml → infra/qc1.toml"
else
    warn "infra/qc.vnodesv.net.toml not found at source — skipping"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Migrating chain configs"

if [[ -d "${OLD_CFG}/chains" ]]; then
    for f in "${OLD_CFG}/chains"/*.toml; do
        [[ -f "${f}" ]] || continue
        base=$(basename "${f}")
        dst="${NEW_CFG}/chains/${base}"
        if [[ -f "${dst}" ]]; then
            warn "chains/${base} already exists — skipping"
        else
            cp "${f}" "${dst}"
            ok "chains/${base}"
        fi
    done
else
    warn "~/.vProx/config/chains/ not found — skipping"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Migrating fleet/settings.toml"

_migrate_simple \
    "${OLD_CFG}/fleet/settings.toml" \
    "${NEW_CFG}/fleet/settings.toml" \
    "fleet/settings.toml"

# ─────────────────────────────────────────────────────────────────────────────
section "Migrating vops chain configs"

if [[ -d "${OLD_CFG}/vops/chains" ]]; then
    mkdir -p "${NEW_CFG}/vops/chains"
    for f in "${OLD_CFG}/vops/chains"/*.toml; do
        [[ -f "${f}" ]] || continue
        base=$(basename "${f}")
        dst="${NEW_CFG}/vops/chains/${base}"
        if [[ -f "${dst}" ]]; then
            warn "vops/chains/${base} already exists — skipping"
        else
            cp "${f}" "${dst}"
            ok "vops/chains/${base}"
        fi
    done
else
    warn "~/.vProx/config/vops/chains/ not found — skipping"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Migrating data assets"

# GeoIP database (critical for proxy geo-enrichment)
GEO_SRC="${VPROX_HOME}/data/geolocation/ip2location.mmdb"
GEO_DST="${VOPS_HOME}/data/geolocation/ip2location.mmdb"
if [[ -f "${GEO_DST}" ]]; then
    warn "GeoIP DB already exists — skipping"
elif [[ -f "${GEO_SRC}" ]]; then
    cp "${GEO_SRC}" "${GEO_DST}"
    ok "ip2location.mmdb → ${GEO_DST}  ($(du -sh "${GEO_DST}" | cut -f1))"
else
    warn "GeoIP DB not found at source — geo-enrichment will be disabled"
    warn "  Expected: ${GEO_SRC}"
fi

# Log archives (existing backups for ingest)
ARCH_SRC="${VPROX_HOME}/data/logs/archives"
ARCH_DST="${VOPS_HOME}/data/logs/archives"
if [[ -d "${ARCH_SRC}" ]]; then
    count=0
    for f in "${ARCH_SRC}"/*.tar.gz; do
        [[ -f "${f}" ]] || continue
        base=$(basename "${f}")
        dst="${ARCH_DST}/${base}"
        if [[ -f "${dst}" ]]; then
            warn "archive ${base} already exists — skipping"
        else
            cp "${f}" "${dst}"
            ok "archive: ${base}"
            (( count++ )) || true
        fi
    done
    ok "${count} archive(s) copied to ${ARCH_DST}"
else
    warn "No archives directory found at ${ARCH_SRC}"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Checkout vOps_v1.4.0 branch + build"

cd "${REPO}"

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
if [[ "${CURRENT_BRANCH}" != "vOps_v1.4.0" ]]; then
    inf "Switching from '${CURRENT_BRANCH}' → vOps_v1.4.0"
    git fetch origin 2>&1 | sed 's/^/  /'
    git checkout vOps_v1.4.0 2>&1 | sed 's/^/  /'
fi
git pull origin vOps_v1.4.0 2>&1 | sed 's/^/  /'
ok "Branch: $(git branch --show-current)  @ $(git log --oneline -1)"

# Rebuild binary (skips frontend if node absent; syncs service files; restarts vOps)
inf "Running make build-vops ..."
make build-vops 2>&1 | sed 's/^/  /'

# ─────────────────────────────────────────────────────────────────────────────
section "Upgrade complete"

echo ""
echo "  Version:  $(vOps --version 2>/dev/null || echo 'check /usr/local/bin/vOps --version')"
echo "  Config:   ${VOPS_HOME}/config/vops/vops.toml"
echo "  Backup:   ${BACKUP}"
echo ""
echo "  Verify:"
echo "    journalctl -u vOps -n 20 --no-pager"
echo ""
warn "vProx (proxy traffic) was NOT restarted — still using ${VPROX_HOME} as its home."
warn "vProx home path (${VPROX_HOME}) remains unchanged for the proxy process."
inf  "To migrate vProx itself: update its --home flag in vProx.service to point to ${VOPS_HOME}"
