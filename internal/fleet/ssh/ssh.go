// Package ssh provides a lightweight SSH client for the fleet module.
// It opens one session per command; callers are responsible for closing
// the Client when done.
package ssh

import (
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// Client wraps an active SSH connection.
// When the connection was established via a ProxyJump, parent holds the jump
// client and is closed automatically when Close() is called.
type Client struct {
	c      *ssh.Client
	parent *Client
}

// expandPath resolves ~ and $HOME in path strings from TOML values.
func expandPath(p string) string {
	p = os.ExpandEnv(p)
	if strings.HasPrefix(p, "~/") {
		if h, err := os.UserHomeDir(); err == nil {
			p = h + p[1:]
		}
	}
	return p
}

// fileExists returns true when path exists and is a regular file.
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// Dial opens an SSH connection to host:port authenticating with the private
// key at keyPath.  When knownHostsPath is non-empty the host key is verified
// against that file; otherwise the connection proceeds without verification
// and a warning is logged.
func Dial(host string, port int, user, keyPath, knownHostsPath string) (*Client, error) {
	keyPath = expandPath(keyPath)

	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("fleet/ssh: read key %s: %w", keyPath, err)
	}

	signer, err := ssh.ParsePrivateKey(keyBytes)
	if err != nil {
		return nil, fmt.Errorf("fleet/ssh: parse key: %w", err)
	}

	var hostKeyCallback ssh.HostKeyCallback
	// When no explicit path is set, fall back to the user's default known_hosts file.
	// This silently enables host-key verification for any host the user has already
	// connected to manually — the common case for fleet VMs.
	if knownHostsPath == "" {
		if h, err := os.UserHomeDir(); err == nil {
			if p := h + "/.ssh/known_hosts"; fileExists(p) {
				knownHostsPath = p
			}
		}
	}
	if knownHostsPath != "" {
		knownHostsPath = expandPath(knownHostsPath)
		cb, khErr := knownhosts.New(knownHostsPath)
		if khErr != nil {
			return nil, fmt.Errorf("fleet/ssh: load known_hosts %s: %w", knownHostsPath, khErr)
		}
		hostKeyCallback = cb
	} else {
		log.Printf("[fleet/ssh] WARNING: host key verification disabled for %s — set known_hosts_path in vops.toml [vops.push.defaults] or run: ssh-keyscan -H %s >> ~/.ssh/known_hosts", host, host)
		hostKeyCallback = ssh.InsecureIgnoreHostKey() //nolint:gosec // explicit config absent and no default known_hosts found
	}

	cfg := &ssh.ClientConfig{
		User:            user,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: hostKeyCallback,
		Timeout:         15 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	c, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return nil, fmt.Errorf("fleet/ssh: dial %s: %w", addr, err)
	}

	return &Client{c: c}, nil
}

// Run executes cmd on the remote host and returns combined stdout+stderr.
// A non-zero exit code is returned as an error alongside any output.
func (c *Client) Run(cmd string) (string, error) {
	sess, err := c.c.NewSession()
	if err != nil {
		return "", fmt.Errorf("fleet/ssh: new session: %w", err)
	}
	defer sess.Close()

	out, err := sess.CombinedOutput(cmd)
	return string(out), err
}

// RunInput executes cmd on the remote host with stdinData piped to stdin,
// and returns combined stdout+stderr. Use for commands that read a password
// from stdin (e.g. sudo -S). A non-zero exit code is returned as an error.
func (c *Client) RunInput(cmd, stdinData string) (string, error) {
	sess, err := c.c.NewSession()
	if err != nil {
		return "", fmt.Errorf("fleet/ssh: new session: %w", err)
	}
	defer sess.Close()

	if stdinData != "" {
		sess.Stdin = strings.NewReader(stdinData)
	}
	out, err := sess.CombinedOutput(cmd)
	return string(out), err
}

// Close releases the underlying SSH connection and any parent jump connection.
func (c *Client) Close() error {
	err := c.c.Close()
	if c.parent != nil {
		if pe := c.parent.Close(); pe != nil && err == nil {
			err = pe
		}
	}
	return err
}

// newClientOverConn establishes an SSH client session over an already-open
// net.Conn (e.g. a tunnel through a jump host).  targetAddr is used only for
// host-key verification and logging; it must be in "host:port" form.
func newClientOverConn(conn net.Conn, targetAddr, user, keyPath, knownHostsPath string) (*Client, error) {
	keyPath = expandPath(keyPath)
	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("fleet/ssh: read key %s: %w", keyPath, err)
	}
	signer, err := ssh.ParsePrivateKey(keyBytes)
	if err != nil {
		return nil, fmt.Errorf("fleet/ssh: parse key: %w", err)
	}

	var hostKeyCallback ssh.HostKeyCallback
	if knownHostsPath == "" {
		if h, err := os.UserHomeDir(); err == nil {
			if p := h + "/.ssh/known_hosts"; fileExists(p) {
				knownHostsPath = p
			}
		}
	}
	if knownHostsPath != "" {
		knownHostsPath = expandPath(knownHostsPath)
		cb, khErr := knownhosts.New(knownHostsPath)
		if khErr != nil {
			return nil, fmt.Errorf("fleet/ssh: load known_hosts %s: %w", knownHostsPath, khErr)
		}
		hostKeyCallback = cb
	} else {
		host, _, _ := net.SplitHostPort(targetAddr)
		if host == "" {
			host = targetAddr
		}
		log.Printf("[fleet/ssh] WARNING: host key verification disabled for %s — add to ~/.ssh/known_hosts", host)
		hostKeyCallback = ssh.InsecureIgnoreHostKey() //nolint:gosec
	}

	cfg := &ssh.ClientConfig{
		User:            user,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: hostKeyCallback,
		Timeout:         15 * time.Second,
	}

	ncc, chans, reqs, err := ssh.NewClientConn(conn, targetAddr, cfg)
	if err != nil {
		return nil, fmt.Errorf("fleet/ssh: connect to %s: %w", targetAddr, err)
	}
	return &Client{c: ssh.NewClient(ncc, chans, reqs)}, nil
}

// DialThrough opens an SSH connection to targetHost:targetPort tunneled through
// the receiver's existing connection (i.e. using c as a ProxyJump).
// The returned Client does NOT close c on Close() — the caller owns c.
func (c *Client) DialThrough(targetHost string, targetPort int, targetUser, targetKeyPath, targetKnownHosts string) (*Client, error) {
	targetAddr := net.JoinHostPort(targetHost, strconv.Itoa(targetPort))
	tunnelConn, err := c.c.Dial("tcp", targetAddr)
	if err != nil {
		return nil, fmt.Errorf("fleet/ssh: tunnel to %s: %w", targetAddr, err)
	}
	tc, err := newClientOverConn(tunnelConn, targetAddr, targetUser, targetKeyPath, targetKnownHosts)
	if err != nil {
		tunnelConn.Close()
		return nil, err
	}
	return tc, nil
}

// DialViaProxy opens an SSH connection to targetHost:targetPort through a
// ProxyJump at jumpHost:jumpPort — equivalent to
//
//	ssh -J jumpUser@jumpHost:jumpPort targetUser@targetHost:targetPort
//
// The returned Client closes both connections on Close().
func DialViaProxy(
	jumpHost string, jumpPort int, jumpUser, jumpKeyPath, jumpKnownHosts string,
	targetHost string, targetPort int, targetUser, targetKeyPath, targetKnownHosts string,
) (*Client, error) {
	jumpClient, err := Dial(jumpHost, jumpPort, jumpUser, jumpKeyPath, jumpKnownHosts)
	if err != nil {
		return nil, fmt.Errorf("fleet/ssh: proxyjump dial %s: %w", jumpHost, err)
	}
	target, err := jumpClient.DialThrough(targetHost, targetPort, targetUser, targetKeyPath, targetKnownHosts)
	if err != nil {
		jumpClient.Close()
		return nil, fmt.Errorf("fleet/ssh: proxyjump tunnel to %s via %s: %w", targetHost, jumpHost, err)
	}
	// Attach jump client as parent so target.Close() cleans up both.
	target.parent = jumpClient
	return target, nil
}
