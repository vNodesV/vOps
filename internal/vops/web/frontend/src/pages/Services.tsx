import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getServices, createService, deleteService, getServiceETA, updateService } from '../api';
import type { Service, ServiceType, ServiceETA } from '../api/types';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';

/* ── Styles ───────────────────────────────────────────────────── */
const card: React.CSSProperties = {
  background: 'var(--vn-surface)',
  border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)',
  padding: '1.25rem 1.5rem',
  boxShadow: 'var(--vn-shadow)',
};

const btn: React.CSSProperties = {
  cursor: 'pointer',
  border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)',
  padding: '0.35rem 0.85rem',
  fontSize: '0.8rem',
  fontWeight: 500,
  background: 'var(--vn-surface)',
  color: 'var(--vn-text)',
};

const primaryBtn: React.CSSProperties = {
  ...btn,
  background: 'var(--vn-primary)',
  color: 'var(--vn-on-primary)',
  border: 'none',
};

const dangerBtn: React.CSSProperties = {
  ...btn,
  background: 'var(--vn-danger)',
  color: '#fff',
  border: 'none',
};

/* ── Type label + icon ────────────────────────────────────────── */
const typeLabel: Record<ServiceType, string> = {
  validator: '🔐 Validator',
  api: '🔌 API',
  rpc: '📡 RPC',
  node: '🟢 Node',
  relayer: '🔄 Relayer',
  webserver: '🌐 Web Server',
  vprox: '🛡 vProx',
  other: '⚙ Other',
};

const SERVICE_TYPES: ServiceType[] = ['validator', 'api', 'rpc', 'node', 'relayer', 'webserver', 'vprox', 'other'];

/** Types that support ETA polling (they have rpc_url). */
const ETA_TYPES = new Set<ServiceType>(['validator', 'api', 'rpc', 'node', 'relayer']);

/* ── Per-type config field definitions (mirrors backend schema.go) ── */
type FieldDef = { key: string; label: string; inputType: 'text' | 'select'; required?: boolean; placeholder?: string; options?: string[]; hint?: string };

const TYPE_FIELDS: Partial<Record<ServiceType, FieldDef[]>> = {
  validator: [
    { key: 'valoper', label: 'Valoper Address', inputType: 'text', required: true, placeholder: 'chihuahuavaloper1…' },
    { key: 'moniker', label: 'Moniker', inputType: 'text', required: true, placeholder: 'my-validator' },
    { key: 'rpc_url', label: 'Node RPC URL', inputType: 'text', placeholder: 'http://localhost:26657', hint: "Local node's CometBFT RPC (optional — omit if not running a node)" },
    { key: 'wallet_key_name', label: 'Wallet Key Name', inputType: 'text', placeholder: 'validator-key' },
    { key: 'preferred_explorer', label: 'Explorer URL', inputType: 'text', placeholder: 'https://ping.pub/chihuahua' },
    { key: 'ref_rpc_url', label: 'Reference RPC (synced)', inputType: 'text', placeholder: 'https://rpc.chihuahua.wtf', hint: 'Used for ETA calculation — auto-filled from cosmos.directory' },
  ],
  api: [
    { key: 'rpc_url', label: 'API URL', inputType: 'text', required: true, placeholder: 'http://localhost:1317' },
    { key: 'moniker', label: 'Moniker', inputType: 'text', required: true },
    { key: 'preferred_explorer', label: 'Explorer URL', inputType: 'text', placeholder: 'https://ping.pub/chihuahua' },
    { key: 'ref_rpc_url', label: 'Reference RPC (synced)', inputType: 'text', hint: 'Used for ETA calculation' },
  ],
  rpc: [
    { key: 'rpc_url', label: 'RPC URL', inputType: 'text', required: true, placeholder: 'http://localhost:26657' },
    { key: 'moniker', label: 'Moniker', inputType: 'text', required: true },
    { key: 'preferred_explorer', label: 'Explorer URL', inputType: 'text', placeholder: 'https://ping.pub/chihuahua' },
    { key: 'ref_rpc_url', label: 'Reference RPC (synced)', inputType: 'text', hint: 'Used for ETA calculation' },
  ],
  node: [
    { key: 'rpc_url', label: 'Node RPC URL', inputType: 'text', required: true, placeholder: 'http://localhost:26657' },
    { key: 'moniker', label: 'Moniker', inputType: 'text', required: true },
    { key: 'preferred_explorer', label: 'Explorer URL', inputType: 'text', placeholder: 'https://ping.pub/chihuahua' },
    { key: 'ref_rpc_url', label: 'Reference RPC (synced)', inputType: 'text', hint: 'Used for ETA calculation' },
  ],
  relayer: [
    { key: 'rpc_url', label: 'Relayer RPC URL', inputType: 'text', required: true, placeholder: 'http://localhost:26657' },
    { key: 'moniker', label: 'Moniker', inputType: 'text', required: true },
    { key: 'wallet_key_name', label: 'Wallet Key Name', inputType: 'text', placeholder: 'relayer-key' },
    { key: 'channels', label: 'IBC Channels', inputType: 'text', placeholder: 'channel-0,channel-1', hint: 'Comma-separated' },
    { key: 'preferred_explorer', label: 'Explorer URL', inputType: 'text' },
    { key: 'ref_rpc_url', label: 'Reference RPC (synced)', inputType: 'text', hint: 'Used for ETA calculation' },
  ],
  webserver: [
    { key: 'engine', label: 'Web Server Engine', inputType: 'select', required: true, options: ['nginx', 'apache2', 'caddy', 'other'] },
    { key: 'public_ip', label: 'Public IP / Domain', inputType: 'text', required: true, placeholder: '1.2.3.4 or example.com' },
    { key: 'cert_domain', label: 'TLS Certificate Domain', inputType: 'text', placeholder: 'example.com', hint: 'Domain to check cert expiry' },
  ],
  vprox: [
    { key: 'api_url', label: 'vProx API URL', inputType: 'text', placeholder: 'http://localhost:8080' },
  ],
  other: [
    { key: 'note', label: 'Notes', inputType: 'text', placeholder: 'Describe this service' },
  ],
};

function stateStatus(s: Service): 'online' | 'error' | 'inactive' | 'unknown' {
  if (s.state === 'online') return 'online';
  if (s.state === 'down') return 'error';
  if (s.state === 'unknown') return 'unknown';
  return 'inactive';
}

/* ── ETA badge with progress bar ──────────────────────────────── */
function ETABadge({ svcId }: { svcId: number }) {
  const [eta, setEta] = useState<ServiceETA | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    try { setEta(await getServiceETA(svcId)); } catch { setEta(null); } finally { setLoading(false); }
  };

  if (loading) return <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>…</span>;
  if (eta) {
    if (eta.error) return <span style={{ fontSize: '0.75rem', color: 'var(--vn-danger)' }} title={eta.error}>⚠ err</span>;
    if (!eta.catching_up) return <span style={{ fontSize: '0.75rem', color: 'var(--vn-success)' }}>✓ synced</span>;
    const pct = eta.ext_height > 0 ? Math.round((eta.local_height / eta.ext_height) * 100) : 0;
    return (
      <div style={{ minWidth: 90 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--vn-warning)', marginBottom: '0.2rem' }}
          title={`${eta.blocks_behind.toLocaleString()} blocks behind · avg ${eta.avg_block_sec.toFixed(1)}s`}>
          ⏳ {eta.eta_human}
        </div>
        <div style={{ height: 4, background: 'var(--vn-border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--vn-warning)', borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--vn-text-muted)', marginTop: '0.15rem' }}>{pct}%</div>
      </div>
    );
  }
  return <button style={{ ...btn, padding: '0.2rem 0.5rem', fontSize: '0.7rem' }} onClick={check}>Check ETA</button>;
}

/* ── Edit Service Modal ───────────────────────────────────────── */
function EditServiceModal({ svc, onClose }: { svc: Service; onClose: () => void }) {
  const qc = useQueryClient();
  const cfg = (svc.config ?? {}) as Record<string, string>;
  const [vmName, setVmName] = useState(svc.vm_name ?? '');
  const [datacenter, setDatacenter] = useState(svc.datacenter ?? '');
  const [chainId, setChainId] = useState(svc.chain_id ?? '');
  const [configFields, setConfigFields] = useState<Record<string, string>>(cfg);
  const [err, setErr] = useState('');

  const setField = (key: string, val: string) =>
    setConfigFields(prev => ({ ...prev, [key]: val }));

  const mut = useMutation({
    mutationFn: () => updateService(svc.id, {
      vm_name: vmName,
      datacenter,
      chain_id: chainId,
      config: Object.fromEntries(Object.entries(configFields).filter(([, v]) => v !== '')),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modal: React.CSSProperties = {
    background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)',
    padding: '2rem', width: 460, maxWidth: '95vw', maxHeight: '90vh',
    overflowY: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
  };
  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.85rem' };
  const labelStyle: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--vn-text-muted)', fontWeight: 500 };
  const inputStyle: React.CSSProperties = {
    padding: '0.45rem 0.75rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)',
    background: 'var(--vn-surface)', color: 'var(--vn-text)', fontSize: '0.875rem',
  };

  const extraFields = TYPE_FIELDS[svc.service_type] ?? [];

  return (
    <div style={overlay} role="dialog" aria-modal aria-label={`Edit service ${svc.name}`} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.1rem', color: 'var(--vn-text)' }}>
          ✏ Edit Service — {svc.name}
          <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--vn-text-muted)', marginLeft: '0.5rem' }}>
            ({typeLabel[svc.service_type] ?? svc.service_type})
          </span>
        </h2>

        <div style={fieldStyle}>
          <label style={labelStyle}>VM Name</label>
          <input style={inputStyle} value={vmName} onChange={e => setVmName(e.target.value)} placeholder="e.g. cosmos-vm-01" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Datacenter</label>
          <input style={inputStyle} value={datacenter} onChange={e => setDatacenter(e.target.value)} placeholder="e.g. QC" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Chain ID</label>
          <input style={inputStyle} value={chainId} onChange={e => setChainId(e.target.value)} placeholder="e.g. chihuahua-1" />
        </div>

        {svc.service_type === 'validator' && chainId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--vn-surface-2)', padding: '0.5rem 0.75rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>Auto-fill from cosmos.directory</span>
            <button
              type="button"
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface)', color: 'var(--vn-text)' }}
              onClick={async () => {
                try {
                  const res = await fetch(`https://cosmos.directory/${chainId.toLowerCase()}/chain`);
                  if (!res.ok) return;
                  const d = await res.json();
                  const rpcs: Array<{ address: string }> = d?.chain?.apis?.rpc ?? [];
                  if (rpcs.length > 0) {
                    setConfigFields(prev => ({ ...prev, ref_rpc_url: rpcs[0].address }));
                  }
                  const explorers: Array<{ url: string }> = d?.chain?.explorers ?? [];
                  if (explorers.length > 0 && !configFields.preferred_explorer) {
                    setConfigFields(prev => ({ ...prev, preferred_explorer: explorers[0].url }));
                  }
                } catch { /* ignore network errors */ }
              }}
            >
              ↓ Fetch RPC + Explorer
            </button>
          </div>
        )}

        {extraFields.map(f => (
          <div key={f.key} style={fieldStyle}>
            <label style={labelStyle}>{f.label}{f.required ? ' *' : ''}</label>
            {f.inputType === 'select' ? (
              <select style={inputStyle} value={configFields[f.key] ?? ''} onChange={e => setField(f.key, e.target.value)}>
                <option value="">Select…</option>
                {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                style={inputStyle}
                value={configFields[f.key] ?? ''}
                onChange={e => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
            {f.hint && <span style={{ fontSize: '0.72rem', color: 'var(--vn-text-muted)' }}>{f.hint}</span>}
          </div>
        ))}

        {err && <p style={{ color: 'var(--vn-danger)', fontSize: '0.82rem', margin: '0.5rem 0' }}>{err}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button onClick={onClose} style={{ ...btn, background: 'var(--vn-surface-2)' }}>Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            style={{ ...btn, background: 'var(--vn-primary)', color: '#fff' }}
          >
            {mut.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Service row (with expandable detail) ─────────────────────── */
function ServiceRow({ svc, onDelete }: { svc: Service; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const status = stateStatus(svc);
  const cfg = (svc.config ?? {}) as Record<string, string>;
  const moniker = cfg.moniker;
  const showETA = ETA_TYPES.has(svc.service_type);
  const fields = TYPE_FIELDS[svc.service_type] ?? [];
  const colSpan = 8;

  return (
    <>
      {showEdit && <EditServiceModal svc={svc} onClose={() => setShowEdit(false)} />}
      <tr
        style={{ borderBottom: expanded ? 'none' : '1px solid var(--vn-border)', cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--vn-text)', userSelect: 'none' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--vn-text-muted)', marginRight: '0.35rem' }}>{expanded ? '▾' : '▸'}</span>
          {svc.name}
          {moniker && moniker !== svc.name && (
            <span style={{ fontWeight: 400, color: 'var(--vn-text-muted)', marginLeft: '0.4rem', fontSize: '0.8rem' }}>
              ({moniker})
            </span>
          )}
        </td>
        <td style={{ padding: '0.75rem 1rem', color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>
          {typeLabel[svc.service_type] ?? svc.service_type}
        </td>
        <td style={{ padding: '0.75rem 1rem', color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>
          {svc.vm_name || '—'}
        </td>
        <td style={{ padding: '0.75rem 1rem', color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>
          {svc.chain_id || '—'}
        </td>
        <td style={{ padding: '0.75rem 1rem' }} onClick={e => e.stopPropagation()}>
          <Badge status={status} />
        </td>
        <td style={{ padding: '0.75rem 1rem' }} onClick={e => e.stopPropagation()}>
          {showETA ? <ETABadge svcId={svc.id} /> : <span style={{ color: 'var(--vn-text-muted)', fontSize: '0.75rem' }}>—</span>}
        </td>
        <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>
          {svc.updated_at ? new Date(svc.updated_at).toLocaleDateString() : '—'}
        </td>
        <td style={{ padding: '0.75rem 1rem' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button
              style={{ ...btn, padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
              onClick={() => setShowEdit(true)}
              aria-label={`Edit service ${svc.name}`}
            >
              ✏ Edit
            </button>
            <button style={dangerBtn} onClick={onDelete} aria-label={`Delete service ${svc.name}`}>
              Remove
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)' }}>
          <td colSpan={colSpan} style={{ padding: '0.75rem 1.5rem 1rem' }}>
            {fields.length === 0 ? (
              <span style={{ fontSize: '0.78rem', color: 'var(--vn-text-muted)' }}>No config fields for this service type.</span>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem 1.5rem' }}>
                {fields.map(f => {
                  const val = cfg[f.key];
                  return (
                    <div key={f.key} style={{ fontSize: '0.78rem' }}>
                      <span style={{ color: 'var(--vn-text-muted)', fontWeight: 500 }}>{f.label}: </span>
                      <span style={{ color: val ? 'var(--vn-text)' : 'var(--vn-text-muted)', fontFamily: f.key.includes('url') ? 'monospace' : undefined, fontStyle: val ? 'normal' : 'italic' }}>
                        {val || '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ marginTop: '0.5rem' }}>
              <button
                onClick={e => { e.stopPropagation(); setShowEdit(true); }}
                style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface)', color: 'var(--vn-text)' }}
              >
                ✏ Edit Config
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Add service modal ────────────────────────────────────────── */
function AddServiceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('node');
  const [vmName, setVmName] = useState('');
  const [datacenter, setDatacenter] = useState('');
  const [chainId, setChainId] = useState('');
  const [configFields, setConfigFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  const setField = (key: string, val: string) =>
    setConfigFields(prev => ({ ...prev, [key]: val }));

  const mut = useMutation({
    mutationFn: () => createService({
      name,
      service_type: serviceType,
      vm_name: vmName,
      datacenter,
      chain_id: chainId,
      config: Object.fromEntries(Object.entries(configFields).filter(([, v]) => v !== '')),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modal: React.CSSProperties = {
    background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)',
    padding: '2rem', width: 460, maxWidth: '95vw', maxHeight: '90vh',
    overflowY: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
  };
  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.85rem' };
  const labelStyle: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--vn-text-muted)', fontWeight: 500 };
  const inputStyle: React.CSSProperties = {
    padding: '0.45rem 0.75rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)',
    background: 'var(--vn-surface)', color: 'var(--vn-text)', fontSize: '0.875rem',
  };

  const extraFields = TYPE_FIELDS[serviceType] ?? [];

  return (
    <div style={overlay} role="dialog" aria-modal aria-label="Add service">
      <div style={modal}>
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.1rem', color: 'var(--vn-text)' }}>Add Service</h2>

        {/* Core fields */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Service name *</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. chihuahua-validator" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Service type *</label>
          <select style={inputStyle} value={serviceType} onChange={e => { setServiceType(e.target.value as ServiceType); setConfigFields({}); }}>
            {SERVICE_TYPES.map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Running on VM</label>
          <input style={inputStyle} value={vmName} onChange={e => setVmName(e.target.value)} placeholder="e.g. chihuahua" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Datacenter</label>
          <input style={inputStyle} value={datacenter} onChange={e => setDatacenter(e.target.value)} placeholder="e.g. QC-BHE1" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Chain ID</label>
          <input style={inputStyle} value={chainId} onChange={e => setChainId(e.target.value)} placeholder="e.g. chihuahua-1" />
        </div>

        {/* Type-specific config fields */}
        {extraFields.length > 0 && (
          <>
            <hr style={{ margin: '0.75rem 0', borderColor: 'var(--vn-border)' }} />
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--vn-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              {typeLabel[serviceType]} configuration
            </p>
            {serviceType === 'validator' && chainId && (
              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--vn-surface-2)', padding: '0.5rem 0.75rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>Auto-fill from cosmos.directory</span>
                <button
                  type="button"
                  style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface)', color: 'var(--vn-text)' }}
                  onClick={async () => {
                    try {
                      const res = await fetch(`https://cosmos.directory/${chainId.toLowerCase()}/chain`);
                      if (!res.ok) return;
                      const d = await res.json();
                      const rpcs: Array<{ address: string }> = d?.chain?.apis?.rpc ?? [];
                      if (rpcs.length > 0) {
                        setConfigFields(prev => ({ ...prev, ref_rpc_url: rpcs[0].address }));
                      }
                      const explorers: Array<{ url: string }> = d?.chain?.explorers ?? [];
                      if (explorers.length > 0 && !configFields.preferred_explorer) {
                        setConfigFields(prev => ({ ...prev, preferred_explorer: explorers[0].url }));
                      }
                    } catch { /* ignore network errors */ }
                  }}
                >
                  ↓ Fetch RPC + Explorer
                </button>
              </div>
            )}
            {extraFields.map(f => (
              <div key={f.key} style={fieldStyle}>
                <label style={labelStyle}>
                  {f.label}{f.required ? ' *' : ''}
                  {f.hint && <span style={{ fontWeight: 400, marginLeft: 4 }}>— {f.hint}</span>}
                </label>
                {f.inputType === 'select' ? (
                  <select style={inputStyle} value={configFields[f.key] ?? ''} onChange={e => setField(f.key, e.target.value)}>
                    <option value="">— select —</option>
                    {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    style={inputStyle}
                    value={configFields[f.key] ?? ''}
                    onChange={e => setField(f.key, e.target.value)}
                    placeholder={f.placeholder ?? ''}
                  />
                )}
              </div>
            ))}
          </>
        )}

        {err && <p style={{ color: 'var(--vn-danger)', fontSize: '0.8rem', margin: '0 0 1rem' }}>{err}</p>}

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button style={btn} onClick={onClose}>Cancel</button>
          <button style={primaryBtn} disabled={!name || mut.isPending}
            onClick={() => { setErr(''); mut.mutate(); }}>
            {mut.isPending ? 'Saving…' : 'Add Service'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────── */
export default function ServicesPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['services'],
    queryFn: getServices,
    refetchInterval: 30_000,
  });

  const delMut = useMutation({
    mutationFn: (id: number) => deleteService(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });

  const services = data?.services ?? [];
  const online = services.filter(s => s.state === 'online').length;
  const down = services.filter(s => s.state === 'down').length;

  return (
    <div>
      <header style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--vn-text)' }}>Services</h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>
            Registered services across your infrastructure
          </p>
        </div>
        <button style={primaryBtn} onClick={() => setShowAdd(true)}>+ Add Service</button>
      </header>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total', value: services.length, color: 'var(--vn-info)' },
          { label: 'Online', value: online, color: 'var(--vn-success)' },
          { label: 'Down', value: down, color: 'var(--vn-danger)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ ...card, padding: '0.75rem 1.25rem', minWidth: 90 }}>
            <span style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{value}</span>
            <div style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>{label}</div>
          </div>
        ))}
      </div>

      {isLoading && <Spinner />}

      {error && (
        <p role="alert" style={{ color: 'var(--vn-danger)', fontSize: '0.875rem' }}>
          Failed to load services.
        </p>
      )}

      {!isLoading && services.length === 0 && !error && (
        <div style={{ ...card, textAlign: 'center', padding: '3rem', color: 'var(--vn-text-muted)' }}>
          <p style={{ margin: '0 0 1rem' }}>No services registered yet.</p>
          <button style={primaryBtn} onClick={() => setShowAdd(true)}>Register your first service</button>
        </div>
      )}

      {services.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--vn-surface-2)', borderBottom: '1px solid var(--vn-border)' }}>
                  {['Name', 'Type', 'VM', 'Chain', 'Status', 'Sync ETA', 'Updated', ''].map(h => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--vn-text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {services.map(svc => (
                  <ServiceRow
                    key={svc.id}
                    svc={svc}
                    onDelete={() => { if (confirm(`Remove service "${svc.name}"?`)) delMut.mutate(svc.id); }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAdd && <AddServiceModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
