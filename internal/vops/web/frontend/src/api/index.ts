import { apiFetch, apiPost, BASE } from './client';
import type {
  Stats,
  IPAccount,
  ChartSeries,
  ChainStatus,
  VMView,
  VMStatus,
  Deployment,
  RegisteredChain,
  ArchiveStats,
  ConfigSnapshot,
  ChartPoint,
  EndpointStat,
} from './types';

// Auth
export const login = (username: string, password: string) =>
  apiPost<{ ok: boolean }>('/login', { username, password });

export const logout = () =>
  apiPost<void>('/logout');

// Stats
export const getStats = () => apiFetch<Stats>('/api/v1/stats');

// Charts
export const getChart = (type: string, days?: number) =>
  apiFetch<ChartSeries | ChartPoint[] | EndpointStat[]>(
    `/api/v1/chart?type=${type}${days ? `&days=${days}` : ''}`,
  );

// Accounts
export const getAccounts = (params: {
  limit?: number;
  offset?: number;
  search?: string;
  sort?: string;
  dir?: string;
}) => {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  if (params.search) q.set('search', params.search);
  if (params.sort) q.set('sort', params.sort);
  if (params.dir) q.set('dir', params.dir);
  return apiFetch<IPAccount[]>(`/api/v1/accounts?${q}`);
};

export const getAccount = (ip: string) =>
  apiFetch<IPAccount>(`/api/v1/accounts/${ip}`);

export const blockIP = (ip: string) =>
  apiPost<{ ok: boolean }>(`/api/v1/block/${ip}`);

export const unblockIP = (ip: string) =>
  apiPost<{ ok: boolean }>(`/api/v1/unblock/${ip}`);

export const syncUFW = (sudoPassword?: string) =>
  apiPost<{ total?: number; imported?: number; note?: string }>('/api/v1/ufw/sync', sudoPassword ? { sudo_password: sudoPassword } : undefined);

// Ingest
export const triggerIngest = () =>
  apiPost<{ ok: boolean; count: number }>('/api/v1/ingest');

export const getIngestStats = () =>
  apiFetch<ArchiveStats>('/api/v1/ingest/stats');

// Fleet
export const getFleetChains = () =>
  apiFetch<{ chains: ChainStatus[] }>('/api/v1/fleet/chains');

export const getFleetVMs = () =>
  apiFetch<{ vms: VMView[] }>('/api/v1/fleet/vms');

export const getVMStatus = () =>
  apiFetch<{ vms: VMStatus[]; hosts: unknown[] }>('/api/v1/fleet/vms/status');

/** Trigger a fresh SSH poll of all VMs (POST — action semantics). */
export const scanAllVMs = () =>
  apiPost<{ vms: VMStatus[]; hosts: unknown[] }>('/api/v1/fleet/vms/scan', {});

/** Register a virsh-discovered VM into the infra TOML config. */
export const registerDiscoveredVM = (name: string, lan_ip: string, datacenter: string) =>
  apiPost<{ ok: boolean; already_registered: boolean; file: string }>(
    '/api/v1/fleet/vms/register',
    { name, lan_ip, datacenter },
  );;

/** Returns the SSE URL for streaming apt upgrade output on a named VM. */
export const vmUpgradeURL = (name: string) =>
  `${BASE}api/v1/fleet/vms/${encodeURIComponent(name)}/upgrade`;

/** Returns stored host inventory from DB or config snapshot. */
export const getHosts = () =>
  apiFetch<{ hosts: import('./types').HostInventory[] }>('/api/v1/fleet/hosts');

/** Triggers a fresh SSH scan of all hypervisor hosts. */
export const scanHosts = () =>
  apiPost<{ hosts: import('./types').HostInventory[]; scanned_at: string }>('/api/v1/fleet/hosts/scan', {});

/** Returns the SSE URL for streaming apt upgrade on a named host. */
export const hostUpgradeURL = (name: string) =>
  `${BASE}api/v1/fleet/hosts/${encodeURIComponent(name)}/upgrade`;

export const getDeployments = (chain?: string) =>
  apiFetch<{ deployments: Deployment[] }>(
    `/api/v1/fleet/deployments${chain ? `?chain=${chain}` : ''}`,
  );

export const getRegisteredChains = () =>
  apiFetch<{ chains: RegisteredChain[] }>('/api/v1/fleet/chains/registered');

export const registerChain = (
  data: Omit<RegisteredChain, 'note'> & { note?: string },
) => apiPost<{ ok: boolean }>('/api/v1/fleet/chains/registered', data);

export const unregisterChain = (chain: string) =>
  apiPost<{ ok: boolean }>(`/api/v1/fleet/chains/registered/${chain}`);

export const forcePoll = () =>
  apiPost<{ ok: boolean }>('/api/v1/fleet/poll');

// Settings
export const getConfig = () =>
  apiFetch<ConfigSnapshot>('/settings/api/config/current');

export const saveConfig = (section: string, data: unknown) =>
  apiPost<{ ok: boolean }>(`/settings/api/config/${section}`, data);

export const applyConfig = (data: unknown) =>
  apiPost<{ ok: boolean }>('/settings/api/config/apply', data);

export const genAPIKey = () =>
  apiFetch<{ key: string }>('/settings/api/gen-api-key');

export const hashPassword = (password: string) =>
  apiPost<{ hash: string }>('/settings/api/hash-password', { password });

export const getSSHPubKey = () =>
  apiFetch<{ public_key: string }>('/settings/api/ssh-pub-key');

export const genSSHKey = () =>
  apiPost<{ public_key: string; private_key_path: string }>(
    '/settings/api/gen-ssh-key',
  );

// Fleet — VM metrics history
export const getVMHistory = (name: string, hours = 24) =>
  apiFetch<{ history: import('./types').VMMetricPoint[] }>(
    `/api/v1/fleet/vms/${encodeURIComponent(name)}/history?hours=${hours}`,
  );

// VM Manager
export const getVMHosts = () =>
  apiFetch<{ hosts: import('./types').HypervisorHost[] }>('/api/v1/vm/hosts');

export const getVMDomains = (host: string) =>
  apiFetch<{ host: string; domains: import('./types').LibvirtDomain[] }>(
    `/api/v1/vm/hosts/${encodeURIComponent(host)}/domains`,
  );

export const vmDomainAction = (host: string, domain: string, action: string) =>
  apiPost<{ result: string }>(
    `/api/v1/vm/hosts/${encodeURIComponent(host)}/domains/${encodeURIComponent(domain)}/action`,
    { action },
  );

export const getVMSnapshots = (host: string, domain: string) =>
  apiFetch<{ snapshots: import('./types').LibvirtSnapshot[] }>(
    `/api/v1/vm/hosts/${encodeURIComponent(host)}/domains/${encodeURIComponent(domain)}/snapshots`,
  );

export const createVMSnapshot = (host: string, domain: string, name: string) =>
  apiPost<{ result: string }>(
    `/api/v1/vm/hosts/${encodeURIComponent(host)}/domains/${encodeURIComponent(domain)}/snapshots`,
    { name },
  );

export const revertVMSnapshot = (host: string, domain: string, snap: string) =>
  apiPost<{ result: string }>(
    `/api/v1/vm/hosts/${encodeURIComponent(host)}/domains/${encodeURIComponent(domain)}/snapshots/${encodeURIComponent(snap)}/revert`,
    {},
  );

export const deleteVMSnapshot = (host: string, domain: string, snap: string) =>
  apiPost<{ result: string }>(
    `/api/v1/vm/hosts/${encodeURIComponent(host)}/domains/${encodeURIComponent(domain)}/snapshots/${encodeURIComponent(snap)}/delete`,
    {},
  );

// ── Debug console ────────────────────────────────────────────────────────────

export interface DebugEvent {
  id: number;
  time: string;
  source: string;
  host: string;
  command: string;
  output?: string;
  error?: string;
  duration_ms: number;
}

export const getDebugMode = () =>
  apiFetch<{ enabled: boolean }>('/api/v1/debug/mode');

export const setDebugMode = (enabled: boolean, clear = false) =>
  apiPost<{ enabled: boolean }>('/api/v1/debug/mode', { enabled, clear });

export const getDebugEvents = (sinceId = 0) =>
  apiFetch<{ enabled: boolean; events: DebugEvent[] }>(
    `/api/v1/debug/events?since_id=${sinceId}`,
  );

// ── Services registry ────────────────────────────────────────────────────────

export const getServices = () =>
  apiFetch<{ services: import('./types').Service[] }>('/api/v1/services');

export const getService = (id: number) =>
  apiFetch<{ service: import('./types').Service; status: import('./types').ServiceStatus }>(`/api/v1/services/${id}`);

export const createService = (body: {
  name: string;
  service_type: string;
  vm_name?: string;
  datacenter?: string;
  chain_id?: string;
  config?: Record<string, unknown>;
}) => apiPost<{ id: number; name: string }>('/api/v1/services', body);

export const updateService = (
  id: number,
  body: {
    vm_name?: string;
    datacenter?: string;
    chain_id?: string;
    state?: string;
    config?: Record<string, unknown>;
  },
) => apiFetch<{ updated: number }>(`/api/v1/services/${id}`, {
  method: 'PUT',
  body: JSON.stringify(body),
});

export const deleteService = (id: number) =>
  apiFetch<{ deleted: number }>(`/api/v1/services/${id}`, { method: 'DELETE' });

export const getServiceSchema = () =>
  apiFetch<import('./types').ServiceSchema>('/api/v1/services/schema');

export const getServiceETA = (id: number) =>
  apiFetch<import('./types').ServiceETA>(`/api/v1/services/${id}/eta`);

// ── Units registry ─────────────────────────────────────────────────────────

export const getUnits = () =>
  apiFetch<{ units: import('./types').CosmosUnitWithStatus[] }>('/api/v1/units');

export const getUnit = (name: string) =>
  apiFetch<import('./types').CosmosUnitWithStatus>(`/api/v1/units/${encodeURIComponent(name)}`);

export const createUnit = (body: Partial<import('./types').CosmosUnit>) =>
  apiPost<{ ok: string; name: string }>('/api/v1/units', body);

export const updateUnit = (name: string, body: Partial<import('./types').CosmosUnit>) =>
  apiFetch<{ ok: string }>(`/api/v1/units/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const deleteUnit = (name: string) =>
  apiFetch<{ ok: string }>(`/api/v1/units/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const getUnitStatusHistory = (name: string) =>
  apiFetch<{ history: import('./types').UnitStatus[] }>(
    `/api/v1/units/${encodeURIComponent(name)}/status/history`,
  );

