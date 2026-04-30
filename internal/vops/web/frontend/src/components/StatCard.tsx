import type { ReactNode } from 'react';

type Variant = 'info' | 'success' | 'warning' | 'danger' | 'default';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  variant?: Variant;
  onClick?: () => void;
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
  onClick,
}: StatCardProps) {
  const accent = variantColors[variant];
  const interactive = !!onClick;

  return (
    <article
      className="card flex items-center gap-4 rounded-lg p-4"
      style={{
        borderRadius: 'var(--vn-radius)',
        cursor: interactive ? 'pointer' : undefined,
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); } : undefined}
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
        <p className="stat-val text-xl font-semibold tabular-nums" style={{ color: accent }}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      </div>
    </article>
  );
}
