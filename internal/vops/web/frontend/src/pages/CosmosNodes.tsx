import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  getUnits,
  createUnit,
  deleteUnit,
  updateUnit,
  getUnitStatusHistory,
  getRegisteredChains,
  registerChain,
  unregisterChain,
} from '../api';
import { BASE } from '../api/client';
import { openSSEStream } from '../api/sse';
import type { CosmosUnit, CosmosUnitWithStatus, NodeType, NetworkType, UnitStatus, RegisteredChain } from '../api/types';
import { fmtDate, timeAgo } from '../lib/time';

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_TYPES: NodeType[] = ['validator', 'node', 'api', 'rpc', 'relayer', 'other'];
const NETWORK_TYPES: NetworkType[] = ['mainnet', 'testnet', 'devnet'];

const NODE_TYPE_COLORS: Record<NodeType, { bg: string; text: string }> = {
  validator: { bg: 'var(--vn-primary-dim)',  text: 'var(--vn-primary)' },
  node:      { bg: 'var(--vn-info-dim)',      text: 'var(--vn-info)' },
  api:       { bg: 'var(--vn-success-dim)',   text: 'var(--vn-success)' },
  rpc:       { bg: 'var(--vn-info-dim)',      text: 'var(--vn-info)' },
  relayer:   { bg: 'var(--vn-warning-dim)',   text: 'var(--vn-warning)' },
  other:     { bg: 'var(--vn-surface-2)',     text: 'var(--vn-text-muted)' },
};

const NET_COLORS: Record<NetworkType, string> = {
  mainnet: 'var(--vn-success)',
  testnet: 'var(--vn-warning)',
  devnet:  'var(--vn-danger)',
};

const STATE_COLORS: Record<string, string> = {
  running:  'var(--vn-success)',
  stopped:  'var(--vn-danger)',
  unknown:  'var(--vn-text-muted)',
  syncing:  'var(--vn-warning)',
  deployed: 'var(--vn-info)',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHeight(h: number): string {
  if (!h) return '—';
  return h.toLocaleString();
}

function fmtTime(ts: string): string {
  return fmtDate(ts);
}

// ── ValidatorUptime ───────────────────────────────────────────────────────────
// Shows last-N poll points as a signing-strip for validator units.

function ValidatorUptime({ unitName }: { unitName: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['unit-history', unitName],
    queryFn: () => getUnitStatusHistory(unitName),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <span style={{ fontSize: 11, color: '#6b7280' }}>Loading uptime…</span>;
  }

  const history: UnitStatus[] = (data?.history ?? []).slice(-50);
  if (history.length === 0) {
    return <span style={{ fontSize: 11, color: '#6b7280' }}>No history yet</span>;
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
        Uptime — last {history.length} polls
      </div>
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {history.map((h, i) => {
          let bg = '#374151';
          if (h.service_active && !h.syncing) bg = '#4ade80';
          else if (h.syncing) bg = '#fbbf24';
          else if (h.service_active === false) bg = '#f87171';
          return (
            <div
              key={`${unitName}-${i}`}
              title={`${new Date(h.polled_at).toLocaleTimeString()} — ${h.service_active ? 'active' : 'inactive'}${h.syncing ? ' (syncing)' : ''} @ ${(h.block_height ?? 0).toLocaleString()}`}
              style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: bg, cursor: 'default', flexShrink: 0 }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── AddChainModal ─────────────────────────────────────────────────────────────

function AddChainModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ chain: '', rpc_url: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.chain.trim() || !form.rpc_url.trim()) {
      setErr('Chain ID and RPC URL are required.');
      return;
    }
    setSaving(true);
    try {
      await registerChain({ chain: form.chain.trim(), rpc_url: form.rpc_url.trim(), note: form.note.trim() || undefined });
      onCreated();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error registering chain');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 480 }}>
        <div className="modal-header">
          <span className="font-semibold">Register Chain</span>
          <button onClick={onClose} className="btn btn-secondary btn-sm">✕</button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <div style={{ color: '#f87171', fontSize: 13 }}>{err}</div>}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Chain ID *</span>
            <input className="vn-input" value={form.chain} onChange={set('chain')} placeholder="cosmoshub-4" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>RPC URL *</span>
            <input className="vn-input" value={form.rpc_url} onChange={set('rpc_url')} placeholder="http://localhost:26657" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Note (optional)</span>
            <input className="vn-input" value={form.note} onChange={set('note')} placeholder="optional note" />
          </label>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn btn-primary">
            {saving ? 'Registering…' : 'Register Chain'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AddUnitModal ──────────────────────────────────────────────────────────────

const EMPTY_UNIT: Partial<CosmosUnit> = {
  name: '', chain_name: '', chain_id: '', network_type: 'mainnet', node_type: 'node',
  vm_name: '', datacenter: '', service_name: '', binary_path: '', cosmovisor_path: '',
  cosmovisor_enabled: false, config_dir: '', rpc_port: 26657, api_port: 1317,
  p2p_port: 26656, valoper: '', state: 'unknown', notes: '',
};

function AddUnitModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<Partial<CosmosUnit>>({ ...EMPTY_UNIT });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: keyof CosmosUnit, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name?.trim()) { setErr('Name is required'); return; }
    setSaving(true); setErr('');
    try {
      await createUnit(form);
      onCreated();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, k: keyof CosmosUnit, type = 'text', ph = '') => (
    <div className="mb-3">
      <label className="block text-xs mb-1" style={{ color: 'var(--vn-text-muted)' }}>{label}</label>
      <input
        type={type}
        value={(form[k] as string | number) ?? ''}
        placeholder={ph}
        onChange={e => set(k, type === 'number' ? Number(e.target.value) : e.target.value)}
        className="vn-input"
      />
    </div>
  );

  const select = (label: string, k: keyof CosmosUnit, opts: string[]) => (
    <div className="mb-3">
      <label className="block text-xs mb-1" style={{ color: 'var(--vn-text-muted)' }}>{label}</label>
      <select
        value={(form[k] as string) ?? ''}
        onChange={e => set(k, e.target.value)}
        className="vn-input"
      >
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 620, maxHeight: '90vh' }}>
        <div className="modal-header">
          <span className="font-semibold">Register Unit</span>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {err && <div className="alert alert-danger mb-3">{err}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            {field('Name *', 'name', 'text', 'unique identifier')}
            {field('Chain Name', 'chain_name', 'text', 'e.g. cheqd')}
            {field('Chain ID', 'chain_id', 'text', 'e.g. cheqd-mainnet-1')}
            {select('Network Type', 'network_type', NETWORK_TYPES)}
            {select('Node Type', 'node_type', NODE_TYPES)}
            {field('VM Name', 'vm_name', 'text', 'e.g. chihuahua')}
            {field('Datacenter', 'datacenter', 'text', 'e.g. QC-BHE1')}
            {field('Service Name', 'service_name', 'text', 'systemd service unit')}
            {field('Binary Path', 'binary_path', 'text', '/home/user/.go/bin/chihuahuad')}
            {field('Cosmovisor Path', 'cosmovisor_path', 'text', '/home/user/cosmovisor')}
            {field('Config Dir', 'config_dir', 'text', '/home/user/.chihuahua')}
            {field('Valoper', 'valoper', 'text', 'chihuahuavaloper1...')}
            {field('RPC Port', 'rpc_port', 'number')}
            {field('API Port', 'api_port', 'number')}
            {field('P2P Port', 'p2p_port', 'number')}
          </div>
          <div className="mb-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.cosmovisor_enabled ?? false}
                onChange={e => set('cosmovisor_enabled', e.target.checked)}
              />
              Cosmovisor enabled
            </label>
          </div>
          <div className="mb-3">
            <label className="block text-xs mb-1" style={{ color: 'var(--vn-text-muted)' }}>Notes</label>
            <textarea
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              className="vn-input"
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving…' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── StatusHistoryModal ────────────────────────────────────────────────────────

function StatusHistoryModal({ unit, onClose }: { unit: CosmosUnitWithStatus; onClose: () => void }) {
  const [history, setHistory] = useState<UnitStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUnitStatusHistory(unit.name)
      .then(r => setHistory(r.history ?? []))
      .finally(() => setLoading(false));
  }, [unit.name]);

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: '75%', maxWidth: 860, maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0 }}>
        <div className="modal-header">
          <span style={{ fontWeight: 700 }}>Status History — {unit.name}</span>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading ? (
            <p style={{ color: 'var(--vn-text-muted)' }}>Loading…</p>
          ) : history.length === 0 ? (
            <p style={{ color: 'var(--vn-text-subtle)' }}>No status history yet. Push status via the API or set up a poller.</p>
          ) : (
            <table className="vn-table">
              <thead>
                <tr>
                  {['Polled', 'Height', 'Peers', 'Voting Power', 'Gov Pending', 'Syncing', 'Active', 'Error'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(st => (
                  <tr key={st.id}>
                    <td style={{ color: '#9ca3af' }}>{timeAgo(st.polled_at)}</td>
                    <td style={{ fontFamily: 'monospace' }}>{fmtHeight(st.block_height)}</td>
                    <td>{st.peers}</td>
                    <td style={{ fontFamily: 'monospace' }}>{fmtHeight(st.voting_power)}</td>
                    <td>{st.gov_pending > 0 ? <span style={{ color: '#fbbf24' }}>{st.gov_pending}</span> : '—'}</td>
                    <td>{st.syncing ? <span style={{ color: '#fbbf24' }}>⟳</span> : <span style={{ color: '#4ade80' }}>✓</span>}</td>
                    <td>{st.service_active ? <span style={{ color: '#4ade80' }}>●</span> : <span style={{ color: 'var(--vn-danger)' }}>●</span>}</td>
                    <td style={{ color: 'var(--vn-danger)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── LogModal ──────────────────────────────────────────────────────────────────

function LogModal({ unit, onClose }: { unit: CosmosUnitWithStatus; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${BASE}/api/v1/units/${encodeURIComponent(unit.name)}/logs`);
    es.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data) as { step: string; msg: string };
        if (d.step === 'connected') { setConnected(true); }
        if (d.step === 'error') { setError(d.msg); }
        if (d.step === 'log' || d.step === 'tail:start') {
          setLines(prev => [...prev.slice(-500), d.msg]);
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { setError('Connection lost'); es.close(); };
    return () => es.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.name]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: '720px', maxWidth: '95vw', display: 'flex', flexDirection: 'column', maxHeight: '80vh', padding: 0 }}>
        <div className="modal-header">
          <strong>📋 Logs — {unit.name}</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {connected && <span style={{ color: 'var(--vn-success)', fontSize: 12 }}>● live</span>}
            {error && <span style={{ color: 'var(--vn-danger)', fontSize: 12 }}>{error}</span>}
            <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="log-panel" style={{ flex: 1 }}>
          {lines.map((l, i) => <div key={i}>{l}</div>)}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

// ── DeployModal ───────────────────────────────────────────────────────────────

function DeployModal({ unit, onClose }: { unit: CosmosUnitWithStatus; onClose: () => void }) {
  const [sudoPwd, setSudoPwd] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  async function startDeploy() {
    setRunning(true);
    setLines([]);
    setDone(false);
    const body = sudoPwd ? { sudo_password: sudoPwd } : {};
    openSSEStream(
      `${BASE}/api/v1/units/${encodeURIComponent(unit.name)}/deploy`,
      'POST',
      (msg) => {
        try {
          const d = JSON.parse(msg.data) as { step: string; msg: string };
          setLines(prev => [...prev, `[${d.step}] ${d.msg}`]);
          if (d.step === 'complete' || d.step === 'error') {
            setDone(true);
            setRunning(false);
          }
        } catch { /* ignore */ }
      },
      () => { setDone(true); setRunning(false); },
      () => { setRunning(false); setLines(prev => [...prev, '[error] Connection lost']); },
      body,
    );
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal" style={{ width: '620px', maxWidth: '95vw' }}>
        <div className="modal-header">
          <strong>🚀 Deploy cosmovisor — {unit.name}</strong>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={running}>✕</button>
        </div>
        <div className="p-4">
          {!running && !done && (
            <div className="space-y-2">
              <label className="block text-xs" style={{ color: 'var(--vn-text-muted)' }}>Sudo password (leave blank if NOPASSWD)</label>
              <input type="password" className="vn-input" value={sudoPwd} onChange={e => setSudoPwd(e.target.value)} placeholder="optional" />
              <p className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
                This will install cosmovisor (if missing), create directory structure, and write a systemd service on <strong style={{ color: 'var(--vn-text-muted)' }}>{unit.vm_name}</strong>.
              </p>
              <button onClick={startDeploy} className="btn btn-primary mt-3">
                Start Deploy
              </button>
            </div>
          )}
          {lines.length > 0 && (
            <div className="log-panel mt-3">
              {lines.map((l, i) => (
                <div key={i} style={{ color: l.includes('[error]') ? '#f87171' : l.includes('[complete]') ? '#4ade80' : '#94a3b8' }}>{l}</div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
          {done && <button onClick={onClose} className="btn btn-secondary mt-3">Close</button>}
        </div>
      </div>
    </div>
  );
}

// ── EditUnitModal ─────────────────────────────────────────────────────────────

function EditUnitModal({ unit, onClose, onSaved }: { unit: CosmosUnitWithStatus; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<CosmosUnit>>({
    chain_name: unit.chain_name,
    chain_id: unit.chain_id,
    network_type: unit.network_type,
    node_type: unit.node_type,
    vm_name: unit.vm_name,
    datacenter: unit.datacenter,
    binary_path: unit.binary_path,
    cosmovisor_path: unit.cosmovisor_path,
    cosmovisor_enabled: unit.cosmovisor_enabled,
    config_dir: unit.config_dir,
    rpc_port: unit.rpc_port,
    api_port: unit.api_port,
    p2p_port: unit.p2p_port,
    valoper: unit.valoper,
    notes: unit.notes,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: keyof CosmosUnit, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      await updateUnit(unit.name, form as CosmosUnit);
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const fldCls = 'flex flex-col gap-1 mb-3';
  const lblStyle = { fontSize: '0.78rem', color: 'var(--vn-text-muted)' };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
    >
      <div
        className="modal"
        style={{ width: 480, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem' }}>✏ Edit Unit — {unit.name}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
          <div className={fldCls}><label style={lblStyle}>Chain Name</label><input className="vn-input" value={form.chain_name ?? ''} onChange={e => set('chain_name', e.target.value)} /></div>
          <div className={fldCls}><label style={lblStyle}>Chain ID</label><input className="vn-input" value={form.chain_id ?? ''} onChange={e => set('chain_id', e.target.value)} /></div>
          <div className={fldCls}><label style={lblStyle}>VM Name</label><input className="vn-input" value={form.vm_name ?? ''} onChange={e => set('vm_name', e.target.value)} /></div>
          <div className={fldCls}><label style={lblStyle}>Datacenter</label><input className="vn-input" value={form.datacenter ?? ''} onChange={e => set('datacenter', e.target.value)} /></div>
          <div className={fldCls}>
            <label style={lblStyle}>Node Type</label>
            <select className="vn-input" value={form.node_type ?? 'node'} onChange={e => set('node_type', e.target.value as NodeType)}>
              {(['validator', 'node', 'relayer', 'other'] as NodeType[]).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className={fldCls}>
            <label style={lblStyle}>Network Type</label>
            <select className="vn-input" value={form.network_type ?? 'mainnet'} onChange={e => set('network_type', e.target.value as NetworkType)}>
              {(['mainnet', 'testnet', 'devnet'] as NetworkType[]).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className={fldCls}><label style={lblStyle}>Binary Path</label><input className="vn-input" value={form.binary_path ?? ''} onChange={e => set('binary_path', e.target.value)} placeholder="/usr/local/bin/cosmosd" /></div>
          <div className={fldCls}><label style={lblStyle}>Cosmovisor Path</label><input className="vn-input" value={form.cosmovisor_path ?? ''} onChange={e => set('cosmovisor_path', e.target.value)} placeholder="/home/cosmos/.cosmovisor" /></div>
          <div className={fldCls}><label style={lblStyle}>Config Dir</label><input className="vn-input" value={form.config_dir ?? ''} onChange={e => set('config_dir', e.target.value)} placeholder="/home/cosmos/.chain" /></div>
          <div className={fldCls}><label style={lblStyle}>Valoper</label><input className="vn-input" value={form.valoper ?? ''} onChange={e => set('valoper', e.target.value)} /></div>
          <div className={fldCls}><label style={lblStyle}>RPC Port</label><input className="vn-input" type="number" value={form.rpc_port ?? 26657} onChange={e => set('rpc_port', Number(e.target.value))} /></div>
          <div className={fldCls}><label style={lblStyle}>API Port</label><input className="vn-input" type="number" value={form.api_port ?? 1317} onChange={e => set('api_port', Number(e.target.value))} /></div>
          <div className={fldCls}><label style={lblStyle}>P2P Port</label><input className="vn-input" type="number" value={form.p2p_port ?? 26656} onChange={e => set('p2p_port', Number(e.target.value))} /></div>
          <div style={{ gridColumn: '1 / -1' }} className={fldCls}>
            <label style={lblStyle}>Cosmovisor Enabled</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.cosmovisor_enabled ?? false} onChange={e => set('cosmovisor_enabled', e.target.checked)} />
              <span style={{ fontSize: '0.85rem' }}>Enable cosmovisor for upgrades</span>
            </label>
          </div>
          <div style={{ gridColumn: '1 / -1' }} className={fldCls}>
            <label style={lblStyle}>Notes</label>
            <textarea className="vn-input" style={{ minHeight: 60, resize: 'vertical' }} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        {err && <p className="alert alert-danger" style={{ margin: '0.5rem 0' }}>{err}</p>}

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── UnitCard ──────────────────────────────────────────────────────────────────

function UnitCard({
  unit,
  onDelete,
  onHistory,
  onLogs,
  onDeploy,
  onEdit,
}: {
  unit: CosmosUnitWithStatus;
  onDelete: (name: string) => void;
  onHistory: (u: CosmosUnitWithStatus) => void;
  onLogs: (u: CosmosUnitWithStatus) => void;
  onDeploy: (u: CosmosUnitWithStatus) => void;
  onEdit: (u: CosmosUnitWithStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const st = unit.status;
  const typeStyle = NODE_TYPE_COLORS[unit.node_type] ?? NODE_TYPE_COLORS.other;

  return (
    <div style={{
      background: '#111827', border: '1px solid #1f2937', borderRadius: 8,
      overflow: 'hidden', transition: 'border-color .15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#374151')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#1f2937')}
    >
      {/* Card header */}
      <div
        style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12 }}
        onClick={() => setExpanded(x => !x)}
      >
        <span style={{ fontSize: 12, marginTop: 2 }}>{expanded ? '▾' : '▸'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{unit.name}</span>
            <span style={{ background: typeStyle.bg, color: typeStyle.text, borderRadius: 4, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
              {unit.node_type}
            </span>
            <span style={{ color: NET_COLORS[unit.network_type] ?? '#9ca3af', fontSize: 11, fontWeight: 600 }}>
              {unit.network_type}
            </span>
            {st && (
              <span style={{ color: st.service_active ? '#4ade80' : '#f87171', fontSize: 12 }}>
                {st.service_active ? '● active' : '● inactive'}
              </span>
            )}
            {st?.syncing && <span style={{ color: '#fbbf24', fontSize: 12 }}>⟳ syncing</span>}
            {st?.upgrade_height != null && st.upgrade_height > 0 && (
              <span style={{ background: '#422006', color: '#fb923c', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
                ⬆ upgrade {st.upgrade_name} @ {fmtHeight(st.upgrade_height)}
              </span>
            )}
            {st?.gov_pending != null && st.gov_pending > 0 && (
              <span style={{ background: '#451a03', color: '#fbbf24', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
                {st.gov_pending} gov
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {unit.chain_id && <span>⛓ {unit.chain_id}</span>}
            {unit.vm_name && <span>⚙ {unit.vm_name}</span>}
            {unit.datacenter && <span>🏢 {unit.datacenter}</span>}
            {st?.block_height != null && st.block_height > 0 && (
              <span style={{ color: '#60a5fa' }}>⬆ {fmtHeight(st.block_height)}</span>
            )}
            {st?.peers != null && <span>👥 {st.peers} peers</span>}
            {st?.polled_at && <span style={{ color: '#6b7280' }}>🕐 {timeAgo(st.polled_at)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
          <span style={{ fontSize: 12, color: STATE_COLORS[unit.state] ?? '#9ca3af', fontWeight: 600 }}>
            {unit.state}
          </span>
          <button onClick={() => onHistory(unit)} title="Status history" className="btn btn-secondary btn-sm">📊</button>
          <button onClick={() => onLogs(unit)} title="Stream logs" className="btn btn-secondary btn-sm" style={{ color: '#60a5fa' }}>📋</button>
          <button onClick={() => onDeploy(unit)} title="Deploy cosmovisor" className="btn btn-secondary btn-sm" style={{ color: '#4ade80' }}>🚀</button>
          <button onClick={() => onEdit(unit)} title="Edit unit" className="btn btn-secondary btn-sm" style={{ color: '#fbbf24' }}>✏</button>
          <button onClick={() => onDelete(unit.name)} title="Delete unit" className="btn btn-danger btn-sm">🗑</button>
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{ borderTop: '1px solid #1f2937', padding: '12px 16px 14px', background: '#0f172a' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px 20px', fontSize: 12 }}>
            {[
              ['Service', unit.service_name],
              ['Binary', unit.binary_path],
              ['Config Dir', unit.config_dir],
              ['Cosmovisor', unit.cosmovisor_enabled ? `✓ ${unit.cosmovisor_path || 'enabled'}` : '✗ disabled'],
              ['Valoper', unit.valoper],
              ['RPC Port', unit.rpc_port],
              ['API Port', unit.api_port],
              ['P2P Port', unit.p2p_port],
              ['Deployed', fmtTime(unit.deployed_at)],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k as string}>
                <div style={{ color: '#6b7280', marginBottom: 2 }}>{k}</div>
                <div style={{ color: '#d1d5db', fontFamily: typeof v === 'string' && (v.startsWith('/') || v.match(/^\d+$/)) ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>
                  {String(v)}
                </div>
              </div>
            ))}
          </div>
          {unit.notes && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af', borderTop: '1px solid #1f2937', paddingTop: 8 }}>
              📝 {unit.notes}
            </div>
          )}
          {unit.node_type === 'validator' && (
            <div style={{ marginTop: 10, borderTop: '1px solid #1f2937', paddingTop: 10 }}>
              <ValidatorUptime unitName={unit.name} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UnitsPage() {
  const [units, setUnits] = useState<CosmosUnitWithStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddChain, setShowAddChain] = useState(false);
  const [registeredChains, setRegisteredChains] = useState<RegisteredChain[]>([]);
  const [historyUnit, setHistoryUnit] = useState<CosmosUnitWithStatus | null>(null);
  const [logUnit, setLogUnit] = useState<CosmosUnitWithStatus | null>(null);
  const [deployUnit, setDeployUnit] = useState<CosmosUnitWithStatus | null>(null);
  const [editUnit, setEditUnit] = useState<CosmosUnitWithStatus | null>(null);
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState(() => searchParams.get('filter') ?? '');
  const [filterType, setFilterType] = useState<NodeType | 'all'>('all');
  const [filterNet, setFilterNet] = useState<NetworkType | 'all'>('all');
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = async () => {
    setLoading(true);
    try {
      const res = await getUnits();
      setUnits(res.units ?? []);
    } finally {
      setLoading(false);
    }
  };

  const loadChains = async () => {
    try {
      const res = await getRegisteredChains();
      setRegisteredChains(res.registered_chains ?? []);
    } catch { /* silently ignore */ }
  };

  useEffect(() => {
    load();
    loadChains();
    // Auto-refresh every 30s to pick up new poller results.
    const t = setInterval(() => { void load(); void loadChains(); }, 30_000);
    return () => clearInterval(t);
  }, []);

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete unit "${name}"? This cannot be undone.`)) return;
    await deleteUnit(name);
    await load();
  };

  const handleRemoveChain = async (chain: string) => {
    if (!confirm(`Unregister chain "${chain}"?`)) return;
    await unregisterChain(chain);
    await loadChains();
  };

  const filtered = units.filter(u => {
    if (filterType !== 'all' && u.node_type !== filterType) return false;
    if (filterNet !== 'all' && u.network_type !== filterNet) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        u.chain_name.toLowerCase().includes(q) ||
        u.chain_id.toLowerCase().includes(q) ||
        u.vm_name.toLowerCase().includes(q) ||
        u.datacenter.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by chain
  const grouped = filtered.reduce<Record<string, CosmosUnitWithStatus[]>>((acc, u) => {
    const key = u.chain_name || 'Uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(u);
    return acc;
  }, {});

  const totalActive = units.filter(u => u.status?.service_active).length;
  const totalSyncing = units.filter(u => u.status?.syncing).length;
  const totalGov = units.reduce((s, u) => s + (u.status?.gov_pending ?? 0), 0);

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>⚛ Services & Chains</h1>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary">
          + Register Service
        </button>
        <button onClick={() => setShowAddChain(true)} className="btn btn-secondary" style={{ borderColor: 'var(--vn-primary)', color: 'var(--vn-primary)' }}>
          + Register Chain
        </button>
        <button onClick={load} disabled={loading} className="btn btn-secondary">
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Services', value: units.length, color: '#60a5fa' },
          { label: 'Active', value: totalActive, color: '#4ade80' },
          { label: 'Syncing', value: totalSyncing, color: '#fbbf24' },
          { label: 'Gov Proposals', value: totalGov, color: totalGov > 0 ? '#fb923c' : '#4ade80' },
          { label: 'Chains', value: Object.keys(grouped).length, color: '#c084fc' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card card-sm" style={{ minWidth: 110 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 12, color: 'var(--vn-text-muted)' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search units, chains, VMs…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="vn-input"
          style={{ flex: 1, minWidth: 200 }}
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value as NodeType | 'all')}
          className="vn-input"
        >
          <option value="all">All types</option>
          {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterNet}
          onChange={e => setFilterNet(e.target.value as NetworkType | 'all')}
          className="vn-input"
        >
          <option value="all">All networks</option>
          {NETWORK_TYPES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Content */}
      {units.length === 0 && !loading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚛</div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>No units registered</div>
          <div style={{ color: 'var(--vn-text-subtle)', marginBottom: 20, fontSize: 14 }}>
            Register your Cosmos validators, nodes, relayers, and API endpoints.
          </div>
          <button onClick={() => setShowAdd(true)} className="btn btn-primary">
            + Register First Unit
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--vn-text-subtle)', padding: '20px 0', textAlign: 'center' }}>No units match the current filters.</div>
      ) : (
        Object.entries(grouped).map(([chain, chainUnits]) => (
          <div key={chain} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#c084fc' }}>⛓ {chain}</span>
              <span style={{ fontSize: 12, color: 'var(--vn-text-subtle)' }}>{chainUnits.length} unit{chainUnits.length !== 1 ? 's' : ''}</span>
              <div style={{ flex: 1, height: 1, background: 'var(--vn-border)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {chainUnits.map(u => (
                <UnitCard
                  key={u.name}
                  unit={u}
                  onDelete={handleDelete}
                  onHistory={setHistoryUnit}
                  onLogs={setLogUnit}
                  onDeploy={setDeployUnit}
                  onEdit={setEditUnit}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Registered Chains section */}
      <div style={{ marginTop: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>⛓ Registered Chains</h2>
          <span style={{ fontSize: 12, color: 'var(--vn-text-subtle)' }}>
            {registeredChains.length} registered — polled by vProx fleet
          </span>
        </div>
        {registeredChains.length === 0 ? (
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ color: 'var(--vn-text-subtle)', fontSize: 14, marginBottom: 12 }}>
              No chains registered for fleet polling yet.
            </div>
            <button onClick={() => setShowAddChain(true)} className="btn btn-secondary" style={{ borderColor: 'var(--vn-primary)', color: 'var(--vn-primary)' }}>
              + Register Chain
            </button>
          </div>
        ) : (
          <div className="card card-flush overflow-x-auto">
            <table className="vn-table">
              <thead>
                <tr>
                  <th>Chain ID</th>
                  <th>RPC URL</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {registeredChains.map(c => (
                  <tr key={c.chain}>
                    <td className="px-3 py-2 font-medium">{c.chain}</td>
                    <td className="px-3 py-2" style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--vn-text-muted)' }}>
                      {c.rpc_url || '—'}
                    </td>
                    <td className="px-3 py-2" style={{ fontSize: '0.78rem', color: 'var(--vn-text-muted)' }}>
                      {c.note || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => { void handleRemoveChain(c.chain); }}
                        style={{ background: 'transparent', color: 'var(--vn-danger)', border: '1px solid var(--vn-danger)', borderRadius: 4, padding: '0.25rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAdd && <AddUnitModal onClose={() => setShowAdd(false)} onCreated={load} />}
      {showAddChain && <AddChainModal onClose={() => setShowAddChain(false)} onCreated={loadChains} />}
      {historyUnit && <StatusHistoryModal unit={historyUnit} onClose={() => setHistoryUnit(null)} />}
      {logUnit && <LogModal unit={logUnit} onClose={() => setLogUnit(null)} />}
      {deployUnit && <DeployModal unit={deployUnit} onClose={() => setDeployUnit(null)} />}
      {editUnit && <EditUnitModal unit={editUnit} onClose={() => setEditUnit(null)} onSaved={load} />}
    </div>
  );
}
