package vprox

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Status represents the running state of a Controller-managed Server.
type Status int

const (
	StatusStopped  Status = iota // Server not started.
	StatusStarting               // Server is initialising.
	StatusRunning                // Server accepted requests.
	StatusError                  // Server exited with error.
)

func (s Status) String() string {
	switch s {
	case StatusStopped:
		return "stopped"
	case StatusStarting:
		return "starting"
	case StatusRunning:
		return "running"
	case StatusError:
		return "error"
	default:
		return "unknown"
	}
}

// Controller manages the lifecycle of an embedded vProx Server.
// It is safe for concurrent use.
type Controller struct {
	cfg Config

	mu        sync.Mutex
	status    Status
	lastErr   error
	startedAt time.Time // zero until first successful Start

	server *Server
	cancel context.CancelFunc
	done   chan struct{} // closed when server goroutine exits
}

// NewController returns a Controller configured with cfg.
// Call Start to launch the embedded proxy.
func NewController(cfg Config) *Controller {
	return &Controller{
		cfg:    cfg,
		status: StatusStopped,
	}
}

// effectiveServiceName returns the systemd unit name (without .service suffix).
func (c *Controller) effectiveServiceName() string {
	if c.cfg.ServiceName != "" {
		return c.cfg.ServiceName
	}
	return "vProx"
}

// Start launches vProx. In embedded mode the server runs as a goroutine under
// parentCtx. In external mode it delegates to "systemctl start <service>".
func (c *Controller) Start(parentCtx context.Context) error {
	if c.cfg.External {
		unit := c.effectiveServiceName() + ".service"
		out, err := exec.CommandContext(parentCtx, "sudo", "systemctl", "start", unit).CombinedOutput()
		if err != nil {
			return fmt.Errorf("systemctl start %s: %w: %s", unit, err, strings.TrimSpace(string(out)))
		}
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.status == StatusStarting || c.status == StatusRunning {
		return fmt.Errorf("vprox controller: already %s", c.status)
	}

	srv := New(c.cfg)
	ctx, cancel := context.WithCancel(parentCtx)
	done := make(chan struct{})

	c.server = srv
	c.cancel = cancel
	c.done = done
	c.status = StatusStarting
	c.lastErr = nil
	c.startedAt = time.Now()

	go func() {
		defer close(done)

		c.mu.Lock()
		if c.status == StatusStarting {
			c.status = StatusRunning
		}
		c.mu.Unlock()

		err := srv.Start(ctx)

		c.mu.Lock()
		if err != nil {
			c.status = StatusError
			c.lastErr = err
		} else {
			c.status = StatusStopped
		}
		c.mu.Unlock()
	}()

	return nil
}

// Stop signals vProx to shut down. In external mode it delegates to
// "systemctl stop <service>".
func (c *Controller) Stop() error {
	if c.cfg.External {
		unit := c.effectiveServiceName() + ".service"
		out, err := exec.Command("sudo", "systemctl", "stop", unit).CombinedOutput()
		if err != nil {
			return fmt.Errorf("systemctl stop %s: %w: %s", unit, err, strings.TrimSpace(string(out)))
		}
		return nil
	}

	c.mu.Lock()
	if c.status == StatusStopped || c.status == StatusError {
		c.mu.Unlock()
		return nil
	}
	cancel := c.cancel
	done := c.done
	c.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
	return c.lastErr
}

// Restart performs a graceful Stop followed by Start.
func (c *Controller) Restart(ctx context.Context) error {
	if c.cfg.External {
		unit := c.effectiveServiceName() + ".service"
		out, err := exec.CommandContext(ctx, "sudo", "systemctl", "restart", unit).CombinedOutput()
		if err != nil {
			return fmt.Errorf("systemctl restart %s: %w: %s", unit, err, strings.TrimSpace(string(out)))
		}
		return nil
	}

	if err := c.Stop(); err != nil {
		return fmt.Errorf("vprox controller: stop: %w", err)
	}
	return c.Start(ctx)
}

// State returns the current status and last error (if StatusError).
// In external mode the status is queried live from systemctl is-active.
func (c *Controller) State() (Status, error) {
	if c.cfg.External {
		return c.externalState()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.status, c.lastErr
}

// externalState queries systemctl is-active and maps the output to a Status.
func (c *Controller) externalState() (Status, error) {
	unit := c.effectiveServiceName() + ".service"
	out, _ := exec.Command("systemctl", "is-active", unit).Output()
	switch strings.TrimSpace(string(out)) {
	case "active":
		return StatusRunning, nil
	case "activating":
		return StatusStarting, nil
	case "failed":
		return StatusError, fmt.Errorf("unit %s is failed", unit)
	default:
		return StatusStopped, nil
	}
}

// UptimeSec returns seconds since the service was last started.
// In external mode it reads ActiveEnterTimestamp from systemctl show.
// Returns 0 when unavailable.
func (c *Controller) UptimeSec() int64 {
	if c.cfg.External {
		return c.externalUptimeSec()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.status != StatusRunning && c.status != StatusStarting {
		return 0
	}
	if c.startedAt.IsZero() {
		return 0
	}
	return int64(time.Since(c.startedAt).Seconds())
}

// externalUptimeSec parses the ActiveEnterTimestamp reported by systemctl.
func (c *Controller) externalUptimeSec() int64 {
	unit := c.effectiveServiceName() + ".service"
	out, err := exec.Command("systemctl", "show", "--property=ActiveEnterTimestamp", unit).Output()
	if err != nil {
		return 0
	}
	line := strings.TrimSpace(string(out))
	idx := strings.Index(line, "=")
	if idx < 0 {
		return 0
	}
	ts := strings.TrimSpace(line[idx+1:])
	if ts == "" || strings.EqualFold(ts, "n/a") {
		return 0
	}
	for _, layout := range []string{
		"Mon 2006-01-02 15:04:05 MST",
		"Mon 2006-01-02 15:04:05 UTC",
	} {
		if t, parseErr := time.Parse(layout, ts); parseErr == nil {
			if sec := int64(time.Since(t).Seconds()); sec > 0 {
				return sec
			}
			return 0
		}
	}
	return 0
}

// ConfigFilePath returns the path to the vProx settings TOML file
// (i.e. $VPROX_HOME/config/vprox/settings.toml).
func (c *Controller) ConfigFilePath() string {
	return filepath.Join(c.cfg.Home, "config", "vprox", "settings.toml")
}

// Home returns the vProx home directory configured for this controller.
func (c *Controller) Home() string { return c.cfg.Home }

// LogFilePath returns the expected path to the main vProx log file
// (i.e. $VPROX_HOME/data/logs/main.log), honouring the LogFile override if set.
func (c *Controller) LogFilePath() string {
	if c.cfg.LogFile != "" {
		if filepath.IsAbs(c.cfg.LogFile) {
			return c.cfg.LogFile
		}
		return filepath.Join(c.cfg.Home, "data", "logs", c.cfg.LogFile)
	}
	return filepath.Join(c.cfg.Home, "data", "logs", "main.log")
}

// Wait blocks until the server goroutine exits.
// Returns the server's exit error, if any.
func (c *Controller) Wait() error {
	c.mu.Lock()
	done := c.done
	c.mu.Unlock()
	if done != nil {
		<-done
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastErr
}
