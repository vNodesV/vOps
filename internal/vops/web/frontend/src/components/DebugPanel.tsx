import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { type DebugEvent, setDebugMode, getDebugEvents } from '../api';

interface DebugPanelProps {
  onDisable: () => void;
}

export default function DebugPanel({ onDisable }: DebugPanelProps) {
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [minimized, setMinimized] = useState(false);
  const sinceRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      const data = await getDebugEvents(sinceRef.current);
      if (data.events && data.events.length > 0) {
        setEvents((prev) => {
          const next = [...prev, ...data.events].slice(-200);
          return next;
        });
        sinceRef.current = data.events[data.events.length - 1].id + 1;
      }
    } catch {
      // silently ignore poll errors
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [poll]);

  // Auto-scroll to bottom when new events arrive and not minimized
  useEffect(() => {
    if (!minimized && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events, minimized]);

  const handleClear = async () => {
    await setDebugMode(true, true);
    setEvents([]);
    sinceRef.current = 0;
  };

  const handleDisable = async () => {
    await setDebugMode(false);
    onDisable();
  };

  return (
    <div style={panelStyle}>
      {/* ── Header ── */}
      <div style={headerStyle}>
        <span style={{ color: '#58a6ff', fontWeight: 600, fontSize: '0.75rem' }}>
          🐛 Debug Console
        </span>
        <span style={{ color: '#8b949e', marginLeft: '0.5rem', fontSize: '0.7rem' }}>
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleClear} style={btnStyle}>Clear</button>
        <button onClick={() => setMinimized((m) => !m)} style={btnStyle}>
          {minimized ? '▲' : '▼'}
        </button>
        <button onClick={handleDisable} style={{ ...btnStyle, color: '#f85149' }}>
          ✕ Disable
        </button>
      </div>

      {/* ── Event list ── */}
      {!minimized && (
        <div ref={listRef} style={listStyle}>
          {events.length === 0 ? (
            <div style={{ padding: '0.4rem 0.75rem', color: '#8b949e', fontSize: '0.7rem' }}>
              Waiting for SSH commands…
            </div>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                style={{
                  ...rowStyle,
                  backgroundColor: expanded === ev.id ? '#161b22' : 'transparent',
                }}
              >
                {/* Summary row */}
                <div style={summaryStyle}>
                  <span style={{ color: '#8b949e', minWidth: '68px', flexShrink: 0 }}>{ev.time}</span>
                  <span style={{ color: sourceColor(ev.source), minWidth: '110px', flexShrink: 0 }}>{ev.source}</span>
                  <span style={{ color: '#79c0ff', minWidth: '110px', flexShrink: 0 }}>{ev.host}</span>
                  <span style={{
                    color: '#c9d1d9',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {ev.command.split('\n')[0]}
                  </span>
                  <span style={{ color: '#8b949e', minWidth: '48px', textAlign: 'right', flexShrink: 0 }}>
                    {ev.duration_ms}ms
                  </span>
                  <span style={{
                    minWidth: '20px',
                    textAlign: 'right',
                    flexShrink: 0,
                    color: ev.error ? '#f85149' : '#3fb950',
                  }}>
                    {ev.error ? '✗' : '✓'}
                  </span>
                </div>

                {/* Expanded detail */}
                {expanded === ev.id && (
                  <div style={detailStyle}>
                    {ev.command && ev.command.includes('\n') && (
                      <pre style={{ ...preStyle, color: '#8b949e' }}>{ev.command}</pre>
                    )}
                    {ev.output && (
                      <pre style={{ ...preStyle, color: '#c9d1d9' }}>{ev.output}</pre>
                    )}
                    {ev.error && (
                      <pre style={{ ...preStyle, color: '#f85149' }}>ERROR: {ev.error}</pre>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 9999,
  backgroundColor: '#0d1117',
  borderTop: '2px solid #30363d',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  fontSize: '0.72rem',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '260px',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0 0.75rem',
  height: '30px',
  borderBottom: '1px solid #21262d',
  backgroundColor: '#161b22',
  flexShrink: 0,
};

const listStyle: CSSProperties = {
  overflow: 'auto',
  flex: 1,
};

const rowStyle: CSSProperties = {
  borderBottom: '1px solid #21262d',
  cursor: 'pointer',
  padding: '0.15rem 0.75rem',
};

const summaryStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'baseline',
};

const detailStyle: CSSProperties = {
  marginTop: '0.25rem',
  paddingLeft: '0.5rem',
  borderLeft: '2px solid #30363d',
  marginBottom: '0.25rem',
};

const preStyle: CSSProperties = {
  margin: '0.15rem 0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  fontSize: '0.68rem',
};

const btnStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#c9d1d9',
  padding: '0.1rem 0.4rem',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.68rem',
  fontFamily: 'inherit',
};

function sourceColor(source: string): string {
  if (source === 'http') return '#a5f3fc';       // cyan   — HTTP calls
  if (source === 'vm-manager') return '#c084fc'; // purple — VM manager SSH
  if (source === 'vm-probe') return '#a78bfa';   // violet — VM metrics probe
  if (source.startsWith('hypervisor')) return '#fb923c'; // orange — hypervisor scan
  if (source.startsWith('host')) return '#fbbf24';       // amber  — host scan
  return '#e3b341'; // default yellow
}
