package vprox

import (
	"context"
	"fmt"
	"sync"
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

	mu     sync.Mutex
	status Status
	lastErr error

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

// Start launches the vProx server in a background goroutine.
// It is idempotent — calling Start while already running returns an error.
// parentCtx cancellation propagates to the server goroutine.
func (c *Controller) Start(parentCtx context.Context) error {
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

	go func() {
		defer close(done)

		// Signal running — server is blocked in ListenAndServe.
		// We optimistically mark running once Start is invoked; the server
		// will return an error through the done channel if it can't bind.
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

// Stop signals the running server to shut down and waits for it to exit.
func (c *Controller) Stop() error {
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
	if err := c.Stop(); err != nil {
		return fmt.Errorf("vprox controller: stop: %w", err)
	}
	return c.Start(ctx)
}

// State returns the current status and last error (if StatusError).
func (c *Controller) State() (Status, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.status, c.lastErr
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
