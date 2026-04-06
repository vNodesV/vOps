interface SortableHeaderProps {
  label: string;
  column: string;
  currentSort: string;
  currentDir: string;
  onClick: (column: string) => void;
  align?: 'left' | 'center' | 'right';
}

export default function SortableHeader({
  label,
  column,
  currentSort,
  currentDir,
  onClick,
  align = 'left',
}: SortableHeaderProps) {
  const isActive = currentSort === column;
  const textAlign = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
  const justify = align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start';

  return (
    <th
      scope="col"
      className={`px-3 py-2 ${textAlign} text-xs font-medium uppercase tracking-wider cursor-pointer select-none whitespace-nowrap`}
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
      <span className={`inline-flex items-center gap-1 ${justify}`}>
        {label}
        <span aria-hidden="true" className="text-[10px] leading-none">
          {isActive ? (currentDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  );
}
