import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getVMHosts,
  getVMDomains,
  vmDomainAction,
  getVMSnapshots,
  createVMSnapshot,
  revertVMSnapshot,
  deleteVMSnapshot,
} from '../api';
import type { HypervisorHost, LibvirtDomain, LibvirtSnapshot } from '../api/types';
import Spinner from '../components/Spinner';

/* ── Styles ───────────────────────────────────────────────────── */
const card: React.CSSProperties = {
  background: 'var(--vn-surface)',
  border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)',
  padding: '1.25rem',
  marginBottom: '1.25rem',
};

const btn: React.CSSProperties = {
  cursor: 'pointer',
  border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)',
  padding: '0.3rem 0.75rem',
  fontSize: '0.8rem',
  fontWeight: 500,
  background: 'var(--vn-surface)',
  color: 'var(--vn-text)',
  transition: 'background 0.12s',
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

/* ── State badge ──────────────────────────────────────────────── */
function StateBadge({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    running: 'var(--vn-success)',
    'shut off': 'var(--vn-text-muted)',
    paused: 'var(--vn-warning)',
    crashed: 'var(--vn-danger)',
  };
  const color = colorMap[state] ?? 'var(--vn-text-muted)';
  return (
    <span
      style={{
        fontSize: '0.7rem',
        padding: '0.15rem 0.5rem',
        borderRadius: 99,
        background: color + '22',
        color,
        border: `1px solid ${color}44`,
        fontWeight: 600,
        textTransform: 'capitalize',
        whiteSpace: 'nowrap',
      }}
    >
      {state}
    </span>
  );
}

/* ── Memory formatter ─────────────────────────────────────────── */
function fmtMem(kib: number) {
  if (kib === 0) return '—';
  const gib = kib / 1024 / 1024;
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;
  return `${(kib / 1024).toFixed(0)} MiB`;
}

/* ── Snapshot Panel ───────────────────────────────────────────── */
function SnapshotPanel({ host, domain }: { host: string; domain: string }) {
  const qc = useQueryClient();
  const [newSnapName, setNewSnapName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['vm-snapshots', host, domain],
    queryFn: () => getVMSnapshots(host, domain),
    staleTime: 30_000,
  });

  const snaps: LibvirtSnapshot[] = data?.snapshots ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['vm-snapshots', host, domain] });

  const doCreate = async () => {
    const name = newSnapName.trim();
    if (!name) return;
    setBusy('create');
    setMsg('');
    try {
      await createVMSnapshot(host, domain, name);
      setNewSnapName('');
      setMsg(`✓ Snapshot "${name}" created`);
      invalidate();
    } catch (e: unknown) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const doRevert = async (snap: string) => {
    setBusy(`revert-${snap}`);
    setMsg('');
    try {
      await revertVMSnapshot(host, domain, snap);
      setMsg(`✓ Reverted to "${snap}"`);
    } catch (e: unknown) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (snap: string) => {
    setBusy(`delete-${snap}`);
    setMsg('');
    try {
      await deleteVMSnapshot(host, domain, snap);
      setMsg(`✓ Snapshot "${snap}" deleted`);
      setConfirmDelete(null);
      invalidate();
    } catch (e: unknown) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--vn-border)', paddingTop: '0.75rem' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--vn-text-muted)' }}>
        Snapshots
      </div>

      {/* Create */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <input
          value={newSnapName}
          onChange={e => setNewSnapName(e.target.value)}
          placeholder="snap-name"
          style={{
            flex: 1, padding: '0.3rem 0.5rem', fontSize: '0.8rem',
            borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)',
            background: 'var(--vn-surface-2)', color: 'var(--vn-text)',
          }}
          onKeyDown={e => e.key === 'Enter' && doCreate()}
        />
        <button style={primaryBtn} onClick={doCreate} disabled={busy === 'create' || !newSnapName.trim()} type="button">
          {busy === 'create' ? '…' : '+ Create'}
        </button>
      </div>

      {msg && (
        <div style={{ fontSize: '0.75rem', marginBottom: '0.4rem', color: msg.startsWith('✓') ? 'var(--vn-success)' : 'var(--vn-danger)' }}>
          {msg}
        </div>
      )}

      {isLoading ? <Spinner /> : snaps.length === 0 ? (
        <p style={{ fontSize: '0.75rem', color: 'var(--vn-text-subtle)', margin: 0 }}>No snapshots.</p>
      ) : (
        <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
          <tbody>
            {snaps.map(s => (
              <tr key={s.name} style={{ borderTop: '1px solid var(--vn-border)' }}>
                <td style={{ padding: '0.3rem 0', fontFamily: 'monospace' }}>{s.name}</td>
                <td style={{ padding: '0.3rem 0', textAlign: 'right' }}>
                  {confirmDelete === s.name ? (
                    <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                      <button style={dangerBtn} onClick={() => doDelete(s.name)} disabled={busy === `delete-${s.name}`} type="button">
                        {busy === `delete-${s.name}` ? '…' : 'Confirm Delete'}
                      </button>
                      <button style={btn} onClick={() => setConfirmDelete(null)} type="button">Cancel</button>
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                      <button style={btn} onClick={() => doRevert(s.name)} disabled={!!busy} type="button">
                        {busy === `revert-${s.name}` ? '…' : 'Revert'}
                      </button>
                      <button style={{ ...btn, color: 'var(--vn-danger)' }} onClick={() => setConfirmDelete(s.name)} type="button">✕</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Domain Card ──────────────────────────────────────────────── */
function DomainCard({ host, domain }: { host: string; domain: LibvirtDomain }) {
  const [showSnaps, setShowSnaps] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const qc = useQueryClient();

  const doAction = async (action: string) => {
    setActionBusy(action);
    setActionMsg('');
    try {
      const res = await vmDomainAction(host, domain.name, action);
      setActionMsg(`✓ ${res.result || action}`);
      // Refresh domain list after state change.
      setTimeout(() => qc.invalidateQueries({ queryKey: ['vm-domains', host] }), 1500);
    } catch (e: unknown) {
      setActionMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionBusy(null);
    }
  };

  const isRunning = domain.state === 'running';
  const isPaused = domain.state === 'paused';

  return (
    <div
      style={{
        border: `1px solid ${isRunning ? 'var(--vn-border)' : 'var(--vn-border)'}`,
        borderLeft: `3px solid ${isRunning ? 'var(--vn-success)' : isPaused ? 'var(--vn-warning)' : 'var(--vn-text-subtle)'}`,
        borderRadius: 'var(--vn-radius)',
        padding: '0.875rem',
        background: 'var(--vn-surface-2)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{domain.name}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--vn-text-subtle)', marginTop: '0.1rem', fontFamily: 'monospace' }}>
            {domain.uuid}
          </div>
        </div>
        <StateBadge state={domain.state} />
      </div>

      {/* Specs */}
      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--vn-text-muted)', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span><span style={{ color: 'var(--vn-text-subtle)' }}>vCPU </span>{domain.cpus || '—'}</span>
        <span><span style={{ color: 'var(--vn-text-subtle)' }}>Max </span>{fmtMem(domain.max_mem_kib)}</span>
        <span><span style={{ color: 'var(--vn-text-subtle)' }}>Used </span>{fmtMem(domain.used_mem_kib)}</span>
        {domain.autostart && <span style={{ color: 'var(--vn-success)' }}>⟳ autostart</span>}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        {!isRunning && !isPaused && (
          <button style={primaryBtn} onClick={() => doAction('start')} disabled={!!actionBusy} type="button">
            {actionBusy === 'start' ? '…' : '▶ Start'}
          </button>
        )}
        {isRunning && (
          <>
            <button style={btn} onClick={() => doAction('shutdown')} disabled={!!actionBusy} type="button">
              {actionBusy === 'shutdown' ? '…' : '⏹ Shutdown'}
            </button>
            <button style={btn} onClick={() => doAction('reboot')} disabled={!!actionBusy} type="button">
              {actionBusy === 'reboot' ? '…' : '↺ Reboot'}
            </button>
            <button style={btn} onClick={() => doAction('suspend')} disabled={!!actionBusy} type="button">
              {actionBusy === 'suspend' ? '…' : '⏸ Suspend'}
            </button>
          </>
        )}
        {isPaused && (
          <button style={primaryBtn} onClick={() => doAction('resume')} disabled={!!actionBusy} type="button">
            {actionBusy === 'resume' ? '…' : '▶ Resume'}
          </button>
        )}
        {(isRunning || isPaused) && (
          <button style={dangerBtn} onClick={() => doAction('destroy')} disabled={!!actionBusy} type="button"
            title="Force power-off (may corrupt disk)">
            {actionBusy === 'destroy' ? '…' : '⚡ Force Off'}
          </button>
        )}
        <button
          style={{ ...btn, fontSize: '0.75rem' }}
          onClick={() => setShowSnaps(v => !v)}
          type="button"
        >
          {showSnaps ? 'Hide Snapshots' : 'Snapshots'}
        </button>
      </div>

      {actionMsg && (
        <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: actionMsg.startsWith('✓') ? 'var(--vn-success)' : 'var(--vn-danger)' }}>
          {actionMsg}
        </div>
      )}

      {showSnaps && <SnapshotPanel host={host} domain={domain.name} />}
    </div>
  );
}

/* ── Host Panel ───────────────────────────────────────────────── */
function HostPanel({ host }: { host: HypervisorHost }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['vm-domains', host.name],
    queryFn: () => getVMDomains(host.name),
    staleTime: 30_000,
    retry: false,
  });

  const domains: LibvirtDomain[] = data?.domains ?? [];
  const running = domains.filter(d => d.state === 'running').length;
  const total = domains.length;

  return (
    <div style={card}>
      {/* Host header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            🖥 {host.name}
          </h2>
          <div style={{ fontSize: '0.72rem', color: 'var(--vn-text-subtle)', marginTop: '0.15rem' }}>
            {host.lan_ip && <><code>{host.lan_ip}</code> · </>}
            {host.datacenter && <>{host.datacenter} · </>}
            {!isLoading && !isError && <>{running}/{total} running</>}
          </div>
        </div>
        <button
          style={btn}
          onClick={() => refetch()}
          disabled={isFetching}
          type="button"
          title="Refresh domain list"
        >
          {isFetching ? '…' : '⟳ Refresh'}
        </button>
      </div>

      {isLoading ? <Spinner /> : isError ? (
        <p style={{ color: 'var(--vn-danger)', fontSize: '0.875rem' }}>
          SSH connection failed — check fleet config and SSH key for this host.
        </p>
      ) : domains.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>No domains found on this host.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0.75rem' }}>
          {domains.map(d => (
            <DomainCard key={d.name} host={host.name} domain={d} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── VMs Page ─────────────────────────────────────────────────── */
export default function VMsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['vm-hosts'],
    queryFn: getVMHosts,
    staleTime: 60_000,
  });

  const hosts: HypervisorHost[] = data?.hosts ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>VM Manager</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--vn-text-subtle)' }}>
            Manage libvirt/KVM domains on hypervisor hosts via SSH — virsh commands, snapshots, lifecycle actions.
          </p>
        </div>
      </div>

      {isLoading ? <Spinner /> : isError ? (
        <div style={card}>
          <p style={{ color: 'var(--vn-danger)', margin: 0 }}>Failed to load hypervisor hosts.</p>
        </div>
      ) : hosts.length === 0 ? (
        <div style={card}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>No hypervisor hosts configured</h3>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--vn-text-muted)' }}>
            Add a <code>[host]</code> entry to your <code>config/infra/*.toml</code> file with a <code>lan_ip</code> and{' '}
            <code>user</code> that can reach the hypervisor.
          </p>
          <pre style={{
            marginTop: '0.75rem', fontSize: '0.75rem', background: 'var(--vn-surface-2)',
            borderRadius: 'var(--vn-radius)', padding: '0.75rem', overflow: 'auto',
          }}>{`[[host]]
name       = "hypervisor"
lan_ip     = "10.0.0.1"
user       = "ubuntu"
datacenter = "QC"`}</pre>
        </div>
      ) : (
        hosts.map(h => <HostPanel key={h.name} host={h} />)
      )}
    </div>
  );
}
