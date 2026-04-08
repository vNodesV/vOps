import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getServices, createService, deleteService } from '../api';
import type { Service, ServiceType } from '../api/types';
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

function stateStatus(s: Service): 'online' | 'error' | 'inactive' | 'unknown' {
  if (s.state === 'online') return 'online';
  if (s.state === 'down') return 'error';
  if (s.state === 'unknown') return 'unknown';
  return 'inactive';
}

/* ── Service row ──────────────────────────────────────────────── */
function ServiceRow({ svc, onDelete }: { svc: Service; onDelete: () => void }) {
  const status = stateStatus(svc);
  return (
    <tr style={{ borderBottom: '1px solid var(--vn-border)' }}>
      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--vn-text)' }}>
        {svc.name}
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
      <td style={{ padding: '0.75rem 1rem' }}>
        <Badge status={status} />
      </td>
      <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>
        {svc.updated_at ? new Date(svc.updated_at).toLocaleDateString() : '—'}
      </td>
      <td style={{ padding: '0.75rem 1rem' }}>
        <button style={dangerBtn} onClick={onDelete} aria-label={`Delete service ${svc.name}`}>
          Remove
        </button>
      </td>
    </tr>
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
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: () => createService({ name, service_type: serviceType, vm_name: vmName, datacenter, chain_id: chainId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modal: React.CSSProperties = {
    background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)',
    padding: '2rem', minWidth: 400, maxWidth: '90vw', boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
  };
  const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '1rem' };
  const label: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--vn-text-muted)', fontWeight: 500 };
  const input: React.CSSProperties = {
    padding: '0.45rem 0.75rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)',
    background: 'var(--vn-surface)', color: 'var(--vn-text)', fontSize: '0.875rem',
  };

  return (
    <div style={overlay} role="dialog" aria-modal aria-label="Add service">
      <div style={modal}>
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.1rem', color: 'var(--vn-text)' }}>Add Service</h2>

        <div style={field}>
          <label style={label}>Service name *</label>
          <input style={input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. chihuahua-validator" />
        </div>
        <div style={field}>
          <label style={label}>Service type *</label>
          <select style={input} value={serviceType} onChange={e => setServiceType(e.target.value as ServiceType)}>
            {SERVICE_TYPES.map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}
          </select>
        </div>
        <div style={field}>
          <label style={label}>Running on VM</label>
          <input style={input} value={vmName} onChange={e => setVmName(e.target.value)} placeholder="e.g. chihuahua" />
        </div>
        <div style={field}>
          <label style={label}>Datacenter</label>
          <input style={input} value={datacenter} onChange={e => setDatacenter(e.target.value)} placeholder="e.g. QC-BHE1" />
        </div>
        <div style={field}>
          <label style={label}>Chain ID</label>
          <input style={input} value={chainId} onChange={e => setChainId(e.target.value)} placeholder="e.g. chihuahua-1" />
        </div>

        {err && <p style={{ color: 'var(--vn-danger)', fontSize: '0.8rem', margin: '0 0 1rem' }}>{err}</p>}

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: 'var(--vn-surface-2)', borderBottom: '1px solid var(--vn-border)' }}>
                {['Name', 'Type', 'VM', 'Chain', 'Status', 'Updated', ''].map(h => (
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
      )}

      {showAdd && <AddServiceModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
