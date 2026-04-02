import type { ReactNode } from 'react';

type Variant = 'info' | 'success' | 'warning' | 'danger' | 'default';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  variant?: Variant;
}

const variantColors: Record<Variant, string> = {
  info: 'var(--vn-info)',
  success: 'var(--vn-success)',
  warning: 'var(--vn-warning)',
  danger: 'var(--vn-danger)',
  default: 'var(--vn-primary)',
};

export default function StatCard({
  label,
  value,
  icon,
  variant = 'default',
}: StatCardProps) {
  const accent = variantColors[variant];

  return (
    <article
      className="flex items-center gap-4 rounded-lg p-4"
      style={{
        backgroundColor: 'var(--vn-surface)',
        border: '1px solid var(--vn-border)',
        boxShadow: 'var(--vn-shadow)',
        borderRadius: 'var(--vn-radius)',
      }}
      aria-label={`${label}: ${value}`}
    >
      {icon && (
        <div
          className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
          style={{ backgroundColor: accent + '18', color: accent }}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p
          className="text-xs font-medium uppercase tracking-wide truncate"
          style={{ color: 'var(--vn-text-muted)' }}
        >
          {label}
        </p>
        <p className="text-xl font-semibold tabular-nums" style={{ color: 'var(--vn-text)' }}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      </div>
    </article>
  );
}
