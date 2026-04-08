import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMultiProxInstances,
  createMultiProxInstance,
  deleteMultiProxInstance,
  pingMultiProxInstance,
  pingAllMultiProxInstances,
} from '../api';
import type { VProxInstance } from '../api/types';
import Spinner from '../components/Spinner';

/* ── styles ───────────────────────────────────────────────────── */
const card: React.CSSProperties = {
  background: 'var(--vn-surface)', border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)', padding: '1.25rem', marginBottom: '1rem',
};
const btn: React.CSSProperties = {
  cursor: 'pointer', border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)', padding: '0.3rem 0.75rem',
  fontSize: '0.8rem', fontWeight: 500, background: 'var(--vn-surface)',
  color: 'var(--vn-text)', transition: 'background 0.12s',
};
const primaryBtn: React.CSSProperties = {
  ...btn, background: 'var(--vn-primary)', color: 'var(--vn-on-primary)', border: 'none',
};
const dangerBtn: React.CSSProperties = {
  ...btn, background: 'var(--vn-danger)', color: '#fff', border: 'none',
};

function statusColor(s: string): string {
  if (s === 'online') return 'var(--vn-success)';
  if (s === 'offline') return 'var(--vn-danger)';
  return 'var(--vn-text-muted)';
}

/* ── Add modal ────────────────────────────────────────────────── */
function AddModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [dc, setDc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await createMultiProxInstance({ name, url, api_key: apiKey, datacenter: dc });
      onSave();
      onClose();
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  };
  const modal: React.CSSProperties = {
    background: 'var(--vn-surface)', border: '1px solid var(--vn-border)',
    borderRadius: 'var(--vn-radius)', padding: '1.5rem', width: '420px', maxWidth: '95vw',
  };
  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '0.35rem 0.5rem',
    background: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)',
    borderRadius: 'var(--vn-radius)', color: 'var(--vn-text)', fontSize: '0.85rem',
    marginTop: '0.25rem', marginBottom: '0.75rem',
  };
  const lbl: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--vn-text-muted)', display: 'block' };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <strong>Register vProx Instance</strong>
          <button style={btn} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <label style={lbl}>Name</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="www-qc" required />
          <label style={lbl}>URL</label>
          <input style={inp} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://vprox.example.com" required />
          <label style={lbl}>API Key (optional)</label>
          <input style={inp} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="secret" />
          <label style={lbl}>Datacenter</label>
          <input style={inp} value={dc} onChange={e => setDc(e.target.value)} placeholder="QC" />
          {err && <p style={{ color: 'var(--vn-danger)', fontSize: '0.8rem', margin: '0.25rem 0' }}>{err}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" style={btn} onClick={onClose}>Cancel</button>
            <button type="submit" style={primaryBtn} disabled={busy}>{busy ? '…' : 'Register'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Instance row ─────────────────────────────────────────────── */
function InstanceRow({ inst, onRefresh }: { inst: VProxInstance; onRefresh: () => void }) {
  const [pinging, setPinging] = useState(false);

  async function handlePing() {
    setPinging(true);
    try {
      await pingMultiProxInstance(inst.name);
      onRefresh();
    } finally {
      setPinging(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${inst.name}?`)) return;
    await deleteMultiProxInstance(inst.name);
    onRefresh();
  }

  const color = statusColor(inst.status);
  return (
    <tr>
      <td style={{ padding: '0.5rem 0.75rem' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6 }} />
        <strong>{inst.name}</strong>
      </td>
      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
        <a href={inst.url} target="_blank" rel="noreferrer" style={{ color: 'var(--vn-primary)' }}>{inst.url}</a>
      </td>
      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: 'var(--vn-text-muted)' }}>{inst.datacenter ?? '—'}</td>
      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color }}>
        {inst.status}
        {inst.last_seen && <span style={{ color: 'var(--vn-text-muted)', marginLeft: 6 }}>({inst.last_seen.slice(0, 16).replace('T', ' ')})</span>}
      </td>
      <td style={{ padding: '0.5rem 0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <a
            href={inst.url.replace(/\/$/, '') + '/vlog/'}
            target="_blank"
            rel="noreferrer"
            style={{ ...btn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            title="Open vProx dashboard"
          >
            🔗 Dashboard
          </a>
          <button style={btn} onClick={handlePing} disabled={pinging} title="Ping health check">{pinging ? '…' : '⟳ Ping'}</button>
          <button style={dangerBtn} onClick={handleDelete} title="Remove instance">✕</button>
        </div>
      </td>
    </tr>
  );
}

/* ── Main page ────────────────────────────────────────────────── */
export default function MultiProxPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [pingingAll, setPingingAll] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['multiprox-instances'],
    queryFn: getMultiProxInstances,
    staleTime: 30_000,
  });

  const instances: VProxInstance[] = data?.instances ?? [];
  const online = instances.filter(i => i.status === 'online').length;

  function refresh() {
    qc.invalidateQueries({ queryKey: ['multiprox-instances'] });
  }

  async function pingAll() {
    setPingingAll(true);
    try {
      await pingAllMultiProxInstances();
      refresh();
    } finally {
      setPingingAll(false);
    }
  }

  return (
    <div>
      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSave={refresh} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Multi-vProx</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--vn-text-subtle)' }}>
            Manage multiple vProx reverse-proxy instances from a single pane.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button style={btn} onClick={pingAll} disabled={pingingAll}>{pingingAll ? '…' : '⟳ Ping All'}</button>
          <button style={primaryBtn} onClick={() => setShowAdd(true)}>+ Register</button>
        </div>
      </div>

      {/* Summary strip */}
      {instances.length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--vn-text-muted)' }}>
          <span>Total: <strong style={{ color: 'var(--vn-text)' }}>{instances.length}</strong></span>
          <span>Online: <strong style={{ color: 'var(--vn-success)' }}>{online}</strong></span>
          <span>Offline: <strong style={{ color: online < instances.length ? 'var(--vn-danger)' : 'var(--vn-text)' }}>{instances.length - online}</strong></span>
        </div>
      )}

      {isLoading ? <Spinner /> : isError ? (
        <div style={card}><p style={{ color: 'var(--vn-danger)', margin: 0 }}>Failed to load instances.</p></div>
      ) : instances.length === 0 ? (
        <div style={card}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>No vProx instances registered</h3>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--vn-text-muted)' }}>
            Click <strong>+ Register</strong> to add a vProx instance (www-qc, www-fr, etc.).
          </p>
        </div>
      ) : (
        <div style={card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--vn-border)', textAlign: 'left', color: 'var(--vn-text-muted)', fontSize: '0.75rem' }}>
                <th style={{ padding: '0.4rem 0.75rem' }}>Instance</th>
                <th style={{ padding: '0.4rem 0.75rem' }}>URL</th>
                <th style={{ padding: '0.4rem 0.75rem' }}>DC</th>
                <th style={{ padding: '0.4rem 0.75rem' }}>Status</th>
                <th style={{ padding: '0.4rem 0.75rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {instances.map(inst => (
                <InstanceRow key={inst.name} inst={inst} onRefresh={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
