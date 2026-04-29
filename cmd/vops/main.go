package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/vNodesV/vOps/internal/fleet"
	fleetcfg "github.com/vNodesV/vOps/internal/fleet/config"
	"github.com/vNodesV/vOps/internal/vops/config"
	"github.com/vNodesV/vOps/internal/vops/db"
	"github.com/vNodesV/vOps/internal/vops/ingest"
	"github.com/vNodesV/vOps/internal/vops/intel"
	"github.com/vNodesV/vOps/internal/vops/web"
	"github.com/vNodesV/vOps/internal/vprox"
)

// Build-time variables injected via -ldflags "-X main.version=... -X main.commit=... -X main.buildDate=...".
// Defaults are used for local `go run` / unversioned builds.
var (
	version   = "dev"
	commit    = "unknown"
	buildDate = "unknown"
)

// ---------------------------------------------------------------------------
// Help / usage
// ---------------------------------------------------------------------------

func printHelp() {
	fmt.Print(`vOps v` + version + ` — infrastructure management and IP intelligence platform

Usage:
  vops <command> [flags]
  vops [one-shot flags]

Commands:
  start    Start vOps server (foreground)
  stop     Stop vOps service (sudo service vOps stop)
  restart  Restart vOps service (sudo service vOps restart)
  ingest   Run one-shot archive ingest and exit
  status   Show database stats and exit
  vprox    Manage the embedded vProx proxy server

vprox subcommands:
  vprox start              Start vProx in the foreground
  vprox start -d           Start vProx as a daemon (systemd)
  vprox stop               Stop the vProx daemon
  vprox restart            Restart the vProx daemon
  vprox status             Show service state and basic stats
  vprox view               Tail vProx service logs (journalctl -f)

One-shot flags:
  -A, --list-archives          List ingested archives with event counts
  -a, --list-accounts          List IP accounts (top 50, by last_seen)
  -t, --list-threats           List flagged IPs sorted by threat score desc
  -e, --enrich <ip>            Enrich an IP via all intel sources and exit
  -x, --purge-cache <ip|all>   Clear intel cache (one IP or all) and exit
  -V, --validate               Validate vops.toml and exit
  -i, --info                   Show resolved config summary and exit
  -n, --dry-run                Load config + open DB, verify, exit without starting

Runtime flags (start):
  -d, --daemon                 Start as background daemon (sudo service vOps start)
  -W, --no-watch               Disable archive file watcher
  -E, --no-enrich              Disable intel auto-enrichment worker
  -w, --watch-interval N       Override watch_interval_sec

Global flags:
      --home PATH              Override $VOPS_HOME (default: ~/.vOps)
      --config PATH            Override config file path
  -p, --port PORT              Override listen port (default: 8889)
  -q, --quiet                  Suppress stdout output
  -v, --verbose                Verbose log output
      --version                Print version and exit
  -h, --help                   Show this help

Examples:
  vops start
  vops start -d
  vops start --port 9000 --no-watch --no-enrich
  vops ingest --home /opt/vops
  vops status
  vops vprox start
  vops vprox start -d
  vops vprox stop
  vops vprox status
  vops vprox view
  vops -A
  vops --list-threats
  vops -e 1.2.3.4
  vops -x all
  vops --validate
`)
}

func printVproxHelp() {
	fmt.Print(`Usage:
  vops vprox <subcommand> [flags]

Subcommands:
  start              Start vProx in the foreground (blocks until Ctrl-C)
  start -d|--daemon  Start vProx as a background systemd daemon
  stop               Stop the vProx systemd service
  restart            Restart the vProx systemd service
  status             Show service state, uptime, and config paths
  view               Follow vProx service logs (journalctl -u vProx -f)

Global flags apply: --home, --verbose, --quiet
`)
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

type flags struct {
	// global
	home    string
	config  string
	port    int
	quiet   bool
	verbose bool
	version bool
	help    bool

	// one-shot
	listArchives bool
	listAccounts bool
	listThreats  bool
	enrich       string
	purgeCache   string
	validate     bool
	info         bool
	dryRun       bool

	// start runtime
	daemon        bool
	noWatch       bool
	noEnrich      bool
	watchInterval int

	// vprox proxy subcommand
	vproxStart   bool
	vproxDaemon  bool
	vproxStop    bool
	vproxRestart bool
	vproxStatus  bool
	vproxView    bool
}

func parseFlags(args []string) (flags, []string, error) {
	var f flags

	// Use a minimal custom parser so we can register short+long aliases
	// that share the same destination.
	fs := newFlagSet()

	// global
	fs.stringVar(&f.home, "home", "", "")
	fs.stringVar(&f.config, "config", "", "")
	fs.intVar(&f.port, "port", 0, "")
	fs.intVar(&f.port, "p", 0, "")
	fs.boolVar(&f.quiet, "quiet", false, "")
	fs.boolVar(&f.quiet, "q", false, "")
	fs.boolVar(&f.verbose, "verbose", false, "")
	fs.boolVar(&f.verbose, "v", false, "")
	fs.boolVar(&f.version, "version", false, "")
	fs.boolVar(&f.help, "help", false, "")
	fs.boolVar(&f.help, "h", false, "")

	// one-shot
	fs.boolVar(&f.listArchives, "list-archives", false, "")
	fs.boolVar(&f.listArchives, "A", false, "")
	fs.boolVar(&f.listAccounts, "list-accounts", false, "")
	fs.boolVar(&f.listAccounts, "a", false, "")
	fs.boolVar(&f.listThreats, "list-threats", false, "")
	fs.boolVar(&f.listThreats, "t", false, "")
	fs.stringVar(&f.enrich, "enrich", "", "")
	fs.stringVar(&f.enrich, "e", "", "")
	fs.stringVar(&f.purgeCache, "purge-cache", "", "")
	fs.stringVar(&f.purgeCache, "x", "", "")
	fs.boolVar(&f.validate, "validate", false, "")
	fs.boolVar(&f.validate, "V", false, "")
	fs.boolVar(&f.info, "info", false, "")
	fs.boolVar(&f.info, "i", false, "")
	fs.boolVar(&f.dryRun, "dry-run", false, "")
	fs.boolVar(&f.dryRun, "n", false, "")

	// start runtime
	fs.boolVar(&f.daemon, "daemon", false, "")
	fs.boolVar(&f.daemon, "d", false, "")
	fs.boolVar(&f.noWatch, "no-watch", false, "")
	fs.boolVar(&f.noWatch, "W", false, "")
	fs.boolVar(&f.noEnrich, "no-enrich", false, "")
	fs.boolVar(&f.noEnrich, "E", false, "")
	fs.intVar(&f.watchInterval, "watch-interval", 0, "")
	fs.intVar(&f.watchInterval, "w", 0, "")

	// vprox proxy subcommand
	fs.boolVar(&f.vproxStart, "vprox-start", false, "")
	fs.boolVar(&f.vproxDaemon, "vprox-daemon", false, "")
	fs.boolVar(&f.vproxStop, "vprox-stop", false, "")
	fs.boolVar(&f.vproxRestart, "vprox-restart", false, "")
	fs.boolVar(&f.vproxStatus, "vprox-status", false, "")
	fs.boolVar(&f.vproxView, "vprox-view", false, "")

	if err := fs.parse(args); err != nil {
		return f, nil, err
	}
	return f, fs.args(), nil
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	os.Exit(run())
}

func run() int {
	f, rest, err := parseFlags(os.Args[1:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: %v\n\n", err)
		printHelp()
		return 1
	}

	if f.help {
		printHelp()
		return 0
	}
	if f.version {
		fmt.Printf("vOps %s (%s, built %s)\n", version, commit, buildDate)
		return 0
	}

	// -- One-shot flags (checked before command dispatch) --------------------
	switch {
	case f.listArchives:
		return cmdListArchives(f)
	case f.listAccounts:
		return cmdListAccounts(f)
	case f.listThreats:
		return cmdListThreats(f)
	case f.enrich != "":
		return cmdEnrich(f)
	case f.purgeCache != "":
		return cmdPurgeCache(f)
	case f.validate:
		return cmdValidate(f)
	case f.info:
		return cmdInfo(f)
	case f.dryRun:
		return cmdDryRun(f)
	}

	// -- Command dispatch ----------------------------------------------------
	cmd := ""
	if len(rest) > 0 {
		cmd = rest[0]
	}

	switch cmd {
	case "":
		printHelp()
		return 0
	case "start":
		return cmdStart(f)
	case "stop":
		return runServiceCommand("stop")
	case "restart":
		return runServiceCommand("restart")
	case "ingest":
		return cmdIngest(f)
	case "status":
		return cmdStatus(f)
	case "vprox":
		return cmdVprox(f, rest[1:])
	default:
		fmt.Fprintf(os.Stderr, "vops: unknown command %q\n\n", cmd)
		printHelp()
		return 1
	}
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

func resolveHome(flagVal string) string {
	if flagVal != "" {
		return flagVal
	}
	return config.FindHome()
}

// vopsConfigPath returns the canonical vops.toml path under home.
// New layout: $home/config/vops/vops.toml (isolated from vProx chain scanner).
// Falls back to legacy $home/config/vops.toml if the new path doesn't exist
// and the old one does, printing a migration hint.
func vopsConfigPath(home string) string {
	newPath := filepath.Join(home, "config", "vops", "vops.toml")
	if _, err := os.Stat(newPath); err == nil {
		return newPath
	}
	oldPath := filepath.Join(home, "config", "vops.toml")
	if _, err := os.Stat(oldPath); err == nil {
		fmt.Fprintf(os.Stderr, "vops: WARNING: config at %s — move to %s (legacy location)\n", oldPath, newPath)
		return oldPath
	}
	return newPath // neither exists; Load() will return defaults gracefully
}

func loadConfig(f flags) (cfg config.Config, home string, err error) {
	home = resolveHome(f.home)

	cfgPath := f.config
	if cfgPath == "" {
		cfgPath = vopsConfigPath(home)
	}

	cfg, err = config.Load(cfgPath)
	if err != nil {
		return cfg, home, err
	}

	if f.port > 0 {
		cfg.VOps.Port = f.port
	}
	if f.watchInterval > 0 {
		cfg.VOps.WatchIntervalSec = f.watchInterval
	}

	if err := cfg.Validate(); err != nil {
		return cfg, home, err
	}
	return cfg, home, nil
}

// openDB loads config and opens the database. Returns cfg, home, db or an
// error. Callers must call database.Close().
func openDB(f flags) (config.Config, string, *db.DB, error) {
	cfg, home, err := loadConfig(f)
	if err != nil {
		return cfg, home, nil, err
	}
	database, err := db.Open(cfg.VOps.DBPath)
	if err != nil {
		return cfg, home, nil, err
	}
	return cfg, home, database, nil
}

// ---------------------------------------------------------------------------
// vops start
// ---------------------------------------------------------------------------

func cmdStart(f flags) int {
	// -d / --daemon → hand off to the service manager, then confirm.
	if f.daemon {
		code := runServiceCommand("start")
		if code != 0 {
			return code
		}
		time.Sleep(1500 * time.Millisecond)
		if serviceIsActive() {
			fmt.Fprintln(os.Stdout, "✓ vOps service started successfully.")
		} else {
			fmt.Fprintln(os.Stderr, "✗ vOps service did not start. Check: journalctl -u vOps -n 50")
			return 1
		}
		return 0
	}

	cfg, home, err := loadConfig(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: config error: %v\n", err)
		return 1
	}

	// Resolve the config path used to load — needed to save preferences back
	// to the same file (may be legacy or new layout).
	resolvedCfgPath := f.config
	if resolvedCfgPath == "" {
		resolvedCfgPath = vopsConfigPath(home)
	}

	if !f.quiet {
		intelAbuseIPDB := yesNo(cfg.VOps.Intel.Keys.AbuseIPDB != "")
		intelVirusTotal := yesNo(cfg.VOps.Intel.Keys.VirusTotal != "")
		intelShodan := yesNo(cfg.VOps.Intel.Keys.Shodan != "")
		fmt.Fprintf(os.Stdout, "vOps %s\n", version)
		fmt.Fprintf(os.Stdout, "  home:     %s\n", home)
		fmt.Fprintf(os.Stdout, "  db:       %s\n", cfg.VOps.DBPath)
		fmt.Fprintf(os.Stdout, "  archives: %s\n", cfg.VOps.ArchivesDir)
		fmt.Fprintf(os.Stdout, "  port:     :%d\n", cfg.VOps.Port)
		fmt.Fprintf(os.Stdout, "  intel:    abuseipdb=%s virustotal=%s shodan=%s\n",
			intelAbuseIPDB, intelVirusTotal, intelShodan)
		fmt.Fprintln(os.Stdout)
	}

	database, err := db.Open(cfg.VOps.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: database error: %v\n", err)
		return 1
	}
	defer database.Close()

	ingester := ingest.New(database, cfg.VOps.ArchivesDir)

	processed, err := ingester.IngestAll()
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: initial ingest error: %v\n", err)
		return 1
	}
	if !f.quiet && processed > 0 {
		fmt.Fprintf(os.Stdout, "Ingested %d archive(s) at startup\n", processed)
	}

	// Enricher — skip if --no-enrich.
	var enricher *intel.Enricher
	if !f.noEnrich {
		enricher = intel.NewEnricher(cfg.VOps.Intel, database)
		enricher.Start()
	}

	// Watcher — skip if --no-watch.
	var watcher *ingest.Watcher
	if !f.noWatch && cfg.VOps.WatchIntervalSec > 0 {
		watcher = ingest.NewWatcher(ingester, cfg.VOps.WatchIntervalSec)
		watcher.Start()
	}

	// Fleet module — initialize from config/infra/*.toml and chain [management] sections.
	// VM registry is sourced from:
	//   1) config/vprox/nodes/*.toml + config/infra/*.toml (preferred)
	//   2) config/chains/*.toml [management] (legacy fallback)
	// and enriched by config/vops/chains/*.toml chain profiles.
	var fleetSvc *fleet.Service
	{
		defs := fleetcfg.FleetDefaults{
			User:           cfg.VOps.Push.Defaults.User,
			KeyPath:        cfg.VOps.Push.Defaults.KeyPath,
			KnownHostsPath: cfg.VOps.Push.Defaults.KnownHostsPath,
		}
		runtimeCfg, err := fleetcfg.LoadRuntimeConfig(home, defs, cfg.VOps.Push.ChainsDir, cfg.VOps.Push.InfraDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "vops: fleet config warning: %v\n", err)
		} else if len(runtimeCfg.VMs) > 0 || len(runtimeCfg.Hosts) > 0 {
			// Initialize fleet when at least one VM or hypervisor host is configured.
			// Hosts alone are sufficient for virsh-based VM discovery via FleetScan.
			svc, err := fleet.NewEmpty(cfg.VOps.Push.DBPath)
			if err != nil {
				fmt.Fprintf(os.Stderr, "vops: fleet db error: %v\n", err)
			} else {
				svc.SetConfig(runtimeCfg)
				svc.SetHome(home)
				fleetSvc = svc
				defer svc.Close()
				go svc.StartPolling(context.Background(), time.Duration(cfg.VOps.Push.PollIntervalSec)*time.Second)
				if !f.quiet {
					fmt.Fprintf(os.Stdout, "  fleet:    chain management (%ds poll)\n", cfg.VOps.Push.PollIntervalSec)
				}
			}
		}
	}

	server, err := web.New(database, enricher, ingester, cfg, fleetSvc, resolvedCfgPath, version, commit, buildDate)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: web server error: %v\n", err)
		return 1
	}

	// Proxy controller: wired when config_path is set in [vprox].
	// external = false → embedded suite mode (vProx goroutine shares errgroup)
	// external = true  → external service mode (monitor/control via systemctl)
	var proxyCtrl *vprox.Controller
	if cfg.Vprox.ConfigPath != "" {
		proxyCfg := vprox.Config{
			Home:        cfg.Vprox.ConfigPath,
			Verbose:     f.verbose,
			External:    cfg.Vprox.External,
			ServiceName: cfg.Vprox.ServiceName,
		}
		proxyCtrl = vprox.NewController(proxyCfg)
		if !f.quiet {
			mode := "embedded"
			if cfg.Vprox.External {
				svc := cfg.Vprox.ServiceName
				if svc == "" {
					svc = "vProx"
				}
				mode = "external (" + svc + ".service)"
			}
			fmt.Fprintf(os.Stdout, "  proxy:    %s (config: %s)\n", mode, cfg.Vprox.ConfigPath)
		}
	}

	// Wire the proxy controller into the web server so the /api/v1/proxy/*
	// endpoints can control and query vProx (embedded or external).
	server.SetProxyController(proxyCtrl)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	eg, egCtx := errgroup.WithContext(ctx)

	// Launch vOps management panel.
	eg.Go(func() error {
		if !f.quiet {
			fmt.Fprintf(os.Stdout, "Listening on :%d\n", cfg.VOps.Port)
		}
		if err := server.Start(); err != nil && err != http.ErrServerClosed {
			return fmt.Errorf("vops panel: %w", err)
		}
		return nil
	})

	// Launch vProx proxy (embedded suite mode only — not when external=true).
	if proxyCtrl != nil && !cfg.Vprox.External {
		eg.Go(func() error {
			return proxyCtrl.Start(egCtx)
		})
	}

	// Shutdown coordinator: when a signal fires, gracefully stop all subsystems.
	// server.Shutdown() MUST be called here (not after eg.Wait()) — it is what
	// unblocks server.Start()/ListenAndServe so that eg.Wait() can return.
	eg.Go(func() error {
		<-egCtx.Done()
		if watcher != nil {
			watcher.Stop()
		}
		if enricher != nil {
			enricher.Stop()
		}
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("http shutdown: %w", err)
		}
		return nil
	})

	// Wait for all goroutines. First non-nil error wins.
	if err := eg.Wait(); err != nil {
		fmt.Fprintf(os.Stderr, "vops: %v\n", err)
	}

	// proxyCtrl context was already cancelled; Stop() is a safety-net no-op.
	if proxyCtrl != nil {
		proxyCtrl.Stop()
	}

	database.Close()

	if !f.quiet {
		fmt.Fprintln(os.Stdout, "vOps stopped.")
	}
	return 0
}

// ---------------------------------------------------------------------------
// vops ingest
// ---------------------------------------------------------------------------

func cmdIngest(f flags) int {
	cfg, _, err := loadConfig(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: config error: %v\n", err)
		return 1
	}

	database, err := db.Open(cfg.VOps.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: database error: %v\n", err)
		return 1
	}
	defer database.Close()

	ingester := ingest.New(database, cfg.VOps.ArchivesDir)

	processed, err := ingester.IngestAll()
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: ingest error: %v\n", err)
		return 1
	}

	if !f.quiet {
		fmt.Fprintf(os.Stdout, "Ingested %d archive(s)\n", processed)
	}
	return 0
}

// ---------------------------------------------------------------------------
// vops status
// ---------------------------------------------------------------------------

func cmdStatus(f flags) int {
	_, _, database, err := openDB(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: %v\n", err)
		return 1
	}
	defer database.Close()

	stats, err := database.Stats()
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: stats error: %v\n", err)
		return 1
	}

	ts := time.Now().UTC().Format(time.RFC3339)
	fmt.Fprintf(os.Stdout, "vOps status — %s\n\n", ts)
	fmt.Fprintf(os.Stdout, "  Archives ingested:  %s\n", fmtInt(stats["total_archives"]))
	fmt.Fprintf(os.Stdout, "  IP accounts:        %s\n", fmtInt(stats["total_ips"]))
	fmt.Fprintf(os.Stdout, "  Request events:     %s\n", fmtInt(stats["total_requests"]))
	fmt.Fprintf(os.Stdout, "  Rate-limit events:  %s\n", fmtInt(stats["total_ratelimit_events"]))
	fmt.Fprintf(os.Stdout, "  Flagged IPs:        %s\n", fmtInt(stats["flagged_ips"]))
	printServiceStatus()
	return 0
}

// ---------------------------------------------------------------------------
// One-shot: --list-archives / -A
// ---------------------------------------------------------------------------

func cmdListArchives(f flags) int {
	_, _, database, err := openDB(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: %v\n", err)
		return 1
	}
	defer database.Close()

	archives, err := database.ListIngestedArchives(0) // 0 = all
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: list archives: %v\n", err)
		return 1
	}

	if len(archives) == 0 {
		fmt.Fprintln(os.Stdout, "No archives ingested yet.")
		return 0
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "ARCHIVE\tINGESTED AT\tREQUESTS\tLIMITS\tSIZE")
	for _, a := range archives {
		fmt.Fprintf(tw, "%s\t%s\t%d\t%d\t%s\n",
			a.Filename, a.IngestedAt, a.RequestCount, a.RatelimitCount, fmtBytes(a.SizeBytes))
	}
	tw.Flush()
	return 0
}

// ---------------------------------------------------------------------------
// One-shot: --list-accounts / -a
// ---------------------------------------------------------------------------

func cmdListAccounts(f flags) int {
	_, _, database, err := openDB(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: %v\n", err)
		return 1
	}
	defer database.Close()

	accounts, err := database.ListIPAccounts("last_seen", "DESC", 50, 0)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: list accounts: %v\n", err)
		return 1
	}

	if len(accounts) == 0 {
		fmt.Fprintln(os.Stdout, "No IP accounts found.")
		return 0
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "IP\tCOUNTRY\tASN\tSCORE\tSTATUS\tREQUESTS\tLAST SEEN")
	for _, a := range accounts {
		score := fmtScore(a.ThreatScore)
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%d\t%s\n",
			a.IP, a.Country, a.ASN, score, a.Status, a.TotalRequests, a.LastSeen)
	}
	tw.Flush()
	return 0
}

// ---------------------------------------------------------------------------
// One-shot: --list-threats / -t
// ---------------------------------------------------------------------------

func cmdListThreats(f flags) int {
	_, _, database, err := openDB(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: %v\n", err)
		return 1
	}
	defer database.Close()

	threats, err := database.ListTopThreatAccounts(100)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: list threats: %v\n", err)
		return 1
	}

	if len(threats) == 0 {
		fmt.Fprintln(os.Stdout, "No flagged IPs found.")
		return 0
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "IP\tCOUNTRY\tSCORE\tSTATUS\tFLAGS\tREQUESTS\tLAST SEEN")
	for _, a := range threats {
		flags := flattenFlags(a.ThreatFlags)
		fmt.Fprintf(tw, "%s\t%s\t%d\t%s\t%s\t%d\t%s\n",
			a.IP, a.Country, a.ThreatScore, a.Status, flags, a.TotalRequests, a.LastSeen)
	}
	tw.Flush()
	return 0
}

// ---------------------------------------------------------------------------
// One-shot: --enrich <ip> / -e
// ---------------------------------------------------------------------------

func cmdEnrich(f flags) int {
	ip := strings.TrimSpace(f.enrich)
	if ip == "" {
		fmt.Fprintf(os.Stderr, "vops: --enrich requires an IP address\n\n")
		printHelp()
		return 1
	}

	cfg, _, err := loadConfig(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: config error: %v\n", err)
		return 1
	}

	database, err := db.Open(cfg.VOps.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: database error: %v\n", err)
		return 1
	}
	defer database.Close()

	enricher := intel.NewEnricher(cfg.VOps.Intel, database)

	if !f.quiet {
		fmt.Fprintf(os.Stdout, "Enriching %s...\n", ip)
	}

	acc, err := enricher.EnrichNow(ip)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: enrich %s: %v\n", ip, err)
		return 1
	}

	fmt.Fprintf(os.Stdout, "\n  IP:           %s\n", acc.IP)
	fmt.Fprintf(os.Stdout, "  Country:      %s\n", acc.Country)
	fmt.Fprintf(os.Stdout, "  ASN:          %s\n", acc.ASN)
	fmt.Fprintf(os.Stdout, "  Org:          %s\n", acc.Org)
	fmt.Fprintf(os.Stdout, "  Threat Score: %d\n", acc.ThreatScore)
	fmt.Fprintf(os.Stdout, "  Status:       %s\n", acc.Status)
	fmt.Fprintf(os.Stdout, "  Flags:        %s\n", flattenFlags(acc.ThreatFlags))
	fmt.Fprintf(os.Stdout, "  AbuseIPDB:    score=%d\n", acc.AbuseScore)
	fmt.Fprintf(os.Stdout, "  VirusTotal:   malicious=%d\n", acc.VTMalicious)
	fmt.Fprintf(os.Stdout, "  Open Ports:   %s\n", flattenPorts(acc.OpenPorts))
	fmt.Fprintf(os.Stdout, "  Updated:      %s\n", acc.IntelUpdatedAt)
	return 0
}

// ---------------------------------------------------------------------------
// One-shot: --purge-cache <ip|all> / -x
// ---------------------------------------------------------------------------

func cmdPurgeCache(f flags) int {
	target := strings.TrimSpace(f.purgeCache)
	if target == "" {
		fmt.Fprintf(os.Stderr, "vops: --purge-cache requires <ip> or \"all\"\n\n")
		printHelp()
		return 1
	}

	_, _, database, err := openDB(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: %v\n", err)
		return 1
	}
	defer database.Close()

	purgeIP := ""
	if target != "all" {
		purgeIP = target
	}

	n, err := database.PurgeIntelCache(purgeIP)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: purge cache: %v\n", err)
		return 1
	}

	if !f.quiet {
		label := "all IPs"
		if purgeIP != "" {
			label = purgeIP
		}
		fmt.Fprintf(os.Stdout, "Purged intel cache for %s (%d entries deleted)\n", label, n)
	}
	return 0
}

// ---------------------------------------------------------------------------
// One-shot: --validate / -V
// ---------------------------------------------------------------------------

func cmdValidate(f flags) int {
	_, _, err := loadConfig(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: validation failed: %v\n", err)
		return 1
	}
	fmt.Fprintln(os.Stdout, "vops.toml OK")
	return 0
}

// ---------------------------------------------------------------------------
// One-shot: --info / -i
// ---------------------------------------------------------------------------

func cmdInfo(f flags) int {
	home := resolveHome(f.home)

	cfgPath := f.config
	if cfgPath == "" {
		cfgPath = vopsConfigPath(home)
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: config error: %v\n", err)
		return 1
	}
	if f.port > 0 {
		cfg.VOps.Port = f.port
	}

	fmt.Fprintf(os.Stdout, "vOps %s — config\n\n", version)
	fmt.Fprintf(os.Stdout, "  home:          %s\n", home)
	fmt.Fprintf(os.Stdout, "  config:        %s\n", cfgPath)
	fmt.Fprintf(os.Stdout, "  db:            %s\n", cfg.VOps.DBPath)
	fmt.Fprintf(os.Stdout, "  archives:      %s\n", cfg.VOps.ArchivesDir)
	fmt.Fprintf(os.Stdout, "  port:          %d\n", cfg.VOps.Port)
	fmt.Fprintf(os.Stdout, "  watch:         %ds\n", cfg.VOps.WatchIntervalSec)
	fmt.Fprintf(os.Stdout, "  auto-enrich:   %s\n", yesNo(cfg.VOps.Intel.AutoEnrich))
	fmt.Fprintf(os.Stdout, "  cache ttl:     %dh\n", cfg.VOps.Intel.CacheTTLHours)
	fmt.Fprintf(os.Stdout, "  rate limit:    %d rpm\n", cfg.VOps.Intel.RateLimitRPM)
	fmt.Fprintf(os.Stdout, "  intel keys:\n")
	fmt.Fprintf(os.Stdout, "    abuseipdb:   %s\n", yesNo(cfg.VOps.Intel.Keys.AbuseIPDB != ""))
	fmt.Fprintf(os.Stdout, "    virustotal:  %s\n", yesNo(cfg.VOps.Intel.Keys.VirusTotal != ""))
	fmt.Fprintf(os.Stdout, "    shodan:      %s\n", yesNo(cfg.VOps.Intel.Keys.Shodan != ""))
	return 0
}

// ---------------------------------------------------------------------------
// One-shot: --dry-run / -n
// ---------------------------------------------------------------------------

func cmdDryRun(f flags) int {
	cfg, _, err := loadConfig(f)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: config error: %v\n", err)
		return 1
	}
	fmt.Fprintln(os.Stdout, "Config OK")

	database, err := db.Open(cfg.VOps.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "vops: database error: %v\n", err)
		return 1
	}
	database.Close()
	fmt.Fprintf(os.Stdout, "Database OK (%s)\n", cfg.VOps.DBPath)
	fmt.Fprintln(os.Stdout, "vOps is ready to start (dry-run — not starting)")
	return 0
}

// ---------------------------------------------------------------------------
// vops vprox — proxy server management subcommands
// ---------------------------------------------------------------------------

// cmdVprox handles `vops vprox <subcommand> [flags]`.
//
// Subcommands:
//
//	start              Start vProx in the foreground (blocks)
//	start -d|--daemon  Start as a systemd background daemon
//	stop               Stop the vProx systemd service
//	restart            Restart the vProx systemd service
//	status             Print service state, uptime, and key paths
//	view               Tail vProx service logs (journalctl -u vProx -f)
func cmdVprox(f flags, args []string) int {
	// Strip flag tokens from subcommand args so bare `vops vprox start --daemon`
	// is treated the same as `vops vprox start -d`.
	subcmd := ""
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			subcmd = a
			break
		}
	}

	// Backward-compat: honour legacy --vprox-* flags when no subcommand given.
	switch {
	case subcmd == "" && f.vproxStop:
		subcmd = "stop"
	case subcmd == "" && f.vproxRestart:
		subcmd = "restart"
	case subcmd == "" && f.vproxStatus:
		subcmd = "status"
	case subcmd == "" && f.vproxView:
		subcmd = "view"
	}

	// -d / --daemon anywhere in the arg list enables daemon mode for `start`.
	daemonMode := f.daemon || f.vproxDaemon
	for _, a := range args {
		if a == "-d" || a == "--daemon" {
			daemonMode = true
		}
	}

	switch subcmd {
	case "start", "":
		return cmdVproxStart(f, daemonMode)
	case "stop":
		return runNamedServiceCommand("vProx", "stop")
	case "restart":
		return runNamedServiceCommand("vProx", "restart")
	case "status":
		return cmdVproxStatus(f)
	case "view":
		return cmdVproxView()
	case "help", "--help", "-h":
		printVproxHelp()
		return 0
	default:
		fmt.Fprintf(os.Stderr, "vops vprox: unknown subcommand %q\n\n", subcmd)
		printVproxHelp()
		return 1
	}
}

// cmdVproxStart starts vProx either in the foreground or as a systemd daemon.
func cmdVproxStart(f flags, daemon bool) int {
	home := resolveHome(f.home)

	if daemon {
		code := runNamedServiceCommand("vProx", "start")
		if code != 0 {
			return code
		}
		time.Sleep(1500 * time.Millisecond)
		out, _ := exec.Command("systemctl", "is-active", "vProx").Output()
		if strings.TrimSpace(string(out)) == "active" {
			fmt.Fprintln(os.Stdout, "✓ vProx daemon started successfully.")
		} else {
			fmt.Fprintln(os.Stderr, "✗ vProx daemon did not start. Check: journalctl -u vProx -n 50")
			return 1
		}
		return 0
	}

	// Foreground mode — blocks until SIGINT/SIGTERM.
	if !f.quiet {
		fmt.Fprintf(os.Stdout, "vOps %s — starting vProx proxy server\n", version)
		fmt.Fprintf(os.Stdout, "  home: %s\n\n", home)
	}

	proxyCfg := vprox.Config{
		Home:    home,
		Verbose: f.verbose,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	if err := vprox.New(proxyCfg).Start(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "vops vprox start: %v\n", err)
		return 1
	}

	if !f.quiet {
		fmt.Fprintln(os.Stdout, "vProx stopped.")
	}
	return 0
}

// cmdVproxStatus prints service state, uptime, and key configuration paths.
func cmdVproxStatus(f flags) int {
	home := resolveHome(f.home)
	proxyCfg := vprox.Config{Home: home, Verbose: f.verbose}
	ctrl := vprox.NewController(proxyCfg)

	// systemd state.
	svcActive, _ := exec.Command("systemctl", "is-active", "vProx").Output()
	svcActiveStr := strings.TrimSpace(string(svcActive))

	// Uptime from systemd (ActiveEnterTimestamp).
	var uptimeStr string
	if svcActiveStr == "active" {
		prop, err := exec.Command("systemctl", "show", "vProx", "--property=ActiveEnterTimestamp", "--value").Output()
		if err == nil {
			ts := strings.TrimSpace(string(prop))
			if t, err := time.Parse("Mon 2006-01-02 15:04:05 MST", ts); err == nil {
				uptimeStr = formatDuration(time.Since(t))
			}
		}
	}

	// In-process controller state (relevant when running embedded in suite mode).
	ctrlState, ctrlErr := ctrl.State()

	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "vProx service status")
	fmt.Fprintln(tw, "────────────────────────────────────────")
	fmt.Fprintf(tw, "  Service (systemd):\t%s\n", svcActiveStr)
	if uptimeStr != "" {
		fmt.Fprintf(tw, "  Uptime:\t%s\n", uptimeStr)
	}
	fmt.Fprintf(tw, "  Controller state:\t%s\n", ctrlState)
	if ctrlErr != nil {
		fmt.Fprintf(tw, "  Last error:\t%v\n", ctrlErr)
	}
	fmt.Fprintf(tw, "  Home:\t%s\n", ctrl.Home())
	fmt.Fprintf(tw, "  Config file:\t%s\n", ctrl.ConfigFilePath())
	fmt.Fprintf(tw, "  Log file:\t%s\n", ctrl.LogFilePath())
	tw.Flush()

	// Append a brief systemctl status block if available.
	statusOut, err := exec.Command("systemctl", "status", "vProx", "--no-pager", "-l", "--lines=5").CombinedOutput()
	if err == nil && len(statusOut) > 0 {
		fmt.Fprintf(os.Stdout, "\n%s", string(statusOut))
	}
	return 0
}

// cmdVproxView follows the vProx service logs via journalctl.
func cmdVproxView() int {
	jctl, err := exec.LookPath("journalctl")
	if err != nil {
		fmt.Fprintln(os.Stderr, "vops vprox view: journalctl not found — is this a systemd host?")
		return 1
	}
	cmd := exec.Command(jctl, "-u", "vProx", "-f", "--output=cat", "-n", "50")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Run(); err != nil {
		// Ctrl-C produces an exit error — treat as clean exit.
		if strings.Contains(err.Error(), "signal") || strings.Contains(err.Error(), "interrupt") {
			return 0
		}
		fmt.Fprintf(os.Stderr, "vops vprox view: %v\n", err)
		return 1
	}
	return 0
}

// formatDuration returns a human-readable duration string (e.g. "2d 3h 14m").
func formatDuration(d time.Duration) string {
	d = d.Round(time.Minute)
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	mins := int(d.Minutes()) % 60
	switch {
	case days > 0:
		return fmt.Sprintf("%dd %dh %dm", days, hours, mins)
	case hours > 0:
		return fmt.Sprintf("%dh %dm", hours, mins)
	default:
		return fmt.Sprintf("%dm", mins)
	}
}

// ---------------------------------------------------------------------------
// Service management (start -d / --daemon)
// ---------------------------------------------------------------------------

func runServiceCommand(action string) int {
	sudo, err := exec.LookPath("sudo")
	args := []string{"service", "vOps", action}
	var cmd *exec.Cmd
	if err == nil {
		cmd = exec.Command(sudo, args...)
	} else {
		cmd = exec.Command("service", "vOps", action)
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "vops: service %s: %v\n", action, err)
		return 1
	}
	return 0
}

// serviceIsActive returns true when systemctl reports the vOps unit as active.
func serviceIsActive() bool {
	out, _ := exec.Command("systemctl", "is-active", "vOps").Output()
	return strings.TrimSpace(string(out)) == "active"
}

// runNamedServiceCommand runs a service action (start/stop/restart) for
// any named service unit (e.g. "vProx"). This is used by `vops vprox`
// so it does not conflict with the vOps service management paths.
func runNamedServiceCommand(svc, action string) int {
	sudo, err := exec.LookPath("sudo")
	args := []string{"service", svc, action}
	var cmd *exec.Cmd
	if err == nil {
		cmd = exec.Command(sudo, args...)
	} else {
		cmd = exec.Command("service", svc, action)
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "vops: service %s %s: %v\n", svc, action, err)
		return 1
	}
	return 0
}

// printServiceStatus appends the full systemctl status for vOps.
// Silently skips on systems without systemctl or when the unit is unknown.
func printServiceStatus() {
	cmd := exec.Command("systemctl", "status", "vOps", "--no-pager", "-l")
	out, _ := cmd.CombinedOutput() // exit!=0 when inactive; output is still useful
	if len(out) > 0 {
		fmt.Fprintf(os.Stdout, "\nService:\n%s", string(out))
	}
}

// ---------------------------------------------------------------------------
// Minimal flag set (supports long and short aliases sharing one destination)
// ---------------------------------------------------------------------------

// flagSet is a thin wrapper that lets two flag names share one pointer, which
// the stdlib flag package supports natively via StringVar/BoolVar/IntVar.
type flagSet struct {
	bools   map[string]*bool
	strings map[string]*string
	ints    map[string]*int
	rest    []string
}

func newFlagSet() *flagSet {
	return &flagSet{
		bools:   make(map[string]*bool),
		strings: make(map[string]*string),
		ints:    make(map[string]*int),
	}
}

func (fs *flagSet) boolVar(p *bool, name string, def bool, _ string) {
	if _, exists := fs.bools[name]; !exists {
		fs.bools[name] = p
		*p = def
	} else {
		fs.bools[name] = p
	}
}

func (fs *flagSet) stringVar(p *string, name string, def string, _ string) {
	fs.strings[name] = p
	if *p == "" {
		*p = def
	}
}

func (fs *flagSet) intVar(p *int, name string, def int, _ string) {
	if _, exists := fs.ints[name]; !exists {
		fs.ints[name] = p
		*p = def
	} else {
		fs.ints[name] = p
	}
}

func (fs *flagSet) args() []string { return fs.rest }

// parse walks os.Args-style args and populates registered flag destinations.
// Supported forms:  --flag  -flag  --flag=val  -flag=val  --flag val  -flag val
func (fs *flagSet) parse(args []string) error {
	i := 0
	for i < len(args) {
		arg := args[i]

		if arg == "--" {
			fs.rest = append(fs.rest, args[i+1:]...)
			return nil
		}

		if !strings.HasPrefix(arg, "-") {
			fs.rest = append(fs.rest, arg)
			i++
			continue
		}

		// Strip leading dashes.
		name := strings.TrimLeft(arg, "-")

		// Handle --flag=value or -f=value.
		val := ""
		hasVal := false
		if idx := strings.IndexByte(name, '='); idx >= 0 {
			name, val = name[:idx], name[idx+1:]
			hasVal = true
		}

		if p, ok := fs.bools[name]; ok {
			if hasVal {
				switch strings.ToLower(val) {
				case "true", "1", "yes":
					*p = true
				case "false", "0", "no":
					*p = false
				default:
					return fmt.Errorf("invalid boolean value %q for flag -%s", val, name)
				}
			} else {
				*p = true
			}
			i++
			continue
		}

		if p, ok := fs.strings[name]; ok {
			if hasVal {
				*p = val
			} else if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				i++
				*p = args[i]
			} else {
				return fmt.Errorf("flag -%s requires a value", name)
			}
			i++
			continue
		}

		if p, ok := fs.ints[name]; ok {
			raw := val
			if !hasVal {
				if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
					i++
					raw = args[i]
				} else {
					return fmt.Errorf("flag -%s requires a value", name)
				}
			}
			n, err := strconv.Atoi(raw)
			if err != nil {
				return fmt.Errorf("invalid value %q for flag -%s: %v", raw, name, err)
			}
			*p = n
			i++
			continue
		}

		return fmt.Errorf("unknown flag: -%s", name)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func yesNo(v bool) string {
	if v {
		return "yes"
	}
	return "no"
}

func fmtInt(n int64) string { return strconv.FormatInt(n, 10) }

func fmtScore(s int64) string {
	if s < 0 {
		return "-"
	}
	return strconv.FormatInt(s, 10)
}

func fmtBytes(b int64) string {
	switch {
	case b >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(b)/(1<<20))
	case b >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(b)/(1<<10))
	default:
		return fmt.Sprintf("%d B", b)
	}
}

// flattenFlags decodes a JSON array of threat flag strings and joins them.
func flattenFlags(raw string) string {
	if raw == "" || raw == "[]" {
		return "-"
	}
	var arr []string
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return raw
	}
	if len(arr) == 0 {
		return "-"
	}
	return strings.Join(arr, ", ")
}

// flattenPorts decodes a JSON array of port ints and joins them.
func flattenPorts(raw string) string {
	if raw == "" || raw == "[]" {
		return "-"
	}
	var arr []any
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return raw
	}
	parts := make([]string, 0, len(arr))
	for _, v := range arr {
		parts = append(parts, fmt.Sprintf("%v", v))
	}
	if len(parts) == 0 {
		return "-"
	}
	return strings.Join(parts, ", ")
}
