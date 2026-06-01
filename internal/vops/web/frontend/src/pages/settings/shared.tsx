/**
 * settings/shared.tsx
 * Shared utility components and helpers used across Settings panel files.
 */
import { useQuery } from '@tanstack/react-query';
import { getVMHistory } from '../../api';
import type { VMMetricPoint } from '../../api/types';

/* ── SectionCard ─────────────────────────────────────────────── */

export function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--vn-text)' }}>{title}</h3>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-muted)' }}>{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

/* ── RetiredPanel ────────────────────────────────────────────── */

/**
 * RetiredPanel renders an honest "this panel has been retired" notice for
 * settings sections whose config-edit surface was decommissioned. These
 * settings are now managed exclusively via config files / CLI. The notice
 * never implies a config-file reachability problem and exposes no Save button.
 */
export function RetiredPanel({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <SectionCard title={title}>
      <div
        className="rounded-lg p-4 text-xs space-y-2"
        style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
      >
        <p style={{ color: 'var(--vn-text)' }}>
          Settings are managed via config files / CLI — this panel has been retired.
        </p>
        {detail && (
          <p style={{ color: 'var(--vn-text-muted)' }}>{detail}</p>
        )}
      </div>
    </SectionCard>
  );
}

/* ── FieldDoc ────────────────────────────────────────────────── */

export function FieldDoc({
  label,
  hint,
  example,
}: {
  label: string;
  hint: string;
  example?: string;
}) {
  return (
    <div className="flex gap-3 py-1.5" style={{ borderBottom: '1px solid var(--vn-border)' }}>
      <code
        className="text-xs shrink-0 w-44 pt-0.5"
        style={{ color: 'var(--vn-primary)' }}
      >
        {label}
      </code>
      <div>
        <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>{hint}</p>
        {example && (
          <code className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
            e.g. {example}
          </code>
        )}
      </div>
    </div>
  );
}

/* ── MetricBar ───────────────────────────────────────────────── */

export function MetricBar({
  value,
  warn = 70,
  danger = 85,
}: {
  value: number;
  warn?: number;
  danger?: number;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const color =
    pct >= danger
      ? 'var(--vn-danger)'
      : pct >= warn
        ? 'var(--vn-warning)'
        : 'var(--vn-success)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 90 }}>
      <div
        style={{
          flex: 1,
          height: 5,
          borderRadius: 3,
          backgroundColor: 'var(--vn-border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </div>
      <span className="text-xs tabular-nums" style={{ color, minWidth: 30 }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

/* ── Sparkline ───────────────────────────────────────────────── */

export function Sparkline({
  pts,
  color,
  height = 22,
  width = 90,
}: {
  pts: number[];
  color: string;
  height?: number;
  width?: number;
}) {
  if (pts.length < 2) return null;
  const step = width / (pts.length - 1);
  const points = pts
    .map((v, i) => {
      const x = i * step;
      const y = height - (Math.min(100, Math.max(0, v)) / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── VMHistorySparkline ──────────────────────────────────────── */

export function VMHistorySparkline({ vmName }: { vmName: string }) {
  const { data } = useQuery({
    queryKey: ['vm-history', vmName],
    queryFn: () => getVMHistory(vmName, 6),
    staleTime: 60_000,
    retry: false,
  });
  const pts: VMMetricPoint[] = data?.history ?? [];
  if (pts.length < 2)
    return <span style={{ color: 'var(--vn-text-subtle)', fontSize: '0.65rem' }}>no data</span>;
  return (
    <div style={{ position: 'relative', height: 22, width: 90 }}>
      <div style={{ position: 'absolute', top: 0, left: 0 }}>
        <Sparkline pts={pts.map((p) => p.storage_pct)} color="var(--vn-warning)" />
      </div>
      <div style={{ position: 'absolute', top: 0, left: 0 }}>
        <Sparkline pts={pts.map((p) => p.mem_pct)} color="var(--vn-success)" />
      </div>
      <div style={{ position: 'absolute', top: 0, left: 0 }}>
        <Sparkline pts={pts.map((p) => p.cpu_pct)} color="var(--vn-primary)" />
      </div>
    </div>
  );
}
