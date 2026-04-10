package db

import (
	"database/sql"
	"fmt"
	"strings"
)

const schemaSQL = `
CREATE TABLE IF NOT EXISTS ip_accounts (
	ip                TEXT PRIMARY KEY,
	first_seen        TEXT NOT NULL,
	last_seen         TEXT NOT NULL,
	total_requests    INTEGER NOT NULL DEFAULT 0,
	ratelimit_events  INTEGER NOT NULL DEFAULT 0,
	country           TEXT NOT NULL DEFAULT '',
	asn               TEXT NOT NULL DEFAULT '',
	org               TEXT NOT NULL DEFAULT '',
	hostnames         TEXT NOT NULL DEFAULT '[]',
	open_ports        TEXT NOT NULL DEFAULT '[]',
	services          TEXT NOT NULL DEFAULT '{}',
	vt_malicious      INTEGER NOT NULL DEFAULT -1,
	vt_data           TEXT NOT NULL DEFAULT '',
	abuse_score       INTEGER NOT NULL DEFAULT -1,
	abuse_data        TEXT NOT NULL DEFAULT '',
	shodan_data       TEXT NOT NULL DEFAULT '',
	threat_score      INTEGER NOT NULL DEFAULT -1,
	threat_flags      TEXT NOT NULL DEFAULT '[]',
	intel_updated_at  TEXT NOT NULL DEFAULT '',
	notes             TEXT NOT NULL DEFAULT '',
	tags              TEXT NOT NULL DEFAULT '[]',
	status            TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS request_events (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	archive     TEXT NOT NULL,
	ts          TEXT NOT NULL,
	request_id  TEXT NOT NULL DEFAULT '',
	ip          TEXT NOT NULL,
	method      TEXT NOT NULL DEFAULT '',
	path        TEXT NOT NULL DEFAULT '',
	host        TEXT NOT NULL DEFAULT '',
	route       TEXT NOT NULL DEFAULT '',
	status      TEXT NOT NULL DEFAULT '',
	country     TEXT NOT NULL DEFAULT '',
	asn         TEXT NOT NULL DEFAULT '',
	user_agent  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ratelimit_events (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	archive     TEXT NOT NULL,
	ts          TEXT NOT NULL,
	request_id  TEXT NOT NULL DEFAULT '',
	ip          TEXT NOT NULL,
	event       TEXT NOT NULL DEFAULT '',
	reason      TEXT NOT NULL DEFAULT '',
	method      TEXT NOT NULL DEFAULT '',
	path        TEXT NOT NULL DEFAULT '',
	host        TEXT NOT NULL DEFAULT '',
	country     TEXT NOT NULL DEFAULT '',
	asn         TEXT NOT NULL DEFAULT '',
	user_agent  TEXT NOT NULL DEFAULT '',
	rps         REAL NOT NULL DEFAULT 0,
	burst       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ingested_archives (
	filename        TEXT PRIMARY KEY,
	ingested_at     TEXT NOT NULL,
	request_count   INTEGER NOT NULL DEFAULT 0,
	ratelimit_count INTEGER NOT NULL DEFAULT 0,
	size_bytes      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS intel_cache (
	ip         TEXT NOT NULL,
	source     TEXT NOT NULL,
	fetched_at TEXT NOT NULL,
	data       TEXT NOT NULL DEFAULT '',
	PRIMARY KEY (ip, source)
);

CREATE INDEX IF NOT EXISTS idx_request_events_ip ON request_events(ip);
CREATE INDEX IF NOT EXISTS idx_request_events_ts ON request_events(ts);
CREATE INDEX IF NOT EXISTS idx_ratelimit_events_ip ON ratelimit_events(ip);
CREATE INDEX IF NOT EXISTS idx_ratelimit_events_ts ON ratelimit_events(ts);
CREATE INDEX IF NOT EXISTS idx_ip_accounts_status ON ip_accounts(status);
CREATE INDEX IF NOT EXISTS idx_ip_accounts_threat_score ON ip_accounts(threat_score);

CREATE TABLE IF NOT EXISTS blocked_ips (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	ip          TEXT NOT NULL,
	blocked_at  TEXT NOT NULL,
	reason      TEXT NOT NULL DEFAULT '',
	ufw_applied INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_ip ON blocked_ips(ip);

CREATE TABLE IF NOT EXISTS host_traffic (
	host       TEXT PRIMARY KEY,
	http_count INTEGER NOT NULL DEFAULT 0,
	ws_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vm_metrics_history (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	vm_name     TEXT NOT NULL,
	polled_at   TEXT NOT NULL,
	cpu_pct     REAL NOT NULL DEFAULT 0,
	mem_pct     REAL NOT NULL DEFAULT 0,
	storage_pct REAL NOT NULL DEFAULT 0,
	load_avg    TEXT NOT NULL DEFAULT '',
	apt_count   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vm_metrics_vm_polled ON vm_metrics_history(vm_name, polled_at);

CREATE TABLE IF NOT EXISTS datacenter_inventory (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	name            TEXT NOT NULL UNIQUE,
	host_name       TEXT NOT NULL DEFAULT '',
	lan_ip          TEXT NOT NULL DEFAULT '',
	public_ip       TEXT NOT NULL DEFAULT '',
	vrack_ip        TEXT NOT NULL DEFAULT '',
	datacenter      TEXT NOT NULL DEFAULT '',
	os              TEXT NOT NULL DEFAULT '',
	kernel          TEXT NOT NULL DEFAULT '',
	uptime_sec      INTEGER NOT NULL DEFAULT 0,
	disk_pct        REAL NOT NULL DEFAULT 0,
	load_avg        TEXT NOT NULL DEFAULT '',
	apt_pending     INTEGER NOT NULL DEFAULT 0,
	last_seen       TEXT NOT NULL DEFAULT '',
	status          TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_dc_inventory_dc ON datacenter_inventory(datacenter);

CREATE TABLE IF NOT EXISTS audit_log (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	ts          TEXT NOT NULL,
	actor       TEXT NOT NULL DEFAULT 'system',
	action      TEXT NOT NULL,
	target_type TEXT NOT NULL DEFAULT '',
	target_name TEXT NOT NULL DEFAULT '',
	params      TEXT NOT NULL DEFAULT '{}',
	result      TEXT NOT NULL DEFAULT 'ok',
	error       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);

CREATE TABLE IF NOT EXISTS units (
	id                 INTEGER PRIMARY KEY AUTOINCREMENT,
	name               TEXT NOT NULL UNIQUE,
	chain_name         TEXT NOT NULL DEFAULT '',
	chain_id           TEXT NOT NULL DEFAULT '',
	network_type       TEXT NOT NULL DEFAULT 'mainnet',
	node_type          TEXT NOT NULL DEFAULT 'node',
	vm_name            TEXT NOT NULL DEFAULT '',
	datacenter         TEXT NOT NULL DEFAULT '',
	service_name       TEXT NOT NULL DEFAULT '',
	binary_path        TEXT NOT NULL DEFAULT '',
	cosmovisor_path    TEXT NOT NULL DEFAULT '',
	cosmovisor_enabled INTEGER NOT NULL DEFAULT 0,
	config_dir         TEXT NOT NULL DEFAULT '',
	rpc_port           INTEGER NOT NULL DEFAULT 26657,
	api_port           INTEGER NOT NULL DEFAULT 1317,
	p2p_port           INTEGER NOT NULL DEFAULT 26656,
	valoper            TEXT NOT NULL DEFAULT '',
	state              TEXT NOT NULL DEFAULT 'unknown',
	deployed_at        TEXT NOT NULL DEFAULT '',
	notes              TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_units_vm ON units(vm_name);
CREATE INDEX IF NOT EXISTS idx_units_chain ON units(chain_name);

CREATE TABLE IF NOT EXISTS unit_status (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	unit_name      TEXT NOT NULL,
	polled_at      TEXT NOT NULL,
	syncing        INTEGER NOT NULL DEFAULT 0,
	block_height   INTEGER NOT NULL DEFAULT 0,
	peers          INTEGER NOT NULL DEFAULT 0,
	voting_power   INTEGER NOT NULL DEFAULT 0,
	gov_pending    INTEGER NOT NULL DEFAULT 0,
	service_active INTEGER NOT NULL DEFAULT 0,
	error          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_unit_status_unit_polled ON unit_status(unit_name, polled_at);

CREATE TABLE IF NOT EXISTS patch_status (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	target_name      TEXT NOT NULL,
	target_type      TEXT NOT NULL DEFAULT 'vm',
	checked_at       TEXT NOT NULL,
	packages_pending INTEGER NOT NULL DEFAULT 0,
	last_upgraded    TEXT NOT NULL DEFAULT '',
	summary          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_patch_status_target ON patch_status(target_name, target_type);

CREATE TABLE IF NOT EXISTS services (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	name         TEXT NOT NULL UNIQUE,
	service_type TEXT NOT NULL DEFAULT 'other',
	vm_name      TEXT NOT NULL DEFAULT '',
	datacenter   TEXT NOT NULL DEFAULT '',
	chain_id     TEXT NOT NULL DEFAULT '',
	state        TEXT NOT NULL DEFAULT 'unknown',
	config       TEXT NOT NULL DEFAULT '{}',
	created_at   TEXT NOT NULL DEFAULT '',
	updated_at   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_services_type ON services(service_type);
CREATE INDEX IF NOT EXISTS idx_services_vm   ON services(vm_name);

CREATE TABLE IF NOT EXISTS service_status (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	service_id INTEGER NOT NULL,
	polled_at  TEXT NOT NULL,
	online     INTEGER NOT NULL DEFAULT 0,
	metrics    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_service_status_sid ON service_status(service_id, polled_at);

CREATE TABLE IF NOT EXISTS vprox_instances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  url         TEXT    NOT NULL DEFAULT '',
  api_key     TEXT    NOT NULL DEFAULT '',
  datacenter  TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'unknown',
  last_seen   TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
`

// Migrate executes the schema DDL against db, creating all tables and
// indexes if they do not already exist. It also applies column-level
// migrations so existing databases gain new fields safely.
func Migrate(db *sql.DB) error {
	for _, stmt := range strings.Split(schemaSQL, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("migrate: %w\nstatement: %s", err, stmt)
		}
	}

	// Column-level migrations: safe to run on existing databases.
	// SQLite returns "duplicate column name" when the column already exists;
	// we treat that as a no-op.
	osintCols := []string{
		"rdns TEXT NOT NULL DEFAULT ''",
		"abuse_email TEXT NOT NULL DEFAULT ''",
		"moniker TEXT NOT NULL DEFAULT ''",
		"chain_id TEXT NOT NULL DEFAULT ''",
		"ping_ms REAL NOT NULL DEFAULT -1",
		"protocol TEXT NOT NULL DEFAULT ''",
		"osint_updated_at TEXT NOT NULL DEFAULT ''",
	}
	for _, col := range osintCols {
		if err := addColumnIfMissing(db, "ip_accounts", col); err != nil {
			return fmt.Errorf("migrate ip_accounts: %w", err)
		}
	}

	// unit_status: upgrade awareness columns.
	unitStatusCols := []string{
		"upgrade_name TEXT NOT NULL DEFAULT ''",
		"upgrade_height INTEGER NOT NULL DEFAULT 0",
	}
	for _, col := range unitStatusCols {
		if err := addColumnIfMissing(db, "unit_status", col); err != nil {
			return fmt.Errorf("migrate unit_status: %w", err)
		}
	}

	return nil
}

// addColumnIfMissing runs ALTER TABLE tbl ADD COLUMN colDef, silently
// ignoring "duplicate column name" errors (column already present).
func addColumnIfMissing(db *sql.DB, table, colDef string) error {
	_, err := db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s", table, colDef))
	if err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return err
	}
	return nil
}
