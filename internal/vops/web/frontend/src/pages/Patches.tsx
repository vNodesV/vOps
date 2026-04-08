import { useEffect, useRef, useState } from 'react';
import {
  getHosts,
  getVMStatus,
  scanHosts,
  scanAllVMs,
  hostUpgradeURL,
  vmUpgradeURL,
} from '../api';
import { openSSEStream } from '../api/sse';
import type { HostInventory, VMStatus } from '../api/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PatchRow {
  kind: 'host' | 'vm';
  name: string;
  datacenter: string;
  ip: string;
  os: string;
  status: string;
  pending: number;        // apt_count (VM) or apt_pending (host)
  online: boolean;
}

interface UpgradeLog {
  target: string;
  lines: { step: string; msg: string }[];
  done: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepIcon(step: string): string {
  if (step.includes('error')) return '✗';
  if (step === 'complete') return '✓';
  if (step.endsWith(':start')) return '…';
  if (step.endsWith(':done')) return '✓';
  if (step === 'connected') return '⚡';
  return '·';
}

function stepColor(step: string): string {
  if (step.includes('error')) return '#f87171';
  if (step === 'complete') return '#4ade80';
  return '#9ca3af';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PatchBadge({ n }: { n: number }) {
  if (n === 0) return <span style={{ color: '#4ade80', fontWeight: 600 }}>✓ up to date</span>;
  return (
    <span style={{
      background: n > 20 ? '#7f1d1d' : '#451a03',
      color: n > 20 ? '#fca5a5' : '#fbbf24',
      borderRadius: 4,
      padding: '2px 8px',
      fontWeight: 700,
      fontSize: 13,
    }}>
      {n} pending
    </span>
  );
}

function LogPanel({ log, onClose }: { log: UpgradeLog; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.lines.length]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#111827', border: '1px solid #374151', borderRadius: 8,
        width: '70%', maxWidth: 800, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700 }}>apt upgrade — {log.target}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, fontFamily: 'monospace', fontSize: 12 }}>
          {log.lines.map((l, i) => (
            <div key={i} style={{ color: stepColor(l.step), marginBottom: 2 }}>
              <span style={{ opacity: 0.6, marginRight: 8 }}>{stepIcon(l.step)}</span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{l.msg}</span>
            </div>
          ))}
          {!log.done && (
            <div style={{ color: '#60a5fa', marginTop: 8 }}>
              <span className="spinner" /> Running…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {log.done && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid #374151', textAlign: 'right' }}>
            <button
              onClick={onClose}
              style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 18px', cursor: 'pointer' }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PatchesPage() {
  const [rows, setRows] = useState<PatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [log, setLog] = useState<UpgradeLog | null>(null);
  const [upgradingAll, setUpgradingAll] = useState(false);
  const esRef = useRef<(() => void) | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [hostRes, vmRes] = await Promise.all([getHosts(), getVMStatus()]);
      const hostRows: PatchRow[] = (hostRes.hosts ?? []).map((h: HostInventory) => ({
        kind: 'host',
        name: h.name,
        datacenter: h.datacenter ?? '',
        ip: h.lan_ip ?? h.host_name ?? '',
        os: h.os ?? '',
        status: h.status,
        pending: h.apt_pending ?? 0,
        online: h.status === 'online',
      }));
      const vmRows: PatchRow[] = (vmRes.vms ?? []).map((v: VMStatus) => ({
        kind: 'vm',
        name: v.name,
        datacenter: v.datacenter,
        ip: v.lan_ip || v.public_ip,
        os: v.os || '',
        status: v.online ? 'online' : 'offline',
        pending: v.apt_count ?? 0,
        online: v.online,
      }));
      setRows([...hostRows, ...vmRows]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      await Promise.all([scanHosts(), scanAllVMs()]);
      await loadData();
    } finally {
      setScanning(false);
    }
  };

  const openLog = (target: string) => {
    setLog({ target, lines: [], done: false });
  };

  const runUpgrade = (row: PatchRow) => {
    openLog(row.name);
    const url = row.kind === 'host' ? hostUpgradeURL(row.name) : vmUpgradeURL(row.name);
    if (esRef.current) esRef.current();
    const cancel = openSSEStream(
      url,
      'POST',
      (msg) => {
        try {
          const data = JSON.parse(msg.data) as { step: string; msg: string };
          setLog(prev => {
            if (!prev) return prev;
            const done = data.step === 'complete' || data.step.includes('error');
            return { ...prev, lines: [...prev.lines, data], done };
          });
          if (data.step === 'complete' || data.step.includes('error')) {
            esRef.current = null;
            loadData();
          }
        } catch { /* ignore */ }
      },
      () => { /* onDone */ },
      () => {
        setLog(prev => prev ? { ...prev, lines: [...prev.lines, { step: 'error', msg: 'SSE connection lost' }], done: true } : prev);
      },
      {},
    );
    esRef.current = cancel;
  };

  const runUpgradeAll = async () => {
    const targets = rows.filter(r => r.online && r.pending > 0);
    if (targets.length === 0) return;
    setUpgradingAll(true);
    for (const row of targets) {
      await new Promise<void>((resolve) => {
        openLog(row.name);
        const url = row.kind === 'host' ? hostUpgradeURL(row.name) : vmUpgradeURL(row.name);
        openSSEStream(
          url,
          'POST',
          (msg) => {
            try {
              const data = JSON.parse(msg.data) as { step: string; msg: string };
              setLog(prev => {
                if (!prev) return prev;
                const done = data.step === 'complete' || data.step.includes('error');
                return { ...prev, lines: [...prev.lines, data], done };
              });
              if (data.step === 'complete' || data.step.includes('error')) {
                resolve();
              }
            } catch { resolve(); }
          },
          () => resolve(),
          () => resolve(),
          {},
        );
      });
    }
    setUpgradingAll(false);
    await loadData();
  };

  const totalPending = rows.reduce((s, r) => s + r.pending, 0);
  const onlinePending = rows.filter(r => r.online && r.pending > 0).length;

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🩹 Patch Management</h1>
        <button
          onClick={handleScan}
          disabled={scanning}
          style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 6, padding: '6px 14px', cursor: scanning ? 'not-allowed' : 'pointer', opacity: scanning ? 0.6 : 1 }}
        >
          {scanning ? '⟳ Scanning…' : '⟳ Refresh'}
        </button>
        {onlinePending > 0 && (
          <button
            onClick={runUpgradeAll}
            disabled={upgradingAll}
            style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: upgradingAll ? 'not-allowed' : 'pointer', fontWeight: 600 }}
          >
            {upgradingAll ? '…Upgrading All' : `⬆ Upgrade All (${onlinePending})`}
          </button>
        )}
        {loading && <span style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</span>}
      </div>

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total tracked', value: rows.length, color: '#60a5fa' },
          { label: 'Online', value: rows.filter(r => r.online).length, color: '#4ade80' },
          { label: 'Hosts', value: rows.filter(r => r.kind === 'host').length, color: '#c084fc' },
          { label: 'VMs', value: rows.filter(r => r.kind === 'vm').length, color: '#f9a8d4' },
          { label: 'Pending updates', value: totalPending, color: totalPending > 0 ? '#fbbf24' : '#4ade80' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 18px', minWidth: 110 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #374151', color: '#9ca3af', textAlign: 'left' }}>
              {['Type', 'Name', 'Datacenter', 'IP', 'OS', 'Status', 'Pending Updates', 'Action'].map(h => (
                <th key={h} style={{ padding: '8px 12px', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '24px 12px', textAlign: 'center', color: '#6b7280' }}>
                  {loading ? 'Loading…' : 'No hosts or VMs found. Run a scan first.'}
                </td>
              </tr>
            )}
            {rows.map(row => (
              <tr
                key={`${row.kind}:${row.name}`}
                style={{ borderBottom: '1px solid #1f2937', transition: 'background .1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1f2937')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <td style={{ padding: '8px 12px' }}>
                  <span style={{
                    background: row.kind === 'host' ? '#312e81' : '#1e3a5f',
                    color: row.kind === 'host' ? '#a5b4fc' : '#93c5fd',
                    borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600,
                  }}>
                    {row.kind === 'host' ? '🖥 Host' : '⚙ VM'}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{row.name}</td>
                <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{row.datacenter || '—'}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#d1d5db' }}>{row.ip || '—'}</td>
                <td style={{ padding: '8px 12px', color: '#9ca3af', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.os || '—'}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ color: row.online ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                    {row.online ? '● online' : '● offline'}
                  </span>
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <PatchBadge n={row.pending} />
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {row.online ? (
                    <button
                      onClick={() => runUpgrade(row)}
                      style={{
                        background: row.pending > 0 ? '#1d4ed8' : '#1f2937',
                        color: row.pending > 0 ? '#fff' : '#6b7280',
                        border: '1px solid ' + (row.pending > 0 ? '#2563eb' : '#374151'),
                        borderRadius: 5, padding: '4px 12px', cursor: row.pending > 0 ? 'pointer' : 'default',
                        fontSize: 12, fontWeight: 600,
                      }}
                    >
                      {row.pending > 0 ? '⬆ Upgrade' : '✓ Current'}
                    </button>
                  ) : (
                    <span style={{ color: '#6b7280', fontSize: 12 }}>offline</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SSE log modal */}
      {log && <LogPanel log={log} onClose={() => setLog(null)} />}
    </div>
  );
}
