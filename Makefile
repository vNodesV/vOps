SHELL := /bin/bash

APP_NAME := vProx
BUILD_SRC := ./cmd/vprox
BUILD_DIR := .build
BUILD_OUT := $(BUILD_DIR)/$(APP_NAME)

VOPS_NAME  := vOps
VOPS_SRC   := ./cmd/vops
VOPS_BUILD := $(BUILD_DIR)/$(VOPS_NAME)

# OS user the sudoers rules below grant passwordless access to.
# Override on the command line: make install SUDOERS_USER=myuser
SUDOERS_USER ?= $(shell whoami)

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
# Override for a dedicated service account: make install VOPS_USER=vops
# (a dedicated nologin 'vops' system user is created automatically by `make install`).
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

# GeoLocation database — bundled in assets/geo/, extracted to user data dir
GEO_DB_SRC := assets/geo/ip2location.mmdb.gz
GEO_DB_DST := $(GEO_DIR)/ip2location.mmdb

ENV_FILE := $(VOPS_HOME)/._env

# Validate Go environment
_RAW_GOPATH := $(shell go env GOPATH)
GOPATH      := $(patsubst %/,%,$(_RAW_GOPATH))
GOROOT      := $(shell go env GOROOT)
# Prefer GOBIN if explicitly set.
# If not set and GOPATH already ends in /bin (some server configs), use it directly
# to avoid producing a double-bin path like ~/go/bin/bin.
_RAW_GOBIN := $(shell go env GOBIN 2>/dev/null)
GOPATH_BIN := $(or $(_RAW_GOBIN),$(if $(filter %/bin,$(GOPATH)),$(GOPATH),$(GOPATH)/bin))

# On servers where GOROOT points to a manually installed (potentially broken)
# Go tree, the module-cache toolchain has a clean stdlib. Prefer it when present,
# but ONLY if its version matches the active `go` binary — prevents stdlib mismatch
# when multiple toolchains are cached (e.g. 1.25.7 active, 1.26.2 cached → reject).
# Falls back to the current GOROOT transparently (no persistent state is changed).
_GO_VERSION       := $(shell go version | awk '{print $$3}')
_TOOLCHAIN_GOROOT := $(shell find $(GOPATH)/pkg/mod/golang.org -maxdepth 1 -name "toolchain@v0.0.1-$(_GO_VERSION).*" 2>/dev/null | head -1)
EFFECTIVE_GOROOT  := $(if $(_TOOLCHAIN_GOROOT),$(_TOOLCHAIN_GOROOT),$(GOROOT))

# Public targets only — internal helpers (_dirs, _geo, _config-*, _env, _frontend, _sudoers,
# _service-*, _system-user-vops, _reset-stale-services, …) are intentionally excluded from
# .PHONY so they don't pollute tab-completion. Run `make help` for the supported surface.
.PHONY: all help install build build-vops build-vprox upgrade clean \
        bump-patch bump-minor bump-major \
        bump-patch-vprox bump-minor-vprox bump-major-vprox

all: help

## ─── Public targets ──────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  vOps — build and install targets"
	@echo ""
	@echo "  make install          Fresh install: dirs, config, sudoers, services, both binaries"
	@echo "  make build-vops       Stop vOps  → build → install to \$$GOPATH/bin (+ /usr/local/bin) → start vOps"
	@echo "  make build-vprox      Stop vProx → build → install to \$$GOPATH/bin (+ /usr/local/bin) → start vProx"
	@echo "  make build / upgrade  Same cycle for BOTH binaries (vOps then vProx)"
	@echo "  make clean            Remove stale .build/ artifacts from older versions of this Makefile"
	@echo ""
	@echo "  Every build target stops its own service(s), builds, installs the binary"
	@echo "  directly to \$$GOPATH/bin, symlinks into /usr/local/bin (created if missing),"
	@echo "  then restarts the service(s). No manual deploy step needed."
	@echo ""
	@echo "  Version management (vOps):"
	@echo "    make bump-patch       0.0.1 → 0.0.2  (bug fixes / small improvements)"
	@echo "    make bump-minor       0.0.x → 0.1.0  (new features, backward-compatible)"
	@echo "    make bump-major       0.x.y → 1.0.0  (breaking changes / major milestones)"
	@echo "    Current version: $$(cat cmd/vops/VERSION 2>/dev/null || echo 'unknown')"
	@echo ""
	@echo "  Version management (vProx):"
	@echo "    make bump-patch-vprox / bump-minor-vprox / bump-major-vprox"
	@echo "    Current version: $$(cat cmd/vprox/VERSION 2>/dev/null || echo 'unknown')"
	@echo ""
	@echo "  Paths (install):"
	@echo "    Binary:    $(GOPATH_BIN)/$(VOPS_NAME)"
	@echo "    Config:    $(VOPS_HOME)/config/"
	@echo "    Data:      $(DATA_DIR)/"
	@echo "    Samples:   $(VOPS_HOME)/.samples/"
	@echo "  Add VMs to:    $(VOPS_HOME)/config/infra/{datacenter}.toml"
	@echo "  Add chains to: $(CFG_DIR)/vprox/{chain}.toml  (vProx chain configs)"
	@echo "                 $(CFG_DIR)/chains/{chain}.toml  (vOps chain profiles)"
	@echo ""

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
	elif [[ -f "$(GEO_DB_DST)" ]]; then \
		echo "✓ GEO DB already present at $(GEO_DB_DST) — skipping (run make _geo to force refresh)"; \
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

## ─── Build targets ───────────────────────────────────────────────────────────
## Each target stops its own service(s), builds straight to a temp file,
## installs to $GOPATH/bin (atomic mv), symlinks into /usr/local/bin (created
## it if absent), then restarts the service(s). No .build/ staging directory,
## no separate manual deploy step. Requires passwordless sudo for systemctl
## (set up once via `make install` / `make _sudoers`).

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
		cd internal/vops/web/frontend && npm install && npm run build; \
		echo "✓ Frontend built → internal/vops/web/dist/"; \
	fi

## Build, install, and restart vOps. Stops vOps → compiles → installs to
## $GOPATH/bin → symlinks into /usr/local/bin (if missing) → restarts vOps.
build-vops: _frontend
	@echo "── Building $(VOPS_NAME) ────────────────────────────────────────────────"
	@sudo systemctl stop vOps 2>/dev/null && echo "  ✓ vOps stopped" || echo "  ○ vOps was not running"
	@mkdir -p "$(GOPATH_BIN)"
	@TMP="$$(mktemp)"; \
	GOROOT="$(EFFECTIVE_GOROOT)" go build -ldflags "$(VOPS_LDFLAGS)" -o "$$TMP" "$(VOPS_SRC)" && \
	mv "$$TMP" "$(GOPATH_BIN)/$(VOPS_NAME)" && chmod +x "$(GOPATH_BIN)/$(VOPS_NAME)"
	@echo "  ✓ Installed → $(GOPATH_BIN)/$(VOPS_NAME)"
	@if [ -e "/usr/local/bin/$(VOPS_NAME)" ]; then \
		echo "  ✓ /usr/local/bin/$(VOPS_NAME) already linked"; \
	else \
		sudo ln -s "$(GOPATH_BIN)/$(VOPS_NAME)" "/usr/local/bin/$(VOPS_NAME)" && \
			echo "  ✓ Linked → /usr/local/bin/$(VOPS_NAME)"; \
	fi
	@sudo systemctl start vOps 2>/dev/null && echo "  ✓ vOps started" || echo "  ○ Could not start vOps — start manually: sudo service vOps start"

## Build, install, and restart vProx. Stops vProx → compiles → installs to
## $GOPATH/bin → symlinks into /usr/local/bin (if missing) → restarts vProx.
build-vprox:
	@echo "── Building $(APP_NAME) ─────────────────────────────────────────────────"
	@sudo systemctl stop vProx 2>/dev/null && echo "  ✓ vProx stopped" || echo "  ○ vProx was not running"
	@mkdir -p "$(GOPATH_BIN)"
	@TMP="$$(mktemp)"; \
	GOROOT="$(EFFECTIVE_GOROOT)" go build -ldflags "$(VPROX_LDFLAGS)" -o "$$TMP" "$(BUILD_SRC)" && \
	mv "$$TMP" "$(GOPATH_BIN)/$(APP_NAME)" && chmod +x "$(GOPATH_BIN)/$(APP_NAME)"
	@echo "  ✓ Installed → $(GOPATH_BIN)/$(APP_NAME)"
	@if [ -e "/usr/local/bin/$(APP_NAME)" ]; then \
		echo "  ✓ /usr/local/bin/$(APP_NAME) already linked"; \
	else \
		sudo ln -s "$(GOPATH_BIN)/$(APP_NAME)" "/usr/local/bin/$(APP_NAME)" && \
			echo "  ✓ Linked → /usr/local/bin/$(APP_NAME)"; \
	fi
	@sudo systemctl start vProx 2>/dev/null && echo "  ✓ vProx started" || echo "  ○ Could not start vProx — start manually: sudo service vProx start"

## ─── Upgrade: build-vops + build-vprox, plus service-file drift sync ────────
## Each sub-target already does its own full stop → build → install → start
## cycle; upgrade just adds the one thing they don't cover — re-syncing the
## systemd unit files in case the .service.template files changed.

upgrade: build-vops build-vprox
	@echo "── Syncing service files (in case templates changed) ───────────────────"
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
	fi
	@echo "Re-asserting service state (in case unit files just changed above)..."
	@sudo systemctl start vOps 2>/dev/null && echo "  ✓ vOps started" || echo "  ○ Could not start vOps — start manually: sudo service vOps start"
	@sudo systemctl start vProx 2>/dev/null && echo "  ✓ vProx started" || echo "  ○ Could not start vProx — start manually: sudo service vProx start"

## Remove stale .build/ directory left over from older Makefile versions
## (current build targets no longer write there — binaries go straight to $GOPATH/bin).

clean:
	@echo "Cleaning stale build artifacts..."
	rm -rf "$(BUILD_DIR)" "./$(APP_NAME)"
	@echo "✓ Clean"

## ─── Internal install helpers (not directly callable — run via `make install`) ──

## Stop, disable, and remove stale vProx/vLog service units before a fresh vOps deploy.
## vOps.service is only stopped+disabled — the unit file is NOT removed (reinstalled by _service-vops).
_reset-stale-services:
	@echo "── Resetting stale service units ────────────────────────────────────────"
	@for svc in vProx.service vprox.service vLog.service vlog.service vops.service; do \
		sudo systemctl stop "$$svc" 2>/dev/null || true; \
		sudo systemctl disable "$$svc" 2>/dev/null || true; \
		sudo rm -f "/etc/systemd/system/$$svc"; \
		echo "  ✓ $$svc stopped, disabled, removed"; \
	done
	@sudo systemctl stop vOps.service 2>/dev/null || true
	@sudo systemctl disable vOps.service 2>/dev/null || true
	@sudo systemctl daemon-reload

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

## Render vOps systemd service file, prompt to install it to /etc/systemd/system.

_service-vops:
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

## Render vProx systemd service file, prompt to install it to /etc/systemd/system.

_service-vprox:
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
## Idempotent — only the 'vops' account is created; VOPS_USER must still be set
## explicitly (e.g. `make install VOPS_USER=vops`) to actually use it in the unit.
_system-user-vops:
	@if id vops &>/dev/null; then \
		echo "✓ System user 'vops' already exists"; \
	else \
		echo "Creating system user 'vops' (nologin)..."; \
		sudo useradd -r -s /usr/sbin/nologin -d /nonexistent -c "vOps service account" vops; \
		echo "✓ User 'vops' created"; \
	fi

## Write ALL passwordless sudoers rules for $(SUDOERS_USER) into /etc/sudoers.d/$(SUDOERS_USER).
## Covers: UFW block/unblock, conntrack, apt, systemctl for vOps + vProx.
## Removes legacy /etc/sudoers.d/vops and /etc/sudoers.d/vprox if present.
_sudoers:
	@echo "[info]  writing /etc/sudoers.d/$(SUDOERS_USER)"
	@echo '$(SUDOERS_USER) ALL=(ALL) NOPASSWD: /usr/sbin/ufw deny from *, /usr/sbin/ufw delete deny from *, /usr/sbin/ufw insert 1 deny from * to any, /usr/sbin/conntrack -L -s *, /usr/sbin/conntrack -D -s *, /usr/bin/apt update, /usr/bin/apt upgrade -y, /usr/bin/systemctl stop vOps, /usr/bin/systemctl start vOps, /usr/bin/systemctl restart vOps, /usr/bin/systemctl stop vProx, /usr/bin/systemctl start vProx, /usr/bin/systemctl restart vProx' \
		| sudo tee /etc/sudoers.d/$(SUDOERS_USER) > /dev/null
	@sudo chmod 0440 /etc/sudoers.d/$(SUDOERS_USER)
	@sudo rm -f /etc/sudoers.d/vops /etc/sudoers.d/vprox
	@echo "[ ok ]  /etc/sudoers.d/$(SUDOERS_USER)"

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

## ─── Fresh install (run ON the server after git pull) ────────────────────────
## Phases: reset stale units → sudoers → dirs → geo → env → config → samples →
##         dedicated service user → build both binaries (each installs itself
##         to $GOPATH/bin + symlinks into /usr/local/bin) → (prompt) systemd services.
## Never touches existing config TOML files (only writes if absent).

install: _validate-go _reset-stale-services _sudoers _dirs _geo _env _config _config-vops _config-vprox _samples-fleet _system-user-vops build-vops build-vprox
	@echo ""
	@echo "── Binaries already installed by build-vops/build-vprox above ─────────────"
	@echo "  ✓ $(GOPATH_BIN)/$(VOPS_NAME)  (symlinked from /usr/local/bin/$(VOPS_NAME))"
	@echo "  ✓ $(GOPATH_BIN)/$(APP_NAME)   (symlinked from /usr/local/bin/$(APP_NAME))"
	@echo ""
	@echo "── Systemd services ─────────────────────────────────────────────────────"
	@$(MAKE) --no-print-directory _service-vops
	@$(MAKE) --no-print-directory _service-vprox
	@echo ""
	@echo "── Service status ───────────────────────────────────────────────────────"
	@for S in vOps vProx; do printf "  %-8s %s\n" "$$S:" "$$(systemctl is-active $$S 2>/dev/null || echo inactive)"; done
	@echo ""
	@echo "════════════════════════════════════════════════════════"
	@echo "  ✓ Installation complete"
	@echo "────────────────────────────────────────────────────────"
	@echo "  Binary:    $(GOPATH_BIN)/$(VOPS_NAME), $(GOPATH_BIN)/$(APP_NAME)"
	@echo "  Config:    $(VOPS_HOME)/config/"
	@echo "  Data:      $(DATA_DIR)/"
	@echo "  Samples:   $(VOPS_HOME)/.samples/"
	@echo "────────────────────────────────────────────────────────"
	@echo "  Next steps:"
	@echo "    1. Edit $(VOPS_HOME)/config/vops/vops.toml  — set api_key"
	@echo "    2. Edit $(VOPS_HOME)/config/infra/*.toml    — add VMs (fleet)"
	@echo "    3. sudo service vOps start && sudo service vProx start"
	@echo "    4. make upgrade                             — rebuild + redeploy later"
	@echo "════════════════════════════════════════════════════════"
