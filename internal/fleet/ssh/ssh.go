// Package ssh provides a lightweight SSH client for the fleet module.
// It opens one session per command; callers are responsible for closing
// the Client when done.
package ssh

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha1" //nolint:gosec // SHA1 required for RFC 4253 SSH known_hosts HMAC format
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/vNodesV/vOps/internal/logging"
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
	var hostKeyAlgos []string
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
		// Constrain the client to only offer host-key algorithms present in
		// known_hosts for this specific host.  Without this, Go's SSH library
		// may negotiate ecdsa or rsa while known_hosts only has ed25519 (or
		// vice-versa), causing a "key mismatch" error even though the right
		// key exists in the file under a different algorithm name.
		if algos := hostKeyAlgosFromFile(knownHostsPath, fmt.Sprintf("%s:%d", host, port)); len(algos) > 0 {
			hostKeyAlgos = algos
		}
	} else {
		logging.Print("WRN", "fleet/ssh", "host key verification disabled — set known_hosts_path in vops.toml or run: ssh-keyscan -H <host> >> ~/.ssh/known_hosts", logging.F("host", host))
		hostKeyCallback = ssh.InsecureIgnoreHostKey() //nolint:gosec // explicit config absent and no default known_hosts found
	}

	cfg := &ssh.ClientConfig{
		User:              user,
		Auth:              []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback:   hostKeyCallback,
		HostKeyAlgorithms: hostKeyAlgos,
		Timeout:           15 * time.Second,
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

// RunStream executes cmd on the remote host, calling lineCallback for each
// line of combined stdout+stderr as it arrives. If stdinData is non-empty it
// is written to the process stdin before the command starts (use for sudo -S).
// Returns the remote exit error when the command finishes.
func (c *Client) RunStream(cmd, stdinData string, lineCallback func(line string)) error {
	sess, err := c.c.NewSession()
	if err != nil {
		return fmt.Errorf("fleet/ssh: new session: %w", err)
	}
	defer sess.Close()

	if stdinData != "" {
		sess.Stdin = strings.NewReader(stdinData)
	}

	// Merge stdout and stderr through a single pipe to preserve natural ordering.
	pr, pw := io.Pipe()
	sess.Stdout = pw
	sess.Stderr = pw

	if startErr := sess.Start(cmd); startErr != nil {
		pw.CloseWithError(startErr)
		pr.Close()
		return fmt.Errorf("fleet/ssh: start: %w", startErr)
	}

	// Drain the pipe in the background until EOF (signalled by pw.Close below).
	done := make(chan struct{})
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(pr)
		scanner.Buffer(make([]byte, 64*1024), 64*1024)
		for scanner.Scan() {
			lineCallback(scanner.Text())
		}
	}()

	waitErr := sess.Wait()
	pw.Close() // EOF for the scanner goroutine.
	pr.Close() // reclaim pipe resources.
	<-done     // wait for all buffered lines to be delivered.

	return waitErr
}

// ShellSession wraps an interactive PTY session on the remote host.
// It implements io.ReadWriteCloser: Write sends to SSH stdin, Read returns
// merged stdout+stderr, and Close tears down the session.
type ShellSession struct {
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
}

// Write sends p to the remote shell's stdin.
func (s *ShellSession) Write(p []byte) (int, error) { return s.stdin.Write(p) }

// Read returns merged stdout+stderr from the remote shell.
func (s *ShellSession) Read(p []byte) (int, error) { return s.stdout.Read(p) }

// Close terminates the interactive shell session.
func (s *ShellSession) Close() error {
	_ = s.stdin.Close()
	return s.session.Close()
}

// Resize sends a window-change request to the remote PTY.
func (s *ShellSession) Resize(rows, cols int) error {
	return s.session.WindowChange(rows, cols)
}

// Shell opens an interactive PTY session on the remote host.
// The caller is responsible for closing the returned ShellSession.
func (c *Client) Shell() (*ShellSession, error) {
	sess, err := c.c.NewSession()
	if err != nil {
		return nil, fmt.Errorf("fleet/ssh: new session: %w", err)
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		sess.Close()
		return nil, fmt.Errorf("fleet/ssh: request pty: %w", err)
	}

	stdinPipe, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		return nil, fmt.Errorf("fleet/ssh: stdin pipe: %w", err)
	}
	stdoutPipe, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		return nil, fmt.Errorf("fleet/ssh: stdout pipe: %w", err)
	}
	stderrPipe, err := sess.StderrPipe()
	if err != nil {
		sess.Close()
		return nil, fmt.Errorf("fleet/ssh: stderr pipe: %w", err)
	}

	if err := sess.Shell(); err != nil {
		sess.Close()
		return nil, fmt.Errorf("fleet/ssh: start shell: %w", err)
	}

	return &ShellSession{
		session: sess,
		stdin:   stdinPipe,
		stdout:  io.MultiReader(stdoutPipe, stderrPipe),
	}, nil
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
	var hostKeyAlgos []string
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
		if algos := hostKeyAlgosFromFile(knownHostsPath, targetAddr); len(algos) > 0 {
			hostKeyAlgos = algos
		}
	} else {
		host, _, _ := net.SplitHostPort(targetAddr)
		if host == "" {
			host = targetAddr
		}
		logging.Print("WRN", "fleet/ssh", "host key verification disabled — add host to ~/.ssh/known_hosts", logging.F("host", host))
		hostKeyCallback = ssh.InsecureIgnoreHostKey() //nolint:gosec
	}

	cfg := &ssh.ClientConfig{
		User:              user,
		Auth:              []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback:   hostKeyCallback,
		HostKeyAlgorithms: hostKeyAlgos,
		Timeout:           15 * time.Second,
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

// hostKeyAlgosFromFile parses knownHostsPath and returns all SSH host-key
// algorithm types stored for addr ("host:port" form).  The result is used to
// set HostKeyAlgorithms in the SSH ClientConfig so the handshake only
// negotiates algorithms actually present in the file — preventing the
// "key mismatch" error that occurs when Go's SSH library proposes ecdsa while
// the file only contains an ed25519 entry (or vice-versa).
//
// Both plaintext and hashed (|1|salt|hash) known_hosts patterns are handled.
func hostKeyAlgosFromFile(knownHostsPath, addr string) []string {
	norm := knownhosts.Normalize(addr)
	host, _, err := net.SplitHostPort(norm)
	if err != nil {
		host = norm
	}

	f, err := os.Open(knownHostsPath) //nolint:gosec // operator-controlled path
	if err != nil {
		return nil
	}
	defer f.Close()

	seen := make(map[string]bool)
	var algos []string

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		fields := strings.Fields(line)
		var patterns, keyType string
		switch fields[0] {
		case "@cert-authority", "@revoked":
			if len(fields) < 4 {
				continue
			}
			patterns, keyType = fields[1], fields[2]
		default:
			if len(fields) < 3 {
				continue
			}
			patterns, keyType = fields[0], fields[1]
		}

		if knownHostPatternsMatch(patterns, host, norm) && !seen[keyType] {
			seen[keyType] = true
			algos = append(algos, keyType)
		}
	}
	return algos
}

// knownHostPatternsMatch returns true if any comma-separated pattern in the
// patterns field of a known_hosts line matches host or normalizedAddr.
// Handles both hashed (|1|salt|hash) and plaintext/wildcard patterns.
func knownHostPatternsMatch(patterns, host, normalizedAddr string) bool {
	for _, pat := range strings.Split(patterns, ",") {
		pat = strings.TrimSpace(pat)
		if pat == "" {
			continue
		}
		negate := strings.HasPrefix(pat, "!")
		if negate {
			pat = pat[1:]
		}
		var matched bool
		if strings.HasPrefix(pat, "|1|") {
			matched = knownHostHashMatches(pat, host) || knownHostHashMatches(pat, normalizedAddr)
		} else {
			matched = pat == host || pat == normalizedAddr || knownHostWildcard(pat, host)
		}
		if negate && matched {
			return false
		}
		if !negate && matched {
			return true
		}
	}
	return false
}

// knownHostHashMatches verifies a hashed known_hosts pattern |1|salt|hash
// against hostname using HMAC-SHA1 (RFC 4253 §4).
func knownHostHashMatches(pattern, hostname string) bool {
	parts := strings.SplitN(pattern, "|", 4)
	if len(parts) != 4 || parts[1] != "1" {
		return false
	}
	salt, err1 := base64.StdEncoding.DecodeString(parts[2])
	want, err2 := base64.StdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	mac := hmac.New(sha1.New, salt) //nolint:gosec // SHA1 is mandated by the SSH known_hosts RFC
	mac.Write([]byte(hostname))
	return hmac.Equal(mac.Sum(nil), want)
}

// knownHostWildcard performs SSH wildcard matching: * matches any sequence,
// ? matches any single character.
func knownHostWildcard(pattern, s string) bool {
	for len(pattern) > 0 {
		switch pattern[0] {
		case '*':
			pattern = pattern[1:]
			if len(pattern) == 0 {
				return true
			}
			for i := range len(s) + 1 {
				if knownHostWildcard(pattern, s[i:]) {
					return true
				}
			}
			return false
		case '?':
			if len(s) == 0 {
				return false
			}
			pattern, s = pattern[1:], s[1:]
		default:
			if len(s) == 0 || pattern[0] != s[0] {
				return false
			}
			pattern, s = pattern[1:], s[1:]
		}
	}
	return len(s) == 0
}
