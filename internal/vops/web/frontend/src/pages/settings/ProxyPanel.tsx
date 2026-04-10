/**
 * settings/ProxyPanel.tsx
 * Proxy & Chains panels: PortsPanel, ProxyControlsPanel, ChainProfilesPanel,
 * ChainCard, NewChainForm.
 */
import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveConfig } from '../../api';
import type { ConfigSnapshot } from '../../api/types';
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
              No chain profiles found. Add one below or run the Setup Wizard.
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
