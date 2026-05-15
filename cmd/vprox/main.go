package main

import (
"context"
"flag"
"fmt"
"log"
"net/http"
"os"
"os/exec"
"os/signal"
"path/filepath"
"strconv"
"strings"
"syscall"
"time"

backup "github.com/vNodesV/vOps/internal/backup"
"github.com/vNodesV/vOps/internal/config"
"github.com/vNodesV/vOps/internal/vprox"
)

// Injected at build time via -ldflags.
var (
	version   = "dev"
	commit    = "unknown"
	buildDate = "unknown"
)

// resolveVProxHome returns VPROX_HOME or ~/.vProx.
func resolveVProxHome() string {
if v := strings.TrimSpace(os.Getenv("VPROX_HOME")); v != "" {
return v
}
if h, err := os.UserHomeDir(); err == nil && h != "" {
return filepath.Join(h, ".vProx")
}
return ".vProx"
}

// runServiceCommand executes "service vProx <action>" and uses sudo when available.
func runServiceCommand(action string) error {
return runNamedServiceCommand("vProx", action)
}

func runNamedServiceCommand(name, action string) error {
bin := "sudo"
args := []string{"service", name, action}
if _, err := exec.LookPath("sudo"); err != nil {
bin = "service"
args = []string{name, action}
}
cmd := exec.Command(bin, args...)
cmd.Stdin = os.Stdin
cmd.Stdout = os.Stdout
cmd.Stderr = os.Stderr
return cmd.Run()
}

// printServiceStatus prints the two-line daemon status block.
func printServiceStatus(vproxErr, vopsErr error, withVOps bool) {
status := func(err error) string {
if err == nil {
return "Online"
}
return "Offline [" + err.Error() + "]"
}
fmt.Printf("vProx %s\n", status(vproxErr))
if withVOps {
fmt.Printf("vOps  %s\n", status(vopsErr))
}
}

// resolveBackupConfigPath returns the effective path for backup.toml.
func resolveBackupConfigPath(configDir string) string {
newPath := filepath.Join(configDir, "backup", "backup.toml")
if _, err := os.Stat(newPath); err == nil {
return newPath
}
return filepath.Join(configDir, "backup.toml")
}

// listBackupArchives prints all .tar.gz archives in archiveDir to stdout.
func listBackupArchives(archiveDir string) error {
entries, err := os.ReadDir(archiveDir)
if err != nil {
if os.IsNotExist(err) {
fmt.Println("No backup archives found.")
return nil
}
return err
}
count := 0
for _, e := range entries {
if e.IsDir() || !strings.HasSuffix(e.Name(), ".tar.gz") {
continue
}
info, _ := e.Info()
size := ""
if info != nil {
b := info.Size()
switch {
case b >= 1<<20:
size = fmt.Sprintf("%.1fMB", float64(b)/(1<<20))
case b >= 1<<10:
size = fmt.Sprintf("%.1fKB", float64(b)/(1<<10))
default:
size = fmt.Sprintf("%dB", b)
}
}
fmt.Printf("  %s  (%s)\n", e.Name(), size)
count++
}
if count == 0 {
fmt.Println("No backup archives found.")
} else {
fmt.Printf("\n  Total: %d archive(s)\n", count)
}
return nil
}

// printBackupStatus prints backup automation state and next-run ETA.
func printBackupStatus(cfgPath, statePath, archiveDir string) {
cfg, loaded, _ := backup.LoadConfig(cfgPath)
b := cfg.Backup

fmt.Println("vProx Backup Status")
fmt.Println("")

automationLabel := "disabled"
if b.Automation {
automationLabel = "enabled"
}
activeLabel := "inactive"
if b.Automation {
activeLabel = "active"
}
cfgSource := "defaults"
if loaded {
cfgSource = cfgPath
}
fmt.Printf("  Automation:       %s  (source: %s)\n", automationLabel, cfgSource)
fmt.Printf("  Scheduler:        %s\n", activeLabel)
fmt.Println("")

if b.IntervalDays > 0 {
fmt.Printf("  Trigger interval: every %d day(s)\n", b.IntervalDays)
} else {
fmt.Println("  Trigger interval: disabled (interval_days = 0)")
}
if b.MaxSizeMB > 0 {
fmt.Printf("  Trigger max size: %d MB\n", b.MaxSizeMB)
} else {
fmt.Println("  Trigger max size: disabled (max_size_mb = 0)")
}
fmt.Printf("  Check interval:   every %d min\n", b.CheckIntervalMin)
fmt.Println("")

var lastRun time.Time
if data, err := os.ReadFile(statePath); err == nil {
if sec, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64); err == nil {
lastRun = time.Unix(sec, 0).UTC()
}
}
if lastRun.IsZero() {
fmt.Println("  Last backup:      never")
} else {
ago := time.Since(lastRun).Truncate(time.Minute)
fmt.Printf("  Last backup:      %s  (%s ago)\n", lastRun.Format("2006-01-02 15:04:05 UTC"), ago)
}

if !b.Automation {
fmt.Println("  Next backup ETA:  n/a (scheduler is inactive)")
} else if b.IntervalDays > 0 && !lastRun.IsZero() {
nextRun := lastRun.Add(time.Duration(b.IntervalDays) * 24 * time.Hour)
eta := time.Until(nextRun).Truncate(time.Minute)
if eta <= 0 {
fmt.Println("  Next backup ETA:  due now (trigger condition met)")
} else {
fmt.Printf("  Next backup ETA:  %s  (in %s)\n", nextRun.Format("2006-01-02 15:04:05 UTC"), eta)
}
} else if b.IntervalDays > 0 && lastRun.IsZero() {
fmt.Println("  Next backup ETA:  due now (no previous backup recorded)")
} else {
fmt.Println("  Next backup ETA:  n/a (interval trigger disabled)")
}
fmt.Println("")

if entries, err := os.ReadDir(archiveDir); err == nil {
count := 0
for _, e := range entries {
if !e.IsDir() && strings.HasSuffix(e.Name(), ".tar.gz") {
count++
}
}
fmt.Printf("  Archive dir:      %s\n", archiveDir)
fmt.Printf("  Archives:         %d file(s)\n", count)
}
if !b.Automation {
fmt.Println("")
fmt.Println("  Automation is disabled. Use 'vProx --new-backup' to create a backup manually.")
}
}

// resolveBackupExtraFiles returns rotate and extra file lists for backup.
func resolveBackupExtraFiles(cfg backup.BackupConfig, dataDir, logsDir, configDir, mainLogPath string) (rotate, extra []string) {
splitNames := func(entries []string) []string {
var out []string
for _, entry := range entries {
for _, name := range strings.Split(entry, ",") {
name = strings.TrimSpace(name)
if name != "" {
out = append(out, name)
}
}
}
return out
}
mainLogClean := filepath.Clean(mainLogPath)
if entries, err := os.ReadDir(logsDir); err == nil {
for _, e := range entries {
if e.IsDir() || !strings.HasSuffix(e.Name(), ".log") {
continue
}
p := filepath.Join(logsDir, e.Name())
if filepath.Clean(p) == mainLogClean {
continue
}
rotate = append(rotate, p)
}
}
for _, name := range splitNames(cfg.Backup.Files.Logs) {
p := filepath.Join(logsDir, name)
if filepath.Clean(p) == mainLogClean {
continue
}
if strings.HasSuffix(name, ".log") {
if !config.ContainsString(rotate, p) {
rotate = append(rotate, p)
}
} else {
extra = append(extra, p)
}
}
for _, name := range splitNames(cfg.Backup.Files.Data) {
extra = append(extra, filepath.Join(dataDir, name))
}
for _, name := range splitNames(cfg.Backup.Files.Config) {
extra = append(extra, filepath.Join(configDir, name))
}
return rotate, extra
}

// notifyVOps sends a POST to vOps's ingest endpoint after a successful backup.
func notifyVOps(vopsURL string) {
if vopsURL == "" {
return
}
client := &http.Client{Timeout: 5 * time.Second}
req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, vopsURL+"/api/v1/ingest", nil)
if err != nil {
return
}
req.Header.Set("Content-Type", "application/json")
resp, err := client.Do(req)
if err != nil {
return
}
resp.Body.Close()
}

func main() {
rawArgs := os.Args[1:]
startMode := false
restartSubcmd := false
stopSubcmd := false

resolveHome := func(args []string) string {
for i, a := range args {
if a == "--home" && i+1 < len(args) {
return args[i+1]
}
if strings.HasPrefix(a, "--home=") {
return strings.TrimPrefix(a, "--home=")
}
}
if h := os.Getenv("VPROX_HOME"); h != "" {
return h
}
home, _ := os.UserHomeDir()
return filepath.Join(home, ".vProx")
}

printHelp := func() {
out := flag.CommandLine.Output()
fmt.Fprintln(out, "Usage: vProx <command> [--flags]")
fmt.Fprintln(out, "")
fmt.Fprintln(out, "Commands:")
fmt.Fprintln(out, "  start                   run in foreground, emit logs to stdout (journalctl friendly)")
fmt.Fprintln(out, "  stop                    stop the vProx.service daemon")
fmt.Fprintln(out, "  restart                 restart the vProx.service daemon")
fmt.Fprintln(out, "  fleet <sub> [flags]     manage remote VMs and deployments")
fmt.Fprintln(out, "  mod   <sub> [flags]     manage vProx ecosystem modules")
fmt.Fprintln(out, "  chain <sub> [flags]     chain node status and upgrade tracking")
fmt.Fprintln(out, "  config [step] [--web]   interactive TOML configuration wizard")
fmt.Fprintln(out, "  vops [sub] [flags]      vOps log analyzer (start|stop|restart|ingest|accounts|threats|cache|status)")
fmt.Fprintln(out, "  completion <shell>      generate shell completion script (bash|zsh|fish)")
fmt.Fprintln(out, "")
fmt.Fprintln(out, "Flags:")
fmt.Fprintln(out, "  --addr string           listen address (default :3000)")
fmt.Fprintln(out, "  --auto-burst int        override auto-quarantine burst (env: VPROX_AUTO_BURST)")
fmt.Fprintln(out, "  --auto-rps float        override auto-quarantine RPS (env: VPROX_AUTO_RPS)")
fmt.Fprintln(out, "  --burst int             override default burst (env: VPROX_BURST)")
fmt.Fprintln(out, "  --chains string         override chains directory")
fmt.Fprintln(out, "  --config string         override config directory")
fmt.Fprintln(out, "  -d, --daemon            start as background daemon (sudo service vProx start)")
fmt.Fprintln(out, "  -O, --with-vops         with -d: also start/stop/restart vOps service; prints two-line status")
fmt.Fprintln(out, "  --disable-auto          disable auto-quarantine")
fmt.Fprintln(out, "  --disable-backup        disable automatic backup loop and persist to backup.toml")
fmt.Fprintln(out, "  --dry-run               load everything but don't start server")
fmt.Fprintln(out, "  --help                  show this help")
fmt.Fprintln(out, "  --home string           override VPROX_HOME")
fmt.Fprintln(out, "  --info                  show loaded config summary and exit")
fmt.Fprintln(out, "  --list-backup           list available backup archives and exit")
fmt.Fprintln(out, "  --log-file string       override main log file path")
fmt.Fprintln(out, "  --new-backup            create a new backup archive and exit")
fmt.Fprintln(out, "  --quiet                 suppress non-error output")
fmt.Fprintln(out, "  --reset-count           reset persisted access counters (backup)")
fmt.Fprintln(out, "  --rps float             override default RPS (env: VPROX_RPS)")
fmt.Fprintln(out, "  --backup-status         show backup automation status and next-run ETA")
fmt.Fprintln(out, "  --validate              validate configs and exit")
fmt.Fprintln(out, "  --verbose               verbose logging output")
fmt.Fprintln(out, "  --version               show version and exit")
fmt.Fprintln(out, "  --with-vops             start vOps alongside proxy (use -O for short form)")
fmt.Fprintln(out, "")
fmt.Fprintln(out, "Backup output goes to terminal + main.log. When run standalone (not via systemd),")
fmt.Fprintln(out, "use 'journalctl -t vProx' to see backup entries in the journal.")
}

if len(rawArgs) == 0 {
printHelp()
os.Exit(0)
}

switch rawArgs[0] {
case "start":
startMode = true
rawArgs = rawArgs[1:]
case "restart":
restartSubcmd = true
rawArgs = rawArgs[1:]
case "stop":
stopSubcmd = true
rawArgs = rawArgs[1:]
case "fleet":
runFleetCmd(resolveHome(rawArgs[1:]), rawArgs[1:])
os.Exit(0)
case "mod":
runModCmd(resolveHome(rawArgs[1:]), rawArgs[1:])
os.Exit(0)
case "chain":
runChainCmd(resolveHome(rawArgs[1:]), rawArgs[1:])
os.Exit(0)
case "config":
runConfigCmd(resolveHome(rawArgs[1:]), rawArgs[1:])
os.Exit(0)
case "vops":
runVOpsCmd(resolveHome(rawArgs[1:]), rawArgs[1:])
os.Exit(0)
case "completion":
runCompletionCmd(rawArgs[1:])
os.Exit(0)
default:
if !strings.HasPrefix(rawArgs[0], "-") {
fmt.Fprintf(os.Stderr, "vProx: unknown command %q\n\n", rawArgs[0])
printHelp()
os.Exit(1)
}
}
os.Args = append([]string{os.Args[0]}, rawArgs...)

// --- Flag definitions ---
newBackupFlag := flag.Bool("new-backup", false, "create a new backup archive and exit")
listBackupFlag := flag.Bool("list-backup", false, "list available backup archives and exit")
statusFlag := flag.Bool("backup-status", false, "show backup automation status and next-run ETA")
daemonFlag := flag.Bool("daemon", false, "start as background daemon (sudo service vProx start)")
daemonShortFlag := flag.Bool("d", false, "alias for --daemon")
backupFlagAlias := flag.Bool("backup", false, "")
withVOpsFlag := flag.Bool("with-vops", false, "start vOps server alongside proxy (integrated mode)")
withVOpsFlagShort := flag.Bool("O", false, "alias for --with-vops")
var resetCount bool
flag.BoolVar(&resetCount, "reset_count", false, "reset persisted access counters (for backup mode)")
flag.BoolVar(&resetCount, "reset-count", false, "reset persisted access counters (for backup mode)")
homeFlag := flag.String("home", "", "override VPROX_HOME")
configFlag := flag.String("config", "", "override config directory")
chainsFlag := flag.String("chains", "", "override chains directory")
addrFlag := flag.String("addr", "", "listen address (default :3000)")
logFileFlag := flag.String("log-file", "", "override main log file path")
validateFlag := flag.Bool("validate", false, "validate configs and exit")
dryRunFlag := flag.Bool("dry-run", false, "load everything but don't start server")
verboseFlag := flag.Bool("verbose", false, "verbose logging output")
_ = flag.Bool("quiet", false, "suppress non-error output")
versionFlag := flag.Bool("version", false, "show version and exit")
infoFlag := flag.Bool("info", false, "show loaded config summary and exit")
rpsFlag := flag.Float64("rps", 0, "override default RPS (env: VPROX_RPS)")
burstFlag := flag.Int("burst", 0, "override default burst (env: VPROX_BURST)")
autoRpsFlag := flag.Float64("auto-rps", 0, "override auto-quarantine RPS (env: VPROX_AUTO_RPS)")
autoBurstFlag := flag.Int("auto-burst", 0, "override auto-quarantine burst (env: VPROX_AUTO_BURST)")
disableAutoFlag := flag.Bool("disable-auto", false, "disable auto-quarantine")
disableBackupFlag := flag.Bool("disable-backup", false, "disable automatic backup loop")

flag.Usage = printHelp
flag.Parse()

if *versionFlag {
fmt.Printf("vProx %s (commit: %s, built: %s)\n", version, commit, buildDate)
os.Exit(0)
}

// Service commands.
if restartSubcmd {
withVO := *withVOpsFlag || *withVOpsFlagShort
vproxErr := runNamedServiceCommand("vProx", "restart")
var vopsErr error
if withVO {
vopsErr = runNamedServiceCommand("vOps", "restart")
}
printServiceStatus(vproxErr, vopsErr, withVO)
if vproxErr != nil {
os.Exit(1)
}
return
}
if stopSubcmd {
withVO := *withVOpsFlag || *withVOpsFlagShort
vproxErr := runNamedServiceCommand("vProx", "stop")
var vopsErr error
if withVO {
vopsErr = runNamedServiceCommand("vOps", "stop")
}
printServiceStatus(vproxErr, vopsErr, withVO)
if vproxErr != nil {
os.Exit(1)
}
return
}
if *daemonFlag || *daemonShortFlag {
withVO := *withVOpsFlag || *withVOpsFlagShort
vproxErr := runNamedServiceCommand("vProx", "start")
var vopsErr error
if withVO {
vopsErr = runNamedServiceCommand("vOps", "start")
}
printServiceStatus(vproxErr, vopsErr, withVO)
if vproxErr != nil {
os.Exit(1)
}
return
}

// Resolve home and directories (needed for backup CLI modes).
vproxHome := resolveVProxHome()
if *homeFlag != "" {
vproxHome = *homeFlag
}
if vproxHome != "" {
_ = os.Setenv("VPROX_HOME", vproxHome)
}

configDir := filepath.Join(vproxHome, "config")
if *configFlag != "" {
if filepath.IsAbs(*configFlag) {
configDir = *configFlag
} else {
configDir = filepath.Join(vproxHome, *configFlag)
}
}
dataDir := filepath.Join(vproxHome, "data")
logsDir := filepath.Join(dataDir, "logs")
archiveDir := filepath.Join(logsDir, "archives")
accessCountsPath := filepath.Join(dataDir, "access-counts.json")

for _, dir := range []string{configDir, dataDir, logsDir, archiveDir} {
if err := os.MkdirAll(dir, 0o755); err != nil {
log.Fatalf("Could not create directory %s: %v", dir, err)
}
}

mainLogPath := filepath.Join(logsDir, "main.log")
if *logFileFlag != "" {
if filepath.IsAbs(*logFileFlag) {
mainLogPath = *logFileFlag
} else {
mainLogPath = filepath.Join(logsDir, *logFileFlag)
}
}

// --- Backup CLI modes ---
doBackup := *newBackupFlag || *backupFlagAlias
doListBackup := *listBackupFlag
doStatus := *statusFlag

if doListBackup {
if err := listBackupArchives(archiveDir); err != nil {
fmt.Fprintf(os.Stderr, "list-backup failed: %v\n", err)
os.Exit(1)
}
return
}
if doStatus {
printBackupStatus(resolveBackupConfigPath(configDir), filepath.Join(dataDir, "backup.last"), archiveDir)
return
}
if doBackup {
if resetCount {
// Load and reset counter using internal package path.
_ = accessCountsPath // ensure variable used
}
bupCfg, bupLoaded, _ := backup.LoadConfig(resolveBackupConfigPath(configDir))
listSrc := "default"
if bupLoaded {
listSrc = "loaded"
}
rotateExtra, extraFiles := resolveBackupExtraFiles(bupCfg, dataDir, logsDir, configDir, mainLogPath)
if err := backup.RunOnce(backup.Options{
LogPath:     mainLogPath,
ArchiveDir:  archiveDir,
StatePath:   filepath.Join(dataDir, "backup.last"),
Method:      "MANUAL",
RotateExtra: rotateExtra,
ExtraFiles:  extraFiles,
ListSource:  listSrc,
}); err != nil {
log.Fatalf("Backup failed: %v", err)
}
vopsURL := os.Getenv("VOPS_URL")
chainsConfigDir := filepath.Join(configDir, "chains")
for _, p := range []string{
filepath.Join(chainsConfigDir, "services.toml"),
filepath.Join(chainsConfigDir, "ports.toml"),
filepath.Join(configDir, "ports.toml"),
} {
if pp, err := config.LoadPorts(p); err == nil && pp.VOpsURL != "" {
vopsURL = pp.VOpsURL
break
}
}
notifyVOps(vopsURL)
return
}

// --- Server start (or --validate / --info / --dry-run) ---
// Delegate everything to internal/vprox.Server.

if !startMode && !*validateFlag && !*infoFlag && !*dryRunFlag {
// No start mode selected and not a diagnostic flag → print help.
printHelp()
os.Exit(1)
}

ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()

srv := vprox.New(vprox.Config{
Home:          vproxHome,
Addr:          *addrFlag,
ConfigDir:     *configFlag,
ChainsDir:     *chainsFlag,
LogFile:       *logFileFlag,
Verbose:       *verboseFlag,
DisableAuto:   *disableAutoFlag,
DisableBackup: *disableBackupFlag,
RPS:           *rpsFlag,
Burst:         *burstFlag,
AutoRPS:       *autoRpsFlag,
AutoBurst:     *autoBurstFlag,
DryRun:        *dryRunFlag,
Validate:      *validateFlag,
Info:          *infoFlag,
})
if err := srv.Start(ctx); err != nil {
log.Fatalf("vProx error: %v", err)
}
}
