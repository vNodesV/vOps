# 2026-05-14 — www.fr login fix + network tuning

## What changed and why

### 1. sshd PAM auth fix (login was broken)

**Root cause:** vOps PAM auth dials `127.0.0.1:<ssh_port>` using Go's `ssh.Password()` method.
www.fr's sshd `Match LocalPort 2222` block was missing `AuthenticationMethods password`,
so the global `AuthenticationMethods publickey` won — sshd rejected every password dial silently.

www.qc (working reference) had the correct 3-line Match block. www.fr's original patch only had 1 line.

**Fix applied** (run manually as sudo on www.fr):
```
# /etc/ssh/sshd_config — Match block corrected to:
Match LocalPort 2222
    PasswordAuthentication yes
    AuthenticationMethods password
    AllowUsers vnodesv
```

Script: `/tmp/fix_sshd_match.sh` (python3 sed replacement + sshd -t validation + systemctl restart ssh)

**Secondary finding:** brute-force lockout (`127.0.0.1`) had accumulated from pre-fix failed attempts.
Cleared by `sudo service vOps restart` (in-memory map, no persistence).

### 2. TCP stack + DNS tuning

**Script:** `/tmp/tune_net_www_fr.sh` — idempotent, backs up modified files, before/after timing.

**Persistent file written:** `/etc/sysctl.d/99-vops-net.conf`
```ini
net.core.rmem_max = 16777216          # was 212992 (208 KB cap)
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr  # was cubic; module loaded + persisted in modules-load.d
net.ipv4.tcp_fastopen = 3              # was 1 (client-only)
net.core.netdev_budget = 600           # was 300
net.core.netdev_max_backlog = 5000     # was 1000 (contributing to 280K enp1s0 drops)
```

**DNS fix:** `/etc/systemd/resolved.conf` — added `FallbackDNS=1.1.1.1 8.8.8.8` + `Cache=yes`

**Measured results (cosmos.directory):**

| Metric | Before | After |
|---|---|---|
| congestion | cubic | BBR |
| rmem/wmem cap | 208 KB | 16 MB (79×) |
| TCP Fast Open | client-only | both directions |
| netdev_budget | 300 | 600 |
| max_backlog | 1,000 | 5,000 |
| DNS cold | 33ms | 19ms (−43%) |
| TTFB | 127ms | 113ms (−11%) |

**Known follow-up:** warm DNS still ~35ms (should be <1ms from cache).
Root cause: netplan/systemd-network is injecting duplicate `213.186.33.99` entries into
resolved's upstream list at the interface level, overriding resolved.conf. Non-blocking.
Fix would require editing `/etc/netplan/*.yaml` to remove per-interface DNS overrides.

## Files / symbols touched

**Remote (www.fr VM):**
- `/etc/ssh/sshd_config` — Match LocalPort 2222 block corrected
- `/etc/sysctl.d/99-vops-net.conf` — created (TCP tuning)
- `/etc/modules-load.d/bbr.conf` — created (tcp_bbr persistence)
- `/etc/systemd/resolved.conf` — FallbackDNS + Cache=yes added

**No vOps codebase changes** — all fixes are infrastructure-only on the www.fr host.

## Verification commands

```bash
# Confirm sshd login works
curl -sk -X POST https://rbx.vnodesv.net/login \
  -d 'username=vnodesv&password=<pass>' -w '%{http_code}'
# Expect 302 redirect (not 401/429)

# Confirm TCP settings survived reboot
ssh www.fr "sysctl net.ipv4.tcp_congestion_control net.core.rmem_max"
# Expect: bbr / 16777216

# Confirm BBR module loads at boot
ssh www.fr "lsmod | grep bbr"
```

## Known follow-ups

- [ ] Warm DNS cache still inconsistent (~35ms) — fix requires editing netplan DNS config
- [ ] Apply same network tuning to www.qc (currently untouched — different kernel/config baseline)
- [ ] Consider adding logging to `pamCheckCredentials` for SSH dial errors (currently silent)
