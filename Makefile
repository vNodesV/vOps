SHELL := /bin/bash

APP_NAME := vProx
BUILD_SRC := ./cmd/vprox
BUILD_DIR := .build
BUILD_OUT := $(BUILD_DIR)/$(APP_NAME)

VOPS_NAME  := vOps
VOPS_SRC   := ./cmd/vops
VOPS_BUILD := $(BUILD_DIR)/$(VOPS_NAME)

# vOps semantic version — source of truth is cmd/vops/VERSION.
# Use `make bump-patch|bump-minor|bump-major` to increment before each push.
# Override on the command line: make build-vops VOPS_VERSION=1.2.3
VOPS_VERSION  := $(shell cat cmd/vops/VERSION 2>/dev/null || echo "dev")
VOPS_COMMIT   := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
VOPS_BUILT    := $(shell date -u +%Y-%m-%d)
VOPS_LDFLAGS  := -X main.version=$(VOPS_VERSION) -X main.commit=$(VOPS_COMMIT) -X main.buildDate=$(VOPS_BUILT)
# System user that owns the vOps service (overridable: make service-vops VOPS_USER=myuser).
# Run `make system-user-vops` once to create this user before enabling the service.
VOPS_USER  ?= vops

VPROX_HOME := $(HOME)/.vProx
VOPS_HOME  := $(HOME)/.vOps
DATA_DIR := $(VPROX_HOME)/data
LOG_DIR := $(DATA_DIR)/logs
CFG_DIR := $(VPROX_HOME)/config
CHAINS_DIR := $(VPROX_HOME)/chains
INTERNAL_DIR := $(VPROX_HOME)/internal
ARCHIVE_DIR := $(LOG_DIR)/archives
SERVICE_DIR := $(VPROX_HOME)/service
SERVICE_PATH := $(SERVICE_DIR)/vProx.service
VOPS_SERVICE := $(SERVICE_DIR)/vOps.service
GEO_DIR := $(DATA_DIR)/geolocation
SAMPLES_DIR := $(VPROX_HOME)/.samples
DIR_LIST := $(DATA_DIR) $(LOG_DIR) $(CFG_DIR) $(CFG_DIR)/chains $(CFG_DIR)/backup \
            $(CFG_DIR)/vprox $(CFG_DIR)/vprox/nodes \
            $(INTERNAL_DIR) $(ARCHIVE_DIR) $(SERVICE_DIR) $(GEO_DIR) \
            $(VOPS_HOME)/config/vops $(VOPS_HOME)/config/infra $(VOPS_HOME)/config/fleet \
            $(VOPS_HOME)/config/vops/chains \
            $(SAMPLES_DIR) $(SAMPLES_DIR)/chains $(SAMPLES_DIR)/backup \
            $(VOPS_HOME)/.samples/vops $(VOPS_HOME)/.samples/infra $(VOPS_HOME)/.samples/fleet \
            $(SAMPLES_DIR)/vprox $(SAMPLES_DIR)/vprox/nodes $(VOPS_HOME)/.samples/vops/chains

# Sample file revision — format: r{major}_{MMDDYY}_{seq}
# Increment {seq} for multiple revisions on the same day; reset to 0 on new date.
# Injected into the "# rev: {{SAMPLE_REV}}" placeholder in every .sample file at install/refresh time.
SAMPLE_REV := r5_031126_0

# GeoLocation database — bundled in assets/_geo/, extracted to user data dir
GEO_DB_SRC := assets/_geo/ip2location.mmdb.gz
GEO_DB_DST := $(GEO_DIR)/ip2location.mmdb

ENV_FILE := $(VPROX_HOME)/._env

# Validate Go environment
GOPATH := $(shell go env GOPATH)
GOROOT := $(shell go env GOROOT)
# Prefer GOBIN if explicitly set — avoids double-bin when GOPATH already ends in /bin on some servers.
_RAW_GOBIN := $(shell go env GOBIN 2>/dev/null)
GOPATH_BIN := $(if $(_RAW_GOBIN),$(_RAW_GOBIN),$(GOPATH)/bin)

# On servers where GOROOT points to a manually installed (potentially broken)
# Go tree, the module-cache toolchain has a clean stdlib. Prefer it when present,
# but ONLY if its version matches the active `go` binary — prevents stdlib mismatch
# when multiple toolchains are cached (e.g. 1.25.7 active, 1.26.2 cached → reject).
# Falls back to the current GOROOT transparently (no persistent state is changed).
_GO_VERSION       := $(shell go version | awk '{print $$3}')
_TOOLCHAIN_GOROOT := $(shell find $(GOPATH)/pkg/mod/golang.org -maxdepth 1 -name "toolchain@v0.0.1-$(_GO_VERSION).*" 2>/dev/null | head -1)
EFFECTIVE_GOROOT  := $(if $(_TOOLCHAIN_GOROOT),$(_TOOLCHAIN_GOROOT),$(GOROOT))

# Public targets only — internal helpers (_dirs, _geo, config-*, _env, _frontend, …) are intentionally
# excluded from .PHONY so they don't pollute tab-completion.
.PHONY: all help install build build-vops release-vops \
        clean ufw reset-services service-vops system-user-vops \
        bump-patch bump-minor bump-major

all: help

## ─── Public targets ──────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  vOps — build and install targets"
	@echo ""
	@echo "  make install          Build + install vOps: binary, config, service"
	@echo "  make build            Build vOps binary → .build/vOps"
	@echo "  make build-vops       Build vOps binary → .build/vOps (rebuilds frontend if Node available)"
	@echo "  make reset-services   Stop + remove stale service units (vProx, vLog) before fresh deploy"
		@echo "  make release-vops     Cross-compile linux/amd64 → vops-linux-amd64, commit + push"
	@echo "  make clean            Remove local build artifacts"
	@echo "  make ufw              Passwordless UFW + apt sudoers for vOps"
	@echo ""
	@echo "  Version management (vOps):"
	@echo "    make bump-patch       0.0.1 → 0.0.2  (bug fixes / small improvements)"
	@echo "    make bump-minor       0.0.x → 0.1.0  (new features, backward-compatible)"
	@echo "    make bump-major       0.x.y → 1.0.0  (breaking changes / major milestones)"
	@echo "    Current version: $$(cat cmd/vops/VERSION 2>/dev/null || echo 'unknown')"
	@echo ""
	@echo ""
	@echo "  Paths (install):"
	@echo "    Binary:    $(GOPATH_BIN)/$(VOPS_NAME)"
	@echo "    Config:    $(VOPS_HOME)/config/"
	@echo "    Data:      $(DATA_DIR)/"
	@echo "    Samples:   $(VOPS_HOME)/.samples/"
	@echo "  SSH control plane (fleet) is installed automatically."
	@echo "  Add VMs to:    $(VOPS_HOME)/config/infra/{datacenter}.toml"
	@echo "  Add chains to: $(VPROX_HOME)/config/chains/{chain}.toml"
	@echo ""

## Full install — build + config + service for vOps.
## Phases: validate-go → dirs → geo → config → env → samples → frontend → build → symlinks → service
## Each optional step (symlinks, service registration, sudoers) prompts for confirmation.

install: _validate-go _dirs _geo _config _config-vops _config-vprox _config-modules _env _samples-fleet _frontend
	@echo ""
	@echo "── Building vOps ────────────────────────────────────────────────────────"
	GOROOT="$(EFFECTIVE_GOROOT)" go build -ldflags "$(VOPS_LDFLAGS)" -o "$(GOPATH_BIN)/$(VOPS_NAME)" "$(VOPS_SRC)"
	@echo "✓ $(VOPS_NAME) → $(GOPATH_BIN)/$(VOPS_NAME)"
	@echo ""
	@echo "── Lowercase aliases in GOPATH/bin ──────────────────────────────────────"
	@ln -sf "$(GOPATH_BIN)/$(VOPS_NAME)" "$(GOPATH_BIN)/vops"
	@echo "✓ vops  → $(VOPS_NAME)  (lowercase alias)"
	@echo ""
	@echo "── /usr/local/bin symlinks (optional, requires sudo) ────────────────────"
	@read -p "Create /usr/local/bin/{$(VOPS_NAME),vops} symlinks? (y/n) " -n 1 -r; echo ""; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		sudo ln -sf "$(GOPATH_BIN)/$(VOPS_NAME)" "/usr/local/bin/$(VOPS_NAME)"; \
		sudo ln -sf "$(GOPATH_BIN)/$(VOPS_NAME)" "/usr/local/bin/vops"; \
		echo "✓ /usr/local/bin/{$(VOPS_NAME),vops} created"; \
	else \
		echo "✓ Skipped — run from $(GOPATH_BIN)/ or add it to PATH."; \
	fi
	@echo ""
	@echo "── Systemd services ─────────────────────────────────────────────────────"
	@$(MAKE) --no-print-directory service-vops
	@echo ""
	@echo "════════════════════════════════════════════════════════"
	@echo "  ✓ Installation complete"
	@echo "────────────────────────────────────────────────────────"
	@echo "  Binary:    $(GOPATH_BIN)/$(VOPS_NAME)"
	@echo "  Config:    $(VOPS_HOME)/config/"
	@echo "  Data:      $(DATA_DIR)/"
	@echo "  Samples:   $(VOPS_HOME)/.samples/"
	@echo "────────────────────────────────────────────────────────"
	@echo "  Next steps:"
	@echo "    1. Edit $(VOPS_HOME)/config/vops/vops.toml  — set api_key"
	@echo "    2. Edit $(VOPS_HOME)/config/infra/*.toml    — add VMs (fleet)"
	@echo "    3. vOps start                               — start vOps"
	@echo "    4. make ufw                                 — UFW block/unblock (optional)"
	@echo "════════════════════════════════════════════════════════"

## Validate Go environment

_validate-go:
	@echo "Validating Go environment..."
	@if [[ -z "$(GOROOT)" ]]; then \
		echo "ERROR: GOROOT is not set. Please ensure Go is properly installed."; \
		exit 1; \
	fi
	@if [[ -z "$(GOPATH)" ]]; then \
		echo "ERROR: GOPATH is not set. Please ensure Go is properly configured."; \
		exit 1; \
	fi
	@echo "✓ GOROOT: $(GOROOT)"
	@if [[ "$(EFFECTIVE_GOROOT)" != "$(GOROOT)" ]]; then \
		echo "  ↳ using clean toolchain: $(EFFECTIVE_GOROOT)"; \
	fi
	@echo "✓ GOPATH: $(GOPATH)"
	@echo "✓ Go version: $$(go version)"

## Create required folders under $HOME/.vProx

_dirs:
	@echo "Inspecting directory structure..."
	@for dir in $(DIR_LIST); do \
		if [[ ! -d "$$dir" ]]; then \
			mkdir -p "$$dir"; \
			echo "✓ $$dir created..."; \
		else \
			echo "✓ $$dir already exists"; \
		fi; \
	done
	

## Install GEO DB — decompress from bundled .gz

_geo:
	@echo "Installing GeoLocation database..."
	@if [[ ! -f "$(GEO_DB_SRC)" ]]; then \
		echo "WARNING: GEO DB not found at $(GEO_DB_SRC)"; \
		echo "Geolocation features will be disabled until a database is provided."; \
	else \
		mkdir -p "$(GEO_DIR)"; \
		gunzip -c "$(GEO_DB_SRC)" > "$(GEO_DB_DST)"; \
		echo "✓ Installed GEO DB to $(GEO_DB_DST)"; \
	fi

## Create ._env if missing

_env:
	@echo "Setting up environment configuration..."
	@if [[ ! -f "$(ENV_FILE)" ]]; then \
		echo "# Geolocation database paths" > "$(ENV_FILE)"; \
		echo "IP2LOCATION_MMDB=$(GEO_DB_DST)" >> "$(ENV_FILE)"; \
		echo "GEOLITE2_COUNTRY_DB=" >> "$(ENV_FILE)"; \
		echo "GEOLITE2_ASN_DB=" >> "$(ENV_FILE)"; \
		echo "" >> "$(ENV_FILE)"; \
		echo "# Rate limiting" >> "$(ENV_FILE)"; \
		echo "VPROX_RPS=25" >> "$(ENV_FILE)"; \
		echo "VPROX_BURST=100" >> "$(ENV_FILE)"; \
		echo "VPROX_AUTO_ENABLED=true" >> "$(ENV_FILE)"; \
		echo "VPROX_AUTO_THRESHOLD=120" >> "$(ENV_FILE)"; \
		echo "VPROX_AUTO_WINDOW_SEC=10" >> "$(ENV_FILE)"; \
		echo "VPROX_AUTO_RPS=1" >> "$(ENV_FILE)"; \
		echo "VPROX_AUTO_BURST=1" >> "$(ENV_FILE)"; \
		echo "VPROX_AUTO_TTL_SEC=900" >> "$(ENV_FILE)"; \
		echo "" >> "$(ENV_FILE)"; \
		echo "# Server" >> "$(ENV_FILE)"; \
		echo "VPROX_ADDR=:3000" >> "$(ENV_FILE)"; \
		echo "✓ Created $(ENV_FILE)"; \
	else \
		echo "✓ $(ENV_FILE) already exists"; \
	fi

## Install live _config defaults (services.toml → ports.toml fallback, backup.toml) — samples handled by _samples-fleet

_config: _dirs _config-modules
	@if [[ ! -f "$(CFG_DIR)/chains/services.toml" && ! -f "$(CFG_DIR)/chains/ports.toml" && ! -f "$(CFG_DIR)/ports.toml" ]]; then \
		echo "Creating default services.toml..."; \
		if [[ -f ".samples/chains/services.sample" ]]; then \
			sed "s/{{SAMPLE_REV}}/$(SAMPLE_REV)/" ".samples/chains/services.sample" > "$(CFG_DIR)/chains/services.toml"; \
			echo "✓ Installed services.toml → $(CFG_DIR)/chains/services.toml"; \
		elif [[ -f ".samples/chains/ports.sample" ]]; then \
			sed "s/{{SAMPLE_REV}}/$(SAMPLE_REV)/" ".samples/chains/ports.sample" > "$(CFG_DIR)/chains/ports.toml"; \
			echo "✓ Installed ports.toml → $(CFG_DIR)/chains/ports.toml (legacy fallback)"; \
		else \
			{ \
				echo "# Default ports for all chains (override per-chain with default_ports = false)"; \
				echo "rpc      = 26657"; \
				echo "rest     = 1317"; \
				echo "grpc     = 9090"; \
				echo "grpc_web = 9091"; \
				echo "api      = 1317"; \
			} > "$(CFG_DIR)/chains/ports.toml"; \
			echo "✓ Created $(CFG_DIR)/chains/ports.toml (minimal fallback)"; \
		fi \
	else \
		echo "✓ Port/service _config already exists (services.toml or ports.toml)"; \
	fi
	@if [[ ! -f "$(CFG_DIR)/backup/backup.toml" ]]; then \
		if [[ -f ".samples/backup/backup.sample" ]]; then \
			sed "s/{{SAMPLE_REV}}/$(SAMPLE_REV)/" ".samples/backup/backup.sample" > "$(CFG_DIR)/backup/backup.toml"; \
			echo "✓ Installed backup.toml → $(CFG_DIR)/backup/backup.toml"; \
		else \
			echo "NOTE: .samples/backup/backup.sample not found; skipping backup.toml install"; \
		fi \
	else \
		echo "✓ $(CFG_DIR)/backup/backup.toml already exists"; \
	fi

## Install proxy settings reference (settings.toml) — only sample, never overwrites live

_config-vprox: _dirs
	@mkdir -p "$(CFG_DIR)/vprox"
	@if [[ -f ".samples/vprox/settings.sample" ]]; then \
		sed "s/{{SAMPLE_REV}}/$(SAMPLE_REV)/" ".samples/vprox/settings.sample" > "$(CFG_DIR)/vprox/settings.sample"; \
		echo "✓ Installed proxy settings sample → $(CFG_DIR)/vprox/settings.sample"; \
		if [[ ! -f "$(CFG_DIR)/vprox/settings.toml" ]]; then \
			echo "  Copy to activate: cp $(CFG_DIR)/vprox/settings.sample $(CFG_DIR)/vprox/settings.toml"; \
		else \
			echo "✓ $(CFG_DIR)/vprox/settings.toml already exists"; \
		fi \
	else \
		echo "NOTE: .samples/vprox/settings.sample not found in repo; skipping"; \
	fi

## Overwrite ALL sample files in SAMPLES_DIR (~/.vProx/.samples/) — safe to run anytime; never touches live _config.
## When a sample already exists, it is archived to SAMPLES_DIR/archives/<old_rev>/<subfolder>/
## before the new version is written, so every prior revision is recoverable.
_samples-fleet:
	@mkdir -p \
		"$(SAMPLES_DIR)/chains"       "$(SAMPLES_DIR)/backup" \
		"$(SAMPLES_DIR)/vops"         "$(SAMPLES_DIR)/infra" \
		"$(SAMPLES_DIR)/fleet"        "$(SAMPLES_DIR)/vprox" \
		"$(SAMPLES_DIR)/vprox/nodes"  "$(SAMPLES_DIR)/vops/chains"
	@_rev="$(SAMPLE_REV)"; \
	_archive() { \
		local dst="$$1" sub="$$2" old_rev adir; \
		if [[ -f "$$dst" ]]; then \
			old_rev="$$(grep -m1 '^# rev:' "$$dst" 2>/dev/null | sed 's/.*# rev: *//' | tr -d '[:space:]')"; \
			old_rev="$${old_rev:-unknown}"; \
			adir="$(SAMPLES_DIR)/archives/$$old_rev/$$sub"; \
			mkdir -p "$$adir"; \
			mv "$$dst" "$$adir/$$(basename "$$dst")"; \
			echo "  ↳ archived → $$adir/$$(basename "$$dst")  [$$old_rev]"; \
		fi; \
	}; \
	_copy() { sed "s/{{SAMPLE_REV}}/$$_rev/" "$$1" > "$$2" && echo "✓ $$2  [$$_rev]"; }; \
	_archive "$(SAMPLES_DIR)/vops/vops.sample"          "vops";         _copy ".samples/vops/vops.sample"              "$(SAMPLES_DIR)/vops/vops.sample"; \
	_archive "$(SAMPLES_DIR)/chains/chain.sample"       "chains";       _copy ".samples/chains/chain.sample"           "$(SAMPLES_DIR)/chains/chain.sample"; \
	_archive "$(SAMPLES_DIR)/chains/ports.sample"       "chains";       _copy ".samples/chains/ports.sample"           "$(SAMPLES_DIR)/chains/ports.sample"; \
	_archive "$(SAMPLES_DIR)/chains/services.sample"    "chains";       _copy ".samples/chains/services.sample"        "$(SAMPLES_DIR)/chains/services.sample"; \
	_archive "$(SAMPLES_DIR)/backup/backup.sample"      "backup";       _copy ".samples/backup/backup.sample"          "$(SAMPLES_DIR)/backup/backup.sample"; \
	_archive "$(SAMPLES_DIR)/infra/infra.sample"        "infra";        _copy ".samples/infra/infra.sample"            "$(SAMPLES_DIR)/infra/infra.sample"; \
	_archive "$(SAMPLES_DIR)/vprox/settings.sample"     "vprox";        _copy ".samples/vprox/settings.sample"         "$(SAMPLES_DIR)/vprox/settings.sample"; \
	_archive "$(SAMPLES_DIR)/fleet/settings.sample"     "fleet";        _copy ".samples/fleet/settings.sample"         "$(SAMPLES_DIR)/fleet/settings.sample"; \
	_archive "$(SAMPLES_DIR)/vprox/nodes/vprox-node.sample" "vprox/nodes"; _copy ".samples/vprox/nodes/vprox-node.sample" "$(SAMPLES_DIR)/vprox/nodes/vprox-node.sample"; \
	_archive "$(SAMPLES_DIR)/vops/chains/vops-chain.sample" "vops/chains"; _copy ".samples/vops/chains/vops-chain.sample" "$(SAMPLES_DIR)/vops/chains/vops-chain.sample"
	@echo "Done. Samples refreshed — $(SAMPLE_REV). See $(SAMPLES_DIR)/"

## Install modules registry stub

_config-modules:
	@if [[ ! -f "$(CFG_DIR)/modules.toml" ]]; then \
		printf '# modules.toml — managed module registry\n# Use: vprox mod add <chain> <component>\n' \
			> "$(CFG_DIR)/modules.toml"; \
		echo "✓ Created modules registry → $(CFG_DIR)/modules.toml"; \
	else \
		echo "✓ $(CFG_DIR)/modules.toml already exists"; \
	fi

## Build vOps binary (default build target)
build: build-vops

## Build vProx binary to .build/vProx
## LEGACY — scheduled for removal in v1.4.0.
## Use `vops vprox --start` (suite mode) or `vops vprox --daemon` instead.
_build-vprox:
	@echo "Building $(APP_NAME)..."
	mkdir -p "$(BUILD_DIR)"
	GOROOT="$(EFFECTIVE_GOROOT)" go build -o "$(BUILD_OUT)" "$(BUILD_SRC)"
	@echo "✓ Build complete"
	@echo "  Output: $(BUILD_OUT)"

## Clean local build artifacts (never touches installed binary)

clean:
	@echo "Cleaning build artifacts..."
	rm -rf "$(BUILD_DIR)" "./$(APP_NAME)"
	@echo "✓ Clean"

## ─── vOps targets ────────────────────────────────────────────────────────────

## Build vOps binary to .build/vOps  (does NOT rebuild vProx)

## Build the React + Vite _frontend SPA (output goes to internal/vops/web/dist/)
_frontend:
	@echo "Building vOps _frontend (React + Vite)..."
	@HAVE_NODE=0; \
	if command -v node >/dev/null 2>&1; then HAVE_NODE=1; \
	elif [ -s "$$HOME/.nvm/nvm.sh" ]; then \
		export NVM_DIR="$$HOME/.nvm" && . "$$NVM_DIR/nvm.sh" && HAVE_NODE=1; \
	fi; \
	if [ "$$HAVE_NODE" = "0" ]; then \
		echo "  ℹ  Node.js not found — skipping _frontend build (using committed dist/)"; \
	else \
		cd internal/vops/web/_frontend && npm install && npm audit fix && npm run build; \
		echo "✓ Frontend built → internal/vops/web/dist/"; \
	fi

build-vops: _frontend
	@echo "Building $(VOPS_NAME) (service keeps running during compile)..."
	mkdir -p "$(BUILD_DIR)"
	GOROOT="$(EFFECTIVE_GOROOT)" go build -ldflags "$(VOPS_LDFLAGS)" -o "$(VOPS_BUILD)" "$(VOPS_SRC)"
	@echo "✓ Build complete — Binary: $(VOPS_BUILD)"
	@VOPS_SC_LINE="$(USER) ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop $(VOPS_NAME), /usr/bin/systemctl start $(VOPS_NAME), /usr/bin/systemctl restart $(VOPS_NAME)"; \
	if ! ([[ -f "/etc/sudoers.d/vprox" ]] && grep -qF "$$VOPS_SC_LINE" /etc/sudoers.d/vprox); then \
		echo "  ⚠ Passwordless systemctl not configured — run 'make service-vops' to configure sudoers."; \
	fi
	@echo "Stopping $(VOPS_NAME) service for swap..."
	@sudo systemctl stop "$(VOPS_NAME)" 2>/dev/null && echo "  ✓ $(VOPS_NAME) stopped" || echo "  ○ $(VOPS_NAME) was not running"
	@cp "$(VOPS_BUILD)" "$(GOPATH_BIN)/$(VOPS_NAME)"
	@if [ -e "/usr/local/bin/$(VOPS_NAME)" ]; then \
		sudo cp "$(VOPS_BUILD)" "/usr/local/bin/$(VOPS_NAME)"; \
		echo "  ✓ Updated → /usr/local/bin/$(VOPS_NAME)"; \
	fi
	@echo "  Copied → $(GOPATH_BIN)/$(VOPS_NAME)"
	@echo "Restarting $(VOPS_NAME) service..."
	@sudo systemctl start "$(VOPS_NAME)" 2>/dev/null && echo "  ✓ $(VOPS_NAME) started" || echo "  ○ Could not start $(VOPS_NAME) — start manually: sudo service $(VOPS_NAME) start"

## Stop, disable, and remove stale vProx/vLog service units before fresh vOps deploy.
## vOps.service is only stopped+disabled — the unit file is NOT removed (reinstall with make service-vops).

reset-services:
	@echo "── Resetting stale service units ────────────────────────────────────────"
	@for svc in vProx.service vprox.service vLog.service vlog.service vops.service; do \
		sudo systemctl stop "$$svc" 2>/dev/null || true; \
		sudo systemctl disable "$$svc" 2>/dev/null || true; \
		sudo rm -f "/etc/systemd/system/$$svc"; \
		echo "  ✓ $$svc stopped, disabled, removed"; \
	done
	@sudo systemctl stop vOps.service 2>/dev/null || true
	@sudo systemctl disable vOps.service 2>/dev/null || true
	@echo "  ✓ vOps.service stopped + disabled (unit preserved for reinstall)"
	@sudo systemctl daemon-reload
	@echo "✓ daemon-reload complete — run 'make service-vops' to reinstall vOps.service"

## Cross-compile vOps for linux/amd64, commit the binary, and push.
## Run this on macOS (or any dev machine) to deploy via git pull on the server.
## Usage: make release-vops  (optionally: make release-vops VOPS_VERSION=0.2.0)

release-vops: _frontend
	@echo "Cross-compiling vOps $(VOPS_VERSION) for linux/amd64..."
	mkdir -p "$(BUILD_DIR)"
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOROOT="$(EFFECTIVE_GOROOT)" \
		go build -ldflags "-s -w $(VOPS_LDFLAGS)" -o vops-linux-amd64 "$(VOPS_SRC)"
	@echo "✓ vops-linux-amd64 built (v$(VOPS_VERSION))"
	@echo "Committing and pushing..."
	git add vops-linux-amd64 cmd/vops/VERSION
	git diff --cached --quiet || git commit -m "release(vops): v$(VOPS_VERSION) linux/amd64 binary" \
		-m "" \
		-m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
	git push
	@echo "✓ Pushed — pull on server: git pull && sudo mv vops-linux-amd64 /usr/local/bin/vops && sudo systemctl restart vops"

## Install .samples/vops/vops.sample → $(VOPS_HOME)/config/vops/vops.toml (only if absent)

_config-vops: _dirs
	@echo "Installing vOps _config..."
	@mkdir -p "$(VOPS_HOME)/config/vops"
	@if [[ -f ".samples/vops/vops.sample" ]]; then \
		if [[ ! -f "$(VOPS_HOME)/config/vops/vops.toml" ]]; then \
			cp ".samples/vops/vops.sample" "$(VOPS_HOME)/config/vops/vops.toml"; \
			echo "✓ Copied vops.sample to $(VOPS_HOME)/config/vops/vops.toml"; \
			echo "  Edit $(VOPS_HOME)/config/vops/vops.toml to set your API keys."; \
		else \
			echo "✓ $(VOPS_HOME)/config/vops/vops.toml already exists — checking for missing fields..."; \
			if ! grep -qE "^[[:space:]]*api_key[[:space:]]*=" "$(VOPS_HOME)/config/vops/vops.toml" || grep -qE "^[[:space:]]*#.*api_key" "$(VOPS_HOME)/config/vops/vops.toml"; then \
				echo ""; \
				echo "┌─────────────────────────────────────────────────────────────────┐"; \
				echo "│  ⚠  ACTION REQUIRED — vOps API Key not configured               │"; \
				echo "├─────────────────────────────────────────────────────────────────┤"; \
				echo "│  vOps uses HMAC-SHA256 to authenticate block/unblock requests.  │"; \
				echo "│  These endpoints manipulate UFW firewall rules and MUST be      │"; \
				echo "│  protected with a secret key before use.                        │"; \
				echo "│                                                                 │"; \
				echo "│  1. Generate your key:                                          │"; \
				echo "│       openssl rand -hex 32                                      │"; \
				echo "│                                                                 │"; \
				echo "│  2. Add it to your _config:                                      │"; \
				echo "│       $(VOPS_HOME)/config/vops/vops.toml"; \
				echo "│     under [vops]:                                               │"; \
				echo "│       api_key = \"your-generated-key\"                            │"; \
				echo "│                                                                 │"; \
				echo "│  Until this is set, block/unblock endpoints return 503.         │"; \
				echo "└─────────────────────────────────────────────────────────────────┘"; \
				echo ""; \
			fi; \
			if ! grep -qE "^[[:space:]]*base_path[[:space:]]*=" "$(VOPS_HOME)/config/vops/vops.toml"; then \
				echo "  ℹ  base_path not set — if vOps is served at a sub-path (e.g. /vops)"; \
				echo "     add to $(VOPS_HOME)/config/vops/vops.toml under [vops]:"; \
				echo "       base_path = \"/vops\""; \
				echo "     See .vscode/vops.apache2 for the matching Apache _config."; \
				echo ""; \
			fi; \
		fi; \
	else \
		echo "WARNING: .samples/vops/vops.sample not found in repo"; \
	fi

## Create and optionally install vOps systemd service

service-vops:
	@echo "Rendering vOps systemd service file..."
	@mkdir -p "$(SERVICE_DIR)"
	@TMP_RENDERED="$$(mktemp)"; \
	sed "s|__HOME__|$(HOME)|g; s|__USER__|$(USER)|g; s|__VOPS_USER__|$(VOPS_USER)|g" vops.service.template > "$$TMP_RENDERED"; \
	if [[ -f "$(VOPS_SERVICE)" ]]; then \
		if cmp -s "$$TMP_RENDERED" "$(VOPS_SERVICE)"; then \
			echo "✓ Local vOps.service already up to date"; \
		else \
			echo "⚠ vOps.service differs; applying update..."; \
			cp "$$TMP_RENDERED" "$(VOPS_SERVICE)"; \
			echo "✓ Updated $(VOPS_SERVICE)"; \
		fi; \
	else \
		cp "$$TMP_RENDERED" "$(VOPS_SERVICE)"; \
		echo "✓ Created $(VOPS_SERVICE)"; \
	fi; \
	rm -f "$$TMP_RENDERED"
	@echo ""
	@read -p "Install vOps.service to /etc/systemd/system? (y/n) " -n 1 -r; echo ""; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		if sudo cp "$(VOPS_SERVICE)" "/etc/systemd/system/vOps.service" && \
		   sudo systemctl daemon-reload && \
		   sudo systemctl enable vOps.service; \
		then \
			echo "✓ vOps.service installed. Start with: sudo service vOps start"; \
		else \
			echo "✗ Failed. Check: sudo systemctl status vOps.service"; \
		fi; \
	else \
		echo "✓ Skipped. Install manually:"; \
		echo "  sudo cp $(VOPS_SERVICE) /etc/systemd/system/vOps.service"; \
		echo "  sudo systemctl daemon-reload && sudo systemctl enable vOps.service"; \
	fi

## ─── UFW passwordless setup for vOps ─────────────────────────────────────────

## Create dedicated vops system user (nologin) for running the vOps service.
## Run once on the server before enabling the systemd service with User=vops.
system-user-vops:
	@if id vops &>/dev/null; then \
		echo "✓ System user 'vops' already exists"; \
	else \
		echo "Creating system user 'vops' (nologin)..."; \
		sudo useradd -r -s /usr/sbin/nologin -d /nonexistent -c "vOps service account" vops; \
		echo "✓ User 'vops' created"; \
	fi
	@echo "  Tip: run 'make ufw' to grant vops the required sudoers entries."

## Set up passwordless UFW + apt for vOps (writes /etc/sudoers.d/vops).
ufw:
	@SUDOERS_FILE="/etc/sudoers.d/vops"; \
	SUDOERS_LINE="$(VOPS_USER) ALL=(ALL) NOPASSWD: /usr/sbin/ufw deny from *, /usr/sbin/ufw delete deny from *, /usr/sbin/ufw insert 1 deny from * to any, /usr/bin/apt update, /usr/bin/apt upgrade -y"; \
	if [[ -f "$$SUDOERS_FILE" ]]; then \
		if grep -qF "$$SUDOERS_LINE" "$$SUDOERS_FILE"; then \
			echo "✓ Sudoers rule already configured ($$SUDOERS_FILE)"; \
		else \
			echo "⚠ $$SUDOERS_FILE exists but differs. Current content:"; \
			sudo cat "$$SUDOERS_FILE"; \
			echo ""; \
			read -p "Overwrite with updated rule? (y/n) " -n 1 -r; echo ""; \
			if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
				echo "$$SUDOERS_LINE" | sudo tee "$$SUDOERS_FILE" > /dev/null; \
				sudo chmod 0440 "$$SUDOERS_FILE"; \
				echo "✓ Updated $$SUDOERS_FILE"; \
			else \
				echo "✓ Skipped sudoers update"; \
			fi; \
		fi; \
	else \
		echo "Setting up passwordless UFW block/unblock for vOps..."; \
		echo "  Allows 'Block IP' and 'Unblock' buttons in vOps UI without password prompt."; \
		read -p "Create sudoers rule? (y/n) " -n 1 -r; echo ""; \
		if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
			echo "$$SUDOERS_LINE" | sudo tee "$$SUDOERS_FILE" > /dev/null; \
			sudo chmod 0440 "$$SUDOERS_FILE"; \
			echo "✓ Created $$SUDOERS_FILE"; \
		else \
			echo "✓ Skipped. You can create it manually:"; \
			echo "  echo '$$SUDOERS_LINE' | sudo tee $$SUDOERS_FILE"; \
			echo "  sudo chmod 0440 $$SUDOERS_FILE"; \
		fi; \
	fi

## ─── vOps version management ────────────────────────────────────────────────
## Source of truth: cmd/vops/VERSION  (format: MAJOR.MINOR.PATCH)
## Run the appropriate target before each push to increment the version.

## Bump patch version (0.0.1 → 0.0.2) — use for bug fixes and small improvements.
bump-patch:
	@ver=$$(cat cmd/vops/VERSION); \
	IFS='.' read -r maj min pat <<< "$$ver"; \
	new="$$maj.$$min.$$((pat+1))"; \
	printf "$$new\n" > cmd/vops/VERSION; \
	echo "✓ vOps version: $$ver → $$new  (cmd/vops/VERSION updated)"

## Bump minor version (0.0.x → 0.1.0) — use for new features (backward-compatible).
bump-minor:
	@ver=$$(cat cmd/vops/VERSION); \
	IFS='.' read -r maj min pat <<< "$$ver"; \
	new="$$maj.$$((min+1)).0"; \
	printf "$$new\n" > cmd/vops/VERSION; \
	echo "✓ vOps version: $$ver → $$new  (cmd/vops/VERSION updated)"

## Bump major version (0.x.y → 1.0.0) — use for breaking changes or major milestones.
bump-major:
	@ver=$$(cat cmd/vops/VERSION); \
	IFS='.' read -r maj min pat <<< "$$ver"; \
	new="$$((maj+1)).0.0"; \
	printf "$$new\n" > cmd/vops/VERSION; \
	echo "✓ vOps version: $$ver → $$new  (cmd/vops/VERSION updated)"
