/**
 * settings/shared.tsx
 * Shared utility components and helpers used across Settings panel files.
 */
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { saveConfig, getVMHistory } from '../../api';
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

/* ── SaveBar ─────────────────────────────────────────────────── */

export function SaveBar({
  onSave,
  onCancel,
  isPending,
  isSuccess,
  isError,
  error,
}: {
  onSave: () => void;
  onCancel?: () => void;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={isPending}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="btn btn-secondary btn-sm">
            Cancel
          </button>
        )}
      </div>
      {isSuccess && (
        <p className="text-xs" style={{ color: 'var(--vn-success)' }} role="alert">
          ✓ Saved successfully.
        </p>
      )}
      {isError && (
        <p className="text-xs" style={{ color: 'var(--vn-danger)' }} role="alert">
          ✗ {(error as Error)?.message ?? 'Save failed.'}
        </p>
      )}
    </div>
  );
}

/* ── TOMLEditor ──────────────────────────────────────────────── */

export function TOMLEditor({
  sectionKey,
  rawValue,
  fieldDocs,
}: {
  sectionKey: string;
  rawValue: unknown;
  fieldDocs?: { label: string; hint: string; example?: string }[];
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const toDisplay = (v: unknown) =>
    typeof v === 'string' ? v : JSON.stringify(v ?? 'Not configured', null, 2);

  const [text, setText] = useState(() => toDisplay(rawValue));

  const saveMut = useMutation({
    mutationFn: (payload: unknown) => saveConfig(sectionKey, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setEditing(false);
    },
  });

  const handleSave = useCallback(() => {
    try {
      saveMut.mutate(JSON.parse(text));
    } catch {
      saveMut.mutate(text);
    }
  }, [text, saveMut]);

  return (
    <div className="space-y-3">
      {fieldDocs && !editing && (
        <div className="space-y-0">
          {fieldDocs.map((f) => (
            <FieldDoc key={f.label} label={f.label} hint={f.hint} example={f.example} />
          ))}
        </div>
      )}

      {!editing ? (
        <div>
          <pre
            className="p-3 rounded-md text-xs overflow-x-auto"
            style={{
              backgroundColor: 'var(--vn-surface-2)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)',
              maxHeight: 320,
            }}
          >
            {toDisplay(rawValue) || 'Not configured — click Edit to add.'}
          </pre>
          <button
            onClick={() => {
              setText(toDisplay(rawValue));
              setEditing(true);
            }}
            className="btn btn-primary btn-sm mt-2"
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`cfg-${sectionKey}`} className="sr-only">
            {sectionKey} configuration
          </label>
          <textarea
            id={`cfg-${sectionKey}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            className="vn-input w-full font-mono text-xs resize-y
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          />
          <SaveBar
            onSave={handleSave}
            onCancel={() => setEditing(false)}
            isPending={saveMut.isPending}
            isSuccess={saveMut.isSuccess}
            isError={saveMut.isError}
            error={saveMut.error as Error | null}
          />
        </div>
      )}
    </div>
  );
}

/* ── parseTOML ───────────────────────────────────────────────── */

export function parseTOML(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  let section = '';
  for (const line of (raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[[')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1).trim();
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      const hi = val.indexOf(' #');
      if (hi > 0) val = val.slice(0, hi).trim();
    }
    result[section ? `${section}.${key}` : key] = val;
  }
  return result;
}

/* ── LabeledInput ────────────────────────────────────────────── */

export function LabeledInput({
  label, value, onChange, placeholder, wide,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="vn-input w-full focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
      />
    </div>
  );
}
