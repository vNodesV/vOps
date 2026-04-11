# vProx Project State
<!-- Managed by jarvis6.0 — append entries, never delete history -->
<!-- NOTE: File reconstructed 2026-04-11 after write corruption (UnicodeError on surrogate pairs) -->

---

## Session: 2026-02-27 (develop branch)

### Active Branch
develop — HEAD: 54369c8

### Architecture Summary
- vProx: Go reverse proxy for Cosmos SDK nodes (RPC/REST/gRPC/WS). Binary: vprox.
- vLog: Standalone log archive analyzer with CRM-like IP accounts, intel enrichment, OSINT. Binary: vlog.
- Config: VPROX_HOME/config/vlog/vlog.toml, config/chains/*.toml, config/ports.toml
- DB: SQLite via modernc.org/sqlite (pure Go, WAL mode). Tables: ip_accounts, request_events, ratelimit_events, ingested_archives, intel_cache.
- Intel: VirusTotal v3 + AbuseIPDB v2 + Shodan /shodan/host/{ip} + ip-api.com

### Completed This Session
Commit 422a208 — Block Button + UFW:
- internal/vlog/ufw/ufw.go: Block/Unblock/IsAvailable; net.ParseIP guard; exec.Command separate args
- internal/vlog/db/schema.go: blocked_ips table
- internal/vlog/web/handlers.go: handleAPIBlock (POST) + handleAPIUnblock (DELETE)
- Makefile: make ufw-vlog target -> /etc/sudoers.d/vlog
- Security: net.ParseIP + exec.Command separate args + sudoers exact command restriction

Commit 422a208 — Shodan ns3777k Migration:
- go.mod: github.com/ns3777k/go-shodan/v4 v4.2.0
- internal/vlog/intel/shodan.go: library replaces hand-rolled HTTP
- ShodanResult gains Vulns + Services fields

Commit f84c836 — OSINT ip-api.com:
- internal/vlog/intel/osint.go: ip-api.com (free, no key, 45 req/min)
- account.html: Account Details first, Threat Intelligence below; two-column detail-grid

---

## Session: 2026-04-06 19:30Z — vLog_v1.4.5 Settings bugs + virsh hypervisor scan

### Branch
vLog_v1.4.5 — HEAD at a1ebe28

### Completed

Commit 2cb987b — fix(settings): fleet scan 405 + SSH pub key lookup
Bug 1 — Fleet scan 405: POST /api/v1/fleet/vms/scan was inside fleet != nil guard; fix: register unconditionally
Bug 2 — SSH pub key not found: now resolves in priority order:
  1. ~/.vprox/secret/vops_ssh_key.pub
  2. cfg.VOps.Push.Defaults.KeyPath + ".pub"
  3. Derive public key in-memory from private key via ssh.ParsePrivateKey

Commit a1ebe28 — fix(settings): SSH key field names, webserver VM filter, virsh hypervisor scan
Bug 3 — "Key written to: undefined": backend returned pub_key/path; frontend expected public_key/private_key_path
Bug 4 — www-qc (webserver VM) shown in Chain Status: strings.EqualFold(vm.Type, "webserver") early continue in pollAll()
Bug 5 — Scan discovered nothing: new HandleHypervisorScan handler:
  1. SSH to each cfg.Hosts[].LanIP
  2. virsh list --all -> parse domain names + states
  3. virsh domifaddr <name> -> extract LAN IP
  4. SSH to VM: cat /proc/loadavg + free -m metrics
  Settings.tsx: added Hypervisor Discovery section table

Strategic decision: vAgent architecture scoped for v1.5.0 (NOT v1.4.5)

### Verification
go build ./... pass, go vet ./... pass, npm run build 648 modules clean

---

## Session: 2026-04-11 — vOps v1.1.0 Build Conventions + Sudoers

### Branch
vOps_v1.1.0 — HEAD: c1bc492

### Goal
Establish clean build/deploy workflow; fix sudoers gap causing password prompts during make build-vops.

### Completed

Commit a4fd833: vOps v1.1.0 theme+nav redesign.
Branch vOps_v1.1.0 created from vOps_v1.0.0. Top horizontal nav bar. Three CSS themes:
vthemedgr (green/dark), vthemedbl (dark-blue), vthemedlite (light-blue/gray).
Logo: v[O]ps 3D metallic, O = red crosshair scope. Build 0.0.1.

Commit 209499d: compile-first in build-vops.
go build runs while service is live; stop/copy/start only after binary ready; ~1-2s downtime.

Commit 761d63b: bump to build 0.0.2 + first push vOps_v1.1.0 to origin.

Commit 58e6771: npm audit fix in Makefile frontend target. Build 0.0.3.
Inserts npm audit fix between npm install and npm run build.

Commit c1bc492: sudoers dual-rule + stale vlog cleanup. Build 0.0.4.
Root cause: build-vops calls sudo systemctl stop/start vOps but only sudoers rule was for service vProx.
Fix: /etc/sudoers.d/vprox now writes TWO lines:
  1. NOPASSWD /usr/sbin/service vProx start|stop|restart
  2. NOPASSWD /usr/bin/systemctl stop|start|restart vOps
Idempotent: checks both lines present; shows diff + prompts if missing.
Stale /etc/sudoers.d/vlog cleanup prompt in make systemd.
build-vops: pre-flight warning if sudoers not configured.
make install (line 136) already calls make systemd -> new installs get rules automatically.

### Deploy Workflow (confirmed)
git pull origin vOps_v1.1.0
git fetch --all
git checkout <commit>
make build-vops
# First install or sudoers update:
make systemd

### Sudoers File Map
/etc/sudoers.d/vprox: make systemd; USER; service vProx + systemctl vOps
/etc/sudoers.d/vops: make ufw; VOPS_USER=vops; ufw + apt-get
/etc/sudoers.d/vlog: stale; prompts for removal in make systemd

### Open Bugs (not yet fixed)
1. Unicode emoji: VM page titles print raw escape sequences instead of emoji chars
2. SSE 404: /vms Fleet/Patches Upgrade - frontend URL vs registered route mismatch
3. Apache 403: chain save - ModSecurity OWASP CRS blocking POST JSON payload
4. Settings RPC/REST: http:// / https:// rejected with permission denied; tcp:// works - SSRF guard
5. Cosmos data (peers, validator, import) likely broken due to bug 4

### Build State
Branch: vOps_v1.1.0, Release: 1.1.0, Build: 0.0.4
657 frontend modules, ~863KB JS (gzip ~237KB)
4 commits pushed to origin/vOps_v1.1.0

### Next Steps
1. Fix Unicode emoji rendering in VM page titles
2. Fix SSE 404 for Upgrade endpoint (trace frontend URL vs backend route)
3. Fix Apache 403 on chain save (ModSecurity SecRuleEngine Off or SecRuleRemoveById)
4. Fix Settings SSRF guard to allow private http://127.0.0.1:xxxx addresses
5. Clarify SSH vs qemu-agent for VM power operations

---

## Session: 2026-04-11 21:25Z — agentupgrade + save (checkpoint)

### Branch
vOps_v1.1.0 — HEAD: c1bc492 (build 0.0.4)

### Note: Plan / Branch Mismatch
plan.md loaded from imported session e6e13a7b contains vOps_v1.0.0 master plan (Sprint v0.2.0, build 0.1.7).
Active git branch is vOps_v1.1.0. These are parallel lines of work:
  - vOps_v1.1.0: theme/design redesign + build tooling (current active)
  - vOps_v1.0.0 Sprint v0.2.0: module consolidation (VM Manager tabs, Services rename, etc.) — planned but not yet started

### agentupgrade Assessment
Skills: 31 project skills installed (.github/skills/) + full plugin suite (awesome-copilot, go-mcp, etc.)
New skills in registry (not yet installed): agent-owasp-compliance, agent-supply-chain, add-educational-comments
Assessment: No critical gaps for current sprint. Skills set is comprehensive.
Build version rule: cmd/vops/VERSION = 0.0.4, schema x.y.z, increment z+1 on each successful build.

### Skill Inventory (31 project skills)
agent-governance, agentic-eval, architecture-blueprint-generator, autoresearch, breakdown-epic-arch,
breakdown-plan, cloud-design-patterns, codeql, conventional-commit, copilot-instructions-blueprint-generator,
create-architectural-decision-record, create-implementation-plan, create-specification, create-technical-spike,
debian-linux-triage, dependabot, devops-rollout-plan, documentation-writer, doublecheck,
excalidraw-diagram-generator, gdpr-compliant, generate-custom-instructions-from-codebase, gh-cli, git-commit,
git-flow-branch-creator, github-issues, model-recommendation, polyglot-test-agent, refactor,
sql-code-review, sql-optimization

### Open Bugs (vOps_v1.1.0 — not yet fixed)
1. Unicode emoji: VM page titles print raw escape sequences (\uD83D\uDE80) instead of emoji
2. SSE 404: Upgrade endpoint URL mismatch between frontend and registered route
3. Apache 403: ModSecurity OWASP CRS blocks POST JSON on chain save
4. Settings SSRF guard: http://127.0.0.1:port rejected — only tcp:// works
5. VM upgrade (apt via SSH): likely broken due to ProxyJump or route issue

### Session Context (restored from 107-vops-v1-1-0-build-conventions.md)
All four commits pushed to origin/vOps_v1.1.0. Deploy workflow confirmed and documented.
Sudoers gap root cause resolved. make systemd idempotent. make install calls make systemd (auto on new clients).

### Next Action
User asked SSH/qemu-agent question about VM power operations — this is the next investigation.
