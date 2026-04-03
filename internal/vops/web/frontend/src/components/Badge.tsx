interface BadgeProps {
  status: string;
}

const COLOR_MAP: Record<string, { bg: string; text: string; label: string }> = {
  allowed: {
    bg: 'var(--vn-success)',
    text: 'var(--vn-on-primary)',
    label: 'Allowed',
  },
  blocked: {
    bg: 'var(--vn-danger)',
    text: 'var(--vn-on-primary)',
    label: 'Blocked',
  },
  flagged: {
    bg: 'var(--vn-warning)',
    text: 'var(--vn-on-primary)',
    label: 'Flagged',
  },
  synced: {
    bg: 'var(--vn-success)',
    text: 'var(--vn-on-primary)',
    label: 'Synced',
  },
  syncing: {
    bg: 'var(--vn-warning)',
    text: 'var(--vn-on-primary)',
    label: 'Syncing',
  },
  down: {
    bg: 'var(--vn-danger)',
    text: 'var(--vn-on-primary)',
    label: 'Down',
  },
};

const DEFAULT_COLOR = { bg: 'var(--vn-text-subtle)', text: 'var(--vn-on-primary)', label: '' };

export default function Badge({ status }: BadgeProps) {
  const display = status || 'unknown';
  const color = COLOR_MAP[display.toLowerCase()] ?? DEFAULT_COLOR;

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap"
      style={{ backgroundColor: color.bg, color: color.text }}
      aria-label={color.label || display}
    >
      {display}
    </span>
  );
}
