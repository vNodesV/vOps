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

/** Returns the SSE URL for streaming apt upgrade output on a named VM. */
export const vmUpgradeURL = (name: string) =>
  `${BASE}api/v1/fleet/vms/${encodeURIComponent(name)}/upgrade`;

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
