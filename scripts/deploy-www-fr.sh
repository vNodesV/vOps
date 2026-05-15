#!/usr/bin/env bash
# deploy-www-fr.sh — apply config fixes + deploy vOps v1.5.x to www.fr
# Run as: vnodesv@www.fr  from  ~/vOps
# Usage:  bash scripts/deploy-www-fr.sh [--config-only | --build-only | --full]
# Default (no args) = --full
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YLW='\033[1;33m'; GRN='\033[0;32m'; CYN='\033[0;36m'; RST='\033[0m'
info()  { echo -e "${CYN}[info]${RST}  $*"; }
ok()    { echo -e "${GRN}[ ok ]${RST}  $*"; }
warn()  { echo -e "${YLW}[warn]${RST}  $*"; }
die()   { echo -e "${RED}[FAIL]${RST}  $*" >&2; exit 1; }

# ── Args ───────────────────────────────────────────────────────────────────────
MODE="${1:---full}"
DO_CONFIG=true; DO_BUILD=true
case "$MODE" in
  --config-only) DO_BUILD=false ;;
  --build-only)  DO_CONFIG=false ;;
  --full) ;;
  *) die "Unknown mode: $MODE  (--config-only | --build-only | --full)" ;;
esac

CHAIN_DIR="${VOPS_HOME:-$HOME/.vOps}/config/chains"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="vOps_v1.5.0"

echo ""
echo -e "${CYN}══════════════════════════════════════════════════════${RST}"
echo -e "${CYN}  vOps www.fr deploy — mode: ${MODE}${RST}"
echo -e "${CYN}══════════════════════════════════════════════════════${RST}"
echo ""

# ── PHASE 1: CONFIG FIXES ──────────────────────────────────────────────────────
if $DO_CONFIG; then
  info "Phase 1 — chain config fixes"
  echo ""

  [[ -d "$CHAIN_DIR" ]] || die "Chain config dir not found: $CHAIN_DIR"

  # 1a. Fix stale key_path (.vprox → .vOps) in ALL chain configs
  STALE=$(grep -rl '\.vprox/secret/id\.push' "$CHAIN_DIR" || true)
  if [[ -n "$STALE" ]]; then
    info "Fixing key_path (.vprox → .vOps) in:"
    echo "$STALE"
    sed -i 's|/home/vnodesv/\.vprox/secret/id\.push|/home/vnodesv/.vOps/secret/id.push|g' \
      "$CHAIN_DIR"/*.toml
    ok "key_path fixed"
  else
    ok "key_path — already clean"
  fi

  # 1b. Fix rpc_msg tripwire ("/" → "")
  TRIPWIRE=$(grep -rl 'rpc_msg = "/"' "$CHAIN_DIR" || true)
  if [[ -n "$TRIPWIRE" ]]; then
    info "Fixing rpc_msg tripwire in:"
    echo "$TRIPWIRE"
    sed -i 's|rpc_msg = "/"|rpc_msg = ""|g' "$CHAIN_DIR"/*.toml
    ok "rpc_msg fixed"
  else
    ok "rpc_msg — already clean"
  fi

  # 1c. Fix api_msg tripwire ("/rest" → "")
  APITRIPWIRE=$(grep -rl 'api_msg = "/rest"' "$CHAIN_DIR" || true)
  if [[ -n "$APITRIPWIRE" ]]; then
    info "Fixing api_msg tripwire in:"
    echo "$APITRIPWIRE"
    sed -i 's|api_msg = "/rest"|api_msg = ""|g' "$CHAIN_DIR"/*.toml
    ok "api_msg fixed"
  else
    ok "api_msg — already clean"
  fi

  # 1d. Rename cheqd.toml → cheqd-testnet.toml (it's the testnet config)
  if [[ -f "$CHAIN_DIR/cheqd.toml" ]]; then
    info "Renaming cheqd.toml → cheqd-testnet.toml"
    mv "$CHAIN_DIR/cheqd.toml" "$CHAIN_DIR/cheqd-testnet.toml"
    ok "Renamed"
  elif [[ -f "$CHAIN_DIR/cheqd-testnet.toml" ]]; then
    ok "cheqd-testnet.toml — already named correctly"
  else
    warn "No cheqd.toml or cheqd-testnet.toml found — skipping rename"
  fi

  # 1e. Verify SSH key at new path
  KEY_PATH="/home/vnodesv/.vOps/secret/id.push"
  if [[ -f "$KEY_PATH" ]]; then
    ok "SSH key present at $KEY_PATH"
  else
    warn "SSH key NOT found at $KEY_PATH"
    OLD_KEY="/home/vnodesv/.vprox/secret/id.push"
    if [[ -f "$OLD_KEY" ]]; then
      warn "Found at OLD path: $OLD_KEY"
      warn "Run manually:  mkdir -p ~/.vOps/secret && cp $OLD_KEY $KEY_PATH"
    else
      warn "Key not found at old path either — fleet push will fail until resolved"
    fi
  fi

  # 1f. Final verification — no stale refs should remain
  REMAINING=$(grep -r '\.vprox/secret/id\.push\|rpc_msg = "/"\|api_msg = "/rest"' \
    "$CHAIN_DIR" 2>/dev/null || true)
  if [[ -n "$REMAINING" ]]; then
    die "Stale refs still present:\n$REMAINING"
  fi

  echo ""
  ok "Phase 1 complete — chain configs are clean"
fi

# ── PHASE 2: BUILD + DEPLOY ────────────────────────────────────────────────────
if $DO_BUILD; then
  echo ""
  info "Phase 2 — pull + build + deploy"
  echo ""

  cd "$REPO_DIR"

  # 2a. Pull latest from branch
  info "git pull origin $BRANCH"
  git pull origin "$BRANCH" || die "git pull failed"
  ok "Up to date"

  # 2b. Install conntrack if missing
  if ! command -v conntrack &>/dev/null; then
    info "Installing conntrack..."
    sudo apt-get install -y conntrack
    ok "conntrack installed"
  else
    ok "conntrack — $(conntrack --version 2>&1 | head -1)"
  fi

  # 2c. Build vOps (frontend + Go binary + service sync + restart)
  info "make build-vops..."
  make build-vops
  ok "build-vops complete"

  # 2d. Update sudoers for conntrack NOPASSWD (make ufw is idempotent)
  info "make ufw — updating sudoers..."
  make ufw
  ok "sudoers updated"

  echo ""
  ok "Phase 2 complete — vOps deployed and restarted"
fi

# ── SUMMARY ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYN}══════════════════════════════════════════════════════${RST}"
echo -e "${GRN}  All done.${RST}"
echo ""
if $DO_CONFIG; then
  echo -e "  Chain configs:  ${GRN}fixed${RST} — $CHAIN_DIR"
fi
if $DO_BUILD; then
  BINARY="$(make --no-print-directory print-vops-path 2>/dev/null || echo '.build/vOps')"
  echo -e "  Binary:         ${GRN}deployed${RST}"
  echo -e "  Services:       ${GRN}restarted${RST}"
fi
echo ""
echo -e "  Verify with:"
echo -e "    systemctl status vOps vProx"
echo -e "    curl -s https://cheqd-testnet.srvs.vnodesv.net/rpc/health? | jq"
echo -e "    curl -s https://meme.srvs.vnodesv.net/rpc/health? | jq"
echo -e "${CYN}══════════════════════════════════════════════════════${RST}"
echo ""
