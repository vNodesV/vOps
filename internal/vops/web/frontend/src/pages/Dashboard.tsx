import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { getStats, getChart, getFleetChains, triggerIngest, getIngestStats } from '../api';
import type { Stats, ChartSeries, ChainStatus, ArchiveStats } from '../api/types';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';

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
  return cs.labels.map((label, i) => {
    const point: Record<string, string | number> = { label };
    for (const s of cs.series) {
      point[s.name] = s.values[i] ?? 0;
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
  if (isError || !data || !('labels' in data)) {
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
          {data.series.map((s) => (
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

function FleetTable() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['fleet-chains'],
    queryFn: getFleetChains,
    refetchInterval: 65_000,
    retry: false,
  });

  if (isLoading) return <Spinner label="Loading fleet" />;
  if (isError) {
    return (
      <div
        className="p-6 text-center rounded-lg"
        style={{ backgroundColor: 'var(--vn-surface)', border: '1px solid var(--vn-border)' }}
      >
        <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
          Fleet not configured &mdash; add chains in Settings to enable fleet monitoring.
        </p>
      </div>
    );
  }

  const chains: ChainStatus[] = data?.chains ?? [];
  if (chains.length === 0) {
    return (
      <div
        className="p-6 text-center rounded-lg"
        style={{ backgroundColor: 'var(--vn-surface)', border: '1px solid var(--vn-border)' }}
      >
        <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>No chains registered.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--vn-border)' }}>
      <table className="w-full text-sm" style={{ backgroundColor: 'var(--vn-surface)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--vn-border)' }}>
            {['Chain', 'Network', 'Status', 'Height', 'Avg Block', 'Governance', 'Upgrade', 'Validator', 'DC Ping', 'Updated'].map(
              (h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--vn-text-muted)' }}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {chains.map((c) => (
            <tr
              key={c.chain}
              className="transition-colors"
              style={{ borderBottom: '1px solid var(--vn-border)' }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--vn-surface-2)')}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '')}
            >
              <td className="px-3 py-2 font-medium whitespace-nowrap">{c.dashboard_name || c.chain}</td>
              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--vn-text-muted)' }}>
                {c.network_type || c.type || '\u2014'}
              </td>
              <td className="px-3 py-2"><Badge status={c.node_status} /></td>
              <td className="px-3 py-2 tabular-nums">{c.height.toLocaleString()}</td>
              <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--vn-text-muted)' }}>
                {c.avg_block_sec != null ? `${c.avg_block_sec.toFixed(1)}s` : '\u2014'}
              </td>
              <td className="px-3 py-2">
                {c.active_proposals > 0 ? (
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--vn-warning)' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--vn-warning)' }} aria-hidden="true" />
                    {c.active_proposals} active
                  </span>
                ) : (
                  <span style={{ color: 'var(--vn-text-subtle)' }}>None</span>
                )}
              </td>
              <td className="px-3 py-2">
                {c.upgrade_pending ? (
                  <span style={{ color: 'var(--vn-warning)' }}>
                    {c.upgrade_name} @ {c.upgrade_height?.toLocaleString()}
                  </span>
                ) : (
                  <span style={{ color: 'var(--vn-text-subtle)' }}>{'\u2014'}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {c.has_validator ? (
                  <span className="inline-flex items-center gap-1">
                    {c.val_jailed ? (
                      <Badge status="blocked" />
                    ) : c.val_bonded ? (
                      <Badge status="synced" />
                    ) : (
                      <Badge status="flagged" />
                    )}
                    {c.val_participation && (
                      <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
                        {c.val_participation}
                      </span>
                    )}
                    {c.val_missed_blocks > 0 && (
                      <span className="text-xs" style={{ color: 'var(--vn-warning)' }}>
                        ({c.val_missed_blocks} missed)
                      </span>
                    )}
                  </span>
                ) : (
                  <span style={{ color: 'var(--vn-text-subtle)' }}>{'\u2014'}</span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--vn-text-muted)' }}>
                {c.lan_ping_ms > 0 ? `${c.lan_ping_ms}ms` : '\u2014'}
              </td>
              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--vn-text-subtle)', fontSize: '12px' }}>
                {fmtRelative(c.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

  const archiveStats: ArchiveStats | undefined = statsQ.data;

  return (
    <div
      className="rounded-lg p-4"
      style={{
        backgroundColor: 'var(--vn-surface)',
        border: '1px solid var(--vn-border)',
        boxShadow: 'var(--vn-shadow)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium" style={{ color: 'var(--vn-text-muted)' }}>
          Archive Ingest
        </h3>
        <button
          onClick={() => ingestMut.mutate()}
          disabled={ingestMut.isPending}
          className="px-3 py-1.5 text-xs font-medium rounded-md btn-vn-primary
                     disabled:opacity-50 cursor-pointer
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ backgroundColor: 'var(--vn-primary)' }}
        >
          {ingestMut.isPending ? 'Ingesting\u2026' : 'Trigger Ingest'}
        </button>
      </div>

      {ingestMut.isSuccess && (
        <div
          className="mb-3 p-2 rounded text-xs"
          style={{ backgroundColor: 'color-mix(in srgb, var(--vn-success) 12%, transparent)', color: 'var(--vn-success)' }}
          role="alert"
        >
          Ingest complete &mdash; {ingestMut.data.count} events processed.
        </div>
      )}
      {ingestMut.isError && (
        <div
          className="mb-3 p-2 rounded text-xs"
          style={{ backgroundColor: 'color-mix(in srgb, var(--vn-danger) 12%, transparent)', color: 'var(--vn-danger)' }}
          role="alert"
        >
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
            <span style={{ color: 'var(--vn-text-muted)' }}>Total Events:</span>{' '}
            <span className="font-medium">{archiveStats.total_events.toLocaleString()}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>No ingest data available.</p>
      )}
    </div>
  );
}

/* ── Dashboard Page ──────────────────────────────────────────── */

export default function DashboardPage() {
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
          <StatCard label="Total IPs" value={stats.total_ips} icon={<IPIcon />} variant="default" />
          <StatCard label="Rate Limit Events" value={stats.total_ratelimit_events} icon={<ShieldIcon />} variant="warning" />
          <StatCard label="Archives" value={stats.total_archives} icon={<ArchiveIcon />} variant="info" />
          <StatCard label="Flagged IPs" value={stats.flagged_ips} icon={<FlagIcon />} variant="warning" />
          <StatCard label="Blocked IPs" value={stats.blocked_ips} icon={<BlockIcon />} variant="danger" />
        </div>
      ) : null}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div
          className="rounded-lg p-4"
          style={{
            backgroundColor: 'var(--vn-surface)',
            border: '1px solid var(--vn-border)',
            boxShadow: 'var(--vn-shadow)',
          }}
        >
          <ChartPanel title="Requests over Time (30d)" queryKey="chart-requests" chartType="requests_over_time" />
        </div>
        <div
          className="rounded-lg p-4"
          style={{
            backgroundColor: 'var(--vn-surface)',
            border: '1px solid var(--vn-border)',
            boxShadow: 'var(--vn-shadow)',
          }}
        >
          <ChartPanel title="IPs over Time (30d)" queryKey="chart-ips" chartType="ips_over_time" />
        </div>
      </div>

      {/* Fleet */}
      <div>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
          Chain Status
        </h3>
        <FleetTable />
      </div>

      {/* Ingest */}
      <IngestSection />
    </div>
  );
}
