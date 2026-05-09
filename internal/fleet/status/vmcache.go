package status

import (
	"sync"
	"time"

	"github.com/vNodesV/vOps/internal/fleet/config"
)

// VMCache runs PollAllVMs on a fixed background interval and caches the result.
// HandleVMStatus reads from the cache instead of opening live SSH sessions on
// every HTTP request, reducing dashboard load time from ~10 s → <1 ms.
type VMCache struct {
	mu       sync.RWMutex
	results  []VMStatus
	polledAt time.Time
	done     chan struct{}
	onPoll   func([]VMStatus) // optional; called after each background poll
}

// NewVMCache constructs a VMCache. Call Start to begin background polling.
func NewVMCache() *VMCache {
	return &VMCache{done: make(chan struct{})}
}

// SetOnPoll registers a callback invoked after each successful background poll.
// Use this to persist metrics to a DB without coupling the cache to storage.
func (c *VMCache) SetOnPoll(fn func([]VMStatus)) { c.onPoll = fn }

// Start launches the background poller. cfgFn is called on every tick so that
// config reloads (new VMs added, hosts changed) are picked up automatically.
// An immediate first poll runs before the ticker loop begins.
func (c *VMCache) Start(cfgFn func() *config.Config, interval time.Duration) {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	go c.run(cfgFn, interval)
}

// Stop signals the background goroutine to exit cleanly.
func (c *VMCache) Stop() {
	select {
	case <-c.done:
	default:
		close(c.done)
	}
}

// Get returns the cached VM statuses and the time the cache was last populated.
// Returns a nil slice when no poll has completed yet.
func (c *VMCache) Get() ([]VMStatus, time.Time) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.results, c.polledAt
}

func (c *VMCache) run(cfgFn func() *config.Config, interval time.Duration) {
	c.poll(cfgFn)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			c.poll(cfgFn)
		case <-c.done:
			return
		}
	}
}

func (c *VMCache) poll(cfgFn func() *config.Config) {
	cfg := cfgFn()
	if cfg == nil || len(cfg.VMs) == 0 {
		return
	}
	results := PollAllVMs(cfg)
	now := time.Now()
	c.mu.Lock()
	c.results = results
	c.polledAt = now
	c.mu.Unlock()
	if c.onPoll != nil {
		c.onPoll(results)
	}
}
