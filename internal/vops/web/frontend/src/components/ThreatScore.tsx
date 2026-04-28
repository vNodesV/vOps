interface ThreatScoreProps {
  score: number;
}

function getLevel(score: number): { label: string; color: string } {
  if (score <= 0) return { label: 'Clean', color: 'var(--vn-success)' };
  if (score <= 30) return { label: 'Low', color: 'var(--vn-warning)' };
  if (score <= 60) return { label: 'Medium', color: 'var(--vn-warning)' };
  return { label: 'Critical', color: 'var(--vn-danger)' };
}

export default function ThreatScore({ score }: ThreatScoreProps) {
  const { label, color } = getLevel(score);

  return (
    <span
      className="inline-flex items-center gap-1.5 font-semibold tabular-nums"
      style={{ color }}
      aria-label={`Threat score ${score} — ${label}`}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {score}
      <span className="text-xs font-normal" style={{ color: 'var(--vn-text-muted)' }}>
        {label}
      </span>
    </span>
  );
}
