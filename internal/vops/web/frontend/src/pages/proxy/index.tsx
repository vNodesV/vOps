/**
 * pages/proxy/index.tsx
 * Embedded vProx proxy management page.
 * Layout: unified overview (status + controls + collapsible log) + Config tab.
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
import SettingsDrawer, { GearButton, ConfigPanel } from '../../components/SettingsDrawer';
import { PortsPanel, ProxyControlsPanel } from '../settings/ProxyPanel';

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
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
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

function NotConfiguredCard({ onSettings }: { onSettings: () => void }) {
  return (
    <div
      className="p-4 rounded-lg text-sm space-y-3"
      style={{ backgroundColor: 'var(--vn-surface)', border: '1px dashed var(--vn-border)' }}
    >
      <p className="font-medium" style={{ color: 'var(--vn-text)' }}>vProx is not configured</p>
      <p style={{ color: 'var(--vn-text-muted)' }}>
        Set <code className="px-1 rounded" style={{ backgroundColor: 'var(--vn-surface-2)' }}>
          [vprox] config_path
        </code> in <strong>vops.toml</strong> to enable the embedded proxy.
      </p>
      <button
        onClick={onSettings}
        className="btn btn-secondary text-xs"
      >
        Open Proxy Settings
      </button>
    </div>
  );
}

/* ── Overview Tab — status + controls + collapsible log ─────── */

function OverviewTab({
  data,
  configured,
  onAction,
  onSettings,
}: {
  data: ProxyStatus | undefined;
  configured: boolean;
  onAction: () => void;
  onSettings: () => void;
}) {
  const qc = useQueryClient();
  const [logOpen, setLogOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [logMsg, setLogMsg] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['proxy-status'] }); onAction(); };
  const startMut   = useMutation({ mutationFn: proxyStart,   onSuccess: invalidate });
  const stopMut    = useMutation({ mutationFn: proxyStop,    onSuccess: invalidate });
  const restartMut = useMutation({ mutationFn: proxyRestart, onSuccess: invalidate });

  const busy      = startMut.isPending || stopMut.isPending || restartMut.isPending;
  const isRunning = data?.status === 'running' || data?.status === 'starting';
  const isStopped = data?.status === 'stopped' || data?.status === 'error';
  const errMsg    = (startMut.error || stopMut.error || restartMut.error) as Error | null;

  // Open/close the EventSource only when logOpen changes.
  useEffect(() => {
    if (!logOpen || !configured) return;

    setLines([]);
    setLogMsg('');
    const es = new EventSource(BASE + '/api/v1/proxy/logs', { withCredentials: true });
    esRef.current = es;

    es.addEventListener('live_not_available', (e) => {
      setLogMsg((e as MessageEvent).data || 'Live log not available.');
      es.close();
    });
    es.addEventListener('end', () => es.close());
    es.onmessage = (e) => setLines(prev => [...prev, e.data]);
    es.onerror   = () => es.close();

    return () => { es.close(); esRef.current = null; };
  }, [logOpen, configured]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines.length]);

  if (!configured) return <NotConfiguredCard onSettings={onSettings} />;

  return (
    <div className="space-y-4">
      {/* Status row */}
      <div className="card flex items-center gap-4 flex-wrap">
        <div className="text-sm font-medium" style={{ color: 'var(--vn-text)' }}>Status</div>
        {data && <StatusBadge status={data.status} />}
        {data?.status === 'running' && data.uptime_sec > 0 && (
          <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
            Uptime: <span style={{ color: 'var(--vn-text)' }}>{fmtUptime(data.uptime_sec)}</span>
          </span>
        )}
      </div>

      {/* Error banner */}
      {data?.status === 'error' && data.error && (
        <div className="p-3 rounded text-xs font-mono"
          style={{ backgroundColor: 'var(--vn-danger-dim)', color: 'var(--vn-danger)' }}>
          {data.error}
        </div>
      )}

      {/* Controls row */}
      <div className="card flex items-center gap-3 flex-wrap">
        <button className="btn btn-primary" onClick={() => startMut.mutate()}
          disabled={busy || isRunning} title={isRunning ? 'Already running' : 'Start proxy'}>
          {startMut.isPending ? 'Starting…' : 'Start'}
        </button>
        <button className="btn btn-secondary" onClick={() => stopMut.mutate()}
          disabled={busy || isStopped} title={isStopped ? 'Already stopped' : 'Stop proxy'}>
          {stopMut.isPending ? 'Stopping…' : 'Stop'}
        </button>
        <button className="btn btn-secondary" onClick={() => restartMut.mutate()} disabled={busy}>
          {restartMut.isPending ? 'Restarting…' : 'Restart'}
        </button>
        {errMsg && (
          <span className="text-xs" style={{ color: 'var(--vn-danger)' }}>{errMsg.message}</span>
        )}
      </div>

      {/* Collapsible log section — default hidden, no stream until opened */}
      <div className="card space-y-2">
        <button
          onClick={() => setLogOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.8rem', fontWeight: 600, color: 'var(--vn-text-muted)', padding: 0,
          }}
        >
          <span style={{ fontSize: '0.65rem', transition: 'transform 0.15s', transform: logOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
          {logOpen ? 'Hide Live Log' : 'Show Live Log'}
        </button>

        {logOpen && (
          logMsg ? (
            <div className="p-3 rounded text-sm"
              style={{ backgroundColor: 'var(--vn-surface)', border: '1px dashed var(--vn-border)', color: 'var(--vn-text-muted)' }}>
              {logMsg}
            </div>
          ) : (
            <>
              <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
                Last 100 lines from <code>$VOPS_HOME/data/logs/main.log</code>
              </p>
              <pre className="text-xs font-mono rounded p-3 overflow-auto"
                style={{ backgroundColor: 'var(--vn-surface-2)', color: 'var(--vn-text)', border: '1px solid var(--vn-border)', maxHeight: 400 }}>
                {lines.length === 0
                  ? <span style={{ color: 'var(--vn-text-muted)' }}>No log lines available.</span>
                  : lines.join('\n')}
                <div ref={bottomRef} />
              </pre>
            </>
          )
        )}
      </div>
    </div>
  );
}

/* ── Config Tab ──────────────────────────────────────────────── */

function ConfigTab({ configured }: { configured: boolean }) {
  const [toml, setToml] = useState('');
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const { isLoading, data: proxyToml } = useQuery({
    queryKey: ['proxy-config'],
    queryFn: getProxyConfig,
    enabled: configured,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (proxyToml !== undefined) setToml(proxyToml);
  }, [proxyToml]);

  if (!configured) return <NotConfiguredCard onSettings={() => {/* handled by parent */}} />;

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
          Edit <code>$VOPS_HOME/config/vprox/settings.toml</code>. Changes take effect on next proxy restart.
        </p>
      </div>
      {isLoading ? (
        <div className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>Loading…</div>
      ) : (
        <textarea
          className="w-full font-mono text-xs rounded p-3"
          style={{
            backgroundColor: 'var(--vn-surface-2)', color: 'var(--vn-text)',
            border: '1px solid var(--vn-border)', minHeight: 280, resize: 'vertical',
          }}
          value={toml}
          onChange={(e) => setToml(e.target.value)}
          spellCheck={false}
        />
      )}
      {saveErr && <div className="text-xs" style={{ color: 'var(--vn-danger)' }}>{saveErr}</div>}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={handleSave}>Save</button>
        {saved && <span className="text-xs" style={{ color: 'var(--vn-success)' }}>Saved ✓</span>}
      </div>
    </div>
  );
}

/* ── ProxyPage ───────────────────────────────────────────────── */

const TABS = ['Overview', 'Config'] as const;
type Tab = typeof TABS[number];

export default function ProxyPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [proxySettingsOpen, setProxySettingsOpen] = useState(false);
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
        <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>Proxy</h2>
        <div className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>Proxy</h2>
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
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>Proxy</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-muted)' }}>
              Manage the embedded vProx reverse-proxy server.
            </p>
          </div>
          <GearButton onClick={() => setProxySettingsOpen(true)} label="Proxy settings" style={{ marginTop: '0.25rem' }} />
        </div>
        {data && <StatusBadge status={data.status} />}
      </div>

      {proxySettingsOpen && (
        <SettingsDrawer title="Proxy Settings" onClose={() => setProxySettingsOpen(false)}>
          <ConfigPanel>
            {(cfg) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <PortsPanel config={cfg} />
                <ProxyControlsPanel config={cfg} />
              </div>
            )}
          </ConfigPanel>
        </SettingsDrawer>
      )}

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
              background: 'none', cursor: 'pointer',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'Overview' && (
          <OverviewTab
            data={data}
            configured={configured}
            onAction={() => qc.invalidateQueries({ queryKey: ['proxy-status'] })}
            onSettings={() => setProxySettingsOpen(true)}
          />
        )}
        {activeTab === 'Config' && <ConfigTab configured={configured} />}
      </div>
    </div>
  );
}

