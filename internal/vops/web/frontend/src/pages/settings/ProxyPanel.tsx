/**
 * settings/ProxyPanel.tsx
 * Proxy & Chains panels: PortsPanel, ProxyControlsPanel, ChainProfilesPanel,
 * ChainCard, NewChainForm, RegisteredChainsPanel.
 */
import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { saveConfig, getRegisteredChains, registerChain, unregisterChain, forcePoll } from '../../api';
import type { ConfigSnapshot, RegisteredChain } from '../../api/types';
import Spinner from '../../components/Spinner';
import {
  SectionCard,
  SaveBar,
  TOMLEditor,
  LabeledInput,
  parseTOML,
} from './shared';

/* ── Proxy & Chains → Ports ──────────────────────────────────── */

export function PortsPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const raw = typeof config.ports === 'string' ? config.ports : '';
  const t = parseTOML(raw);

  const [fields, setFields] = useState({
    rpc:      t['rpc']      ?? '26657',
    rest:     t['rest']     ?? '1317',
    grpc:     t['grpc']     ?? '0',
    grpc_web: t['grpc_web'] ?? '0',
    api:      t['api']      ?? '0',
    vops_url: t['vops_url'] ?? '',
  });

  const [showToml, setShowToml] = useState(false);
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveConfig('ports', {
      rpc:      Number(fields.rpc)      || 26657,
      rest:     Number(fields.rest)     || 1317,
      grpc:     Number(fields.grpc)     || 0,
      grpc_web: Number(fields.grpc_web) || 0,
      api:      Number(fields.api)      || 0,
      vops_url: fields.vops_url,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  return (
    <SectionCard
      title="vProx Ports"
      subtitle="Default TCP ports vProx listens on per protocol. Per-chain ports are set in Chain Profiles. Changes require a vProx service restart."
    >
      <div className="grid grid-cols-3 gap-3">
        <LabeledInput label="RPC Port" value={fields.rpc} onChange={set('rpc')} placeholder="26657" />
        <LabeledInput label="REST Port" value={fields.rest} onChange={set('rest')} placeholder="1317" />
        <LabeledInput label="gRPC Port" value={fields.grpc} onChange={set('grpc')} placeholder="9090 (0 = disabled)" />
        <LabeledInput label="gRPC-Web Port" value={fields.grpc_web} onChange={set('grpc_web')} placeholder="9091 (0 = disabled)" />
        <LabeledInput label="API Port" value={fields.api} onChange={set('api')} placeholder="0 = disabled" />
        <LabeledInput label="vOps URL" value={fields.vops_url} onChange={set('vops_url')} placeholder="http://127.0.0.1:8889" />
      </div>
      <SaveBar
        onSave={() => saveMut.mutate()}
        isPending={saveMut.isPending}
        isSuccess={saveMut.isSuccess}
        isError={saveMut.isError}
        error={saveMut.error as Error | null}
      />
      <div className="pt-2">
        <button onClick={() => setShowToml((s) => !s)} className="text-xs cursor-pointer" style={{ color: 'var(--vn-text-muted)' }}>
          {showToml ? 'Hide' : 'View'} raw TOML
        </button>
        {showToml && <div className="mt-2"><TOMLEditor sectionKey="ports" rawValue={config.ports} /></div>}
      </div>
    </SectionCard>
  );
}

/* ── Proxy & Chains → Proxy Controls ─────────────────────────── */

export function ProxyControlsPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const raw = typeof config.settings === 'string' ? config.settings : '';
  const t = parseTOML(raw);

  const [fields, setFields] = useState({
    rps:              t['rate_limit.rps']              ?? '25',
    burst:            t['rate_limit.burst']             ?? '100',
    aq_enabled:       t['auto_quarantine.enabled']      ?? 'true',
    aq_threshold:     t['auto_quarantine.threshold']    ?? '120',
    aq_window_sec:    t['auto_quarantine.window_sec']   ?? '10',
    aq_ttl_sec:       t['auto_quarantine.ttl_sec']      ?? '900',
    debug_enabled:    t['debug.enabled']                ?? 'false',
    debug_port:       t['debug.port']                   ?? '6060',
  });

  const [showToml, setShowToml] = useState(false);
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveConfig('settings', {
      rps:              Number(fields.rps)           || 25,
      burst:            Number(fields.burst)          || 100,
      aq_enabled:       fields.aq_enabled === 'true',
      aq_threshold:     Number(fields.aq_threshold)   || 120,
      aq_window_sec:    Number(fields.aq_window_sec)  || 10,
      aq_ttl_sec:       Number(fields.aq_ttl_sec)     || 900,
      debug_enabled:    fields.debug_enabled === 'true',
      debug_port:       Number(fields.debug_port)     || 6060,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  return (
    <SectionCard
      title="Proxy Controls"
      subtitle="Rate limiting, auto-quarantine, and debug settings for the vProx reverse proxy. Changes require a vProx restart."
    >
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>Rate Limiting</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <LabeledInput label="Requests / Second (RPS)" value={fields.rps} onChange={set('rps')} placeholder="25" />
        <LabeledInput label="Burst Allowance" value={fields.burst} onChange={set('burst')} placeholder="100" />
      </div>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>Auto-Quarantine — blocks abusive IPs automatically</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>Enabled</label>
          <select
            value={fields.aq_enabled}
            onChange={(e) => set('aq_enabled')(e.target.value)}
            className="vn-input w-full"
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
        <LabeledInput label="Threshold (req in window)" value={fields.aq_threshold} onChange={set('aq_threshold')} placeholder="120" />
        <LabeledInput label="Window (sec)" value={fields.aq_window_sec} onChange={set('aq_window_sec')} placeholder="10" />
        <LabeledInput label="Penalty TTL (sec)" value={fields.aq_ttl_sec} onChange={set('aq_ttl_sec')} placeholder="900" />
      </div>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>Debug (pprof)</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>pprof Debug Server</label>
          <select
            value={fields.debug_enabled}
            onChange={(e) => set('debug_enabled')(e.target.value)}
            className="vn-input w-full"
          >
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </div>
        <LabeledInput label="Debug Port" value={fields.debug_port} onChange={set('debug_port')} placeholder="6060" />
      </div>
      <SaveBar
        onSave={() => saveMut.mutate()}
        isPending={saveMut.isPending}
        isSuccess={saveMut.isSuccess}
        isError={saveMut.isError}
        error={saveMut.error as Error | null}
      />
      <div className="pt-2">
        <button onClick={() => setShowToml((s) => !s)} className="text-xs cursor-pointer" style={{ color: 'var(--vn-text-muted)' }}>
          {showToml ? 'Hide' : 'View'} raw TOML
        </button>
        {showToml && <div className="mt-2"><TOMLEditor sectionKey="settings" rawValue={config.settings} /></div>}
      </div>
    </SectionCard>
  );
}

/* ── Proxy & Chains → Chain Profiles ─────────────────────────── */

interface ChainEntry {
  file: string;
  name: string;
  raw?: string;
  fields?: Record<string, unknown>;
}

export function ChainCard({ chain, onSaved }: { chain: ChainEntry; onSaved: () => void }) {
  const f = (chain.fields ?? {}) as Record<string, string>;
  const [fields, setFields] = useState({
    chain_name:          f.chain_name          ?? chain.name ?? '',
    chain_id:            f.chain_id            ?? '',
    dashboard_name:      f.dashboard_name      ?? '',
    explorer_base:       f.explorer_base       ?? '',
    chain_ping_country:  f.chain_ping_country  ?? '',
    chain_ping_provider: f.chain_ping_provider ?? '',
  });
  const [showToml, setShowToml] = useState(false);
  const set = (k: keyof typeof fields) => (v: string) => setFields((p) => ({ ...p, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveConfig('chain', { ...fields }),
    onSuccess: onSaved,
  });

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--vn-text)' }}>{fields.chain_name || chain.name}</span>
        <span className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>{chain.file}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <LabeledInput label="Chain Name (slug)" value={fields.chain_name} onChange={set('chain_name')} placeholder="cosmos" />
        <LabeledInput label="Chain ID" value={fields.chain_id} onChange={set('chain_id')} placeholder="cosmoshub-4" />
        <LabeledInput label="Dashboard Name" value={fields.dashboard_name} onChange={set('dashboard_name')} placeholder="Cosmos Hub" />
        <LabeledInput label="Explorer Base URL" value={fields.explorer_base} onChange={set('explorer_base')} placeholder="https://mintscan.io/cosmos" />
        <LabeledInput label="Ping Country (ISO)" value={fields.chain_ping_country} onChange={set('chain_ping_country')} placeholder="US" />
        <LabeledInput label="Ping Provider" value={fields.chain_ping_provider} onChange={set('chain_ping_provider')} placeholder="Hetzner" />
      </div>
      <SaveBar
        onSave={() => saveMut.mutate()}
        isPending={saveMut.isPending}
        isSuccess={saveMut.isSuccess}
        isError={saveMut.isError}
        error={saveMut.error as Error | null}
      />
      <div>
        <button onClick={() => setShowToml((s) => !s)} className="text-xs cursor-pointer" style={{ color: 'var(--vn-text-muted)' }}>
          {showToml ? 'Hide' : 'View'} raw TOML
        </button>
        {showToml && <div className="mt-2"><TOMLEditor sectionKey="chain" rawValue={chain.raw} /></div>}
      </div>
    </div>
  );
}

export function NewChainForm({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({ chain_name: '', chain_id: '', dashboard_name: '', chain_ping_country: '', chain_ping_provider: '' });
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveConfig('chain', { ...fields }),
    onSuccess: () => { setOpen(false); setFields({ chain_name: '', chain_id: '', dashboard_name: '', chain_ping_country: '', chain_ping_provider: '' }); onSaved(); },
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full py-2 text-xs rounded-lg cursor-pointer"
        style={{ border: '1px dashed var(--vn-border)', color: 'var(--vn-text-muted)', backgroundColor: 'transparent' }}>
        + Add New Chain Profile
      </button>
    );
  }

  return (
    <div className="rounded-lg p-4 space-y-3" style={{ border: '1px dashed var(--vn-primary)', backgroundColor: 'var(--vn-surface)' }}>
      <p className="text-xs font-semibold" style={{ color: 'var(--vn-text)' }}>New Chain Profile</p>
      <div className="grid grid-cols-2 gap-2">
        <LabeledInput label="Chain Name (slug)" value={fields.chain_name} onChange={set('chain_name')} placeholder="cosmos" />
        <LabeledInput label="Chain ID" value={fields.chain_id} onChange={set('chain_id')} placeholder="cosmoshub-4" />
        <LabeledInput label="Dashboard Name" value={fields.dashboard_name} onChange={set('dashboard_name')} placeholder="Cosmos Hub" />
        <LabeledInput label="Ping Country" value={fields.chain_ping_country} onChange={set('chain_ping_country')} placeholder="US" />
      </div>
      <p className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
        Service nodes (RPC, REST, gRPC endpoints) are configured separately in the chain TOML after creation.
      </p>
      <SaveBar onSave={() => saveMut.mutate()} onCancel={() => setOpen(false)} isPending={saveMut.isPending} isSuccess={saveMut.isSuccess} isError={saveMut.isError} error={saveMut.error as Error | null} />
    </div>
  );
}

export function ChainProfilesPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const chains = (config.chains as ChainEntry[]) ?? [];
  const onSaved = useCallback(() => queryClient.invalidateQueries({ queryKey: ['config'] }), [queryClient]);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Chain Profiles"
        subtitle="Each file in config/vops/chains/ defines one Cosmos chain. Identity fields (chain_id, slug, dashboard name) are editable here. Service node endpoints (RPC/REST/gRPC) and validator settings live in the raw TOML."
      >
        <div className="space-y-3">
          {chains.length === 0 ? (
            <div className="p-4 rounded-lg text-xs text-center"
              style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px dashed var(--vn-border)', color: 'var(--vn-text-muted)' }}>
              No chain profiles found. Add one using the form below.
            </div>
          ) : (
            chains.map((c) => <ChainCard key={c.file} chain={c} onSaved={onSaved} />)
          )}
          <NewChainForm onSaved={onSaved} />
        </div>
      </SectionCard>
    </div>
  );
}

/* ── Registered Chains ───────────────────────────────────────── */

const fleetBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
  padding: '0.4rem 0.85rem', border: 'none', borderRadius: 'var(--vn-radius)',
  background: 'var(--vn-primary)', color: 'var(--vn-on-primary)',
  fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer',
};
const fleetTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' };
const fleetTh: React.CSSProperties = {
  padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem',
  color: 'var(--vn-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: '1px solid var(--vn-border)',
};
const fleetTd: React.CSSProperties = { padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--vn-border)', color: 'var(--vn-text)' };
const fleetInput: React.CSSProperties = {
  padding: '0.4rem 0.65rem', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)',
  background: 'var(--vn-surface-2)', color: 'var(--vn-text)', fontSize: '0.875rem',
};

export function RegisteredChainsPanel() {
  const qc = useQueryClient();
  const [newChain, setNewChain] = useState('');
  const [newRPC, setNewRPC] = useState('');
  const [newNote, setNewNote] = useState('');
  const [addErr, setAddErr] = useState('');
  const [msg, setMsg] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['registered-chains'],
    queryFn: getRegisteredChains,
    staleTime: 30_000,
  });
  const chains: RegisteredChain[] = data?.registered_chains ?? [];

  const { mutate: doRegister, isPending: registering } = useMutation({
    mutationFn: () => registerChain({ chain: newChain.trim(), rpc_url: newRPC.trim(), note: newNote.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['registered-chains'] });
      setNewChain('');
      setNewRPC('');
      setNewNote('');
      setAddErr('');
      setMsg('Chain registered.');
    },
    onError: (e: Error) => setAddErr(e.message),
  });

  const { mutate: doUnregister } = useMutation({
    mutationFn: (chain: string) => unregisterChain(chain),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['registered-chains'] }); setMsg('Chain removed.'); },
    onError: (e: Error) => setMsg(`Error: ${e.message}`),
  });

  const { mutate: doPoll } = useMutation({
    mutationFn: () => forcePoll(),
    onSuccess: () => setMsg('Poll triggered.'),
    onError: (e: Error) => setMsg(`Error: ${e.message}`),
  });

  return (
    <SectionCard title="Registered Chains" subtitle="Chains registered for live status polling via vProx.">
      {isLoading ? <Spinner label="Loading chains…" /> : (
        <>
          {chains.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--vn-text-muted)', margin: '0 0 1rem' }}>
              No chains registered yet.
            </p>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
              <table style={fleetTable}>
                <thead>
                  <tr>
                    {['Chain', 'RPC URL', 'Note', ''].map(h => (
                      <th key={h} style={fleetTh}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chains.map((c) => (
                    <tr key={c.chain}>
                      <td style={{ ...fleetTd, fontWeight: 600 }}>{c.chain}</td>
                      <td style={{ ...fleetTd, fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--vn-text-muted)' }}>{c.rpc_url || '—'}</td>
                      <td style={{ ...fleetTd, fontSize: '0.78rem', color: 'var(--vn-text-muted)' }}>{c.note || '—'}</td>
                      <td style={fleetTd}>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            onClick={() => doPoll()}
                            style={{ ...fleetBtn, background: 'var(--vn-surface)', color: 'var(--vn-text)', border: '1px solid var(--vn-border)', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                          >
                            Poll All
                          </button>
                          <button
                            onClick={() => { if (confirm(`Unregister chain "${c.chain}"?`)) doUnregister(c.chain); }}
                            style={{ ...fleetBtn, background: 'transparent', color: 'var(--vn-danger)', border: '1px solid var(--vn-danger)', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {msg && <p style={{ fontSize: '0.8rem', color: msg.startsWith('Error') ? 'var(--vn-danger)' : 'var(--vn-success)', marginBottom: '0.75rem' }}>{msg}</p>}

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--vn-text-muted)', marginBottom: '0.25rem' }}>Chain ID</label>
              <input
                value={newChain}
                onChange={e => { setNewChain(e.target.value); setAddErr(''); }}
                placeholder="cosmoshub-4"
                style={{ ...fleetInput, width: 140 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--vn-text-muted)', marginBottom: '0.25rem' }}>RPC URL</label>
              <input
                value={newRPC}
                onChange={e => setNewRPC(e.target.value)}
                placeholder="http://localhost:26657"
                style={{ ...fleetInput, width: 220 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--vn-text-muted)', marginBottom: '0.25rem' }}>Note (opt)</label>
              <input
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="optional note"
                style={{ ...fleetInput, width: 120 }}
              />
            </div>
            <button
              onClick={() => {
                if (!newChain.trim() || !newRPC.trim()) { setAddErr('Chain ID and RPC URL are required'); return; }
                doRegister();
              }}
              disabled={registering}
              style={fleetBtn}
            >
              {registering ? 'Registering…' : 'Register'}
            </button>
          </div>
          {addErr && <p style={{ fontSize: '0.78rem', color: 'var(--vn-danger)', marginTop: '0.4rem' }}>{addErr}</p>}
        </>
      )}
    </SectionCard>
  );
}
