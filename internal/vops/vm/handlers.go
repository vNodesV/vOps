package vm

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/vNodesV/vOps/internal/fleet/config"
	opsdb "github.com/vNodesV/vOps/internal/vops/db"
)

// configProvider is satisfied by *fleet.Service and allows Handlers to read
// the current fleet config without holding a stale snapshot.
type configProvider interface {
	Config() *config.Config
}

// Handlers exposes VM manager operations as HTTP JSON endpoints.
// It is wired into the vOps mux by server.go when fleet config is available.
// svc is queried on every request so VM Manager always reflects live TOML state.
type Handlers struct {
	svc        configProvider
	db         *sql.DB // optional; used for audit logging
	sshPort    int
	sshKeyPath string
	knownHosts string
	debug      vmDebugEmitter
}

// vmDebugEmitter is satisfied by *web.DebugRing; defined locally to avoid
// a circular import between the vm and web packages.
type vmDebugEmitter interface {
	IsEnabled() bool
	Emit(source, host, command, output, errStr string, durationMs int64)
}

// NewHandlers creates Handlers backed by the given fleet service.
// svc must implement configProvider (satisfied by *fleet.Service).
// db is optional; when non-nil, management actions are recorded in audit_log.
func NewHandlers(svc configProvider, db *sql.DB, sshPort int, sshKeyPath, knownHosts string) *Handlers {
	return &Handlers{
		svc:        svc,
		db:         db,
		sshPort:    sshPort,
		sshKeyPath: sshKeyPath,
		knownHosts: knownHosts,
	}
}

// SetDebug attaches a debug emitter so all SSH commands executed by VM manager
// handlers are recorded in the debug console.
func (h *Handlers) SetDebug(d vmDebugEmitter) { h.debug = d }

// ── GET /api/v1/vm/hosts ──────────────────────────────────────────────────────

// HandleListHosts returns all hypervisor hosts from the fleet config.
func (h *Handlers) HandleListHosts(w http.ResponseWriter, r *http.Request) {
	cfg := h.svc.Config()
	if cfg == nil {
		writeJSON(w, http.StatusOK, map[string]any{"hosts": []HostInfo{}})
		return
	}
	hosts := make([]HostInfo, 0, len(cfg.Hosts))
	for _, host := range cfg.Hosts {
		hosts = append(hosts, HostInfo{
			Name:       host.Name,
			LanIP:      host.LanIP,
			Datacenter: host.Datacenter,
			User:       host.User,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"hosts": hosts})
}

// ── GET /api/v1/vm/hosts/{host}/domains ──────────────────────────────────────

// HandleListDomains lists all libvirt domains on the named hypervisor host.
func (h *Handlers) HandleListDomains(w http.ResponseWriter, r *http.Request) {
	hostName := r.PathValue("host")
	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}
	domains, err := ListDomains(client)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"host": hostName, "domains": domains})
}

// ── POST /api/v1/vm/hosts/{host}/domains/{domain}/action ─────────────────────

type actionRequest struct {
	Action string `json:"action"`
}

// HandleDomainAction executes a lifecycle action (start/shutdown/destroy/etc).
func (h *Handlers) HandleDomainAction(w http.ResponseWriter, r *http.Request) {
	hostName := r.PathValue("host")
	domainName := r.PathValue("domain")

	var req actionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Action == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body must contain {\"action\":\"...\"}"})
		return
	}

	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}
	out, err := DomainAction(client, domainName, req.Action)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": out})
}

// ── GET /api/v1/vm/hosts/{host}/domains/{domain}/stats ───────────────────────

// HandleDomainStats returns live virsh domstats for one domain.
func (h *Handlers) HandleDomainStats(w http.ResponseWriter, r *http.Request) {
	hostName := r.PathValue("host")
	domainName := r.PathValue("domain")

	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}
	stats, err := DomainStats(client, domainName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"host": hostName, "domain": domainName, "stats": stats})
}

// ── GET /api/v1/vm/hosts/{host}/domains/{domain}/snapshots ───────────────────

// HandleListSnapshots returns snapshot names for a domain.
func (h *Handlers) HandleListSnapshots(w http.ResponseWriter, r *http.Request) {
	hostName, domainName := r.PathValue("host"), r.PathValue("domain")
	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}
	snaps, err := ListSnapshots(client, domainName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if snaps == nil {
		snaps = []Snapshot{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"snapshots": snaps})
}

// ── POST /api/v1/vm/hosts/{host}/domains/{domain}/snapshots ──────────────────

type snapshotRequest struct {
	Name string `json:"name"`
}

// HandleCreateSnapshot creates a new snapshot for a domain.
func (h *Handlers) HandleCreateSnapshot(w http.ResponseWriter, r *http.Request) {
	hostName, domainName := r.PathValue("host"), r.PathValue("domain")
	var req snapshotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body must contain {\"name\":\"...\"}"})
		return
	}
	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}
	if err := CreateSnapshot(client, domainName, req.Name); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "created"})
}

// ── POST /api/v1/vm/hosts/{host}/domains/{domain}/snapshots/{snap}/revert ────

// HandleRevertSnapshot reverts a domain to a named snapshot.
func (h *Handlers) HandleRevertSnapshot(w http.ResponseWriter, r *http.Request) {
	hostName, domainName, snapName := r.PathValue("host"), r.PathValue("domain"), r.PathValue("snap")
	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}
	if err := RevertSnapshot(client, domainName, snapName); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "reverted"})
}

// ── DELETE /api/v1/vm/hosts/{host}/domains/{domain}/snapshots/{snap} ─────────

// HandleDeleteSnapshot deletes a domain snapshot.
func (h *Handlers) HandleDeleteSnapshot(w http.ResponseWriter, r *http.Request) {
	hostName, domainName, snapName := r.PathValue("host"), r.PathValue("domain"), r.PathValue("snap")
	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}
	if err := DeleteSnapshot(client, domainName, snapName); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "deleted"})
}

// ── helpers ───────────────────────────────────────────────────────────────────

func (h *Handlers) findHost(name string) (HostInfo, error) {
	cfg := h.svc.Config()
	if cfg == nil {
		return HostInfo{}, fmt.Errorf("host %q not found in fleet config", name)
	}
	for _, host := range cfg.Hosts {
		if host.Name == name {
			user := host.User
			if user == "" {
				user = "root"
			}
			return HostInfo{
				Name:       host.Name,
				LanIP:      host.LanIP,
				Datacenter: host.Datacenter,
				User:       user,
				SSHKeyPath: host.SSHKeyPath, // per-host key; falls back to h.sshKeyPath in dialHost
				Port:       host.Port,       // per-host port; falls back to h.sshPort / 22 in dialHost
			}, nil
		}
	}
	return HostInfo{}, fmt.Errorf("host %q not found in fleet config", name)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// ── GET /api/v1/vm/hosts/{host}/networks ─────────────────────────────────────

// HandleListNetworks returns all libvirt virtual networks on the named host.
func (h *Handlers) HandleListNetworks(w http.ResponseWriter, r *http.Request) {
	hostName := r.PathValue("host")
	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}
	nets, err := ListNetworks(client)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if nets == nil {
		nets = []Network{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"host": hostName, "networks": nets})
}

// ── GET /api/v1/vm/hosts/{host}/domains/{domain}/interfaces ──────────────────

// HandleDomainInterfaces returns the network interfaces attached to a domain.
func (h *Handlers) HandleDomainInterfaces(w http.ResponseWriter, r *http.Request) {
	hostName, domainName := r.PathValue("host"), r.PathValue("domain")
	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}
	ifaces, err := ListDomainInterfaces(client, domainName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if ifaces == nil {
		ifaces = []Interface{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"host": hostName, "domain": domainName, "interfaces": ifaces})
}

// ── DELETE /api/v1/vm/hosts/{host}/domains/{domain} ──────────────────────────

type deleteDomainRequest struct {
	DeleteStorage bool   `json:"delete_storage"`
	Pool          string `json:"pool"` // default: "default"
}

// HandleDeleteDomain undefines a domain and optionally deletes its storage.
func (h *Handlers) HandleDeleteDomain(w http.ResponseWriter, r *http.Request) {
	hostName, domainName := r.PathValue("host"), r.PathValue("domain")

	var req deleteDomainRequest
	// Body is optional; DELETE may have no body.
	_ = json.NewDecoder(r.Body).Decode(&req)

	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}

	opts := UndefineOpts{DeleteStorage: req.DeleteStorage, Pool: req.Pool}
	opErr := UndefineVM(client, domainName, opts)

	actor, _ := r.Context().Value("vops-actor").(string)
	if actor == "" {
		actor = hostName
	}
	h.audit(actor, "vm.delete", "domain", domainName, opErr)
	if opErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": opErr.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "deleted"})
}

// ── POST /api/v1/vm/hosts/{host}/domains/{domain}/resize ─────────────────────

type resizeDomainRequest struct {
	MemoryMiB int64 `json:"memory_mib"` // 0 = no change
	VCPUs     int   `json:"vcpus"`       // 0 = no change
	Live      bool  `json:"live"`        // apply immediately when running
}

// HandleResizeDomain changes vCPU count and/or memory for a domain.
func (h *Handlers) HandleResizeDomain(w http.ResponseWriter, r *http.Request) {
	hostName, domainName := r.PathValue("host"), r.PathValue("domain")

	var req resizeDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if req.MemoryMiB == 0 && req.VCPUs == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "provide memory_mib and/or vcpus"})
		return
	}

	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}

	var opErr error
	if req.MemoryMiB > 0 {
		opErr = SetMemory(client, domainName, req.MemoryMiB, req.Live)
	}
	if opErr == nil && req.VCPUs > 0 {
		opErr = SetVCPUs(client, domainName, req.VCPUs, req.Live)
	}

	actor, _ := r.Context().Value("vops-actor").(string)
	if actor == "" {
		actor = hostName
	}
	h.audit(actor, "vm.resize", "domain", domainName, opErr)
	if opErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": opErr.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "resized"})
}

// ── POST /api/v1/vm/hosts/{host}/domains ─────────────────────────────────────

type createDomainRequest struct {
	// Mode selects the creation strategy: "clone" or "create".
	Mode string `json:"mode"`

	// clone mode
	SourceDomain string `json:"source_domain"`
	NewDiskPath  string `json:"new_disk_path"` // optional; auto-derived when empty

	// create mode (from base image)
	BaseImage  string `json:"base_image"` // full path in boot-1 pool
	DiskPath   string `json:"disk_path"`  // destination in default pool
	DiskSizeGB int    `json:"disk_size_gb"`
	OSVariant  string `json:"os_variant"` // virt-install --os-variant (e.g. "ubuntu22.04")
	Network    string `json:"network"`    // libvirt network (default: "default")

	// shared
	Name      string `json:"name"`
	MemoryMiB int64  `json:"memory_mib"`
	VCPUs     int    `json:"vcpus"`
	Pool      string `json:"pool"` // storage pool (default: "default")
}

// HandleCreateDomain creates a new VM via clone or fresh image import.
func (h *Handlers) HandleCreateDomain(w http.ResponseWriter, r *http.Request) {
	hostName := r.PathValue("host")

	var req createDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	if req.Mode != "clone" && req.Mode != "create" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "mode must be 'clone' or 'create'"})
		return
	}

	hi, err := h.findHost(hostName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	client, err := h.dialHost(hi)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("ssh: %v", err)})
		return
	}

	var opErr error
	switch req.Mode {
	case "clone":
		if req.SourceDomain == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "source_domain is required for clone mode"})
			return
		}
		opErr = CloneVM(client, CloneOpts{
			SourceDomain: req.SourceDomain,
			NewName:      req.Name,
			NewDiskPath:  req.NewDiskPath,
			Pool:         req.Pool,
			MemMiB:       req.MemoryMiB,
			VCPUs:        req.VCPUs,
		})
	case "create":
		if req.BaseImage == "" || req.DiskPath == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "base_image and disk_path are required for create mode",
			})
			return
		}
		opErr = CreateVMFromImage(client, CreateFromImageOpts{
			Name:       req.Name,
			BaseImage:  req.BaseImage,
			DiskPath:   req.DiskPath,
			DiskSizeGB: req.DiskSizeGB,
			MemMiB:     req.MemoryMiB,
			VCPUs:      req.VCPUs,
			Network:    req.Network,
			OSVariant:  req.OSVariant,
		})
	}

	actor, _ := r.Context().Value("vops-actor").(string)
	if actor == "" {
		actor = hostName
	}
	h.audit(actor, "vm.create."+req.Mode, "domain", req.Name, opErr)
	if opErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": opErr.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"result": "created", "name": req.Name})
}

// ── audit helper ──────────────────────────────────────────────────────────────

// audit records a management action in the audit_log table when a DB is wired.
// actor is the authenticated operator identity from the request context
// (falls back to hostName when the context carries no actor).
// opErr is nil on success; when non-nil the result is "error".
func (h *Handlers) audit(actor, action, targetType, targetName string, opErr error) {
	if h.db == nil {
		return
	}
	entry := opsdb.AuditEntry{
		Actor:      actor,
		Action:     action,
		TargetType: targetType,
		TargetName: targetName,
		Result:     "ok",
	}
	if opErr != nil {
		entry.Result = "error"
		entry.Error = opErr.Error()
	}
	_ = opsdb.InsertAuditLog(h.db, entry)
}
