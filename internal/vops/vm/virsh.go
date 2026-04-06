// Package vm provides a Tier-1 VM Manager that communicates with hypervisor
// hosts via SSH, delegating to the locally installed virsh CLI (libvirt).
// No CGO dependency — all operations are pure string commands over SSH.
package vm

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	fleetssh "github.com/vNodesV/vProx/internal/fleet/ssh"
)

// Domain represents a libvirt domain (virtual machine) on a hypervisor.
type Domain struct {
	Name       string `json:"name"`
	State      string `json:"state"`       // running | shut off | paused | crashed
	CPUs       int    `json:"cpus"`
	MaxMemKiB  int64  `json:"max_mem_kib"`
	UsedMemKiB int64  `json:"used_mem_kib"`
	Persistent bool   `json:"persistent"`
	Autostart  bool   `json:"autostart"`
	UUID       string `json:"uuid,omitempty"`
}

// Snapshot represents a libvirt domain snapshot.
type Snapshot struct {
	Name      string `json:"name"`
	CreatedAt string `json:"created_at,omitempty"`
	State     string `json:"state,omitempty"`
}

// HostInfo holds basic identification data for a hypervisor host.
type HostInfo struct {
	Name       string `json:"name"`
	LanIP      string `json:"lan_ip,omitempty"`
	Datacenter string `json:"datacenter,omitempty"`
	User       string `json:"user,omitempty"`
}

// sshClient is the subset of fleetssh.Client we need.
type sshClient interface {
	Run(cmd string) (string, error)
}

// dialFn is the SSH dial constructor — swappable for tests.
var dialFn = func(host string, port int, user, keyPath, knownHosts string) (sshClient, error) {
	return fleetssh.Dial(host, port, user, keyPath, knownHosts)
}

// dialHost opens an SSH connection to the given hypervisor host.
func dialHost(h HostInfo, port int, keyPath, knownHosts string) (sshClient, error) {
	addr := h.LanIP
	if addr == "" {
		addr = h.Name
	}
	return dialFn(addr, port, h.User, keyPath, knownHosts)
}

// ListDomains returns all libvirt domains visible to virsh on the host,
// including their state, memory, vCPU count, and persistence flags.
func ListDomains(client sshClient) ([]Domain, error) {
	out, err := client.Run("virsh list --all --name")
	if err != nil {
		return nil, fmt.Errorf("virsh list: %w", err)
	}
	var domains []Domain
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}
		d, err := domainInfo(client, name)
		if err != nil {
			// Include domain with minimal info if dominfo fails.
			domains = append(domains, Domain{Name: name, State: "unknown"})
			continue
		}
		domains = append(domains, d)
	}
	return domains, nil
}

// domainInfo fetches detailed info for one domain via virsh dominfo.
func domainInfo(client sshClient, name string) (Domain, error) {
	out, err := client.Run(fmt.Sprintf("virsh dominfo %s", shellescape(name)))
	if err != nil {
		return Domain{Name: name, State: "unknown"}, nil
	}
	d := Domain{Name: name}
	for _, line := range strings.Split(out, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key := strings.TrimSpace(k)
		val := strings.TrimSpace(v)
		switch key {
		case "State":
			d.State = val
		case "UUID":
			d.UUID = val
		case "CPU(s)":
			d.CPUs, _ = strconv.Atoi(val)
		case "Max memory":
			d.MaxMemKiB = parseKiB(val)
		case "Used memory":
			d.UsedMemKiB = parseKiB(val)
		case "Persistent":
			d.Persistent = val == "yes"
		case "Autostart":
			d.Autostart = val == "enable"
		}
	}
	return d, nil
}

// DomainAction executes an action on a domain.
// Supported actions: start, shutdown, destroy (force-off), suspend, resume, reboot.
func DomainAction(client sshClient, domainName, action string) (string, error) {
	var cmd string
	switch action {
	case "start":
		cmd = fmt.Sprintf("virsh start %s", shellescape(domainName))
	case "shutdown":
		cmd = fmt.Sprintf("virsh shutdown %s", shellescape(domainName))
	case "destroy":
		cmd = fmt.Sprintf("virsh destroy %s", shellescape(domainName))
	case "suspend":
		cmd = fmt.Sprintf("virsh suspend %s", shellescape(domainName))
	case "resume":
		cmd = fmt.Sprintf("virsh resume %s", shellescape(domainName))
	case "reboot":
		cmd = fmt.Sprintf("virsh reboot %s", shellescape(domainName))
	default:
		return "", fmt.Errorf("unknown action: %s", action)
	}
	out, err := client.Run(cmd)
	if err != nil {
		return "", fmt.Errorf("virsh %s %s: %w — %s", action, domainName, err, out)
	}
	return strings.TrimSpace(out), nil
}

// ListSnapshots returns the snapshots for a domain, ordered newest-first.
func ListSnapshots(client sshClient, domainName string) ([]Snapshot, error) {
	out, err := client.Run(fmt.Sprintf(
		"virsh snapshot-list %s --name --no-metadata 2>/dev/null || virsh snapshot-list %s --name",
		shellescape(domainName), shellescape(domainName),
	))
	if err != nil {
		return nil, fmt.Errorf("virsh snapshot-list: %w", err)
	}
	var snaps []Snapshot
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		name := strings.TrimSpace(line)
		if name == "" || strings.HasPrefix(name, " Name") || strings.HasPrefix(name, "----") {
			continue
		}
		snaps = append(snaps, Snapshot{Name: name})
	}
	return snaps, nil
}

// CreateSnapshot creates a new snapshot with the given name for domainName.
func CreateSnapshot(client sshClient, domainName, snapName string) error {
	out, err := client.Run(fmt.Sprintf(
		"virsh snapshot-create-as %s %s",
		shellescape(domainName), shellescape(snapName),
	))
	if err != nil {
		return fmt.Errorf("create snapshot: %w — %s", err, out)
	}
	return nil
}

// RevertSnapshot reverts a domain to the named snapshot.
func RevertSnapshot(client sshClient, domainName, snapName string) error {
	out, err := client.Run(fmt.Sprintf(
		"virsh snapshot-revert %s %s",
		shellescape(domainName), shellescape(snapName),
	))
	if err != nil {
		return fmt.Errorf("revert snapshot: %w — %s", err, out)
	}
	return nil
}

// DeleteSnapshot deletes the named snapshot from a domain.
func DeleteSnapshot(client sshClient, domainName, snapName string) error {
	out, err := client.Run(fmt.Sprintf(
		"virsh snapshot-delete %s %s",
		shellescape(domainName), shellescape(snapName),
	))
	if err != nil {
		return fmt.Errorf("delete snapshot: %w — %s", err, out)
	}
	return nil
}

// DomainStats returns CPU, memory, and disk I/O stats for a running domain.
// Returns empty map if the domain is not running (virsh domstats will error).
func DomainStats(client sshClient, domainName string) (map[string]string, error) {
	out, err := client.Run(fmt.Sprintf(
		"virsh domstats --raw %s 2>/dev/null", shellescape(domainName),
	))
	if err != nil {
		return map[string]string{}, nil
	}
	stats := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		stats[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return stats, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

var reUnsafe = regexp.MustCompile(`[^a-zA-Z0-9_\-\.]`)

// shellescape naively wraps a name in single quotes after stripping unsafe chars.
// Domain/snapshot names in libvirt are restricted to [a-z0-9_-.] so this is
// primarily a defensive measure against unexpected characters.
func shellescape(s string) string {
	s = reUnsafe.ReplaceAllString(s, "")
	return "'" + s + "'"
}

// parseKiB parses strings like "8388608 KiB" → int64.
func parseKiB(s string) int64 {
	s = strings.TrimSuffix(strings.TrimSpace(s), " KiB")
	s = strings.TrimSuffix(s, " kB")
	n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return n
}
