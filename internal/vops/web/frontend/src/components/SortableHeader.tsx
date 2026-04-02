interface SortableHeaderProps {
  label: string;
  column: string;
  currentSort: string;
  currentDir: string;
  onClick: (column: string) => void;
}

export default function SortableHeader({
  label,
  column,
  currentSort,
  currentDir,
  onClick,
}: SortableHeaderProps) {
  const isActive = currentSort === column;

  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
      style={{ color: 'var(--vn-text-muted)' }}
      onClick={() => onClick(column)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(column); } }}
      tabIndex={0}
      role="columnheader"
      aria-sort={
        isActive
          ? currentDir === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span aria-hidden="true" className="text-[10px] leading-none">
          {isActive ? (currentDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  );
}
