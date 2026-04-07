package db

import (
	"database/sql"
	"time"
)

// HostInventory mirrors one row from datacenter_inventory.
type HostInventory struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	HostName   string  `json:"host_name"`
	LanIP      string  `json:"lan_ip"`
	PublicIP   string  `json:"public_ip"`
	VRackIP    string  `json:"vrack_ip"`
	Datacenter string  `json:"datacenter"`
	OS         string  `json:"os"`
	Kernel     string  `json:"kernel"`
	UptimeSec  int64   `json:"uptime_sec"`
	DiskPct    float64 `json:"disk_pct"`
	LoadAvg    string  `json:"load_avg"`
	AptPending int     `json:"apt_pending"`
	LastSeen   string  `json:"last_seen"`
	Status     string  `json:"status"`
}

// UpsertHostInventory inserts or updates a host health snapshot.
func UpsertHostInventory(db *sql.DB, h HostInventory) error {
	if h.LastSeen == "" {
		h.LastSeen = time.Now().UTC().Format(time.RFC3339)
	}
	_, err := db.Exec(`
		INSERT INTO datacenter_inventory
			(name, host_name, lan_ip, public_ip, vrack_ip, datacenter, os, kernel,
			 uptime_sec, disk_pct, load_avg, apt_pending, last_seen, status)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(name) DO UPDATE SET
			host_name    = excluded.host_name,
			lan_ip       = excluded.lan_ip,
			public_ip    = excluded.public_ip,
			vrack_ip     = excluded.vrack_ip,
			datacenter   = excluded.datacenter,
			os           = excluded.os,
			kernel       = excluded.kernel,
			uptime_sec   = excluded.uptime_sec,
			disk_pct     = excluded.disk_pct,
			load_avg     = excluded.load_avg,
			apt_pending  = excluded.apt_pending,
			last_seen    = excluded.last_seen,
			status       = excluded.status`,
		h.Name, h.HostName, h.LanIP, h.PublicIP, h.VRackIP, h.Datacenter,
		h.OS, h.Kernel, h.UptimeSec, h.DiskPct, h.LoadAvg, h.AptPending,
		h.LastSeen, h.Status,
	)
	return err
}

// ListHostInventory returns all rows from datacenter_inventory, ordered by datacenter and name.
func ListHostInventory(db *sql.DB) ([]HostInventory, error) {
	rows, err := db.Query(`
		SELECT id, name, host_name, lan_ip, public_ip, vrack_ip,
		       datacenter, os, kernel, uptime_sec, disk_pct, load_avg,
		       apt_pending, last_seen, status
		FROM datacenter_inventory
		ORDER BY datacenter, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HostInventory
	for rows.Next() {
		var h HostInventory
		if err := rows.Scan(
			&h.ID, &h.Name, &h.HostName, &h.LanIP, &h.PublicIP, &h.VRackIP,
			&h.Datacenter, &h.OS, &h.Kernel, &h.UptimeSec, &h.DiskPct, &h.LoadAvg,
			&h.AptPending, &h.LastSeen, &h.Status,
		); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}
