import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { getStats, getChart, getFleetChains, triggerIngest, triggerBackupAndIngest, getIngestStats, getVMStatus, vmUpgradeURL, getVMHistory, getUnits } from '../api';
import type { Stats, ChartSeries, ArchiveStats, VMStatus, VMMetricPoint, CosmosUnitWithStatus } from '../api/types';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import UpgradeModal from '../components/UpgradeModal';

/* ── SVG Icons ───────────────────────────────────────────────── */

function RequestsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IPIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

function BlockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

/* ── Transform ChartSeries to Recharts data ──────────────────── */

function toRechartsData(cs: ChartSeries): Array<Record<string, string | number>> {
  return (cs.labels ?? []).map((label, i) => {
    const point: Record<string, string | number> = { label };
    for (const s of cs.series ?? []) {
      point[s.name] = (s.values ?? [])[i] ?? 0;
    }
    return point;
  });
}

/* ── Chart Panel ─────────────────────────────────────────────── */

function ChartPanel({ title, queryKey, chartType }: { title: string; queryKey: string; chartType: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: [queryKey],
    queryFn: () => getChart(chartType, 30) as Promise<ChartSeries>,
    refetchInterval: 65_000,
  });

  if (isLoading) return <Spinner label={`Loading ${title}`} />;
  if (isError || !data || !('labels' in data) || !Array.isArray((data as ChartSeries).labels)) {
    return (
      <div className="flex items-center justify-center h-[250px] text-sm" style={{ color: 'var(--vn-text-muted)' }}>
        No chart data available
      </div>
    );
  }

  const rechartsData = toRechartsData(data);

  return (
    <div>
      <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={rechartsData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--vn-border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--vn-text-subtle)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--vn-border)' }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--vn-text-subtle)' }}
            tickLine={false}
            axisLine={false}
            width={50}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--vn-surface)',
              border: '1px solid var(--vn-border)',
              borderRadius: 'var(--vn-radius)',
              fontSize: 12,
            }}
          />
          {(data.series ?? []).map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color || 'var(--vn-primary)'}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Fleet Table ─────────────────────────────────────────────── */

function fmtRelative(iso: string): string {
  if (!iso) return '\u2014';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${(n / 1_073_741_824).toFixed(2)} GB`;
}

/* ── Infrastructure summary boxes ─────────────────────────────── */

function SummaryBoxes() {
  const nav = useNavigate();

  const { data: svcsData } = useQuery({
    queryKey: ['units'],
    queryFn: getUnits,
    refetchInterval: 60_000,
    retry: false,
  });

  const { data: vmsData } = useQuery({
    queryKey: ['vm-status'],
    queryFn: getVMStatus,
    refetchInterval: 60_000,
    retry: false,
  });

  const services = svcsData?.units ?? [];
  const vms: VMStatus[] = vmsData?.vms ?? [];

  // Derive chain stats from registered services (grouped by chain_name)
  const chainNames = [...new Set(services.map(u => u.chain_name || u.chain_id).filter(Boolean))];
  const chainsSynced = chainNames.filter(chain => {
    const cu = services.filter(u => (u.chain_name || u.chain_id) === chain);
    return cu.some(u => u.status?.service_active && !u.status?.syncing);
  }).length;
  const chainsCatching = chainNames.filter(chain => {
    const cu = services.filter(u => (u.chain_name || u.chain_id) === chain);
    return !cu.some(u => u.status?.service_active && !u.status?.syncing) && cu.some(u => u.status?.syncing);
  }).length;
  const chainsProposals = services.reduce((a, u) => a + (u.status?.gov_pending ?? 0), 0);

  const svcsOnline = services.filter(s => s.status?.service_active).length;
  const svcsDown = services.filter(s => s.status != null && !s.status.service_active).length;
  // Count by node_type for breakdown (top 3 most common)
  const svcTypeCount = services.reduce((acc, s) => {
    acc[s.node_type] = (acc[s.node_type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topTypes = Object.entries(svcTypeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const vmsOnline = vms.filter(v => v.online);
  const vmsRunning = vmsOnline.length;
  const totalPatches = vms.reduce((a, v) => a + (v.apt_count ?? 0), 0);
  const busiestVM = vmsOnline.length > 0
    ? vmsOnline.reduce((max, v) => (v.mem_pct ?? 0) > (max.mem_pct ?? 0) ? v : max)
    : null;

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {/* Chains box */}
      <div className="card" role="button" tabIndex={0} onClick={() => nav('/settings')}
        onKeyDown={e => e.key === 'Enter' && nav('/settings')}
        aria-label="Go to Services & Chains settings"
        style={{ cursor: 'pointer', flex: '1 1 200px', minWidth: 180, transition: 'border-color 0.15s' }}>
        <div className="text-xs font-semibold uppercase tracking-[0.06em] mb-3" style={{ color: 'var(--vn-text-muted)' }}>🔗 Chains</div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--vn-info)', marginBottom: '0.5rem' }}>
          {chainNames.length}
        </div>
        <div className="flex justify-between text-sm py-[0.15rem]">
          <span style={{ color: 'var(--vn-text-muted)' }}>Synced</span>
          <span style={{ color: 'var(--vn-success)', fontWeight: 600 }}>{chainsSynced}</span>
        </div>
        {chainsCatching > 0 && (
          <div className="flex justify-between text-sm py-[0.15rem]">
            <span style={{ color: 'var(--vn-text-muted)' }}>Catching up</span>
            <span style={{ color: 'var(--vn-warning)', fontWeight: 600 }}>{chainsCatching}</span>
          </div>
        )}
        {chainsProposals > 0 && (
          <div className="flex justify-between text-sm py-[0.15rem]">
            <span style={{ color: 'var(--vn-warning)' }}>📋 Proposals</span>
            <span style={{ color: 'var(--vn-warning)', fontWeight: 600 }}>{chainsProposals}</span>
          </div>
        )}
      </div>

      {/* Services box */}
      <div className="card" role="button" tabIndex={0} onClick={() => nav('/ops')}
        onKeyDown={e => e.key === 'Enter' && nav('/ops')}
        aria-label="Go to Operations Center"
        style={{ cursor: 'pointer', flex: '1 1 200px', minWidth: 180, transition: 'border-color 0.15s' }}>
        <div className="text-xs font-semibold uppercase tracking-[0.06em] mb-3" style={{ color: 'var(--vn-text-muted)' }}>⚙ Cosmos Units</div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--vn-primary)', marginBottom: '0.5rem' }}>
          {services.length}
        </div>
        <div className="flex justify-between text-sm py-[0.15rem]">
          <span style={{ color: 'var(--vn-text-muted)' }}>Online</span>
          <span style={{ color: 'var(--vn-success)', fontWeight: 600 }}>{svcsOnline}</span>
        </div>
        {svcsDown > 0 && (
          <div className="flex justify-between text-sm py-[0.15rem]">
            <span style={{ color: 'var(--vn-danger)' }}>⚠ Down</span>
            <span style={{ color: 'var(--vn-danger)', fontWeight: 600 }}>{svcsDown}</span>
          </div>
        )}
        {topTypes.map(([type, count]) => (
          <div key={type} className="flex justify-between text-sm py-[0.15rem]">
            <span style={{ color: 'var(--vn-text-muted)', fontSize: '0.75rem' }}>{type}</span>
            <span style={{ fontWeight: 600, fontSize: '0.75rem' }}>{count}</span>
          </div>
        ))}
      </div>

      {/* VMs box */}
      <div className="card" role="button" tabIndex={0} onClick={() => nav('/vms')}
        onKeyDown={e => e.key === 'Enter' && nav('/vms')}
        aria-label="Go to VM Manager"
        style={{ cursor: 'pointer', flex: '1 1 200px', minWidth: 180, transition: 'border-color 0.15s' }}>
        <div className="text-xs font-semibold uppercase tracking-[0.06em] mb-3" style={{ color: 'var(--vn-text-muted)' }}>🖥 VMs</div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--vn-success)', marginBottom: '0.5rem' }}>
          {vmsRunning}<span style={{ fontSize: '1rem', color: 'var(--vn-text-muted)', fontWeight: 400 }}>/{vms.length}</span>
        </div>
        {busiestVM && (
          <div className="flex justify-between text-sm py-[0.15rem]">
            <span style={{ color: 'var(--vn-text-muted)', fontSize: '0.75rem' }} title="Highest mem VM">
              {busiestVM.name}
            </span>
            <span style={{ fontWeight: 600, fontSize: '0.75rem',
              color: (busiestVM.mem_pct ?? 0) > 85 ? 'var(--vn-danger)' : 'var(--vn-text)' }}>
              {Math.round(busiestVM.mem_pct ?? 0)}% mem
            </span>
          </div>
        )}
        {totalPatches > 0 && (
          <div className="flex justify-between text-sm py-[0.15rem]">
            <span style={{ color: 'var(--vn-warning)' }}>📦 Patches</span>
            <span style={{ color: 'var(--vn-warning)', fontWeight: 600 }}>{totalPatches}</span>
          </div>
        )}
        {vms.length === 0 && (
          <div style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)', marginTop: '0.25rem' }}>
            No VMs polled yet
          </div>
        )}
      </div>

    </div>
  );
}

/* ── DC ping color helper ────────────────────────────────────── */



function FleetTable() {
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['units'],
    queryFn: getUnits,
    refetchInterval: 65_000,
    retry: false,
  });

  if (isLoading) return <Spinner label="Loading services" />;

  const allUnits: CosmosUnitWithStatus[] = data?.units ?? [];
  if (allUnits.length === 0) {
    return (
      <div className="card text-center">
        <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
          No services registered &mdash; add chains &amp; services in Settings to enable monitoring.
        </p>
      </div>
    );
  }

  // Group units by chain_name, falling back to chain_id
  const grouped = allUnits.reduce<Record<string, CosmosUnitWithStatus[]>>((acc, u) => {
    const key = u.chain_name || u.chain_id || 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(u);
    return acc;
  }, {});

  return (
    <div className="card card-flush overflow-x-auto">
      <table className="vn-table">
        <thead>
          <tr>
            {['Chain', 'Network', 'Services', 'Active', 'Height', 'Gov', 'Validators', 'Updated'].map(h => (
              <th key={h} scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(grouped).map(([chain, chainUnits]) => {
            const active = chainUnits.filter(u => u.status?.service_active);
            const maxHeight = Math.max(0, ...chainUnits.map(u => u.status?.block_height ?? 0));
            const totalGov = chainUnits.reduce((s, u) => s + (u.status?.gov_pending ?? 0), 0);
            const validators = chainUnits.filter(u => u.node_type === 'validator');
            const bondedValidators = validators.filter(u => (u.status?.voting_power ?? 0) > 0);
            const network = chainUnits[0]?.network_type ?? '';
            const chainId = chainUnits[0]?.chain_id ?? '';
            const upgrades = chainUnits.filter(u => u.status?.upgrade_height != null && (u.status?.upgrade_height ?? 0) > 0);
            const mostRecent = chainUnits
              .map(u => u.status?.polled_at)
              .filter((p): p is string => !!p)
              .sort()
              .pop();

            return (
              <tr
                key={chain}
                style={{ cursor: 'pointer' }}
                onClick={() => nav('/settings')}
                title={`View ${chain} services in Settings`}
              >
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  {chain}
                  {chainId && chainId !== chain && (
                    <span className="text-xs ml-1" style={{ color: 'var(--vn-text-muted)' }}>{chainId}</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--vn-text-muted)' }}>
                  {network || '\u2014'}
                </td>
                <td className="px-3 py-2 tabular-nums">{chainUnits.length}</td>
                <td className="px-3 py-2">
                  {active.length > 0 ? (
                    <span style={{ color: 'var(--vn-success)', fontWeight: 600 }}>{active.length}</span>
                  ) : (
                    <Badge status="down" />
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {maxHeight > 0 ? maxHeight.toLocaleString() : '\u2014'}
                </td>
                <td className="px-3 py-2">
                  {totalGov > 0 ? (
                    <span className="inline-flex items-center gap-1" style={{ color: 'var(--vn-warning)' }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--vn-warning)' }} aria-hidden="true" />
                      {totalGov} active
                    </span>
                  ) : (
                    <span style={{ color: 'var(--vn-text-subtle)' }}>None</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {validators.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Badge status={bondedValidators.length > 0 ? 'synced' : 'down'} />
                      <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
                        {bondedValidators.length}/{validators.length}
                      </span>
                      {upgrades.length > 0 && (
                        <span className="text-xs" style={{ color: 'var(--vn-warning)' }}>
                          ⬆ {upgrades[0].status?.upgrade_name ?? 'upgrade'} @ {upgrades[0].status?.upgrade_height?.toLocaleString()}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--vn-text-subtle)' }}>{'\u2014'}</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--vn-text-subtle)', fontSize: '12px' }}>
                  {mostRecent ? fmtRelative(mostRecent) : '\u2014'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Mini metric bar ─────────────────────────────────────────── */

function MetricBar({ value, warn = 70, danger = 85 }: { value: number; warn?: number; danger?: number }) {
  const color = value >= danger ? 'var(--vn-danger)' : value >= warn ? 'var(--vn-warning)' : 'var(--vn-success)';
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--vn-border)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }} />
      </div>
      <span className="tabular-nums text-xs w-8 text-right" style={{ color }}>{value.toFixed(0)}%</span>
    </div>
  );
}

/* ── Servers Panel ───────────────────────────────────────────── */

function Sparkline({ pts, color, height = 24, width = 100 }: { pts: number[]; color: string; height?: number; width?: number }) {
  if (pts.length < 2) return null;
  const step = width / (pts.length - 1);
  const points = pts.map((v, i) => {
    const x = i * step;
    const y = height - Math.min(100, Math.max(0, v)) / 100 * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function HistorySparkline({ vmName }: { vmName: string }) {
  const { data } = useQuery({
    queryKey: ['vm-history', vmName],
    queryFn: () => getVMHistory(vmName, 6),
    staleTime: 60_000,
    retry: false,
  });
  const pts: VMMetricPoint[] = data?.history ?? [];
  if (pts.length < 2) return <span style={{ color: 'var(--vn-text-subtle)', fontSize: '0.65rem' }}>no data</span>;
  return (
    <div>
      <div style={{ position: 'relative', height: 24, width: 100 }}>
        <div style={{ position: 'absolute', top: 0, left: 0 }}><Sparkline pts={pts.map(p => p.storage_pct)} color="var(--vn-warning)" /></div>
        <div style={{ position: 'absolute', top: 0, left: 0 }}><Sparkline pts={pts.map(p => p.mem_pct)} color="var(--vn-success)" /></div>
        <div style={{ position: 'absolute', top: 0, left: 0 }}><Sparkline pts={pts.map(p => p.cpu_pct)} color="var(--vn-primary)" /></div>
      </div>
      <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.15rem', alignItems: 'center' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--vn-primary)', display: 'inline-block' }} aria-hidden="true" />
        <span style={{ fontSize: '0.6rem', color: 'var(--vn-text-muted)', lineHeight: 1 }}>CPU</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--vn-success)', display: 'inline-block' }} aria-hidden="true" />
        <span style={{ fontSize: '0.6rem', color: 'var(--vn-text-muted)', lineHeight: 1 }}>Mem</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--vn-warning)', display: 'inline-block' }} aria-hidden="true" />
        <span style={{ fontSize: '0.6rem', color: 'var(--vn-text-muted)', lineHeight: 1 }}>Disk</span>
      </div>
    </div>
  );
}

function ServersPanel() {
  const [upgradeTarget, setUpgradeTarget] = useState<VMStatus | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['vm-status'],
    queryFn: getVMStatus,
    refetchInterval: 60_000,
    retry: false,
  });

  if (isLoading) return <Spinner label="Loading server status" />;
  if (isError) {
    return (
      <div className="card text-sm" style={{ color: 'var(--vn-text-muted)' }}>
        Fleet not configured — add VMs to <code>config/infra/*.toml</code> to enable server monitoring.
      </div>
    );
  }

  const vms: VMStatus[] = data?.vms ?? [];
  if (vms.length === 0) {
    return (
      <div className="card text-sm" style={{ color: 'var(--vn-text-muted)' }}>
        No VMs configured.
      </div>
    );
  }

  return (
    <>
      <div className="card card-flush overflow-x-auto">
        <table className="vn-table">
          <thead>
            <tr>
              {['Server', 'OS', 'CPU', 'Memory', 'Disk', 'Load', 'Updates', '6h History', 'Status', ''].map((h) => (
                <th
                  key={h}
                  scope="col"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vms.map((vm) => (
              <tr
                key={vm.name}
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-xs">{vm.name}</div>
                  <div className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>{vm.datacenter}</div>
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--vn-text-muted)' }}>
                  {vm.online ? (vm.os || 'Linux') : '—'}
                </td>
                <td className="px-3 py-2" style={{ minWidth: '90px' }}>
                  {vm.online ? <MetricBar value={vm.cpu_pct} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                </td>
                <td className="px-3 py-2" style={{ minWidth: '90px' }}>
                  {vm.online ? <MetricBar value={vm.mem_pct} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                </td>
                <td className="px-3 py-2" style={{ minWidth: '90px' }}>
                  {vm.online ? <MetricBar value={vm.storage_pct} warn={75} danger={90} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                </td>
                <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--vn-text-muted)' }}>
                  {vm.online ? vm.load_avg || '—' : '—'}
                </td>
                <td className="px-3 py-2">
                  {vm.online ? (
                    vm.apt_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--vn-warning)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--vn-warning)' }} aria-hidden="true" />
                        {vm.apt_count} pending
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--vn-success)' }}>✓ current</span>
                    )
                  ) : (
                    <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>
                  )}
                </td>
                <td className="px-3 py-2" style={{ minWidth: '110px' }}>
                  {vm.online ? <HistorySparkline vmName={vm.name} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                </td>
                <td className="px-3 py-2">
                  <Badge status={vm.online ? 'online' : 'offline'} />
                  {vm.error && (
                    <span className="ml-1 text-xs" style={{ color: 'var(--vn-danger)' }} title={vm.error}>⚠</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {vm.online && vm.apt_count > 0 && (
                    <button
                      onClick={() => setUpgradeTarget(vm)}
                      className="px-2 py-1 text-xs rounded cursor-pointer whitespace-nowrap
                                 focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                      style={{
                        color: 'var(--vn-on-primary)',
                        backgroundColor: 'var(--vn-primary)',
                        border: 'none',
                      }}
                      aria-label={`Upgrade ${vm.name}`}
                    >
                      Upgrade
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {upgradeTarget && (
        <UpgradeModal
          vmName={upgradeTarget.name}
          upgradeURL={vmUpgradeURL(upgradeTarget.name)}
          onClose={() => setUpgradeTarget(null)}
        />
      )}
    </>
  );
}

/* ── Ingest Section ──────────────────────────────────────────── */

function IngestSection() {
  const queryClient = useQueryClient();
  const statsQ = useQuery({
    queryKey: ['ingest-stats'],
    queryFn: getIngestStats,
    retry: false,
  });

  const ingestMut = useMutation({
    mutationFn: triggerIngest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingest-stats'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const backupMut = useMutation({
    mutationFn: triggerBackupAndIngest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingest-stats'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const archiveStats: ArchiveStats | undefined = statsQ.data;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium" style={{ color: 'var(--vn-text-muted)' }}>
          Archive Ingest
        </h3>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            onClick={() => backupMut.mutate()}
            disabled={backupMut.isPending || ingestMut.isPending}
            title="Run vprox --new-backup then ingest"
            className="btn btn-secondary btn-sm"
          >
            {backupMut.isPending ? 'Backing up…' : '💾 Backup & Ingest'}
          </button>
          <button
            onClick={() => ingestMut.mutate()}
            disabled={ingestMut.isPending || backupMut.isPending}
            className="btn btn-primary btn-sm disabled:opacity-50"
          >
            {ingestMut.isPending ? 'Ingesting\u2026' : 'Trigger Ingest'}
          </button>
        </div>
      </div>

      {ingestMut.isSuccess && (
        <div className="alert alert-success mb-3" role="alert">
          Ingest complete &mdash; {ingestMut.data.count} events processed.
        </div>
      )}
      {backupMut.isSuccess && (
        <div className="alert alert-success mb-3" role="alert">
          Backup &amp; ingest complete &mdash; {backupMut.data.processed} archives processed.
        </div>
      )}
      {backupMut.isError && (
        <div className="alert alert-danger mb-3" role="alert">
          Backup failed: {(backupMut.error as Error).message}
        </div>
      )}
      {ingestMut.isError && (
        <div className="alert alert-danger mb-3" role="alert">
          Ingest failed: {(ingestMut.error as Error).message}
        </div>
      )}

      {statsQ.isLoading ? (
        <Spinner size={16} label="Loading ingest stats" />
      ) : archiveStats ? (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span style={{ color: 'var(--vn-text-muted)' }}>Archives:</span>{' '}
            <span className="font-medium">{archiveStats.total_archives}</span>
          </div>
          <div>
            <span style={{ color: 'var(--vn-text-muted)' }}>Requests:</span>{' '}
            <span className="font-medium">{(archiveStats.total_requests ?? 0).toLocaleString()}</span>
          </div>
          {archiveStats.total_ratelimit > 0 && (
            <div>
              <span style={{ color: 'var(--vn-text-muted)' }}>Rate-limited:</span>{' '}
              <span className="font-medium" style={{ color: 'var(--vn-warning)' }}>{archiveStats.total_ratelimit.toLocaleString()}</span>
            </div>
          )}
          {archiveStats.last_ingested_at && (
            <div>
              <span style={{ color: 'var(--vn-text-muted)' }}>Last ingest:</span>{' '}
              <span className="font-medium" style={{ color: 'var(--vn-text-subtle)', fontSize: '0.8rem' }}>{fmtRelative(archiveStats.last_ingested_at)}</span>
            </div>
          )}
          {(archiveStats.total_bytes ?? 0) > 0 && (
            <div>
              <span style={{ color: 'var(--vn-text-muted)' }}>Size:</span>{' '}
              <span className="font-medium">{fmtBytes(archiveStats.total_bytes)}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>No ingest data available.</p>
      )}
    </div>
  );
}


/* ── Alerts Widget (replaces ChainsFloater) ─────────────────── */

type AlertEntry = { type: 'danger' | 'warn'; label: string };

function AlertsWidget() {
  const { data: chainsData } = useQuery({
    queryKey: ['fleet-chains'],
    queryFn: getFleetChains,
    refetchInterval: 60_000,
    retry: false,
  });
  const { data: vmsData } = useQuery({
    queryKey: ['vm-status'],
    queryFn: getVMStatus,
    refetchInterval: 60_000,
    retry: false,
  });

  const chains = chainsData?.chains ?? [];
  const vms: VMStatus[] = vmsData?.vms ?? [];

  const alerts: AlertEntry[] = [];

  chains.filter(c => c.node_status === 'down')
    .forEach(c => alerts.push({ type: 'danger', label: `Node down: ${c.dashboard_name || c.chain}` }));

  chains.filter(c => c.latest_block_time && Date.now() - new Date(c.latest_block_time).getTime() > 120_000 && c.node_status !== 'down')
    .forEach(c => alerts.push({ type: 'danger', label: `Chain stalled: ${c.dashboard_name || c.chain}` }));

  chains.filter(c => c.has_validator && c.val_jailed)
    .forEach(c => alerts.push({ type: 'danger', label: `Validator jailed: ${c.dashboard_name || c.chain}` }));

  chains.filter(c => c.upgrade_pending)
    .forEach(c => alerts.push({ type: 'warn', label: `Upgrade pending: ${c.dashboard_name || c.chain} — ${c.upgrade_name}` }));

  chains.filter(c => c.active_proposals > 0)
    .forEach(c => alerts.push({
      type: 'warn',
      label: `${c.active_proposals} proposal${c.active_proposals > 1 ? 's' : ''} open: ${c.dashboard_name || c.chain}`,
    }));

  vms.filter(v => v.online && (v.cpu_pct >= 85 || v.mem_pct >= 85 || v.storage_pct >= 90))
    .forEach(v => {
      const issues: string[] = [];
      if (v.cpu_pct >= 85)      issues.push(`CPU ${v.cpu_pct.toFixed(0)}%`);
      if (v.mem_pct >= 85)      issues.push(`mem ${v.mem_pct.toFixed(0)}%`);
      if (v.storage_pct >= 90)  issues.push(`disk ${v.storage_pct.toFixed(0)}%`);
      alerts.push({ type: 'danger', label: `High resource: ${v.name} — ${issues.join(', ')}` });
    });

  const patchableVMs = vms.filter(v => v.online && v.apt_count > 0);
  const totalPatches = patchableVMs.reduce((a, v) => a + v.apt_count, 0);
  if (totalPatches > 0) {
    alerts.push({
      type: 'warn',
      label: `${totalPatches} pending patch${totalPatches > 1 ? 'es' : ''} across ${patchableVMs.length} server${patchableVMs.length > 1 ? 's' : ''}`,
    });
  }

  const dangerCount = alerts.filter(a => a.type === 'danger').length;
  const warnCount   = alerts.filter(a => a.type === 'warn').length;

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-medium" style={{ color: 'var(--vn-text-muted)' }}>
          Active Alerts
        </h3>
        {dangerCount > 0 && (
          <span className="inline-flex items-center justify-center text-xs font-bold rounded-full px-1.5"
            style={{ backgroundColor: 'var(--vn-danger)', color: '#fff', minWidth: '1.25rem', lineHeight: '1.25rem' }}>
            {dangerCount}
          </span>
        )}
        {warnCount > 0 && (
          <span className="inline-flex items-center justify-center text-xs font-bold rounded-full px-1.5"
            style={{ backgroundColor: 'var(--vn-warning)', color: '#000', minWidth: '1.25rem', lineHeight: '1.25rem' }}>
            {warnCount}
          </span>
        )}
      </div>

      {alerts.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--vn-success)' }}>✓ All systems nominal</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {alerts.map((a, i) => (
            <li key={`${a.type}-${a.label}-${i}`} className="flex items-center gap-2 text-sm">
              <span className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: a.type === 'danger' ? 'var(--vn-danger)' : 'var(--vn-warning)' }}
                aria-hidden="true" />
              <span style={{ color: a.type === 'danger' ? 'var(--vn-danger)' : 'var(--vn-warning)' }}>
                {a.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Dashboard Page ──────────────────────────────────────────── */

export default function DashboardPage() {
  const nav = useNavigate();
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 65_000,
  });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>
        Dashboard
      </h2>

      {/* Stat Cards */}
      {isLoading ? (
        <Spinner label="Loading stats" />
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard label="Total Requests" value={stats.total_requests} icon={<RequestsIcon />} variant="info" />
          <StatCard label="Total IPs" value={stats.total_ips} icon={<IPIcon />} variant="default" onClick={() => nav('/accounts')} />
          <StatCard label="Rate Limit Events" value={stats.total_ratelimit_events} icon={<ShieldIcon />} variant="warning" />
          <StatCard label="Archives" value={stats.total_archives} icon={<ArchiveIcon />} variant="info" />
          <StatCard label="Flagged IPs" value={stats.flagged_ips} icon={<FlagIcon />} variant="warning" onClick={() => nav('/accounts')} />
          <StatCard label="Blocked IPs" value={stats.blocked_ips} icon={<BlockIcon />} variant="danger" onClick={() => nav('/accounts')} />
        </div>
      ) : null}

      {/* Charts — two-column layout matching vLog v1.4.0 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <ChartPanel title="Requests over Time (30d)" queryKey="chart-requests" chartType="requests_over_time" />
        </div>
        <div className="card">
          <ChartPanel title="IPs over Time (30d)" queryKey="chart-ips" chartType="ips_over_time" />
        </div>
      </div>

      {/* Chain Status */}
      <div>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
          Chain Status
        </h3>
        <FleetTable />
      </div>

      {/* Ingest */}
      <IngestSection />

      {/* Infrastructure Overview — quick-nav to Chains / Services / VMs */}
      <div>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
          Infrastructure Overview
        </h3>
        <SummaryBoxes />
      </div>

      {/* Servers */}
      <div>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
          Servers
        </h3>
        <ServersPanel />
      </div>

      <AlertsWidget />
    </div>
  );
}
