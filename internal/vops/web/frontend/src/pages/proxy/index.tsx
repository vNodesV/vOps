/**
 * pages/proxy/index.tsx
 * Embedded vProx proxy management page.
 * Tabs: Status · Control · Config · Logs
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProxyStatus,
  proxyStart,
  proxyStop,
  proxyRestart,
  getProxyConfig,
  saveProxyConfig,
} from '../../api';
import { BASE } from '../../api/client';
import type { ProxyStatus } from '../../api/types';

/* ── Status badge ────────────────────────────────────────────── */

function StatusBadge({ status }: { status: ProxyStatus['status'] }) {
  const map: Record<ProxyStatus['status'], { color: string; label: string }> = {
    running:        { color: 'var(--vn-success)',     label: 'Running' },
    stopped:        { color: 'var(--vn-text-muted)',  label: 'Stopped' },
    starting:       { color: 'var(--vn-warning)',     label: 'Starting…' },
    error:          { color: 'var(--vn-danger)',      label: 'Error' },
    not_configured: { color: 'var(--vn-info)',        label: 'Not configured' },
  };
  const { color, label } = map[status] ?? map.stopped;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/* ── Uptime formatter ────────────────────────────────────────── */

function fmtUptime(sec: number): string {
  if (sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/* ── Not-configured info card ────────────────────────────────── */

function NotConfiguredCard() {
  return (
    <div
      className="p-4 rounded-lg text-sm space-y-2"
      style={{ backgroundColor: 'var(--vn-surface)', border: '1px dashed var(--vn-border)' }}
    >
      <p className="font-medium" style={{ color: 'var(--vn-text)' }}>
        vProx is not configured
      </p>
      <p style={{ color: 'var(--vn-text-muted)' }}>
        Set <code className="px-1 rounded" style={{ backgroundColor: 'var(--vn-surface-2)' }}>
          [vprox] config_path
        </code> in <strong>vops.toml</strong> to enable the embedded proxy.
      </p>
    </div>
  );
}

/* ── Status Tab ──────────────────────────────────────────────── */

function StatusTab({ data }: { data: ProxyStatus }) {
  if (data.status === 'not_configured') return <NotConfiguredCard />;
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium" style={{ color: 'var(--vn-text)' }}>Status</span>
        <StatusBadge status={data.status} />
      </div>
      {data.status === 'running' && (
        <div className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
          Uptime: <span style={{ color: 'var(--vn-text)' }}>{fmtUptime(data.uptime_sec)}</span>
        </div>
      )}
      {data.status === 'error' && data.error && (
        <div
          className="p-3 rounded text-xs font-mono"
          style={{ backgroundColor: 'var(--vn-danger-dim)', color: 'var(--vn-danger)' }}
        >
          {data.error}
        </div>
      )}
    </div>
  );
}

/* ── Control Tab ─────────────────────────────────────────────── */

function ControlTab({ data, onAction }: { data: ProxyStatus; onMutate?: () => void; onAction: () => void }) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['proxy-status'] });
    onAction();
  };

  const startMut  = useMutation({ mutationFn: proxyStart,   onSuccess: invalidate });
  const stopMut   = useMutation({ mutationFn: proxyStop,    onSuccess: invalidate });
  const restartMut = useMutation({ mutationFn: proxyRestart, onSuccess: invalidate });

  const isRunning = data.status === 'running' || data.status === 'starting';
  const isStopped = data.status === 'stopped' || data.status === 'error';
  const busy = startMut.isPending || stopMut.isPending || restartMut.isPending;

  if (data.status === 'not_configured') return <NotConfiguredCard />;

  const errMsg = (startMut.error || stopMut.error || restartMut.error) as Error | null;

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="btn btn-primary"
          onClick={() => startMut.mutate()}
          disabled={busy || isRunning}
          title={isRunning ? 'Proxy is already running' : 'Start proxy'}
        >
          {startMut.isPending ? 'Starting…' : 'Start'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => stopMut.mutate()}
          disabled={busy || isStopped}
          title={isStopped ? 'Proxy is already stopped' : 'Stop proxy'}
        >
          {stopMut.isPending ? 'Stopping…' : 'Stop'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => restartMut.mutate()}
          disabled={busy}
        >
          {restartMut.isPending ? 'Restarting…' : 'Restart'}
        </button>
        <StatusBadge status={data.status} />
      </div>
      {errMsg && (
        <div
          className="p-3 rounded text-xs"
          style={{ backgroundColor: 'var(--vn-danger-dim)', color: 'var(--vn-danger)' }}
        >
          {errMsg.message}
        </div>
      )}
    </div>
  );
}

/* ── Config Tab ──────────────────────────────────────────────── */

function ConfigTab({ configured }: { configured: boolean }) {
  const [toml, setToml] = useState('');
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const { isLoading } = useQuery({
    queryKey: ['proxy-config'],
    queryFn: getProxyConfig,
    enabled: configured,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Populate textarea once loaded.
  useQuery({
    queryKey: ['proxy-config'],
    queryFn: getProxyConfig,
    enabled: configured,
    retry: false,
    refetchOnWindowFocus: false,
    select: (data) => data,
  });

  // Use a separate state loader to populate textarea.
  useEffect(() => {
    if (!configured) return;
    getProxyConfig().then(setToml).catch(() => {});
  }, [configured]);

  if (!configured) return <NotConfiguredCard />;

  const handleSave = async () => {
    setSaveErr('');
    setSaved(false);
    try {
      await saveProxyConfig(toml);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setSaveErr((e as Error).message);
    }
  };

  return (
    <div className="card space-y-3">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--vn-text)' }}>vProx Settings</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-muted)' }}>
          Edit <code>$VPROX_HOME/config/vprox/settings.toml</code>. Changes take effect on next proxy restart.
        </p>
      </div>
      {isLoading ? (
        <div className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>Loading…</div>
      ) : (
        <textarea
          className="w-full font-mono text-xs rounded p-3"
          style={{
            backgroundColor: 'var(--vn-surface-2)',
            color: 'var(--vn-text)',
            border: '1px solid var(--vn-border)',
            minHeight: 280,
            resize: 'vertical',
          }}
          value={toml}
          onChange={(e) => setToml(e.target.value)}
          spellCheck={false}
        />
      )}
      {saveErr && (
        <div className="text-xs" style={{ color: 'var(--vn-danger)' }}>{saveErr}</div>
      )}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={handleSave}>Save</button>
        {saved && <span className="text-xs" style={{ color: 'var(--vn-success)' }}>Saved ✓</span>}
      </div>
    </div>
  );
}

/* ── Logs Tab ────────────────────────────────────────────────── */

function LogsTab({ configured }: { configured: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [notAvail, setNotAvail] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!configured) return;

    const es = new EventSource(BASE + '/api/v1/proxy/logs', { withCredentials: true });

    es.addEventListener('live_not_available', (e) => {
      setNotAvail((e as MessageEvent).data || 'Live log streaming not available for in-process proxy. Check host logs.');
      es.close();
    });

    es.addEventListener('end', () => {
      // Historical lines done — close; re-open for live tailing not implemented (static snapshot).
      es.close();
    });

    es.onmessage = (e) => {
      setLines((prev) => [...prev, e.data]);
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [configured]);

  // Auto-scroll to bottom when new lines arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  if (!configured) return <NotConfiguredCard />;

  if (notAvail) {
    return (
      <div
        className="p-4 rounded text-sm"
        style={{ backgroundColor: 'var(--vn-surface)', border: '1px dashed var(--vn-border)', color: 'var(--vn-text-muted)' }}
      >
        {notAvail}
      </div>
    );
  }

  return (
    <div className="card space-y-2">
      <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
        Last 100 lines from <code>$VPROX_HOME/data/logs/main.log</code>
      </p>
      <pre
        className="text-xs font-mono rounded p-3 overflow-auto"
        style={{
          backgroundColor: 'var(--vn-surface-2)',
          color: 'var(--vn-text)',
          border: '1px solid var(--vn-border)',
          maxHeight: 400,
        }}
      >
        {lines.length === 0
          ? <span style={{ color: 'var(--vn-text-muted)' }}>No log lines available.</span>
          : lines.join('\n')}
        <div ref={bottomRef} />
      </pre>
    </div>
  );
}

/* ── ProxyPage ───────────────────────────────────────────────── */

const TABS = ['Status', 'Control', 'Config', 'Logs'] as const;
type Tab = typeof TABS[number];

export default function ProxyPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Status');
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<ProxyStatus>({
    queryKey: ['proxy-status'],
    queryFn: getProxyStatus,
    refetchInterval: 5_000,
    retry: 1,
  });

  const configured = data?.status !== 'not_configured';

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>Proxy Management</h2>
        <div className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>Proxy Management</h2>
        <div className="text-sm" style={{ color: 'var(--vn-danger)' }}>
          Failed to load proxy status: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>
            Proxy Management
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-muted)' }}>
            Manage the embedded vProx reverse-proxy server.
          </p>
        </div>
        {data && <StatusBadge status={data.status} />}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--vn-border)' }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{
              color: activeTab === tab ? 'var(--vn-primary)' : 'var(--vn-text-muted)',
              borderBottom: activeTab === tab ? '2px solid var(--vn-primary)' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {data && activeTab === 'Status'  && <StatusTab data={data} />}
        {data && activeTab === 'Control' && (
          <ControlTab
            data={data}
            onAction={() => qc.invalidateQueries({ queryKey: ['proxy-status'] })}
          />
        )}
        {activeTab === 'Config' && <ConfigTab configured={configured} />}
        {activeTab === 'Logs'   && <LogsTab   configured={configured} />}
      </div>
    </div>
  );
}
