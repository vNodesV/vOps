package db

import (
	"database/sql"
	"fmt"
	"time"
)

// VMMetricPoint holds one historical data sample for a VM.
type VMMetricPoint struct {
	PolledAt   string  `json:"polled_at"`
	CPUPct     float64 `json:"cpu_pct"`
	MemPct     float64 `json:"mem_pct"`
	StoragePct float64 `json:"storage_pct"`
	LoadAvg    string  `json:"load_avg"`
	AptCount   int     `json:"apt_count"`
}

// InsertVMMetric stores a single metric snapshot for vmName.
// Rows older than 48 h are pruned after the insert to cap table growth.
func InsertVMMetric(d *sql.DB, vmName string, cpu, mem, storage float64, loadAvg string, aptCount int) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := d.Exec(
		`INSERT INTO vm_metrics_history (vm_name, polled_at, cpu_pct, mem_pct, storage_pct, load_avg, apt_count)
		 VALUES (?,?,?,?,?,?,?)`,
		vmName, now, cpu, mem, storage, loadAvg, aptCount,
	)
	if err != nil {
		return fmt.Errorf("insert vm metric: %w", err)
	}
	// Prune rows older than 48 h to keep the table bounded.
	cutoff := time.Now().UTC().Add(-48 * time.Hour).Format(time.RFC3339)
	_, _ = d.Exec(`DELETE FROM vm_metrics_history WHERE vm_name=? AND polled_at < ?`, vmName, cutoff)
	return nil
}

// GetVMHistory returns up to 200 metric points for vmName collected in the last
// hours hours, ordered oldest-first (suitable for chart rendering).
func GetVMHistory(d *sql.DB, vmName string, hours int) ([]VMMetricPoint, error) {
	if hours <= 0 {
		hours = 24
	}
	cutoff := time.Now().UTC().Add(-time.Duration(hours) * time.Hour).Format(time.RFC3339)
	rows, err := d.Query(
		`SELECT polled_at, cpu_pct, mem_pct, storage_pct, load_avg, apt_count
		 FROM vm_metrics_history
		 WHERE vm_name=? AND polled_at >= ?
		 ORDER BY polled_at ASC
		 LIMIT 200`,
		vmName, cutoff,
	)
	if err != nil {
		return nil, fmt.Errorf("query vm history: %w", err)
	}
	defer rows.Close()

	var pts []VMMetricPoint
	for rows.Next() {
		var p VMMetricPoint
		if err := rows.Scan(&p.PolledAt, &p.CPUPct, &p.MemPct, &p.StoragePct, &p.LoadAvg, &p.AptCount); err != nil {
			return nil, err
		}
		pts = append(pts, p)
	}
	return pts, rows.Err()
}
