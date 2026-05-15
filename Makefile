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
# Override on the command line: make build-vprox VPROX_VERSION=1.0.1
VPROX_VERSION := $(shell cat cmd/vprox/VERSION 2>/dev/null || echo "dev")
VPROX_LDFLAGS := -X main.version=$(VPROX_VERSION) -X main.commit=$(VOPS_COMMIT) -X main.buildDate=$(VOPS_BUILT)
# Service user: defaults to the installing user.
# Override for a dedicated service account: make service-vops VOPS_USER=vops
# (run `make system-user-vops` first to create the vops system user).
VOPS_USER  ?= $(USER)

VOPS_HOME  := $(HOME)/.vOps
# VPROX_HOME retained for reference only — no active paths should use it.
# Existing ~/.vProx data can be migrated with: cp -r ~/.vProx/data ~/.vOps/data
VPROX_HOME := $(HOME)/.vProx
DATA_DIR     := $(VOPS_HOME)/data
LOG_DIR      := $(VOPS_HOME)/data/logs
CFG_DIR      := $(VOPS_HOME)/config
CHAINS_DIR   := $(VOPS_HOME)/chains
INTERNAL_DIR := $(VOPS_HOME)/internal
ARCHIVE_DIR  := $(VOPS_HOME)/data/logs/archives
SERVICE_DIR  := $(VOPS_HOME)/service
SERVICE_PATH := $(SERVICE_DIR)/vOps.service
VOPS_SERVICE  := $(SERVICE_DIR)/vOps.service
VPROX_SERVICE := $(SERVICE_DIR)/vProx.service
GEO_DIR      := $(VOPS_HOME)/data/geolocation
SAMPLES_DIR  := $(VOPS_HOME)/.samples
DIR_LIST := $(DATA_DIR) $(LOG_DIR) $(CFG_DIR) $(CFG_DIR)/chains $(CFG_DIR)/backup \
            $(CFG_DIR)/vprox $(CFG_DIR)/vprox/nodes \
            $(INTERNAL_DIR) $(ARCHIVE_DIR) $(SERVICE_DIR) $(GEO_DIR) \
            $(CFG_DIR)/vops $(CFG_DIR)/infra $(CFG_DIR)/fleet \
            $(CFG_DIR)/vops/chains \
            $(SAMPLES_DIR) $(SAMPLES_DIR)/chains $(SAMPLES_DIR)/backup \
            $(SAMPLES_DIR)/vops $(SAMPLES_DIR)/infra $(SAMPLES_DIR)/fleet \
            $(SAMPLES_DIR)/vprox $(SAMPLES_DIR)/vprox/nodes $(SAMPLES_DIR)/vops/chains

# Sample file revision — format: r{major}_{MMDDYY}_{seq}
# Increment {seq} for multiple revisions on the same day; reset to 0 on new date.
# Injected into the "# rev: {{SAMPLE_REV}}" placeholder in every .sample file at install/refresh time.
SAMPLE_REV := r5_031126_0

# GeoLocation database — bundled in assets/_geo/, extracted to user data dir
GEO_DB_SRC := assets/_geo/ip2location.mmdb.gz
GEO_DB_DST := $(GEO_DIR)/ip2location.mmdb

ENV_FILE := $(VOPS_HOME)/._env

# Remote infra host for TOML patching — override: make toml-upgrade INFRA_HOST=user@host
INFRA_HOST ?= www.qc

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
.PHONY: all help install build build-vops build-vops-reset release-vops \
        clean ufw reset-services service-vops service-vprox system-user-vops \
        bump-patch bump-minor bump-major toml-upgrade upgrade-1.2.1-1.4.4 \
        _config-reset

all: help

## ─── Public targets ──────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  vOps — build and install targets"
	@echo ""
	@echo "  make install          Build + install vOps: binary, config, service"
	@echo "  make build            Build vOps binary → .build/vOps"
	@echo "  make build-vops       Build vOps binary + sync service files (⚠ never touches config files)"
	@echo "  make build-vops-reset Build vOps binary + reset config files from samples (backs up first)"
	@echo "  make service-vops     Render + optionally install vOps.service from template"
	@echo "  make service-vprox    Render + optionally install vProx.service from template"
	@echo "  make reset-services   Stop + remove stale service units (vProx, vLog) before fresh deploy"
		@echo "  make release-vops     Cross-compile linux/amd64 → vops-linux-amd64, commit + push"
	@echo "  make clean            Remove local build artifacts"
	@echo "  make ufw              Passwordless UFW + apt sudoers for vOps"
	@echo "  make toml-upgrade     SSH to INFRA_HOST ($(INFRA_HOST)) and patch infra TOML files"
	@echo "  make upgrade-1.2.1-1.4.4  Migrate ~/.vProx config → ~/.vOps, rebuild + restart (run ON server)"
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
	@echo "  Add chains to: $(CFG_DIR)/vprox/{chain}.toml  (vProx chain configs)"
	@echo "                 $(CFG_DIR)/chains/{chain}.toml  (vOps chain profiles)"
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
	@$(MAKE) --no-print-directory service-vprox
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

## Create required folders under $HOME/.vOps

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

## Create ._env reference file if missing.
## NOTE: This file is NOT loaded by the systemd services — service environment
## is set entirely via Environment= directives in the service unit file.
## ._env serves as a human-readable reference of all supported env var overrides.

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
## Migrates automatically from the legacy $(VPROX_HOME)/config/vprox/settings.toml path.

_config-vprox: _dirs
	@mkdir -p "$(CFG_DIR)/vprox"
	@if [[ -f ".samples/vprox/settings.sample" ]]; then \
		sed "s/{{SAMPLE_REV}}/$(SAMPLE_REV)/" ".samples/vprox/settings.sample" > "$(CFG_DIR)/vprox/settings.sample"; \
		echo "✓ Installed proxy settings sample → $(CFG_DIR)/vprox/settings.sample"; \
		if [[ ! -f "$(CFG_DIR)/vprox/settings.toml" ]]; then \
			if [[ -f "$(VPROX_HOME)/config/vprox/settings.toml" ]]; then \
				cp "$(VPROX_HOME)/config/vprox/settings.toml" "$(CFG_DIR)/vprox/settings.toml"; \
				echo "✓ Migrated settings.toml from $(VPROX_HOME)/config/vprox/ → $(CFG_DIR)/vprox/"; \
			else \
				echo "  Copy to activate: cp $(CFG_DIR)/vprox/settings.sample $(CFG_DIR)/vprox/settings.toml"; \
			fi; \
		else \
			echo "✓ $(CFG_DIR)/vprox/settings.toml already exists"; \
		fi \
	else \
		echo "NOTE: .samples/vprox/settings.sample not found in repo; skipping"; \
	fi

## Overwrite ALL sample files in SAMPLES_DIR (~/.vOps/.samples/) — safe to run anytime; never touches live _config.
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

## Build vProx binary to .build/vProx (with version ldflags, service sync + restart).
## ⚠ NEVER touches any config TOML files — existing configs are always preserved.
build-vprox:
	@echo "Building $(APP_NAME) (service keeps running during compile)..."
	mkdir -p "$(BUILD_DIR)"
	GOROOT="$(EFFECTIVE_GOROOT)" go build -ldflags "$(VPROX_LDFLAGS)" -o "$(BUILD_OUT)" "$(BUILD_SRC)"
	@echo "✓ Build complete — Binary: $(BUILD_OUT)"
	@echo "Stopping $(APP_NAME) service for swap..."
	@sudo systemctl stop "$(APP_NAME)" 2>/dev/null && echo "  ✓ $(APP_NAME) stopped" || echo "  ○ $(APP_NAME) was not running"
	@cp "$(BUILD_OUT)" "$(GOPATH_BIN)/$(APP_NAME)"
	@if [ -e "/usr/local/bin/$(APP_NAME)" ]; then \
		sudo cp "$(BUILD_OUT)" "/usr/local/bin/$(APP_NAME)"; \
		echo "  ✓ Updated → /usr/local/bin/$(APP_NAME)"; \
	fi
	@echo "  Copied → $(GOPATH_BIN)/$(APP_NAME)"
	@echo "── Syncing vProx service file ───────────────────────────────────────────"
	@sys="/etc/systemd/system/vProx.service"; \
	if [[ -f "$$sys" ]]; then \
		rnd=$$(mktemp); \
		sed "s|__HOME__|$(HOME)|g; s|__USER__|$(USER)|g; s|__VOPS_USER__|$(VOPS_USER)|g" vprox.service.template > "$$rnd"; \
		if ! cmp -s "$$rnd" "$$sys"; then \
			sudo cp "$$sys" "$${sys}.bak.$$(date +%s)"; \
			sudo cp "$$rnd" "$$sys"; \
			echo "  ✓ vProx.service updated (drifted from template; prior backed up)"; \
			sudo systemctl daemon-reload && echo "  ✓ daemon-reload"; \
		else \
			echo "  ✓ vProx.service up to date"; \
		fi; \
		rm -f "$$rnd"; \
	fi
	@echo "Restarting $(APP_NAME) service..."
	@sudo systemctl start "$(APP_NAME)" 2>/dev/null && echo "  ✓ $(APP_NAME) started" || echo "  ○ Could not start $(APP_NAME) — start manually: sudo service $(APP_NAME) start"

## LEGACY: use build-vprox instead.
_build-vprox:
	@echo "⚠ _build-vprox is deprecated — use 'make build-vprox' instead."
	@$(MAKE) build-vprox

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
		cd internal/vops/web/frontend && npm install && npm audit fix && npm run build; \
		echo "✓ Frontend built → internal/vops/web/dist/"; \
	fi

## Build vOps binary (frontend + Go compile, service sync).
## ⚠ NEVER touches any config TOML files — existing configs are always preserved.
## Use make build-vops-reset to also reset configs to sample defaults.
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
	@echo "── Syncing service files ────────────────────────────────────────────────"
	@reload=0; \
	for entry in "vops.service.template:vOps.service" "vprox.service.template:vProx.service"; do \
		tpl="$${entry%%:*}"; svc="$${entry##*:}"; sys="/etc/systemd/system/$$svc"; \
		if [[ -f "$$sys" ]]; then \
			rnd=$$(mktemp); \
			sed "s|__HOME__|$(HOME)|g; s|__USER__|$(USER)|g; s|__VOPS_USER__|$(VOPS_USER)|g" "$$tpl" > "$$rnd"; \
			if ! cmp -s "$$rnd" "$$sys"; then \
				sudo cp "$$sys" "$${sys}.bak.$$(date +%s)"; \
				sudo cp "$$rnd" "$$sys"; echo "  ✓ $$svc updated (drifted from template; prior backed up as $${sys}.bak.*)"; reload=1; \
			else \
				echo "  ✓ $$svc up to date"; \
			fi; \
			rm -f "$$rnd"; \
		fi; \
	done; \
	if [[ "$$reload" = "1" ]]; then \
		sudo systemctl daemon-reload && echo "  ✓ daemon-reload"; \
		if sudo systemctl is-active --quiet vProx 2>/dev/null; then \
			sudo systemctl restart vProx 2>/dev/null && echo "  ✓ vProx restarted (service config changed)"; \
		fi; \
	fi
	@echo "Restarting $(VOPS_NAME) service..."
	@sudo systemctl start "$(VOPS_NAME)" 2>/dev/null && echo "  ✓ $(VOPS_NAME) started" || echo "  ○ Could not start $(VOPS_NAME) — start manually: sudo service $(VOPS_NAME) start"

## Reset all config TOML files from samples — backs up existing files first.
## ⚠ DESTRUCTIVE: overwrites live config values. Use to restore defaults.
## Called automatically by build-vops-reset.
_config-reset: _dirs
	@echo "── Resetting config from samples ────────────────────────────────────────"
	@_ts="$$(date +%s)"; \
	_reset() { \
		local src="$$1" dst="$$2"; \
		if [[ -f "$$dst" ]]; then \
			cp "$$dst" "$${dst%.toml}.bak.$$_ts"; \
			echo "  ↳ backed up → $${dst%.toml}.bak.$$_ts"; \
		fi; \
		if [[ -f "$$src" ]]; then \
			sed "s/{{SAMPLE_REV}}/$(SAMPLE_REV)/" "$$src" > "$$dst"; \
			echo "  ✓ reset → $$dst"; \
		else \
			echo "  ⚠ sample not found: $$src — skipped"; \
		fi; \
	}; \
	_reset ".samples/vops/vops.sample"         "$(CFG_DIR)/vops/vops.toml"; \
	_reset ".samples/vprox/settings.sample"    "$(CFG_DIR)/vprox/settings.toml"; \
	_reset ".samples/backup/backup.sample"     "$(CFG_DIR)/backup/backup.toml"; \
	_reset ".samples/chains/services.sample"   "$(CFG_DIR)/chains/services.toml"
	@echo "✓ Config reset complete — edit restored files to reconfigure"

## Build vOps binary AND reset all config files from samples (⚠ overwrites live config).
## Backs up each existing TOML before overwriting. Use when intentionally starting fresh.
build-vops-reset: _config-reset build-vops

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
## Migrates automatically from the legacy $(VPROX_HOME)/config/vops/vops.toml path.

_config-vops: _dirs
	@echo "Installing vOps _config..."
	@mkdir -p "$(VOPS_HOME)/config/vops"
	@if [[ -f ".samples/vops/vops.sample" ]]; then \
		if [[ ! -f "$(VOPS_HOME)/config/vops/vops.toml" ]]; then \
			if [[ -f "$(VPROX_HOME)/config/vops/vops.toml" ]]; then \
				cp "$(VPROX_HOME)/config/vops/vops.toml" "$(VOPS_HOME)/config/vops/vops.toml"; \
				echo "✓ Migrated vops.toml from $(VPROX_HOME)/config/vops/ → $(VOPS_HOME)/config/vops/"; \
			else \
				cp ".samples/vops/vops.sample" "$(VOPS_HOME)/config/vops/vops.toml"; \
				echo "✓ Copied vops.sample to $(VOPS_HOME)/config/vops/vops.toml"; \
				echo "  Edit $(VOPS_HOME)/config/vops/vops.toml to set your API keys."; \
			fi; \
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

## Create and optionally install vProx systemd service.
## Renders vprox.service.template → $(VPROX_SERVICE), then prompts to install to /etc/systemd/system/.

service-vprox:
	@echo "Rendering vProx systemd service file..."
	@mkdir -p "$(SERVICE_DIR)"
	@TMP_RENDERED="$$(mktemp)"; \
	sed "s|__HOME__|$(HOME)|g; s|__USER__|$(USER)|g" vprox.service.template > "$$TMP_RENDERED"; \
	if [[ -f "$(VPROX_SERVICE)" ]]; then \
		if cmp -s "$$TMP_RENDERED" "$(VPROX_SERVICE)"; then \
			echo "✓ Local vProx.service already up to date"; \
		else \
			echo "⚠ vProx.service differs; applying update..."; \
			cp "$$TMP_RENDERED" "$(VPROX_SERVICE)"; \
			echo "✓ Updated $(VPROX_SERVICE)"; \
		fi; \
	else \
		cp "$$TMP_RENDERED" "$(VPROX_SERVICE)"; \
		echo "✓ Created $(VPROX_SERVICE)"; \
	fi; \
	rm -f "$$TMP_RENDERED"
	@echo ""
	@read -p "Install vProx.service to /etc/systemd/system? (y/n) " -n 1 -r; echo ""; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		if sudo cp "$(VPROX_SERVICE)" "/etc/systemd/system/vProx.service" && \
		   sudo systemctl daemon-reload && \
		   sudo systemctl enable vProx.service; \
		then \
			echo "✓ vProx.service installed. Start with: sudo service vProx start"; \
		else \
			echo "✗ Failed. Check: sudo systemctl status vProx.service"; \
		fi; \
	else \
		echo "✓ Skipped. Install manually:"; \
		echo "  sudo cp $(VPROX_SERVICE) /etc/systemd/system/vProx.service"; \
		echo "  sudo systemctl daemon-reload && sudo systemctl enable vProx.service"; \
	fi

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
	SUDOERS_LINE="$(VOPS_USER) ALL=(ALL) NOPASSWD: /usr/sbin/ufw deny from *, /usr/sbin/ufw delete deny from *, /usr/sbin/ufw insert 1 deny from * to any, /usr/sbin/conntrack -L -s *, /usr/sbin/conntrack -D -s *, /usr/bin/apt update, /usr/bin/apt upgrade -y"; \
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

## ─── vProx version management ──────────────────────────────────────────────
## Source of truth: cmd/vprox/VERSION  (format: MAJOR.MINOR.PATCH)

## Bump vProx patch version.
bump-patch-vprox:
	@ver=$$(cat cmd/vprox/VERSION); \
	IFS='.' read -r maj min pat <<< "$$ver"; \
	new="$$maj.$$min.$$((pat+1))"; \
	printf "$$new\n" > cmd/vprox/VERSION; \
	echo "✓ vProx version: $$ver → $$new  (cmd/vprox/VERSION updated)"

## Bump vProx minor version.
bump-minor-vprox:
	@ver=$$(cat cmd/vprox/VERSION); \
	IFS='.' read -r maj min pat <<< "$$ver"; \
	new="$$maj.$$((min+1)).0"; \
	printf "$$new\n" > cmd/vprox/VERSION; \
	echo "✓ vProx version: $$ver → $$new  (cmd/vprox/VERSION updated)"

## Bump vProx major version.
bump-major-vprox:
	@ver=$$(cat cmd/vprox/VERSION); \
	IFS='.' read -r maj min pat <<< "$$ver"; \
	new="$$((maj+1)).0.0"; \
	printf "$$new\n" > cmd/vprox/VERSION; \
	echo "✓ vProx version: $$ver → $$new  (cmd/vprox/VERSION updated)"

## ─── Infra config maintenance ────────────────────────────────────────────────

## Patch live infra TOML files on the remote control VM.
## Creates timestamped backups before modifying. Shows exactly what was changed.
## Override host: make toml-upgrade INFRA_HOST=user@host

toml-upgrade:
	@echo "→ Patching infra TOMLs on $(INFRA_HOST) ..."
	@ssh $(INFRA_HOST) python3 - < scripts/toml-upgrade.py

## ─── Version upgrade (v1.2.x → v1.4.4) ─────────────────────────────────────

## Full upgrade: migrate ~/.vProx config layout → ~/.vOps, rebuild binary, restart.
## Run this ON the target server after `git pull origin vOps_v1.4.0`.
## Idempotent — safe to re-run; existing files in ~/.vOps are never overwritten.

upgrade-1.2.1-1.4.4:
	@bash scripts/upgrade-1.2.1-to-1.4.4.sh
