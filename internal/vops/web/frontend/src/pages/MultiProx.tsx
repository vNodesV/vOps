import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMultiProxInstances,
  createMultiProxInstance,
  deleteMultiProxInstance,
  pingMultiProxInstance,
  pingAllMultiProxInstances,
  updateMultiProx,
} from '../api';
import type { VProxInstance } from '../api/types';
import Spinner from '../components/Spinner';

function statusColor(s: string): string {
  if (s === 'online') return 'var(--vn-success)';
  if (s === 'offline') return 'var(--vn-danger)';
  return 'var(--vn-text-muted)';
}

/* ── Edit modal ───────────────────────────────────────────────── */
function EditModal({ inst, onClose, onSave }: { inst: VProxInstance; onClose: () => void; onSave: () => void }) {
  const [url, setUrl] = useState(inst.url);
  const [apiKey, setApiKey] = useState('');
  const [dc, setDc] = useState(inst.datacenter ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await updateMultiProx(inst.name, { url, api_key: apiKey, datacenter: dc });
      onSave();
      onClose();
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <strong>Edit vProx Instance — {inst.name}</strong>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3 p-4">
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>URL</span>
            <input className="vn-input mt-1" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://vprox.example.com" required />
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>API Key</span>
            <input className="vn-input mt-1" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="leave blank to keep current" />
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>Datacenter</span>
            <input className="vn-input mt-1" value={dc} onChange={e => setDc(e.target.value)} placeholder="QC" />
          </label>
          {err && <p className="alert alert-danger">{err}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
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

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <strong>Register vProx Instance</strong>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3 p-4">
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>Name</span>
            <input className="vn-input mt-1" value={name} onChange={e => setName(e.target.value)} placeholder="www-qc" required />
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>URL</span>
            <input className="vn-input mt-1" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://vprox.example.com" required />
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>API Key (optional)</span>
            <input className="vn-input mt-1" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="secret" />
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>Datacenter</span>
            <input className="vn-input mt-1" value={dc} onChange={e => setDc(e.target.value)} placeholder="QC" />
          </label>
          {err && <p className="alert alert-danger">{err}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '…' : 'Register'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Instance row ─────────────────────────────────────────────── */
function InstanceRow({ inst, onRefresh, onEdit }: { inst: VProxInstance; onRefresh: () => void; onEdit: () => void }) {
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
            className="btn btn-secondary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            title="Open vProx dashboard"
          >
            🔗 Dashboard
          </a>
          <button className="btn btn-secondary" onClick={handlePing} disabled={pinging} title="Ping health check">{pinging ? '…' : '⟳ Ping'}</button>
          <button className="btn btn-secondary" onClick={onEdit} title="Edit instance">✎</button>
          <button className="btn btn-danger" onClick={handleDelete} title="Remove instance">✕</button>
        </div>
      </td>
    </tr>
  );
}

/* ── Main page ────────────────────────────────────────────────── */
export default function MultiProxPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editInst, setEditInst] = useState<VProxInstance | null>(null);
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
      {editInst && (
        <EditModal
          inst={editInst}
          onClose={() => setEditInst(null)}
          onSave={refresh}
        />
      )}

      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-xl font-bold m-0">Multi-vProx</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--vn-text-subtle)' }}>
            Manage multiple vProx reverse-proxy instances from a single pane.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={pingAll} disabled={pingingAll}>{pingingAll ? '…' : '⟳ Ping All'}</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Register</button>
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
        <div className="card"><p style={{ color: 'var(--vn-danger)', margin: 0 }}>Failed to load instances.</p></div>
      ) : instances.length === 0 ? (
        <div className="card">
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>No vProx instances registered</h3>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--vn-text-muted)' }}>
            Click <strong>+ Register</strong> to add a vProx instance (www-qc, www-fr, etc.).
          </p>
        </div>
      ) : (
        <div className="card">
          <table className="vn-table" style={{ fontSize: '0.85rem' }}>
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
                <InstanceRow key={inst.name} inst={inst} onRefresh={refresh} onEdit={() => setEditInst(inst)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
