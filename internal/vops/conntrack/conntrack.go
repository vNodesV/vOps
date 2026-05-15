package conntrack

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// IsAvailable reports whether conntrack-tools is installed at the canonical path.
func IsAvailable() bool {
	_, err := os.Stat("/usr/sbin/conntrack")
	return err == nil
}

// Count returns the number of active kernel connection-tracking entries for the
// given source IP. Returns (0, nil) when conntrack is not installed — soft fail.
func Count(ip string) (int, error) {
	if net.ParseIP(ip) == nil {
		return 0, fmt.Errorf("conntrack: invalid IP: %q", ip)
	}
	if !IsAvailable() {
		return 0, nil
	}
	// -L lists entries; -s filters by source IP.
	// stdout: one entry per line. stderr: summary ("N flow entries listed.") — discarded.
	cmd := exec.Command("sudo", "-n", "/usr/sbin/conntrack", "-L", "-s", ip)
	out, _ := cmd.Output() // stdout only; non-zero exit when no entries is fine
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		return 0, nil
	}
	return strings.Count(trimmed, "\n") + 1, nil
}

// Sever deletes all kernel connection-tracking entries for the given source IP.
// The kernel sends TCP RST to both sides, closing all established connections
// immediately. Returns the number of connections severed.
// Returns (0, nil) when conntrack is not installed — soft fail.
func Sever(ip string) (int, error) {
	if net.ParseIP(ip) == nil {
		return 0, fmt.Errorf("conntrack: invalid IP: %q", ip)
	}
	if !IsAvailable() {
		return 0, nil
	}
	cmd := exec.Command("sudo", "-n", "/usr/sbin/conntrack", "-D", "-s", ip)
	out, err := cmd.CombinedOutput()
	if err != nil {
		// exit code 1 means no entries matched — not a real error
		if exitCode(err) == 1 {
			return 0, nil
		}
		return 0, fmt.Errorf("conntrack -D -s %s: %w: %s", ip, err, strings.TrimSpace(string(out)))
	}
	return parseDeletedCount(string(out)), nil
}

// parseDeletedCount extracts the integer from conntrack's deletion summary line.
// e.g. "conntrack v1.4.7 (conntrack-tools): 30 flow entries have been deleted."
func parseDeletedCount(out string) int {
	for _, line := range strings.Split(out, "\n") {
		if i := strings.Index(line, " flow entries"); i > 0 {
			parts := strings.Fields(line[:i])
			if len(parts) > 0 {
				if n, err := strconv.Atoi(parts[len(parts)-1]); err == nil {
					return n
				}
			}
		}
	}
	return 0
}

func exitCode(err error) int {
	if ee, ok := err.(*exec.ExitError); ok {
		return ee.ExitCode()
	}
	return -1
}
