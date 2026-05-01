#!/usr/bin/env bash
# upgrade-1.2.1-to-1.4.4.sh — Migrate vProx v1.2.x layout → vOps v1.4.4
#
# Run DIRECTLY on www.fr (not from dev machine):
#   cd ~/vOps && git pull origin vOps_v1.4.0
#   make upgrade-1.2.1-1.4.4
#
# What this does:
#   1. Validates preconditions (go in PATH, old config exists, repo present)
#   2. Backs up ~/.vProx to timestamped snapshot
#   3. Creates full ~/.vOps directory tree
#   4. Copies SSH keys: ~/.vprox/secret/ → ~/.vOps/secret/
#   5. Writes fresh TOML files (heredoc, correct v1.4.4 schema, fr's real values)
#        vops.toml  — extracts api_key/password_hash/intel keys from old file
#        rbx1.toml  — all RBX VMs, updated key paths
#        qc1.toml   — QC host header (no VMs from this side)
#   6. Copies remaining configs as-is (vprox settings, fleet, chains)
#   7. Copies data assets (GeoIP DB, log archives)
#   8. Checks out vOps_v1.4.0, builds binary, restarts vOps
#
# Idempotent: files that already exist in ~/.vOps are skipped.

set -euo pipefail

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; YEL='\033[1;33m'; GRN='\033[0;32m'; BLU='\033[0;34m'; RST='\033[0m'
ok()      { echo -e "${GRN}  ✓${RST} $*"; }
warn()    { echo -e "${YEL}  ⚠${RST} $*"; }
err()     { echo -e "${RED}  ✗${RST} $*" >&2; }
inf()     { echo -e "${BLU}  →${RST} $*"; }
section() { echo ""; echo -e "${BLU}── $*${RST}"; echo "────────────────────────────────────────────────────────"; }

# ── paths ─────────────────────────────────────────────────────────────────────
VPROX_HOME="${HOME}/.vProx"
VOPS_HOME="${HOME}/.vOps"
OLD_CFG="${VPROX_HOME}/config"
NEW_CFG="${VOPS_HOME}/config"
REPO="${HOME}/vOps"
TS=$(date +%Y%m%d_%H%M%S)
BACKUP="${HOME}/.vProx-backup-${TS}"
SSH_KEY="${VOPS_HOME}/secret/vops_ssh_key"

# ─────────────────────────────────────────────────────────────────────────────
section "Pre-flight checks"

[[ -d "${VPROX_HOME}" ]]             || { err "~/.vProx not found"; exit 1; }
[[ -f "${OLD_CFG}/vops/vops.toml" ]] || { err "~/.vProx/config/vops/vops.toml not found"; exit 1; }
[[ -d "${REPO}" ]]                   || { err "~/vOps repo not found at ${REPO}"; exit 1; }
command -v go >/dev/null 2>&1        || { err "go not found in PATH"; exit 1; }

ok "Source : ${VPROX_HOME}"
ok "Target : ${VOPS_HOME}"
ok "Repo   : ${REPO}"

# ─────────────────────────────────────────────────────────────────────────────
section "Backup ~/.vProx"

cp -a "${VPROX_HOME}" "${BACKUP}"
ok "Backup → ${BACKUP}"

# ─────────────────────────────────────────────────────────────────────────────
section "Directory structure"

mkdir -p \
    "${VOPS_HOME}/config/vops/chains" \
    "${VOPS_HOME}/config/vprox" \
    "${VOPS_HOME}/config/chains" \
    "${VOPS_HOME}/config/infra" \
    "${VOPS_HOME}/config/fleet" \
    "${VOPS_HOME}/config/backup" \
    "${VOPS_HOME}/data/geolocation" \
    "${VOPS_HOME}/data/logs/archives" \
    "${VOPS_HOME}/secret"
ok "Dirs created under ${VOPS_HOME}"

# ─────────────────────────────────────────────────────────────────────────────
section "SSH keys  (~/.vprox/secret/ → ~/.vOps/secret/)"

OLD_KEY="${HOME}/.vprox/secret/vops_ssh_key"
if [[ -f "${OLD_KEY}" ]]; then
    cp "${OLD_KEY}"     "${SSH_KEY}"
    cp "${OLD_KEY}.pub" "${SSH_KEY}.pub" 2>/dev/null || true
    chmod 600 "${SSH_KEY}"
    ok "vops_ssh_key → ${SSH_KEY}"
else
    warn "${OLD_KEY} not found — infra SSH will not work until key is placed at ${SSH_KEY}"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "vops.toml  (fresh write, fr's real credentials)"

NEW_VOPS="${NEW_CFG}/vops/vops.toml"

if [[ -f "${NEW_VOPS}" ]]; then
    warn "vops.toml already exists — skipping"
else
    OLD_VOPS="${OLD_CFG}/vops/vops.toml"
    # Extract real values from old config (single-quoted TOML values)
    _get() { grep -m1 "^${1}[[:space:]]*=" "${OLD_VOPS}" | sed "s/.*=[[:space:]]*['\"]//;s/['\"].*//"; }
    API_KEY=$(_get api_key)
    PASS_HASH=$(_get password_hash)
    ABUSE_KEY=$(_get abuseipdb)
    VT_KEY=$(_get virustotal)
    SHODAN_KEY=$(_get shodan)

    cat > "${NEW_VOPS}" << TOML
[vops]
port               = 8889
base_path          = '/'
api_key            = '${API_KEY}'
db_path            = '${VOPS_HOME}/data/vops.db'
archives_dir       = '${VOPS_HOME}/data/logs/archives'
vprox_bin          = 'vprox'
watch_interval_sec = 60
bind_address       = '127.0.0.1'

[vops.push]
chains_dir        = '${NEW_CFG}/chains'
infra_dir         = '${NEW_CFG}/infra'
db_path           = '${VOPS_HOME}/data/push.db'
poll_interval_sec = 60

[vops.push.defaults]
user             = ''
key_path         = ''
known_hosts_path = ''

[vops.intel]
auto_enrich          = false
cache_ttl_hours      = 24
rate_limit_rpm       = 10
auto_ban_enabled     = false
auto_ban_threshold   = 5
ban_duration_minutes = 60
ban_whitelist        = []

[vops.intel.keys]
abuseipdb  = '${ABUSE_KEY}'
virustotal = '${VT_KEY}'
shodan     = '${SHODAN_KEY}'

[vops.server]
read_timeout_sec  = 30
write_timeout_sec = 30

[vops.auth]
allowed_groups = []
ssh_port       = 0
username       = 'vnodesv'
password_hash  = '${PASS_HASH}'

[vops.ui]
theme = 'vthemedbl'

[vprox]
config_path  = '${VOPS_HOME}'
external     = true
service_name = 'vProx'
TOML
    ok "vops.toml written → ${NEW_VOPS}"
    inf "  api_key:       ${API_KEY:0:12}..."
    inf "  password_hash: ${PASS_HASH:0:12}..."
    inf "  [vprox]:       config_path=${VOPS_HOME}, external=true"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "vprox/settings.toml  (copy as-is)"

_cp_once() {
    local src="$1" dst="$2" label="$3"
    if [[ -f "${dst}" ]]; then
        warn "${label} already exists — skipping"
    elif [[ -f "${src}" ]]; then
        cp "${src}" "${dst}"
        ok "${label}"
    else
        warn "${label} not found at source — skipping"
    fi
}

_cp_once "${OLD_CFG}/vprox/settings.toml" "${NEW_CFG}/vprox/settings.toml" "vprox/settings.toml"

# ─────────────────────────────────────────────────────────────────────────────
section "infra/rbx1.toml  (fresh write, updated key paths)"

RBX_DST="${NEW_CFG}/infra/rbx1.toml"
if [[ -f "${RBX_DST}" ]]; then
    warn "infra/rbx1.toml already exists — skipping"
else
    cat > "${RBX_DST}" << TOML
[host]
name                = 'rbx.vnodesv.net'
public_ip           = '141.94.162.127'
lan_ip              = '10.0.0.1'
datacenter          = 'RBX1'
user                = 'vnodes.v.eu'
ssh_key_path        = '${SSH_KEY}'
port                = 22
vrack_ip            = ''
ssh_known_hosts_path = ''

[vprox]
name         = 'vProx'
lan_ip       = ''
key          = ''
user         = 'vnodesv'
ssh_key_path = '${SSH_KEY}'

[[vm]]
name       = 'cheqd'
host_ref   = 'RBX1'
host       = '10.0.0.23'
lan_ip     = '10.0.0.23'
datacenter = 'RBX1'
type       = 'node'
user       = 'vnodesv'
key_path   = '${SSH_KEY}'
port       = 22

[[vm]]
name       = 'sifchain'
host_ref   = 'RBX1'
host       = '10.0.0.21'
lan_ip     = '10.0.0.21'
datacenter = 'RBX1'
type       = 'node'
user       = 'vnodesv'
key_path   = '${SSH_KEY}'
port       = 22

[[vm]]
name       = 'elysRBX'
host_ref   = 'RBX1'
host       = '10.0.0.11'
lan_ip     = '10.0.0.11'
datacenter = 'RBX1'
type       = 'node'
user       = 'vnodesv'
key_path   = '${SSH_KEY}'
port       = 22

[[vm]]
name       = 'cheqd-services'
host_ref   = 'RBX1'
host       = '10.0.0.13'
lan_ip     = '10.0.0.13'
datacenter = 'RBX1'
type       = 'node'
user       = 'vnodesv'
key_path   = '${SSH_KEY}'
port       = 22

[[vm]]
name       = 'www.fr'
host_ref   = 'RBX1'
host       = '127.0.0.1'
lan_ip     = '127.0.0.1'
datacenter = 'RBX1'
type       = 'webserver'
user       = 'vnodesv'
key_path   = '${SSH_KEY}'
port       = 22
TOML
    ok "rbx1.toml written → ${RBX_DST}"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "infra/qc1.toml  (fresh write, RBX→QC vrack path)"

QC_DST="${NEW_CFG}/infra/qc1.toml"
if [[ -f "${QC_DST}" ]]; then
    warn "infra/qc1.toml already exists — skipping"
else
    cat > "${QC_DST}" << TOML
[host]
name                = 'qc.vnodesv.net'
public_ip           = '10.1.0.2'
lan_ip              = '10.0.0.1'
datacenter          = 'QC1'
user                = 'vnodes.v.ca'
ssh_key_path        = '${SSH_KEY}'
port                = 22
vrack_ip            = ''
ssh_known_hosts_path = ''

[vprox]
name         = 'vProx'
lan_ip       = ''
key          = ''
user         = 'vnodesv'
ssh_key_path = '/home/vnodesv/.ssh/id_vShare'
TOML
    ok "qc1.toml written → ${QC_DST}"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Fleet settings  (copy as-is)"

_cp_once "${OLD_CFG}/fleet/settings.toml" "${NEW_CFG}/fleet/settings.toml" "fleet/settings.toml"

# ─────────────────────────────────────────────────────────────────────────────
section "Chain configs  (copy as-is)"

if [[ -d "${OLD_CFG}/chains" ]]; then
    for f in "${OLD_CFG}/chains"/*.toml; do
        [[ -f "${f}" ]] || continue
        base=$(basename "${f}")
        dst="${NEW_CFG}/chains/${base}"
        if [[ -f "${dst}" ]]; then warn "chains/${base} exists — skip"
        else cp "${f}" "${dst}"; ok "chains/${base}"; fi
    done
else
    warn "~/.vProx/config/chains/ not found — skipping"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "vOps chain configs  (copy as-is)"

if [[ -d "${OLD_CFG}/vops/chains" ]]; then
    mkdir -p "${NEW_CFG}/vops/chains"
    for f in "${OLD_CFG}/vops/chains"/*.toml; do
        [[ -f "${f}" ]] || continue
        base=$(basename "${f}")
        dst="${NEW_CFG}/vops/chains/${base}"
        if [[ -f "${dst}" ]]; then warn "vops/chains/${base} exists — skip"
        else cp "${f}" "${dst}"; ok "vops/chains/${base}"; fi
    done
else
    warn "~/.vProx/config/vops/chains/ not found — skipping"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Data assets  (GeoIP + archives)"

_cp_once \
    "${VPROX_HOME}/data/geolocation/ip2location.mmdb" \
    "${VOPS_HOME}/data/geolocation/ip2location.mmdb" \
    "ip2location.mmdb"

count=0
ARCH_SRC="${VPROX_HOME}/data/logs/archives"
ARCH_DST="${VOPS_HOME}/data/logs/archives"
if [[ -d "${ARCH_SRC}" ]]; then
    for f in "${ARCH_SRC}"/*.tar.gz; do
        [[ -f "${f}" ]] || continue
        base=$(basename "${f}")
        dst="${ARCH_DST}/${base}"
        if [[ -f "${dst}" ]]; then warn "archive ${base} exists — skip"
        else cp "${f}" "${dst}"; ok "archive: ${base}"; (( count++ )) || true; fi
    done
fi
ok "${count} archive(s) copied to ${ARCH_DST}"

# ─────────────────────────────────────────────────────────────────────────────
section "Checkout vOps_v1.4.0 + build"

cd "${REPO}"
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
if [[ "${CURRENT_BRANCH}" != "vOps_v1.4.0" ]]; then
    inf "Switching '${CURRENT_BRANCH}' → vOps_v1.4.0"
    git fetch origin
    git checkout vOps_v1.4.0
fi
git pull origin vOps_v1.4.0
ok "Branch: $(git branch --show-current)  @ $(git log --oneline -1)"

inf "Building vOps binary..."
make build-vops

# ─────────────────────────────────────────────────────────────────────────────
section "Upgrade complete ✓"

echo ""
echo "  Config : ${VOPS_HOME}/config/vops/vops.toml"
echo "  Backup : ${BACKUP}"
echo ""
echo "  Verify : journalctl -u vOps -n 30 --no-pager"
echo ""
warn "vProx was NOT restarted — proxy traffic untouched."
warn "vProx still reads ${VPROX_HOME}. To consolidate later:"
inf  "  Update --home in vProx.service → ${VOPS_HOME}"
