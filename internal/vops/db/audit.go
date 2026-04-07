package db

import (
	"database/sql"
	"time"
)

// AuditEntry represents one management action row in audit_log.
type AuditEntry struct {
	ID         int64  `json:"id"`
	TS         string `json:"ts"`
	Actor      string `json:"actor"`
	Action     string `json:"action"`
	TargetType string `json:"target_type"`
	TargetName string `json:"target_name"`
	Params     string `json:"params"`
	Result     string `json:"result"`
	Error      string `json:"error,omitempty"`
}

// InsertAuditLog records a management action. Zero-value fields receive defaults.
func InsertAuditLog(db *sql.DB, e AuditEntry) error {
	if e.TS == "" {
		e.TS = time.Now().UTC().Format(time.RFC3339)
	}
	if e.Actor == "" {
		e.Actor = "system"
	}
	if e.Result == "" {
		e.Result = "ok"
	}
	if e.Params == "" {
		e.Params = "{}"
	}
	_, err := db.Exec(`
		INSERT INTO audit_log (ts, actor, action, target_type, target_name, params, result, error)
		VALUES (?,?,?,?,?,?,?,?)`,
		e.TS, e.Actor, e.Action, e.TargetType, e.TargetName, e.Params, e.Result, e.Error,
	)
	return err
}

// ListAuditLog returns the latest limit entries from audit_log, newest-first.
func ListAuditLog(db *sql.DB, limit, offset int) ([]AuditEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := db.Query(`
		SELECT id, ts, actor, action, target_type, target_name, params, result, error
		FROM audit_log
		ORDER BY ts DESC
		LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(
			&e.ID, &e.TS, &e.Actor, &e.Action,
			&e.TargetType, &e.TargetName, &e.Params,
			&e.Result, &e.Error,
		); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
