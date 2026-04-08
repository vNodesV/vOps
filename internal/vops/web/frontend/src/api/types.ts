// Dashboard stats (map[string]int64 from Go)
export interface Stats {
  total_ips: number;
  total_requests: number;
  total_ratelimit_events: number;
  total_archives: number;
  flagged_ips: number;
  blocked_ips: number;
}

// IP account (db.IPAccount)
export interface IPAccount {
  IP: string;
  FirstSeen: string;
  LastSeen: string;
  TotalRequests: number;
  RatelimitEvents: number;
  Country: string;
  ASN: string;
  Org: string;
  Hostnames: string;      // JSON array string
  OpenPorts: string;      // JSON array string
  Services: string;       // JSON object string
  VTMalicious: number;
  VTData: string;
  AbuseScore: number;
  AbuseData: string;
  ShodanData: string;
  ThreatScore: number;
  ThreatFlags: string;    // JSON array string
  IntelUpdatedAt: string;
  Notes: string;
  Tags: string;           // JSON array string
  Status: string;         // "allowed" | "blocked" | ""
  RDNS: string;
  AbuseEmail: string;
  Moniker: string;
  ChainID: string;
  PingMs: number;
  Protocol: string;
  OSINTUpdatedAt: string;
}

// Chart data
export interface ChartPoint { label: string; value: number; }
export interface SeriesLine { name: string; color: string; values: number[]; }
export interface ChartSeries { labels: string[]; series: SeriesLine[]; }
export interface EndpointStat { host: string; requests: number; unique_ips: number; last_seen: string; }

// Fleet types
export interface ChainStatus {
  chain: string;
  type: string;
  rpc_url: string;
  rest_url?: string;
  moniker: string;
  height: number;
  earliest_height: number;
  catching_up: boolean;
  latest_block_time: string;
  avg_block_sec?: number;
  node_status: string;        // "synced" | "syncing" | "down"
  active_proposals: number;
  active_proposal_ids?: string[];
  voting_end_time?: string;
  upgrade_pending: boolean;
  upgrade_name?: string;
  upgrade_height?: number;
  upgrade_est_utc?: string;
  upgrade_proposal_id?: string;
  chain_id?: string;
  chain_name?: string;
  network_type?: string;
  explorer_url?: string;
  internal_ip?: string;
  lan_ping_ms: number;
  val_participation?: string;
  has_validator: boolean;
  val_bonded: boolean;
  val_jailed: boolean;
  val_missed_blocks: number;
  datacenter?: string;
  dashboard_name?: string;
  ping_country?: string;
  ping_provider?: string;
  updated_at: string;
  error?: string;
}

export interface VMView { name: string; host: string; datacenter: string; type: string; }

// Live VM status from SSH poll
export interface VMStatus {
  // Identity
  name: string;
  datacenter: string;
  lan_ip: string;
  public_ip: string;
  host_ref?: string;
  type: string;
  // Endpoints
  rpc_url?: string;
  rest_url?: string;
  // Live metrics
  online: boolean;
  os: string;
  cpu_pct: number;
  mem_pct: number;
  storage_pct: number;
  load_avg: string;
  apt_count: number;
  // Meta
  error?: string;
  polled_at: string;
}

/** Hypervisor host from DB inventory or config snapshot. */
export interface HostInventory {
  name: string;
  host_name?: string;
  lan_ip?: string;
  public_ip?: string;
  vrack_ip?: string;
  datacenter?: string;
  os?: string;
  kernel?: string;
  uptime_sec?: number;
  disk_pct?: number;
  load_avg?: string;
  apt_pending: number;
  last_seen?: string;
  status: string;
}

/** VM discovered via `virsh list --all` on the hypervisor host. */
export interface VirshVM {
  name: string;
  datacenter: string;
  lan_ip?: string;
  state: string;
  online: boolean;
  os_version?: string;
  cpu_pct?: number;
  load_avg?: string;
  mem_pct?: number;
  error?: string;
}

export interface Deployment {
  id: number;
  vm: string;
  chain: string;
  component: string;
  script: string;
  status: string;
  started_at: string;
  finished_at?: string;
  output?: string;
}

export interface RegisteredChain {
  chain: string;
  rpc_url: string;
  rest_url?: string;
  note?: string;
}

// Ingest
export interface ArchiveStats {
  total_archives: number;
  total_events: number;
  archives: Array<{
    filename: string;
    ingested_at: string;
    request_count: number;
    ratelimit_count: number;
    size_bytes: number;
  }>;
}

// Settings snapshot (raw config map)
export type ConfigSnapshot = Record<string, unknown>;

// SSE event data
export interface SSEEvent { type: string; data: string; }

// VM Metrics History
export interface VMMetricPoint {
  polled_at: string;
  cpu_pct: number;
  mem_pct: number;
  storage_pct: number;
  load_avg: string;
  apt_count: number;
}

// VM Manager — libvirt domains
export interface LibvirtDomain {
  name: string;
  state: string;      // "running" | "shut off" | "paused" | "crashed"
  cpus: number;
  max_mem_kib: number;
  used_mem_kib: number;
  persistent: boolean;
  autostart: boolean;
  uuid?: string;
}

export interface LibvirtSnapshot {
  name: string;
  created_at?: string;
  state?: string;
}

export interface HypervisorHost {
  name: string;
  lan_ip?: string;
  datacenter?: string;
  user?: string;
}

// Services registry
export type ServiceType = 'validator' | 'api' | 'rpc' | 'node' | 'relayer' | 'webserver' | 'vprox' | 'other';

export interface Service {
  id: number;
  name: string;
  service_type: ServiceType;
  vm_name: string;
  datacenter: string;
  chain_id: string;
  state: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ServiceStatus {
  id?: number;
  service_id?: number;
  polled_at?: string;
  online?: boolean;
  metrics?: Record<string, unknown>;
}

// Service field schema (from GET /api/v1/services/schema)
export interface ServiceFieldDef {
  key: string;
  label: string;
  type: 'text' | 'select' | 'bool';
  required?: boolean;
  placeholder?: string;
  options?: string[];
  hint?: string;
}
export type ServiceSchema = Record<ServiceType, ServiceFieldDef[]>;

// Sync ETA result (from GET /api/v1/services/{id}/eta)
export interface ServiceETA {
  service_id: number;
  catching_up: boolean;
  local_height: number;
  ext_height: number;
  blocks_behind: number;
  avg_block_sec: number;
  eta_seconds: number;
  eta_human: string;
  polled_at: string;
  error?: string;
}
