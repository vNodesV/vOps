# vOps CLI Flags Guide

Authoritative guide for the `vops` command-line interface and its embedded `vprox` subcommand.

## Commands

### `vops start`
Start vOps server (foreground). Logs to stdout.

### `vops start -d` / `vops start --daemon`
Start via systemd service (`sudo service vOps start`).

### `vops stop`
Stop vOps service (`sudo service vOps stop`).

### `vops restart`
Restart vOps service (`sudo service vOps restart`).

### `vops ingest`
Run one-shot archive ingest and exit.

### `vops status`
Show database stats and exit.

### `vops vprox <subcommand>`
Manage the embedded vProx proxy server. See [vprox subcommand reference](#vprox-subcommand-reference) below.

---

## Invocation style

Use long flags with a double dash:

- `vops --help`
- `vops --validate`
- `vops --dry-run --verbose`

> Compatibility note: Go's flag parser still accepts single-dash form (`-flag`), but project docs standardize on `--flag`.

---

## Global flags

| Flag | Default | Description |
|---|---|---|
| `--home PATH` | `$VOPS_HOME` or `~/.vOps` | Override vOps home directory |
| `--config PATH` | — | Override config file path |
| `-p`, `--port PORT` | from `vops.toml` | Override web server listen port |
| `-q`, `--quiet` | false | Suppress non-essential output |
| `-v`, `--verbose` | false | Verbose log output |
| `--version` | — | Print version and exit |
| `-h`, `--help` | — | Print usage |

Examples:
- `vops --home /srv/vops`
- `vops --home /tmp/vops-dev`

---

## One-shot flags

| Flag | Description |
|---|---|
| `-A`, `--list-archives` | List ingested archives with event counts |
| `-a`, `--list-accounts` | List IP accounts (top 50, by last_seen) |
| `-t`, `--list-threats` | List flagged IPs sorted by threat score desc |
| `-e`, `--enrich <ip>` | Enrich an IP via all intel sources and exit |
| `-x`, `--purge-cache <ip\|all>` | Clear intel cache (one IP or all) and exit |
| `-V`, `--validate` | Validate `vops.toml` and exit |
| `-i`, `--info` | Show resolved config summary and exit |
| `-n`, `--dry-run` | Load config + open DB, verify, exit without starting |

---

## Runtime flags (`start`)

| Flag | Description |
|---|---|
| `-d`, `--daemon` | Start as background daemon (`sudo service vOps start`) |
| `-W`, `--no-watch` | Disable archive file watcher |
| `-E`, `--no-enrich` | Disable intel auto-enrichment worker |
| `-w`, `--watch-interval N` | Override `watch_interval_sec` |

---

## Practical command sets

### Service management
- `vops start` — foreground
- `vops start -d` — daemon (systemd service)
- `vops stop` — stop service
- `vops restart` — restart service

### Pre-deploy check
- `vops --validate`
- `vops --dry-run --verbose`

### Inspect resolved runtime
- `vops --info --verbose`

### Intelligence
```bash
vops --enrich 1.2.3.4       # run VT + AbuseIPDB + Shodan on IP
vops --purge-cache 1.2.3.4  # clear cached score for IP
vops --list-threats         # print IPs with score >= 50
```

---

## vprox subcommand reference {#vprox-subcommand-reference}

`vprox` manages the embedded reverse proxy and is invoked as a subcommand of `vops` — there is no standalone top-level `vprox` command in normal operation.

### Commands

| Command | Description |
|---|---|
| `vops vprox start` | Start vProx in the foreground (blocks until Ctrl-C) |
| `vops vprox start -d` | Start vProx as a background systemd daemon |
| `vops vprox stop` | Stop the vProx systemd service |
| `vops vprox restart` | Restart the vProx systemd service |
| `vops vprox status` | Show service state, uptime, and config paths |
| `vops vprox view` | Follow vProx service logs (`journalctl -u vProx -f`) |

Global flags apply: `--home`, `--verbose`, `--quiet`.

### Practical command sets

```bash
vops vprox start -d    # daemon
vops vprox stop        # stop
vops vprox restart     # restart
vops vprox status      # show stats
vops vprox view        # tail logs
```

---

## Advanced: standalone vProx binary (dev/diagnostics only)

The proxy is also buildable as its own binary (`make build-vprox` → `.build/vProx`, `go run ./cmd/vprox`) for local development and diagnostics outside the systemd-managed deployment. It exposes a much larger flag set than the `vops vprox` wrapper above — useful for one-off config validation, rate-limit overrides, and manual backups without touching the production service.

> Production deployments should prefer `vops vprox <subcommand>` for day-to-day service control. The flags below only apply when invoking `./cmd/vprox`/`.build/vProx` directly.

### Configuration paths

- `--home string` — override runtime home (`VPROX_HOME`), defaulting to `~/.vOps` if unset
- `--config string` — override config directory (relative paths resolve under `--home`)
- `--chains string` — override chains directory (relative paths resolve under `--home`)
- `--log-file string` — override main log file path (default `<home>/data/logs/main.log`)
- `--addr string` — HTTP listen address (default `:3000`, env fallback `VPROX_ADDR`)

### Startup / run modes

- `--help` — show usage and available flags
- `--version` — print version and exit
- `--with-vops` — start vOps log analyzer alongside the proxy in integrated mode (same process, coordinated shutdown)
- `--validate` — load and validate configuration, then exit
- `--info` — load configuration, print runtime summary, and exit
- `--dry-run` — load everything but do not start server

### Rate limiting overrides

CLI values override env values for this run. Precedence: CLI flags > environment variables > built-in defaults.

- `--rps float` — override default requests-per-second (env `VPROX_RPS`, default `25`)
- `--burst int` — override default burst capacity (env `VPROX_BURST`, default `100`)
- `--disable-auto` — disable auto-quarantine behavior
- `--auto-rps float` — override auto-quarantine penalty RPS (env `VPROX_AUTO_RPS`, default `1`)
- `--auto-burst int` — override auto-quarantine penalty burst (env `VPROX_AUTO_BURST`, default `1`)

Example: `VPROX_RPS=30 ./.build/vProx start --rps 100` → effective RPS is `100`.

### Backup controls

- `--new-backup` — run one backup cycle and exit (no proxy server start)
- `--list-backup` — list existing backup archives and exit
- `--backup-status` — show backup scheduler status (automation state, next ETA, archive count) and exit
- `--disable-backup` — disable automatic backup loop at startup (does not affect manual `--new-backup`)
- `--reset_count` / `--reset-count` — reset persisted access counters before backup execution

### Shell completion

```bash
./.build/vProx completion bash   >> ~/.bash_completion
./.build/vProx completion zsh    >> ~/.zshrc
./.build/vProx completion fish   > ~/.config/fish/completions/vprox.fish
```

### Verbosity / diagnostics

- `--verbose` — enable extra startup diagnostics and override logs (pairs well with `--info` / `--dry-run`)
- `--quiet` — flag is present, but current implementation still logs to configured log file; treat as reserved/minimal-effect in the current build
