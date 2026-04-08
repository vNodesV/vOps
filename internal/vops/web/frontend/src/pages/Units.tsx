import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getUnits,
  createUnit,
  deleteUnit,
  updateUnit,
  getUnitStatusHistory,
} from '../api';
import type { CosmosUnit, CosmosUnitWithStatus, NodeType, NetworkType, UnitStatus } from '../api/types';

const BASE = (import.meta.env.VITE_API_BASE ?? '') as string;

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_TYPES: NodeType[] = ['validator', 'node', 'api', 'rpc', 'relayer', 'other'];
const NETWORK_TYPES: NetworkType[] = ['mainnet', 'testnet', 'devnet'];

const NODE_TYPE_COLORS: Record<NodeType, { bg: string; text: string }> = {
  validator: { bg: '#4c1d95', text: '#c4b5fd' },
  node:      { bg: '#1e3a5f', text: '#93c5fd' },
  api:       { bg: '#14532d', text: '#86efac' },
  rpc:       { bg: '#164e63', text: '#67e8f9' },
  relayer:   { bg: '#713f12', text: '#fcd34d' },
  other:     { bg: '#1f2937', text: '#9ca3af' },
};

const NET_COLORS: Record<NetworkType, string> = {
  mainnet: '#4ade80',
  testnet: '#fbbf24',
  devnet:  '#f87171',
};

const STATE_COLORS: Record<string, string> = {
  running:  '#4ade80',
  stopped:  '#f87171',
  unknown:  '#9ca3af',
  syncing:  '#fbbf24',
  deployed: '#60a5fa',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHeight(h: number): string {
  if (!h) return '—';
  return h.toLocaleString();
}

function fmtTime(ts: string): string {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function timeAgo(ts: string): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
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
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={(form[k] as string | number) ?? ''}
        placeholder={ph}
        onChange={e => set(k, type === 'number' ? Number(e.target.value) : e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #374151', borderRadius: 6, color: '#f9fafb', padding: '6px 10px', fontSize: 13 }}
      />
    </div>
  );

  const select = (label: string, k: keyof CosmosUnit, opts: string[]) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>{label}</label>
      <select
        value={(form[k] as string) ?? ''}
        onChange={e => set(k, e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #374151', borderRadius: 6, color: '#f9fafb', padding: '6px 10px', fontSize: 13 }}
      >
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, width: 620, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Register Unit</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {err && <div style={{ background: '#450a0a', color: '#fca5a5', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{err}</div>}
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
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#d1d5db', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.cosmovisor_enabled ?? false}
                onChange={e => set('cosmovisor_enabled', e.target.checked)}
              />
              Cosmovisor enabled
            </label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Notes</label>
            <textarea
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              style={{ width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #374151', borderRadius: 6, color: '#f9fafb', padding: '6px 10px', fontSize: 13, resize: 'vertical' }}
            />
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #374151', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ background: '#1f2937', color: '#d1d5db', border: '1px solid #374151', borderRadius: 6, padding: '7px 18px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, width: '75%', maxWidth: 860, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700 }}>Status History — {unit.name}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading ? (
            <p style={{ color: '#9ca3af' }}>Loading…</p>
          ) : history.length === 0 ? (
            <p style={{ color: '#6b7280' }}>No status history yet. Push status via the API or set up a poller.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: '#9ca3af', borderBottom: '1px solid #374151' }}>
                  {['Polled', 'Height', 'Peers', 'Voting Power', 'Gov Pending', 'Syncing', 'Active', 'Error'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(st => (
                  <tr key={st.id} style={{ borderBottom: '1px solid #111' }}>
                    <td style={{ padding: '6px 10px', color: '#9ca3af' }}>{timeAgo(st.polled_at)}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{fmtHeight(st.block_height)}</td>
                    <td style={{ padding: '6px 10px' }}>{st.peers}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{fmtHeight(st.voting_power)}</td>
                    <td style={{ padding: '6px 10px' }}>{st.gov_pending > 0 ? <span style={{ color: '#fbbf24' }}>{st.gov_pending}</span> : '—'}</td>
                    <td style={{ padding: '6px 10px' }}>{st.syncing ? <span style={{ color: '#fbbf24' }}>⟳</span> : <span style={{ color: '#4ade80' }}>✓</span>}</td>
                    <td style={{ padding: '6px 10px' }}>{st.service_active ? <span style={{ color: '#4ade80' }}>●</span> : <span style={{ color: '#f87171' }}>●</span>}</td>
                    <td style={{ padding: '6px 10px', color: '#f87171', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.error || '—'}</td>
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

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  };
  const modal: React.CSSProperties = {
    background: '#0f172a', border: '1px solid #1f2937',
    borderRadius: 8, padding: '1.25rem', width: '720px', maxWidth: '95vw',
    display: 'flex', flexDirection: 'column', maxHeight: '80vh',
  };
  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <strong style={{ color: '#e2e8f0' }}>📋 Logs — {unit.name}</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {connected && <span style={{ color: '#4ade80', fontSize: 12 }}>● live</span>}
            {error && <span style={{ color: '#f87171', fontSize: 12 }}>{error}</span>}
            <button style={{ background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }} onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.72rem', background: '#020617', borderRadius: 4, padding: '0.5rem', lineHeight: 1.5, color: '#94a3b8' }}>
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
    const es = new EventSource(
      `${BASE}/api/v1/units/${encodeURIComponent(unit.name)}/deploy?sudo_password=${encodeURIComponent(sudoPwd)}`
    );
    es.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data) as { step: string; msg: string };
        setLines(prev => [...prev, `[${d.step}] ${d.msg}`]);
        if (d.step === 'complete') { setDone(true); es.close(); setRunning(false); }
        if (d.step === 'error') { setDone(true); es.close(); setRunning(false); }
      } catch { /* ignore */ }
    };
    es.onerror = () => { setRunning(false); es.close(); setLines(prev => [...prev, '[error] Connection lost']); };
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  };
  const modal: React.CSSProperties = {
    background: '#0f172a', border: '1px solid #1f2937',
    borderRadius: 8, padding: '1.25rem', width: '620px', maxWidth: '95vw',
    display: 'flex', flexDirection: 'column',
  };
  const inp: React.CSSProperties = {
    padding: '0.35rem 0.5rem', background: '#1e293b', border: '1px solid #334155',
    borderRadius: 4, color: '#e2e8f0', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && !running && onClose()}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <strong style={{ color: '#e2e8f0' }}>🚀 Deploy cosmovisor — {unit.name}</strong>
          <button style={{ background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }} onClick={onClose} disabled={running}>✕</button>
        </div>
        {!running && !done && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>Sudo password (leave blank if NOPASSWD)</label>
            <input type="password" style={inp} value={sudoPwd} onChange={e => setSudoPwd(e.target.value)} placeholder="optional" />
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.5rem 0 0' }}>
              This will install cosmovisor (if missing), create directory structure, and write a systemd service on <strong style={{ color: '#94a3b8' }}>{unit.vm_name}</strong>.
            </p>
            <button onClick={startDeploy} style={{ marginTop: '0.75rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 5, padding: '0.35rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              Start Deploy
            </button>
          </div>
        )}
        {lines.length > 0 && (
          <div style={{ maxHeight: '40vh', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.72rem', background: '#020617', borderRadius: 4, padding: '0.5rem', lineHeight: 1.6, color: '#94a3b8' }}>
            {lines.map((l, i) => (
              <div key={i} style={{ color: l.includes('[error]') ? '#f87171' : l.includes('[complete]') ? '#4ade80' : '#94a3b8' }}>{l}</div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
        {done && <button onClick={onClose} style={{ marginTop: '0.75rem', alignSelf: 'flex-end', background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', borderRadius: 5, padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>Close</button>}
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

  const inp: React.CSSProperties = {
    padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid #374151',
    background: '#111827', color: '#e5e7eb', fontSize: '0.85rem', width: '100%',
  };
  const fld: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: '0.75rem' };
  const lbl: React.CSSProperties = { fontSize: '0.78rem', color: '#9ca3af' };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#1f2937', borderRadius: 10, padding: '1.5rem', width: 480, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', color: '#f9fafb' }}>✏ Edit Unit — {unit.name}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
          <div style={fld}><label style={lbl}>Chain Name</label><input style={inp} value={form.chain_name ?? ''} onChange={e => set('chain_name', e.target.value)} /></div>
          <div style={fld}><label style={lbl}>Chain ID</label><input style={inp} value={form.chain_id ?? ''} onChange={e => set('chain_id', e.target.value)} /></div>
          <div style={fld}><label style={lbl}>VM Name</label><input style={inp} value={form.vm_name ?? ''} onChange={e => set('vm_name', e.target.value)} /></div>
          <div style={fld}><label style={lbl}>Datacenter</label><input style={inp} value={form.datacenter ?? ''} onChange={e => set('datacenter', e.target.value)} /></div>
          <div style={fld}>
            <label style={lbl}>Node Type</label>
            <select style={inp} value={form.node_type ?? 'node'} onChange={e => set('node_type', e.target.value as NodeType)}>
              {(['validator', 'node', 'relayer', 'other'] as NodeType[]).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={fld}>
            <label style={lbl}>Network Type</label>
            <select style={inp} value={form.network_type ?? 'mainnet'} onChange={e => set('network_type', e.target.value as NetworkType)}>
              {(['mainnet', 'testnet', 'devnet'] as NetworkType[]).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={fld}><label style={lbl}>Binary Path</label><input style={inp} value={form.binary_path ?? ''} onChange={e => set('binary_path', e.target.value)} placeholder="/usr/local/bin/cosmosd" /></div>
          <div style={fld}><label style={lbl}>Cosmovisor Path</label><input style={inp} value={form.cosmovisor_path ?? ''} onChange={e => set('cosmovisor_path', e.target.value)} placeholder="/home/cosmos/.cosmovisor" /></div>
          <div style={fld}><label style={lbl}>Config Dir</label><input style={inp} value={form.config_dir ?? ''} onChange={e => set('config_dir', e.target.value)} placeholder="/home/cosmos/.chain" /></div>
          <div style={fld}><label style={lbl}>Valoper</label><input style={inp} value={form.valoper ?? ''} onChange={e => set('valoper', e.target.value)} /></div>
          <div style={fld}><label style={lbl}>RPC Port</label><input style={inp} type="number" value={form.rpc_port ?? 26657} onChange={e => set('rpc_port', Number(e.target.value))} /></div>
          <div style={fld}><label style={lbl}>API Port</label><input style={inp} type="number" value={form.api_port ?? 1317} onChange={e => set('api_port', Number(e.target.value))} /></div>
          <div style={fld}><label style={lbl}>P2P Port</label><input style={inp} type="number" value={form.p2p_port ?? 26656} onChange={e => set('p2p_port', Number(e.target.value))} /></div>
          <div style={{ ...fld, gridColumn: '1 / -1' }}>
            <label style={lbl}>Cosmovisor Enabled</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.cosmovisor_enabled ?? false} onChange={e => set('cosmovisor_enabled', e.target.checked)} />
              <span style={{ fontSize: '0.85rem', color: '#e5e7eb' }}>Enable cosmovisor for upgrades</span>
            </label>
          </div>
          <div style={{ ...fld, gridColumn: '1 / -1' }}>
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        {err && <p style={{ color: '#f87171', fontSize: '0.82rem', margin: '0.5rem 0' }}>{err}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '1rem' }}>
          <button onClick={onClose} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#9ca3af', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: 6, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
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
          <button
            onClick={() => onHistory(unit)}
            title="Status history"
            style={{ background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            📊
          </button>
          <button
            onClick={() => onLogs(unit)}
            title="Stream logs"
            style={{ background: '#1f2937', color: '#60a5fa', border: '1px solid #374151', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            📋
          </button>
          <button
            onClick={() => onDeploy(unit)}
            title="Deploy cosmovisor"
            style={{ background: '#1f2937', color: '#4ade80', border: '1px solid #374151', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            🚀
          </button>
          <button
            onClick={() => onEdit(unit)}
            title="Edit unit"
            style={{ background: '#1f2937', color: '#fbbf24', border: '1px solid #374151', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            ✏
          </button>
          <button
            onClick={() => onDelete(unit.name)}
            title="Delete unit"
            style={{ background: '#1f2937', color: '#f87171', border: '1px solid #374151', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            🗑
          </button>
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

  useEffect(() => {
    load();
    // Auto-refresh every 30s to pick up new poller results.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete unit "${name}"? This cannot be undone.`)) return;
    await deleteUnit(name);
    await load();
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
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>⚛ Units</h1>
        <button
          onClick={() => setShowAdd(true)}
          style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600 }}
        >
          + Register Unit
        </button>
        <button
          onClick={load}
          disabled={loading}
          style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 6, padding: '6px 14px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
        >
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Units', value: units.length, color: '#60a5fa' },
          { label: 'Active', value: totalActive, color: '#4ade80' },
          { label: 'Syncing', value: totalSyncing, color: '#fbbf24' },
          { label: 'Gov Proposals', value: totalGov, color: totalGov > 0 ? '#fb923c' : '#4ade80' },
          { label: 'Chains', value: Object.keys(grouped).length, color: '#c084fc' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 18px', minWidth: 110 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>{label}</div>
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
          style={{ flex: 1, minWidth: 200, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, color: '#f9fafb', padding: '6px 12px', fontSize: 13 }}
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value as NodeType | 'all')}
          style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, color: '#f9fafb', padding: '6px 10px', fontSize: 13 }}
        >
          <option value="all">All types</option>
          {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterNet}
          onChange={e => setFilterNet(e.target.value as NetworkType | 'all')}
          style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, color: '#f9fafb', padding: '6px 10px', fontSize: 13 }}
        >
          <option value="all">All networks</option>
          {NETWORK_TYPES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Content */}
      {units.length === 0 && !loading ? (
        <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 8, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚛</div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>No units registered</div>
          <div style={{ color: '#6b7280', marginBottom: 20, fontSize: 14 }}>
            Register your Cosmos validators, nodes, relayers, and API endpoints.
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontWeight: 600 }}
          >
            + Register First Unit
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#6b7280', padding: '20px 0', textAlign: 'center' }}>No units match the current filters.</div>
      ) : (
        Object.entries(grouped).map(([chain, chainUnits]) => (
          <div key={chain} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#c084fc' }}>⛓ {chain}</span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{chainUnits.length} unit{chainUnits.length !== 1 ? 's' : ''}</span>
              <div style={{ flex: 1, height: 1, background: '#1f2937' }} />
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

      {/* Modals */}
      {showAdd && <AddUnitModal onClose={() => setShowAdd(false)} onCreated={load} />}
      {historyUnit && <StatusHistoryModal unit={historyUnit} onClose={() => setHistoryUnit(null)} />}
      {logUnit && <LogModal unit={logUnit} onClose={() => setLogUnit(null)} />}
      {deployUnit && <DeployModal unit={deployUnit} onClose={() => setDeployUnit(null)} />}
      {editUnit && <EditUnitModal unit={editUnit} onClose={() => setEditUnit(null)} onSaved={load} />}
    </div>
  );
}
