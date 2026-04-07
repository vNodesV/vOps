package vm

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/vNodesV/vProx/internal/fleet/config"
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
	sshPort    int
	sshKeyPath string
	knownHosts string
}

// NewHandlers creates Handlers backed by the given fleet service.
// svc must implement configProvider (satisfied by *fleet.Service).
func NewHandlers(svc configProvider, sshPort int, sshKeyPath, knownHosts string) *Handlers {
	return &Handlers{
		svc:        svc,
		sshPort:    sshPort,
		sshKeyPath: sshKeyPath,
		knownHosts: knownHosts,
	}
}

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
	client, err := dialHost(hi, h.sshPort, h.sshKeyPath, h.knownHosts)
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
	client, err := dialHost(hi, h.sshPort, h.sshKeyPath, h.knownHosts)
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
	client, err := dialHost(hi, h.sshPort, h.sshKeyPath, h.knownHosts)
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
	client, err := dialHost(hi, h.sshPort, h.sshKeyPath, h.knownHosts)
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
	client, err := dialHost(hi, h.sshPort, h.sshKeyPath, h.knownHosts)
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
	client, err := dialHost(hi, h.sshPort, h.sshKeyPath, h.knownHosts)
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
	client, err := dialHost(hi, h.sshPort, h.sshKeyPath, h.knownHosts)
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
