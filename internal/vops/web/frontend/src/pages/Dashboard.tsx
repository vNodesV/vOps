import { useState, Fragment } from 'react';
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
import { getStats, getChart, getFleetChains, triggerBackupAndIngest, getIngestStats, getVMStatus, vmUpgradeURL, getVMHistory, getUnits } from '../api';
import type { Stats, ChartSeries, VMStatus, VMMetricPoint, CosmosUnitWithStatus } from '../api/types';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import UpgradeModal from '../components/UpgradeModal';
import SettingsDrawer, { GearButton, ConfigPanel } from '../components/SettingsDrawer';
import { ChainProfilesPanel } from './settings/ProxyPanel';
import { BackupsPanel } from './settings/SystemPanel';
import { FleetScanPanel, DatacentersPanel } from './settings/InfraPanel';

/* ── Feature flag — flip to false to restore original layout ─── */
const SERVICES_IN_DRAWER = true;

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
      {title && (
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
          {title}
        </h3>
      )}
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

/* ── Alerts hook ─────────────────────────────────────────────── */

type AlertEntry = { type: 'danger' | 'warn'; label: string };

function useAlerts() {
  const { data: chainsData } = useQuery({
    queryKey: ['fleet-chains'],
    queryFn: getFleetChains,
    refetchInterval: 30_000,
    staleTime: 0,
    retry: false,
  });
  const { data: vmsData } = useQuery({
    queryKey: ['vm-status'],
    queryFn: getVMStatus,
    refetchInterval: 30_000,
    staleTime: 0,
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
    .forEach(c => alerts.push({ type: 'warn', label: `Upgrade pending: ${c.dashboard_name || c.chain}${c.upgrade_name ? ` — ${c.upgrade_name}` : ''}` }));

  chains.filter(c => c.active_proposals > 0)
    .forEach(c => alerts.push({
      type: 'warn',
      label: `${c.active_proposals} proposal${c.active_proposals > 1 ? 's' : ''}: ${c.dashboard_name || c.chain}`,
    }));

  vms.filter(v => v.online && (v.cpu_pct >= 85 || v.mem_pct >= 85 || v.storage_pct >= 90))
    .forEach(v => {
      const issues: string[] = [];
      if (v.cpu_pct >= 85)     issues.push(`CPU ${v.cpu_pct.toFixed(0)}%`);
      if (v.mem_pct >= 85)     issues.push(`mem ${v.mem_pct.toFixed(0)}%`);
      if (v.storage_pct >= 90) issues.push(`disk ${v.storage_pct.toFixed(0)}%`);
      alerts.push({ type: 'danger', label: `${v.name} — ${issues.join(', ')}` });
    });

  const patchableVMs = vms.filter(v => v.online && v.apt_count > 0);
  const totalPatches = patchableVMs.reduce((a, v) => a + v.apt_count, 0);
  if (totalPatches > 0) {
    alerts.push({
      type: 'warn',
      label: `${totalPatches} patch${totalPatches > 1 ? 'es' : ''} / ${patchableVMs.length} server${patchableVMs.length > 1 ? 's' : ''}`,
    });
  }

  return alerts;
}

/* ── Infrastructure summary boxes ─────────────────────────────── */

function SummaryBoxes() {
  const nav = useNavigate();
  const alerts = useAlerts();
  const dangerCount = alerts.filter(a => a.type === 'danger').length;
  const warnCount   = alerts.filter(a => a.type === 'warn').length;
  const [alertModal, setAlertModal] = useState<'danger' | 'warn' | null>(null);

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
    <>
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

      {/* Services box — hidden when services live in VM drawer */}
      {!SERVICES_IN_DRAWER && (
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
      )}

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

      {/* Alerts box */}
      <div className="card" style={{ flex: '1 1 200px', minWidth: 180 }}>
        <div className="text-xs font-semibold uppercase tracking-[0.06em] mb-3" style={{ color: 'var(--vn-text-muted)' }}>🔔 Alerts</div>
        {dangerCount === 0 && warnCount === 0 ? (
          <>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--vn-success)', marginBottom: '0.5rem' }}>✓</div>
            <div className="text-sm py-[0.15rem]" style={{ color: 'var(--vn-success)' }}>All nominal</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: dangerCount > 0 ? 'var(--vn-danger)' : 'var(--vn-warning)', marginBottom: '0.5rem' }}>
              {dangerCount + warnCount}
            </div>
            {dangerCount > 0 && (
              <button
                className="flex justify-between text-sm py-[0.15rem] w-full"
                style={{ background: 'none', border: 'none', padding: '0.15rem 0', cursor: 'pointer' }}
                onClick={() => setAlertModal('danger')}
              >
                <span style={{ color: 'var(--vn-danger)' }}>🔴 Critical</span>
                <span style={{ color: 'var(--vn-danger)', fontWeight: 700 }}>{dangerCount}</span>
              </button>
            )}
            {warnCount > 0 && (
              <button
                className="flex justify-between text-sm py-[0.15rem] w-full"
                style={{ background: 'none', border: 'none', padding: '0.15rem 0', cursor: 'pointer' }}
                onClick={() => setAlertModal('warn')}
              >
                <span style={{ color: 'var(--vn-warning)' }}>⚠ Warning</span>
                <span style={{ color: 'var(--vn-warning)', fontWeight: 700 }}>{warnCount}</span>
              </button>
            )}
          </>
        )}
      </div>

    </div>

    {alertModal && (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => setAlertModal(null)}
      >
        <div
          className="card"
          style={{ maxWidth: 480, width: '90%', maxHeight: '70vh', overflow: 'auto', padding: '1.5rem' }}
          onClick={e => e.stopPropagation()}
        >
          <h3 style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '1rem', color: alertModal === 'danger' ? 'var(--vn-danger)' : 'var(--vn-warning)' }}>
            {alertModal === 'danger' ? '🔴 Critical Alerts' : '⚠ Warnings'} ({alerts.filter(a => a.type === alertModal).length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.5rem' }}>
            {alerts.filter(a => a.type === alertModal).map((a, i) => (
              <div key={i} style={{ fontSize: '0.875rem', color: alertModal === 'danger' ? 'var(--vn-danger)' : 'var(--vn-warning)' }}>
                {a.label}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setAlertModal(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => { setAlertModal(null); nav('/ops'); }}>Go to OpsCenter</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

/* ── DC ping color helper ────────────────────────────────────── */



function FleetTable({ onChainClick }: { onChainClick: (chain: string, units: CosmosUnitWithStatus[]) => void }) {
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
            const bondedValidators = validators.filter(u => u.status?.service_active && !u.status?.syncing);
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
                onClick={() => onChainClick(chain, chainUnits)}
                title={`View ${chain} service details`}
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

function ServersPanel({ onVMClick, units = [] }: { onVMClick: (vm: VMStatus) => void; units?: CosmosUnitWithStatus[] }) {
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

  // Group VMs by datacenter
  const byDC = vms.reduce<Record<string, VMStatus[]>>((acc, vm) => {
    const dc = vm.datacenter || '—';
    (acc[dc] ??= []).push(vm);
    return acc;
  }, {});
  const dcNames = Object.keys(byDC).sort();

  return (
    <div className="card card-flush overflow-x-auto">
      <table className="vn-table">
        <thead>
          <tr>
            {['Name', 'IP', 'Services', 'Disk', 'CPU', 'Mem'].map((h) => (
              <th key={h} scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dcNames.map((dc) => (
            <Fragment key={dc}>
              <tr key={`dc-${dc}`} aria-label={`Datacenter: ${dc}`}>
                <td
                  colSpan={6}
                  style={{
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.65rem', fontWeight: 600,
                    color: 'var(--vn-text-subtle)',
                    background: 'var(--vn-green-dim)',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    borderBottom: '1px solid var(--vn-border)',
                  }}
                >
                  {dc}
                </td>
              </tr>
              {byDC[dc].map((vm) => {
                const vmUnits = units.filter(u => u.vm_name === vm.name);
                const govPending = vmUnits.some(u => (u.status?.gov_pending ?? 0) > 0);
                const anyDown = vmUnits.some(u => u.status && !u.status.service_active);
                return (
                  <tr
                    key={vm.name}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onVMClick(vm)}
                    title={`View ${vm.name} details`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-xs" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span
                          style={{
                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                            backgroundColor: vm.online ? 'var(--vn-success)' : 'var(--vn-danger)',
                          }}
                          aria-hidden="true"
                        />
                        {vm.name}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--vn-text-subtle)', fontFamily: 'monospace' }}>
                      {vm.lan_ip || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {vmUnits.length === 0 ? (
                        <span style={{ color: 'var(--vn-text-subtle)', fontSize: '0.7rem' }}>—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-xs tabular-nums" style={{
                            color: anyDown ? 'var(--vn-danger)' : 'var(--vn-accent)',
                            fontWeight: 600,
                          }}>⬡ {vmUnits.length}</span>
                          {govPending && (
                            <span className="text-xs" style={{ color: 'var(--vn-warning)' }} title="Governance proposals pending">📋</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2" style={{ minWidth: '80px' }}>
                      {vm.online ? <MetricBar value={vm.storage_pct} warn={75} danger={90} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                    </td>
                    <td className="px-3 py-2" style={{ minWidth: '80px' }}>
                      {vm.online ? <MetricBar value={vm.cpu_pct} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                    </td>
                    <td className="px-3 py-2" style={{ minWidth: '80px' }}>
                      {vm.online ? <MetricBar value={vm.mem_pct} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Ingest Section ──────────────────────────────────────────── */

function IngestBar() {
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const statsQ = useQuery({
    queryKey: ['ingest-stats'],
    queryFn: getIngestStats,
    retry: false,
  });

  const importsMut = useMutation({
    mutationFn: triggerBackupAndIngest,
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['ingest-stats'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setFeedback({ type: 'ok', msg: `${d.processed} archives imported` });
      setTimeout(() => setFeedback(null), 4000);
    },
    onError: (e: Error) => { setFeedback({ type: 'err', msg: e.message }); },
  });

  const busy = importsMut.isPending;
  const s = statsQ.data;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem',
      padding: '0.45rem 0.85rem',
      border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)',
      background: 'var(--vn-surface)', fontSize: '0.78rem',
    }}>
      <span style={{ color: 'var(--vn-text-muted)', fontWeight: 600, flexShrink: 0 }}>
        IMPORTS
      </span>

      {s && (
        <span style={{ color: 'var(--vn-text-muted)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span>{s.total_archives} archives</span>
          {s.last_ingested_at && (
            <span>· last: <span style={{ color: 'var(--vn-text)' }}>{fmtRelative(s.last_ingested_at)}</span></span>
          )}
          {(s.total_bytes ?? 0) > 0 && (
            <span>· {fmtBytes(s.total_bytes)}</span>
          )}
        </span>
      )}

      {feedback && (
        <span style={{
          fontSize: '0.72rem', fontWeight: 500,
          color: feedback.type === 'ok' ? 'var(--vn-success)' : 'var(--vn-danger)',
        }}>
          {feedback.type === 'ok' ? '✓' : '✗'} {feedback.msg}
        </span>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
        <button
          onClick={() => importsMut.mutate()}
          disabled={busy}
          title="Run vprox --new-backup then ingest all new archives"
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {importsMut.isPending ? 'Importing…' : '⬇ IMPORTS'}
        </button>
        <GearButton onClick={() => setSettingsOpen(true)} label="Import & backup settings" />
      </div>

      {settingsOpen && (
        <SettingsDrawer title="Import & Backup Settings" onClose={() => setSettingsOpen(false)}>
          <ConfigPanel>{(cfg) => <BackupsPanel config={cfg} />}</ConfigPanel>
        </SettingsDrawer>
      )}
    </div>
  );
}


/* ── Chain Detail Drawer ─────────────────────────────────────── */

function ChainDetailDrawer({
  chain, units, onClose,
}: {
  chain: string;
  units: CosmosUnitWithStatus[];
  onClose: () => void;
}) {
  return (
    <SettingsDrawer title={`Chain: ${chain}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {units[0] && (
          <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
            {units[0].chain_id}
            {units[0].network_type ? ` · ${units[0].network_type}` : ''}
          </p>
        )}
        <div className="card card-flush overflow-x-auto">
          <table className="vn-table">
            <thead>
              <tr>
                {['Node', 'Type', 'Status', 'Height', 'Peers', 'Gov', 'Updated'].map(h => (
                  <th key={h} scope="col">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">
                    {u.name}
                    {u.vm_name && (
                      <span style={{ color: 'var(--vn-text-subtle)', marginLeft: '0.25rem' }}>@{u.vm_name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--vn-text-muted)' }}>
                    {u.node_type}
                  </td>
                  <td className="px-3 py-2">
                    {u.status ? (
                      u.status.service_active
                        ? <Badge status={u.status.syncing ? 'syncing' : 'synced'} />
                        : <Badge status="down" />
                    ) : (
                      <span style={{ color: 'var(--vn-text-subtle)', fontSize: '0.7rem' }}>unknown</span>
                    )}
                    {u.status?.error && (
                      <span className="ml-1 text-xs" style={{ color: 'var(--vn-danger)' }} title={u.status.error}>⚠</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {(u.status?.block_height ?? 0) > 0
                      ? (u.status?.block_height ?? 0).toLocaleString()
                      : '\u2014'}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums" style={{ color: 'var(--vn-text-muted)' }}>
                    {(u.status?.peers ?? 0) > 0 ? (u.status?.peers ?? 0) : '\u2014'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {(u.status?.gov_pending ?? 0) > 0 ? (
                      <span style={{ color: 'var(--vn-warning)', fontWeight: 600 }}>
                        {u.status?.gov_pending}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--vn-text-subtle)' }}>{'\u2014'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--vn-text-subtle)' }}>
                    {u.status?.polled_at ? fmtRelative(u.status.polled_at) : '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {units.filter(u => (u.status?.upgrade_height ?? 0) > 0).map(u => (
          <div key={u.id} className="alert" style={{ fontSize: '0.78rem' }}>
            ⬆ {u.name}: {u.status?.upgrade_name ?? 'upgrade'} @ block {u.status?.upgrade_height?.toLocaleString()}
          </div>
        ))}
      </div>
    </SettingsDrawer>
  );
}

/* ── VM Detail Drawer ────────────────────────────────────────── */

function VMDetailDrawer({
  vm, units = [], onClose,
}: {
  vm: VMStatus;
  units?: CosmosUnitWithStatus[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [upgradeTarget, setUpgradeTarget] = useState<VMStatus | null>(null);
  return (
    <>
      {/* Centered modal — click outside to close */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)' }}
        role="dialog"
        aria-modal="true"
        aria-label={`Server details: ${vm.name}`}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="w-full max-w-xl rounded-xl overflow-hidden flex flex-col"
          style={{
            backgroundColor: 'var(--vn-surface)',
            border: '1px solid var(--vn-border)',
            boxShadow: 'var(--vn-shadow-md)',
            maxHeight: '90vh',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid var(--vn-border)', flexShrink: 0 }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: vm.online ? 'var(--vn-success)' : 'var(--vn-danger)',
                }}
                aria-hidden="true"
              />
              <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--vn-text)', fontFamily: 'var(--font-mono)' }}>
                {vm.name}
              </h2>
              <Badge status={vm.online ? 'online' : 'offline'} />
              {vm.datacenter && (
                <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>{vm.datacenter}</span>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--vn-text-muted)', fontSize: '1.1rem', lineHeight: 1,
                padding: '0.25rem',
              }}
            >✕</button>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* IP + OS meta */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              {vm.lan_ip && (
                <code className="text-xs" style={{ color: 'var(--vn-text-subtle)', fontFamily: 'monospace' }}>{vm.lan_ip}</code>
              )}
              {vm.os && (
                <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>{vm.os}</span>
              )}
            </div>
            {vm.online ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '0.5rem 1rem', alignItems: 'center' }}>
                  <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>CPU</span>
                  <MetricBar value={vm.cpu_pct} />
                  <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>Memory</span>
                  <MetricBar value={vm.mem_pct} />
                  <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>Disk</span>
                  <MetricBar value={vm.storage_pct} warn={75} danger={90} />
                  {vm.load_avg && (
                    <>
                      <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>Load avg</span>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--vn-text)' }}>{vm.load_avg}</span>
                    </>
                  )}
                </div>
                <div>
                  <span className="text-xs" style={{ color: 'var(--vn-text-muted)', display: 'block', marginBottom: '0.25rem' }}>6h History</span>
                  <HistorySparkline vmName={vm.name} />
                </div>
                {vm.apt_count > 0 && (
                  <div style={{
                    padding: '0.5rem 0.75rem',
                    border: '1px solid var(--vn-warning)',
                    borderRadius: 'var(--vn-radius)',
                    background: 'color-mix(in srgb, var(--vn-warning) 8%, transparent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
                  }}>
                    <span className="text-xs" style={{ color: 'var(--vn-warning)', fontWeight: 600 }}>
                      {vm.apt_count} pending update{vm.apt_count !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => setUpgradeTarget(vm)}
                      className="px-2 py-1 text-xs rounded cursor-pointer whitespace-nowrap"
                      style={{
                        color: 'var(--vn-on-primary)',
                        backgroundColor: 'var(--vn-primary)',
                        border: 'none',
                      }}
                      aria-label={`Upgrade ${vm.name}`}
                    >
                      Upgrade
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>Server is offline.</p>
            )}
            {vm.error && (
              <div style={{
                padding: '0.5rem 0.75rem',
                border: '1px solid var(--vn-danger)',
                borderRadius: 'var(--vn-radius)',
                background: 'color-mix(in srgb, var(--vn-danger) 8%, transparent)',
              }}>
                <span className="text-xs" style={{ color: 'var(--vn-danger)' }}>{vm.error}</span>
              </div>
            )}
            {vm.polled_at && (
              <p className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
                Last updated {fmtRelative(vm.polled_at)}
              </p>
            )}

            {/* ── Services ─────────────────────────────────────── */}
            <div style={{ marginTop: '0.25rem', paddingTop: '1rem', borderTop: '1px solid var(--vn-border)' }}>
              <div className="text-xs font-semibold uppercase tracking-[0.06em] mb-2" style={{ color: 'var(--vn-text-muted)' }}>
                ⬡ Services
                {units.length > 0 && (
                  <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: '0.5rem', color: 'var(--vn-text-subtle)' }}>
                    {units.length} unit{units.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {units.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>No services registered to this server.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {units.map((u) => {
                    const isActive = u.status?.service_active;
                    const isSyncing = u.status?.syncing;
                    const statusColor = !u.status ? 'var(--vn-text-subtle)'
                      : isActive ? (isSyncing ? 'var(--vn-warning)' : 'var(--vn-success)')
                      : 'var(--vn-danger)';
                    const statusLabel = !u.status ? 'unknown'
                      : isActive ? (isSyncing ? 'catching up' : 'synced')
                      : 'down';
                    return (
                      <div
                        key={u.id}
                        style={{
                          background: 'var(--vn-green-dim)',
                          border: '1px solid var(--vn-green-border)',
                          borderRadius: 'var(--vn-radius)',
                          padding: '0.45rem 0.6rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                            {u.name}
                          </span>
                          {u.network_type && (
                            <span style={{
                              fontSize: '0.6rem', padding: '1px 5px',
                              borderRadius: '3px',
                              background: 'var(--vn-surface-2)',
                              border: '1px solid var(--vn-border)',
                              color: 'var(--vn-text-muted)',
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                              {u.network_type}
                            </span>
                          )}
                          <span style={{ marginLeft: 'auto', fontSize: '0.68rem', fontWeight: 600, color: statusColor }}>
                            {statusLabel}
                          </span>
                          {u.status?.error && (
                            <span className="text-xs" style={{ color: 'var(--vn-danger)' }} title={u.status.error}>⚠</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.68rem', color: 'var(--vn-text-subtle)' }}>
                            chain{' '}
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--vn-text-muted)' }}>
                              {u.chain_name || u.chain_id}
                            </span>
                          </span>
                          {(u.status?.block_height ?? 0) > 0 && (
                            <span style={{ fontSize: '0.68rem', color: 'var(--vn-text-subtle)' }}>
                              h{' '}
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--vn-text-muted)' }}>
                                {(u.status?.block_height ?? 0).toLocaleString()}
                              </span>
                            </span>
                          )}
                          {(u.status?.peers ?? 0) > 0 && (
                            <span style={{ fontSize: '0.68rem', color: 'var(--vn-text-subtle)' }}>
                              peers{' '}
                              <span style={{ color: 'var(--vn-text-muted)' }}>{u.status?.peers}</span>
                            </span>
                          )}
                          {(u.status?.gov_pending ?? 0) > 0 && (
                            <span style={{
                              fontSize: '0.6rem', padding: '1px 5px', borderRadius: '3px',
                              background: 'color-mix(in srgb, var(--vn-warning) 10%, transparent)',
                              border: '1px solid color-mix(in srgb, var(--vn-warning) 25%, transparent)',
                              color: 'var(--vn-warning)', fontWeight: 600,
                            }}>
                              {u.status?.gov_pending} gov
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {units.filter(u => (u.status?.upgrade_height ?? 0) > 0).map(u => (
                <div key={u.id} className="alert mt-2" style={{ fontSize: '0.78rem' }}>
                  ⬆ {u.name}: {u.status?.upgrade_name ?? 'upgrade'} @ block {u.status?.upgrade_height?.toLocaleString()}
                </div>
              ))}
            </div>

            {/* Footer action */}
            <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--vn-border)' }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { onClose(); navigate(`/ops?focus=${encodeURIComponent(vm.name)}`); }}
              >
                Open in OpsCenter →
              </button>
            </div>
          </div>
        </div>
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

/* ── Dashboard Page ──────────────────────────────────────────── */

export default function DashboardPage() {
  const nav = useNavigate();
  const [chainSettingsOpen, setChainSettingsOpen] = useState(false);
  const [serversSettingsOpen, setServersSettingsOpen] = useState(false);
  const [serversOpen, setServersOpen] = useState(false);
  const [selectedChain, setSelectedChain] = useState<{ name: string; units: CosmosUnitWithStatus[] } | null>(null);
  const [selectedVM, setSelectedVM] = useState<VMStatus | null>(null);
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 65_000,
  });
  const { data: svcsData } = useQuery({
    queryKey: ['units'],
    queryFn: getUnits,
    refetchInterval: 60_000,
    retry: false,
    enabled: SERVICES_IN_DRAWER,
  });
  const allUnits: CosmosUnitWithStatus[] = svcsData?.units ?? [];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>
        Dashboard
      </h2>

      {/* Infrastructure Overview — 4 pills: Chains, Services, VMs, Alerts */}
      <div>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
          Infrastructure Overview
        </h3>
        <SummaryBoxes />
      </div>

      {/* Stat pills — 3 left + 3 right */}
      {isLoading ? (
        <Spinner label="Loading stats" />
      ) : stats ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
            <StatCard label="Requests" value={stats.total_requests} icon={<RequestsIcon />} variant="info" />
            <StatCard label="Total IPs" value={stats.total_ips} icon={<IPIcon />} variant="default" onClick={() => nav('/accounts')} />
            <StatCard label="Rate Limits" value={stats.total_ratelimit_events} icon={<ShieldIcon />} variant="warning" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
            <StatCard label="Archives" value={stats.total_archives} icon={<ArchiveIcon />} variant="info" />
            <StatCard label="Flagged IPs" value={stats.flagged_ips} icon={<FlagIcon />} variant="warning" onClick={() => nav('/accounts')} />
            <StatCard label="Blocked IPs" value={stats.blocked_ips} icon={<BlockIcon />} variant="danger" onClick={() => nav('/accounts')} />
          </div>
        </div>
      ) : null}

      {/* Charts — OG 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <ChartPanel title="Requests over Time (30d)" queryKey="chart-requests" chartType="requests_over_time" />
        </div>
        <div className="card">
          <ChartPanel title="IPs over Time (30d)" queryKey="chart-ips" chartType="ips_over_time" />
        </div>
      </div>

      {/* Servers — collapsible, default closed */}
      <div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setServersOpen(v => !v)}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setServersOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            cursor: 'pointer', userSelect: 'none',
            marginBottom: serversOpen ? '0.75rem' : 0,
          }}
          aria-expanded={serversOpen}
        >
          <span style={{
            fontSize: '0.65rem', color: 'var(--vn-text-muted)',
            transition: 'transform 0.15s',
            transform: serversOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}>▶</span>
          <h3 className="text-sm font-medium" style={{ color: 'var(--vn-text-muted)' }}>Servers</h3>
          <GearButton onClick={e => { e.stopPropagation(); setServersSettingsOpen(true); }} label="Fleet & server settings" />
        </div>
        {serversOpen && <ServersPanel onVMClick={setSelectedVM} units={allUnits} />}
      </div>

      {/* Chain Status — hidden when services live in VM drawer */}
      {!SERVICES_IN_DRAWER && (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.75rem' }}>
          <h3 className="text-sm font-medium" style={{ color: 'var(--vn-text-muted)' }}>
            Chain Status
          </h3>
          <GearButton onClick={() => setChainSettingsOpen(true)} label="Chain profile settings" />
        </div>
        <FleetTable onChainClick={(chain, units) => setSelectedChain({ name: chain, units })} />
      </div>
      )}

      {/* Archive Ingest — compact single-line bar at bottom */}
      <IngestBar />

      {chainSettingsOpen && (
        <SettingsDrawer title="Chain Profile Settings" onClose={() => setChainSettingsOpen(false)}>
          <ConfigPanel>{(cfg) => <ChainProfilesPanel config={cfg} />}</ConfigPanel>
        </SettingsDrawer>
      )}
      {serversSettingsOpen && (
        <SettingsDrawer title="Fleet & Server Settings" onClose={() => setServersSettingsOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <FleetScanPanel />
            <ConfigPanel>{(cfg) => <DatacentersPanel config={cfg} />}</ConfigPanel>
          </div>
        </SettingsDrawer>
      )}
      {selectedChain && (
        <ChainDetailDrawer
          chain={selectedChain.name}
          units={selectedChain.units}
          onClose={() => setSelectedChain(null)}
        />
      )}
      {selectedVM && (
        <VMDetailDrawer
          vm={selectedVM}
          units={allUnits.filter(u => u.vm_name === selectedVM.name)}
          onClose={() => setSelectedVM(null)}
        />
      )}
    </div>
  );
}
