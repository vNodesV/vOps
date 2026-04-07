// Package vm provides a Tier-1 VM Manager that communicates with hypervisor
// hosts via SSH, delegating to the locally installed virsh CLI (libvirt).
// No CGO dependency — all operations are pure string commands over SSH.
package vm

import (
	"encoding/base64"
	"fmt"
	"path/filepath"
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

// ── Network & interface types ──────────────────────────────────────────────────

// Network represents a libvirt virtual network on a hypervisor.
type Network struct {
	Name       string `json:"name"`
	State      string `json:"state"`      // active | inactive
	Autostart  bool   `json:"autostart"`
	Persistent bool   `json:"persistent"`
}

// Interface represents one network interface attached to a domain.
type Interface struct {
	Interface string `json:"interface"` // e.g. vnet0
	Type      string `json:"type"`      // network | bridge
	Source    string `json:"source"`    // network/bridge name
	Model     string `json:"model"`     // virtio | e1000
	MAC       string `json:"mac"`
}

// ── VM lifecycle option types ──────────────────────────────────────────────────

// UndefineOpts controls the behaviour of UndefineVM.
type UndefineOpts struct {
	// DeleteStorage removes the managed qcow2 disk from Pool (default "default").
	DeleteStorage bool
	Pool          string
}

// CloneOpts describes parameters for cloning an existing VM via virt-clone.
// virt-clone is part of the virtinst package (apt install virtinst on hypervisor).
type CloneOpts struct {
	SourceDomain string // existing domain to clone
	NewName      string // new domain name
	// NewDiskPath is the full path for the cloned disk; empty = auto-derive.
	NewDiskPath string
	Pool        string // storage pool (default: "default")
	MemMiB      int64  // override memory in MiB (0 = keep source value)
	VCPUs       int    // override vCPU count (0 = keep source value)
}

// CreateFromImageOpts describes parameters for deploying a new VM from a base image
// via virt-install --import (part of the virtinst package).
type CreateFromImageOpts struct {
	Name       string
	BaseImage  string // full path to source qcow2 (e.g. pool boot-1)
	DiskPath   string // destination path in pool default
	DiskSizeGB int    // grow disk after copy; 0 = no resize
	MemMiB     int64
	VCPUs      int
	Network    string // libvirt network name (default: "default")
	OSVariant  string // virt-install --os-variant hint (e.g. "ubuntu22.04"; empty = "generic")
}

// ── New virsh operations ───────────────────────────────────────────────────────

// ListNetworks returns all libvirt virtual networks on the host.
func ListNetworks(client sshClient) ([]Network, error) {
	out, err := client.Run("virsh net-list --all 2>&1")
	if err != nil {
		return nil, fmt.Errorf("virsh net-list: %w", err)
	}
	var nets []Network
	for i, line := range strings.Split(out, "\n") {
		if i < 2 {
			continue
		}
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "-") {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		nets = append(nets, Network{
			Name:       f[0],
			State:      f[1],
			Autostart:  f[2] == "yes",
			Persistent: len(f) > 3 && f[3] == "yes",
		})
	}
	return nets, nil
}

// ListDomainInterfaces returns the network interfaces attached to a domain.
func ListDomainInterfaces(client sshClient, domainName string) ([]Interface, error) {
	out, err := client.Run(fmt.Sprintf("virsh domiflist %s 2>&1", shellescape(domainName)))
	if err != nil {
		return nil, fmt.Errorf("virsh domiflist: %w", err)
	}
	var ifaces []Interface
	for i, line := range strings.Split(out, "\n") {
		if i < 2 {
			continue
		}
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "-") {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 5 {
			continue
		}
		ifaces = append(ifaces, Interface{
			Interface: f[0],
			Type:      f[1],
			Source:    f[2],
			Model:     f[3],
			MAC:       f[4],
		})
	}
	return ifaces, nil
}

// UndefineVM removes a domain definition from libvirt.
// If opts.DeleteStorage is true, it also deletes managed disk volumes.
// The domain is force-stopped first when it is running.
func UndefineVM(client sshClient, domainName string, opts UndefineOpts) error {
	// Force-stop if running.
	state, _ := getDomainState(client, domainName)
	if strings.Contains(state, "running") {
		out, err := client.Run(fmt.Sprintf("virsh destroy %s 2>&1", shellescape(domainName)))
		if err != nil {
			return fmt.Errorf("virsh destroy: %w — %s", err, out)
		}
	}

	// Collect disk paths before undefine (blklist is only available while defined).
	var diskPaths []string
	if opts.DeleteStorage {
		diskPaths, _ = domainDiskPaths(client, domainName)
	}

	// Undefine; --nvram removes firmware state for UEFI guests.
	out, err := client.Run(fmt.Sprintf(
		"virsh undefine %s --nvram 2>/dev/null || virsh undefine %s 2>&1",
		shellescape(domainName), shellescape(domainName),
	))
	if err != nil {
		return fmt.Errorf("virsh undefine: %w — %s", err, out)
	}

	if opts.DeleteStorage {
		pool := opts.Pool
		if pool == "" {
			pool = "default"
		}
		for _, path := range diskPaths {
			vol := filepath.Base(path)
			// Try pool-aware vol-delete first; fall back to direct rm.
			_, _ = client.Run(fmt.Sprintf(
				"virsh vol-delete %s --pool %s 2>/dev/null || rm -f %s 2>&1",
				shellescape(vol), shellescape(pool), shellquote(path),
			))
		}
	}
	return nil
}

// SetVCPUs changes the vCPU count for a domain.
// The change is always persisted to the domain config.
// If live is true and the domain is running, a hot-plug change is also attempted
// (requires the guest to support CPU hot-plug).
func SetVCPUs(client sshClient, domainName string, count int, live bool) error {
	n := strconv.Itoa(count)
	if out, err := client.Run(fmt.Sprintf(
		"virsh setvcpus %s %s --config 2>&1", shellescape(domainName), n,
	)); err != nil {
		return fmt.Errorf("virsh setvcpus --config: %w — %s", err, out)
	}
	if live {
		if out, err := client.Run(fmt.Sprintf(
			"virsh setvcpus %s %s --live 2>&1", shellescape(domainName), n,
		)); err != nil {
			return fmt.Errorf("virsh setvcpus --live: %w — %s", err, out)
		}
	}
	return nil
}

// SetMemory changes the memory allocation for a domain (value in MiB).
// The change is always persisted to the domain config.
// If live is true and the domain is running, a balloon change is also attempted
// (requires the guest to have a virtio-balloon device).
func SetMemory(client sshClient, domainName string, mib int64, live bool) error {
	kib := strconv.FormatInt(mib*1024, 10)
	// Set max memory before current to avoid "cannot exceed max" errors.
	for _, cmd := range []string{
		fmt.Sprintf("virsh setmaxmem %s %s --config 2>&1", shellescape(domainName), kib),
		fmt.Sprintf("virsh setmem %s %s --config 2>&1", shellescape(domainName), kib),
	} {
		if out, err := client.Run(cmd); err != nil {
			return fmt.Errorf("virsh setmem --config: %w — %s", err, out)
		}
	}
	if live {
		if out, err := client.Run(fmt.Sprintf(
			"virsh setmem %s %s --live 2>&1", shellescape(domainName), kib,
		)); err != nil {
			return fmt.Errorf("virsh setmem --live: %w — %s", err, out)
		}
	}
	return nil
}

// CloneVM clones an existing VM using virt-clone (part of the virtinst package).
// If virt-clone is not installed on the hypervisor, the call returns an error with
// installation instructions.
func CloneVM(client sshClient, opts CloneOpts) error {
	// Build virt-clone command.
	args := fmt.Sprintf("--original %s --name %s", shellescape(opts.SourceDomain), shellescape(opts.NewName))
	if opts.NewDiskPath != "" {
		args += " --file " + shellquote(opts.NewDiskPath)
	} else {
		args += " --auto-clone"
	}
	out, err := client.Run(fmt.Sprintf("virt-clone %s 2>&1", args))
	if err != nil {
		if strings.Contains(out, "not found") || strings.Contains(err.Error(), "not found") ||
			strings.Contains(out, "No such file or directory") {
			return fmt.Errorf("virt-clone not found — install virtinst on the hypervisor: apt install virtinst\noriginal error: %s", out)
		}
		return fmt.Errorf("virt-clone: %w — %s", err, out)
	}

	// Apply memory/vcpu overrides after clone.
	if opts.MemMiB > 0 {
		if err := SetMemory(client, opts.NewName, opts.MemMiB, false); err != nil {
			return fmt.Errorf("clone memory override: %w", err)
		}
	}
	if opts.VCPUs > 0 {
		if err := SetVCPUs(client, opts.NewName, opts.VCPUs, false); err != nil {
			return fmt.Errorf("clone vcpu override: %w", err)
		}
	}
	return nil
}

// CreateVMFromImage deploys a new VM by copying a base qcow2 image and importing it
// with virt-install --import (part of the virtinst package).
// The base image is copied to DiskPath and optionally grown before import.
func CreateVMFromImage(client sshClient, opts CreateFromImageOpts) error {
	// 1. Copy base image.
	out, err := client.Run(fmt.Sprintf("cp %s %s 2>&1", shellquote(opts.BaseImage), shellquote(opts.DiskPath)))
	if err != nil {
		return fmt.Errorf("copy base image: %w — %s", err, out)
	}

	// 2. Optionally resize.
	if opts.DiskSizeGB > 0 {
		out, err = client.Run(fmt.Sprintf(
			"qemu-img resize %s %dG 2>&1", shellquote(opts.DiskPath), opts.DiskSizeGB,
		))
		if err != nil {
			// Non-fatal: remove copied disk and report.
			_, _ = client.Run("rm -f " + shellquote(opts.DiskPath) + " 2>/dev/null")
			return fmt.Errorf("resize disk: %w — %s", err, out)
		}
	}

	// 3. Build virt-install --import command.
	network := opts.Network
	if network == "" {
		network = "default"
	}
	osVariant := opts.OSVariant
	if osVariant == "" {
		osVariant = "generic"
	}

	viCmd := fmt.Sprintf(
		"virt-install --name %s --memory %d --vcpus %d"+
			" --disk path=%s,format=qcow2"+
			" --import --os-variant %s --network network=%s"+
			" --noautoconsole 2>&1",
		shellescape(opts.Name), opts.MemMiB, opts.VCPUs,
		shellquote(opts.DiskPath),
		shellescape(osVariant), shellescape(network),
	)

	out, err = client.Run(viCmd)
	if err != nil {
		if strings.Contains(out, "not found") || strings.Contains(err.Error(), "not found") ||
			strings.Contains(out, "No such file or directory") {
			_, _ = client.Run("rm -f " + shellquote(opts.DiskPath) + " 2>/dev/null")
			return fmt.Errorf("virt-install not found — install virtinst: apt install virtinst\noriginal error: %s", out)
		}
		// Clean up copied disk on failure.
		_, _ = client.Run("rm -f " + shellquote(opts.DiskPath) + " 2>/dev/null")
		return fmt.Errorf("virt-install: %w — %s", err, out)
	}
	return nil
}

// ── private helpers ────────────────────────────────────────────────────────────

// getDomainState returns the current state string for a domain (e.g. "running", "shut off").
func getDomainState(client sshClient, domainName string) (string, error) {
	out, err := client.Run(fmt.Sprintf("virsh domstate %s 2>&1", shellescape(domainName)))
	if err != nil {
		return "", fmt.Errorf("virsh domstate: %w", err)
	}
	return strings.TrimSpace(out), nil
}

// domainDiskPaths returns the full file paths of all disk volumes attached to a domain.
func domainDiskPaths(client sshClient, domainName string) ([]string, error) {
	out, err := client.Run(fmt.Sprintf("virsh domblklist %s --details 2>&1", shellescape(domainName)))
	if err != nil {
		return nil, fmt.Errorf("virsh domblklist: %w", err)
	}
	var paths []string
	for i, line := range strings.Split(out, "\n") {
		if i < 2 {
			continue
		}
		f := strings.Fields(line)
		// Fields: Type  Device  Target  Source
		// Only "file" type disks have a real path.
		if len(f) < 4 || f[0] != "file" {
			continue
		}
		src := f[3]
		if src != "" && src != "-" {
			paths = append(paths, src)
		}
	}
	return paths, nil
}

// shellquote wraps a string in single quotes and escapes any embedded single quotes.
// Use this for file paths and any string that may contain special shell characters.
// For domain/snapshot names (restricted charset) prefer shellescape.
func shellquote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// writeViaBase64 writes content to a remote file path by encoding it as base64
// and decoding it on the remote side. Safe for arbitrary binary or text content.
// Used internally for writing XML files to the hypervisor.
func writeViaBase64(client sshClient, content, remotePath string) error {
	b64 := base64.StdEncoding.EncodeToString([]byte(content))
	// base64 alphabet [A-Za-z0-9+/=] is safe inside single quotes.
	cmd := fmt.Sprintf("printf '%%s' '%s' | base64 -d > %s 2>&1", b64, shellquote(remotePath))
	out, err := client.Run(cmd)
	if err != nil {
		return fmt.Errorf("write %s: %w — %s", remotePath, err, out)
	}
	return nil
}

// rewriteDomainXML replaces name, clears UUID, replaces disk source path, and
// optionally overrides memory/vcpu in a virsh dumpxml output string.
// Used as a fallback when virt-clone is unavailable.
var (
	reDomName  = regexp.MustCompile(`<name>[^<]*</name>`)
	reDomUUID  = regexp.MustCompile(`<uuid>[0-9a-f\-]+</uuid>`)
	reDomDisk  = regexp.MustCompile(`(<source file=')[^']*('/>)`)
	reDomMAC   = regexp.MustCompile(`<mac address='[^']*'/>`)
	reDomMem   = regexp.MustCompile(`<memory[^>]*>[^<]*</memory>`)
	reDomCurM  = regexp.MustCompile(`<currentMemory[^>]*>[^<]*</currentMemory>`)
	reDomVCPU  = regexp.MustCompile(`<vcpu[^>]*>[^<]*</vcpu>`)
)

func rewriteDomainXML(src, newName, newDisk string, memMiB int64, vcpus int) string {
	s := reDomName.ReplaceAllLiteralString(src, "<name>"+newName+"</name>")
	s = reDomUUID.ReplaceAllLiteralString(s, "")
	s = reDomDisk.ReplaceAllString(s, "${1}"+newDisk+"${2}")
	s = reDomMAC.ReplaceAllLiteralString(s, "")
	if memMiB > 0 {
		kib := fmt.Sprintf("%d", memMiB*1024)
		s = reDomMem.ReplaceAllLiteralString(s, "<memory unit='KiB'>"+kib+"</memory>")
		s = reDomCurM.ReplaceAllLiteralString(s, "<currentMemory unit='KiB'>"+kib+"</currentMemory>")
	}
	if vcpus > 0 {
		s = reDomVCPU.ReplaceAllString(s, fmt.Sprintf("<vcpu placement='static'>%d</vcpu>", vcpus))
	}
	return s
}
