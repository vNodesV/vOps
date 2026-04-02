interface PortGridProps {
  openPorts: string; // JSON array string, e.g. "[80, 443]"
}

const STANDARD_PORTS: Array<{ port: number; label: string }> = [
  { port: 80, label: 'HTTP' },
  { port: 443, label: 'HTTPS' },
  { port: 22, label: 'SSH' },
  { port: 26657, label: 'CometRPC' },
  { port: 26656, label: 'P2P' },
  { port: 1317, label: 'REST' },
  { port: 9090, label: 'gRPC' },
];

function parsePorts(raw: string): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => !isNaN(n));
  } catch {
    // ignore parse errors
  }
  return [];
}

export default function PortGrid({ openPorts }: PortGridProps) {
  const open = new Set(parsePorts(openPorts));

  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label="Port status">
      {STANDARD_PORTS.map(({ port, label }) => {
        const isOpen = open.has(port);
        return (
          <div
            key={port}
            role="listitem"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium"
            style={{
              backgroundColor: isOpen ? 'var(--vn-success)' + '1a' : 'var(--vn-surface-2)',
              color: isOpen ? 'var(--vn-success)' : 'var(--vn-text-subtle)',
              border: `1px solid ${isOpen ? 'var(--vn-success)' + '40' : 'var(--vn-border)'}`,
            }}
            aria-label={`Port ${port} (${label}): ${isOpen ? 'open' : 'closed'}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: isOpen ? 'var(--vn-success)' : 'var(--vn-text-subtle)' }}
              aria-hidden="true"
            />
            {port}
            <span style={{ color: 'var(--vn-text-muted)' }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
