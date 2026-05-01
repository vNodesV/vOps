#!/usr/bin/env python3
"""
toml-upgrade.py — Surgical patch for vOps infra TOML files on the control VM.

Fixes applied
─────────────
qc1.toml:
  • [host].ssh_key_path:        .vprox  → .vOps  (wrong key was causing QC hypervisor dial to fail)
  • cheqd_testnet / memeQc:     key_path .vprox → .vOps
  • jarvis + crypWatch:         add user = 'vnodesv' + key_path (were empty → SSH guard skips them)
  • www VM:                     host 127.0.0.1 → 10.0.0.65  (vOps must not SSH to itself via loopback)
  • all VMs:                    host_ref = 'qc.vnodesv.net', datacenter = 'QC1'

rbx1.toml:
  • all 5 RBX VMs:              proxy_jump_host = 'rbx.vnodesv.net'  (QC→RBX must go via vRack)
  • all 5 RBX VMs:              host_ref = 'rbx.vnodesv.net', datacenter = 'RBX1'

Usage
─────
  make toml-upgrade              # SSH to www.qc and run this script
  make toml-upgrade INFRA_HOST=user@other-host
  ssh www.qc python3 - < scripts/toml-upgrade.py   # manual run
"""

import os
import shutil
from datetime import datetime

CFG = os.path.expanduser("~/.vOps/config/infra")
TS  = datetime.now().strftime("%Y%m%d_%H%M%S")

H  = "\033[1;36m"
OK = "\033[1;32m"
WN = "\033[1;33m"
RS = "\033[0m"


def patch(filename: str, subs: list[tuple[str, str]]) -> None:
    path   = os.path.join(CFG, filename)
    backup = f"{path}.bak_{TS}"

    if not os.path.exists(path):
        print(f"  {WN}⚠  {filename} not found — skipped{RS}")
        return

    shutil.copy2(path, backup)

    with open(path) as fh:
        original = fh.read()

    content = original
    applied = []
    for old, new in subs:
        if old in content:
            content = content.replace(old, new)
            applied.append(old)

    if content == original:
        print(f"  ○  {filename}  — already up to date (no changes)")
        os.remove(backup)
        return

    with open(path, "w") as fh:
        fh.write(content)

    print(f"  {OK}✓{RS}  {filename}  — {len(applied)} substitution(s)  "
          f"[backup: {os.path.basename(backup)}]")
    for item in applied:
        print(f"       · {item!r}")


print(f"\n{H}── vOps infra TOML upgrade ──────────────────────────────────────{RS}")

patch("qc1.toml", [
    # SSH key: .vprox → .vOps  (host section)
    (
        "ssh_key_path = '/home/vnodesv/.vprox/secret/vops_ssh_key'",
        "ssh_key_path = '/home/vnodesv/.vOps/secret/vops_ssh_key'",
    ),
    # SSH key: .vprox → .vOps  (cheqd_testnet + memeQc VM key_path)
    (
        "key_path = '/home/vnodesv/.vprox/secret/vops_ssh_key'",
        "key_path = '/home/vnodesv/.vOps/secret/vops_ssh_key'",
    ),
    # Grouping: host_ref + datacenter for all VMs (only empty strings are affected)
    ("host_ref = ''",    "host_ref = 'qc.vnodesv.net'"),
    ("datacenter = ''",  "datacenter = 'QC1'"),
    # www VM: fix self-dial — loopback → www-qc LAN IP
    ("host = '127.0.0.1'", "host = '10.0.0.65'"),
    # jarvis + crypWatch: add missing credentials
    ("user = ''",      "user = 'vnodesv'"),
    ("key_path = ''",  "key_path = '~/.vOps/secret/vops_ssh_key'"),
])

patch("rbx1.toml", [
    # All RBX VMs: ProxyJump via vRack (QC 10.1.0.5 → RBX 10.1.0.3)
    ("proxy_jump_host = ''", "proxy_jump_host = 'rbx.vnodesv.net'"),
    # Grouping: host_ref + datacenter for all VMs
    ("host_ref = ''",    "host_ref = 'rbx.vnodesv.net'"),
    ("datacenter = ''",  "datacenter = 'RBX1'"),
])

print(f"\n  {OK}Done.{RS}  Restart vOps to reload config:\n"
      f"    sudo systemctl restart vOps\n")
