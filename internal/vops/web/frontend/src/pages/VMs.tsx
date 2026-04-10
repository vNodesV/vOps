import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getVMHosts, getVMDomains, vmDomainAction, getVMSnapshots, createVMSnapshot,
  revertVMSnapshot, deleteVMSnapshot, createVM,
  getFleetChains, getServices, getRegisteredChains, registerChain, unregisterChain,
  createService, deleteService, getServiceETA, updateService,
  getFleetVMs, getDeployments, forcePoll, getVMStatus, vmUpgradeURL, getVMHistory, deployFleet,
  getHosts, scanHosts, scanAllVMs, hostUpgradeURL,
} from '../api';
import type {
  HypervisorHost, LibvirtDomain, LibvirtSnapshot,
  ChainStatus, RegisteredChain, Service, ServiceType, ServiceETA,
  VMView, Deployment, VMStatus, VMMetricPoint,
  HostInventory,
} from '../api/types';
import { openSSEStream } from '../api/sse';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import UpgradeModal from '../components/UpgradeModal';

/* ═══════════════════════════════════════════════════════════════
   Shared styles
   ═══════════════════════════════════════════════════════════════ */

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

/* ── Fleet-specific styles ────────────────────────────────────── */

const fleetBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.375rem',
  padding: '0.4rem 0.85rem',
  border: 'none',
  borderRadius: 'var(--vn-radius)',
  background: 'var(--vn-primary)',
  color: 'var(--vn-on-primary)',
  fontSize: '0.8rem',
  fontWeight: 500,
  cursor: 'pointer',
};

const fleetTable: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
};

const fleetTh: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '0.75rem',
  color: 'var(--vn-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--vn-border)',
};

const fleetTd: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--vn-border)',
  color: 'var(--vn-text)',
};

const fleetInputStyle: React.CSSProperties = {
  padding: '0.4rem 0.65rem',
  border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)',
  background: 'var(--vn-surface-2)',
  color: 'var(--vn-text)',
  fontSize: '0.875rem',
};

/* ── Chains / Services styles ─────────────────────────────────── */

const sectionTitle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--vn-text)',
  letterSpacing: '-0.01em',
};

const thStyle: React.CSSProperties = {
  padding: '0.6rem 1rem',
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--vn-text-muted)',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  fontSize: '0.8375rem',
  color: 'var(--vn-text)',
  verticalAlign: 'middle',
};

/* ═══════════════════════════════════════════════════════════════
   Shared service data
   ═══════════════════════════════════════════════════════════════ */

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

const SERVICE_TYPES: ServiceType[] = [
  'validator', 'api', 'rpc', 'node', 'relayer', 'webserver', 'vprox', 'other',
];

const ETA_TYPES = new Set<ServiceType>(['validator', 'api', 'rpc', 'node', 'relayer']);

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

/* ═══════════════════════════════════════════════════════════════
   VMs Tab Components
   ═══════════════════════════════════════════════════════════════ */

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

function fmtMem(kib: number) {
  if (kib === 0) return '\u2014';
  const gib = kib / 1024 / 1024;
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;
  return `${(kib / 1024).toFixed(0)} MiB`;
}

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
      setMsg(`\u2713 Snapshot "${name}" created`);
      invalidate();
    } catch (e: unknown) {
      setMsg(`\u2717 ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const doRevert = async (snap: string) => {
    setBusy(`revert-${snap}`);
    setMsg('');
    try {
      await revertVMSnapshot(host, domain, snap);
      setMsg(`\u2713 Reverted to "${snap}"`);
    } catch (e: unknown) {
      setMsg(`\u2717 ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (snap: string) => {
    setBusy(`delete-${snap}`);
    setMsg('');
    try {
      await deleteVMSnapshot(host, domain, snap);
      setMsg(`\u2713 Snapshot "${snap}" deleted`);
      setConfirmDelete(null);
      invalidate();
    } catch (e: unknown) {
      setMsg(`\u2717 ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--vn-border)', paddingTop: '0.75rem' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--vn-text-muted)' }}>
        Snapshots
      </div>

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
          {busy === 'create' ? '\u2026' : '+ Create'}
        </button>
      </div>

      {msg && (
        <div style={{ fontSize: '0.75rem', marginBottom: '0.4rem', color: msg.startsWith('\u2713') ? 'var(--vn-success)' : 'var(--vn-danger)' }}>
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
                        {busy === `delete-${s.name}` ? '\u2026' : 'Confirm Delete'}
                      </button>
                      <button style={btn} onClick={() => setConfirmDelete(null)} type="button">Cancel</button>
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                      <button style={btn} onClick={() => doRevert(s.name)} disabled={!!busy} type="button">
                        {busy === `revert-${s.name}` ? '\u2026' : 'Revert'}
                      </button>
                      <button style={{ ...btn, color: 'var(--vn-danger)' }} onClick={() => setConfirmDelete(s.name)} type="button">\u2715</button>
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
      setActionMsg(`\u2713 ${res.result || action}`);
      setTimeout(() => qc.invalidateQueries({ queryKey: ['vm-domains', host] }), 1500);
    } catch (e: unknown) {
      setActionMsg(`\u2717 ${e instanceof Error ? e.message : String(e)}`);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{domain.name}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--vn-text-subtle)', marginTop: '0.1rem', fontFamily: 'monospace' }}>
            {domain.uuid}
          </div>
        </div>
        <StateBadge state={domain.state} />
      </div>

      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--vn-text-muted)', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span><span style={{ color: 'var(--vn-text-subtle)' }}>vCPU </span>{domain.cpus || '\u2014'}</span>
        <span><span style={{ color: 'var(--vn-text-subtle)' }}>Max </span>{fmtMem(domain.max_mem_kib)}</span>
        <span><span style={{ color: 'var(--vn-text-subtle)' }}>Used </span>{fmtMem(domain.used_mem_kib)}</span>
        {domain.autostart && <span style={{ color: 'var(--vn-success)' }}>\u27f3 autostart</span>}
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        {!isRunning && !isPaused && (
          <button style={primaryBtn} onClick={() => doAction('start')} disabled={!!actionBusy} type="button">
            {actionBusy === 'start' ? '\u2026' : '\u25b6 Start'}
          </button>
        )}
        {isRunning && (
          <>
            <button style={btn} onClick={() => doAction('shutdown')} disabled={!!actionBusy} type="button">
              {actionBusy === 'shutdown' ? '\u2026' : '\u23f9 Shutdown'}
            </button>
            <button style={btn} onClick={() => doAction('reboot')} disabled={!!actionBusy} type="button">
              {actionBusy === 'reboot' ? '\u2026' : '\u21ba Reboot'}
            </button>
            <button style={btn} onClick={() => doAction('suspend')} disabled={!!actionBusy} type="button">
              {actionBusy === 'suspend' ? '\u2026' : '\u23f8 Suspend'}
            </button>
          </>
        )}
        {isPaused && (
          <button style={primaryBtn} onClick={() => doAction('resume')} disabled={!!actionBusy} type="button">
            {actionBusy === 'resume' ? '\u2026' : '\u25b6 Resume'}
          </button>
        )}
        {(isRunning || isPaused) && (
          <button style={dangerBtn} onClick={() => doAction('destroy')} disabled={!!actionBusy} type="button"
            title="Force power-off (may corrupt disk)">
            {actionBusy === 'destroy' ? '\u2026' : '\u26a1 Force Off'}
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
        <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: actionMsg.startsWith('\u2713') ? 'var(--vn-success)' : 'var(--vn-danger)' }}>
          {actionMsg}
        </div>
      )}

      {showSnaps && <SnapshotPanel host={host} domain={domain.name} />}
    </div>
  );
}

function HostPanel({ host, search }: { host: HypervisorHost; search?: string }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['vm-domains', host.name],
    queryFn: () => getVMDomains(host.name),
    staleTime: 30_000,
    retry: false,
  });

  const allDomains: LibvirtDomain[] = data?.domains ?? [];
  const domains = search
    ? allDomains.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))
    : allDomains;
  const running = allDomains.filter(d => d.state === 'running').length;
  const total = allDomains.length;

  return (
    <div style={{ ...card, marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            \ud83d\udda5 {host.name}
          </h2>
          <div style={{ fontSize: '0.72rem', color: 'var(--vn-text-subtle)', marginTop: '0.15rem' }}>
            {host.lan_ip && <><code>{host.lan_ip}</code> \u00b7 </>}
            {host.datacenter && <>{host.datacenter} \u00b7 </>}
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
          {isFetching ? '\u2026' : '\u27f3 Refresh'}
        </button>
      </div>

      {isLoading ? <Spinner /> : isError ? (
        <p style={{ color: 'var(--vn-danger)', fontSize: '0.875rem' }}>
          SSH connection failed \u2014 check fleet config and SSH key for this host.
        </p>
      ) : domains.length === 0 && search ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>No VMs match \u201c{search}\u201d.</p>
      ) : domains.length === 0 ? (
        <div style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>
          <p style={{ margin: '0 0 0.5rem' }}>No VMs found on this hypervisor.</p>
          <p style={{ margin: 0, fontSize: '0.8rem' }}>
            This can mean: (a) no VMs are defined yet \u2014 use <strong>+ Create VM</strong> to deploy one,
            or (b) the SSH connection to libvirtd failed. Verify with:{' '}
            <code style={{ background: 'var(--vn-surface-2)', padding: '0.1rem 0.3rem', borderRadius: 3 }}>ssh user@host virsh list --all</code>
          </p>
        </div>
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

function CreateVMModal({ hosts, onClose }: { hosts: HypervisorHost[]; onClose: () => void }) {
  const [mode, setMode] = useState<'clone' | 'create'>('clone');
  const [host, setHost] = useState(hosts[0]?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const [sourceDomain, setSourceDomain] = useState('');
  const [newDiskPath, setNewDiskPath] = useState('');
  const [baseImage, setBaseImage] = useState('');
  const [diskPath, setDiskPath] = useState('');
  const [diskSizeGb, setDiskSizeGb] = useState(20);
  const [osVariant, setOsVariant] = useState('ubuntu22.04');
  const [network, setNetwork] = useState('default');
  const [vmName, setVmName] = useState('');
  const [memMib, setMemMib] = useState(2048);
  const [vcpus, setVcpus] = useState(2);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult('');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = { mode, name: vmName, memory_mib: memMib, vcpus };
      if (mode === 'clone') {
        body.source_domain = sourceDomain;
        body.new_disk_path = newDiskPath;
      } else {
        body.base_image = baseImage;
        body.disk_path = diskPath;
        body.disk_size_gb = diskSizeGb;
        body.os_variant = osVariant;
        body.network = network;
      }
      const r = await createVM(host, body);
      setResult('\u2713 ' + (r.result ?? 'Done'));
    } catch (err: unknown) {
      setResult('\u2717 ' + String(err));
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
    borderRadius: 'var(--vn-radius)', padding: '1.5rem', width: '480px', maxWidth: '95vw',
  };
  const fld: React.CSSProperties = { marginBottom: '0.75rem' };
  const lbl: React.CSSProperties = { display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem', color: 'var(--vn-text-muted)' };
  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '0.35rem 0.5rem',
    background: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)',
    borderRadius: 'var(--vn-radius)', color: 'var(--vn-text)', fontSize: '0.85rem',
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <strong style={{ fontSize: '1rem' }}>Create / Clone VM</strong>
          <button style={btn} onClick={onClose}>\u2715</button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {(['clone', 'create'] as const).map(m => (
            <button key={m} style={{ ...btn, ...(mode === m ? { background: 'var(--vn-primary)', color: 'var(--vn-on-primary)', border: 'none' } : {}) }}
              onClick={() => setMode(m)}>{m === 'clone' ? '\ud83d\udccb Clone' : '\u2795 Create'}</button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={fld}>
            <label style={lbl}>Hypervisor host</label>
            <select style={inp} value={host} onChange={e => setHost(e.target.value)}>
              {hosts.map(h => <option key={h.name} value={h.name}>{h.name}</option>)}
            </select>
          </div>
          <div style={fld}>
            <label style={lbl}>VM name</label>
            <input style={inp} value={vmName} onChange={e => setVmName(e.target.value)} placeholder="my-vm-01" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={lbl}>Memory (MiB)</label>
              <input style={inp} type="number" value={memMib} onChange={e => setMemMib(+e.target.value)} min={512} step={512} />
            </div>
            <div>
              <label style={lbl}>vCPUs</label>
              <input style={inp} type="number" value={vcpus} onChange={e => setVcpus(+e.target.value)} min={1} />
            </div>
          </div>

          {mode === 'clone' ? (<>
            <div style={fld}>
              <label style={lbl}>Source domain (to clone from)</label>
              <input style={inp} value={sourceDomain} onChange={e => setSourceDomain(e.target.value)} placeholder="source-vm" required />
            </div>
            <div style={fld}>
              <label style={lbl}>New disk path</label>
              <input style={inp} value={newDiskPath} onChange={e => setNewDiskPath(e.target.value)} placeholder="/var/lib/libvirt/images/my-vm-01.qcow2" />
            </div>
          </>) : (<>
            <div style={fld}>
              <label style={lbl}>Base image path</label>
              <input style={inp} value={baseImage} onChange={e => setBaseImage(e.target.value)} placeholder="/var/lib/libvirt/images/ubuntu-22.04-base.qcow2" required />
            </div>
            <div style={fld}>
              <label style={lbl}>New disk path</label>
              <input style={inp} value={diskPath} onChange={e => setDiskPath(e.target.value)} placeholder="/var/lib/libvirt/images/my-vm-01.qcow2" required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={lbl}>Disk size (GB)</label>
                <input style={inp} type="number" value={diskSizeGb} onChange={e => setDiskSizeGb(+e.target.value)} min={5} />
              </div>
              <div>
                <label style={lbl}>Network</label>
                <input style={inp} value={network} onChange={e => setNetwork(e.target.value)} placeholder="default" />
              </div>
            </div>
            <div style={fld}>
              <label style={lbl}>OS variant (virt-install)</label>
              <input style={inp} value={osVariant} onChange={e => setOsVariant(e.target.value)} placeholder="ubuntu22.04" />
            </div>
          </>)}

          {result && (
            <p style={{ fontSize: '0.8rem', color: result.startsWith('\u2713') ? 'var(--vn-success)' : 'var(--vn-danger)', margin: '0.5rem 0' }}>{result}</p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="button" style={btn} onClick={onClose}>Cancel</button>
            <button type="submit" style={primaryBtn} disabled={busy}>{busy ? '\u2026' : mode === 'clone' ? 'Clone VM' : 'Create VM'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function VMsTabContent() {
  const [showCreate, setShowCreate] = useState(false);
  const [hostFilter, setHostFilter] = useState('');
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('filter') ?? '');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['vm-hosts'],
    queryFn: getVMHosts,
    staleTime: 60_000,
  });

  const hosts: HypervisorHost[] = data?.hosts ?? [];
  const visibleHosts = hostFilter ? hosts.filter(h => h.name === hostFilter) : hosts;

  return (
    <div>
      {showCreate && <CreateVMModal hosts={hosts} onClose={() => setShowCreate(false)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>VM Manager</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--vn-text-subtle)' }}>
            Manage libvirt/KVM domains on hypervisor hosts via SSH \u2014 virsh commands, snapshots, lifecycle actions.
          </p>
        </div>
        {hosts.length > 0 && (
          <button style={primaryBtn} onClick={() => setShowCreate(true)}>+ Create VM</button>
        )}
      </div>

      {hosts.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <select
            value={hostFilter}
            onChange={e => setHostFilter(e.target.value)}
            style={{
              padding: '0.35rem 0.6rem', fontSize: '0.8rem', borderRadius: 'var(--vn-radius)',
              border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)',
              color: 'var(--vn-text)', cursor: 'pointer',
            }}
            aria-label="Filter by host"
          >
            <option value="">All hosts</option>
            {hosts.map(h => <option key={h.name} value={h.name}>{h.name}{h.datacenter ? ` (${h.datacenter})` : ''}</option>)}
          </select>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search VM name\u2026"
            style={{
              padding: '0.35rem 0.6rem', fontSize: '0.8rem', borderRadius: 'var(--vn-radius)',
              border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)',
              color: 'var(--vn-text)', minWidth: 180,
            }}
            aria-label="Search VM by name"
          />
          {(hostFilter || search) && (
            <button
              onClick={() => { setHostFilter(''); setSearch(''); }}
              style={{
                padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: 'var(--vn-radius)',
                border: '1px solid var(--vn-border)', background: 'var(--vn-surface)',
                color: 'var(--vn-text-muted)', cursor: 'pointer',
              }}
            >
              \u2715 Clear
            </button>
          )}
        </div>
      )}

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
        visibleHosts.map(h => <HostPanel key={h.name} host={h} search={search} />)
      )}
    </div>
  );
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   Chains Tab Components
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

function fmtBlockSpeed(sec?: number): string {
  if (!sec || sec <= 0) return '—';
  return `${sec.toFixed(2)}s`;
}

function fmtHeight(h: number): string {
  return h > 0 ? h.toLocaleString() : '—';
}

/* ── Upgrade Plan Modal ───────────────────────────────────────── */
function UpgradePlanModal({ chain, onClose }: { chain: ChainStatus; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)', padding: '1.5rem', minWidth: 340, maxWidth: 500, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>⬆ Upgrade Plan — {chain.chain_name ?? chain.chain}</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <tbody>
            <tr><td style={{ padding: '0.3rem 0.5rem', color: 'var(--vn-text-muted)' }}>Upgrade Name</td><td style={{ fontWeight: 600 }}>{chain.upgrade_name}</td></tr>
            {chain.upgrade_height && <tr><td style={{ padding: '0.3rem 0.5rem', color: 'var(--vn-text-muted)' }}>Upgrade Height</td><td style={{ fontVariantNumeric: 'tabular-nums' }}>{chain.upgrade_height.toLocaleString()}</td></tr>}
            <tr><td style={{ padding: '0.3rem 0.5rem', color: 'var(--vn-text-muted)' }}>Current Height</td><td style={{ fontVariantNumeric: 'tabular-nums' }}>{chain.height > 0 ? chain.height.toLocaleString() : '—'}</td></tr>
            {chain.upgrade_height && chain.height > 0 && (
              <tr>
                <td style={{ padding: '0.3rem 0.5rem', color: 'var(--vn-text-muted)' }}>Blocks Remaining</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--vn-warning)' }}>
                  {(chain.upgrade_height - chain.height).toLocaleString()}
                  {chain.avg_block_sec ? ` (~${Math.round((chain.upgrade_height - chain.height) * chain.avg_block_sec / 60)} min)` : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.4rem 1rem', fontSize: '0.82rem', borderRadius: 'var(--vn-radius)',
              background: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)', cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Chains table row ─────────────────────────────────────────── */
function ChainRow({ chain, isRegistered, onRemove, onEdit }: { chain: ChainStatus; isRegistered: boolean; onRemove: () => void; onEdit: () => void }) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const syncStatus = chain.error ? 'error' : chain.catching_up ? 'syncing' : 'synced';
  const hasUpgrade = chain.upgrade_pending && chain.upgrade_name;

  return (
    <tr style={{ borderBottom: '1px solid var(--vn-border)' }}>
      {/* Chain ID */}
      <td style={tdStyle}>
        <div style={{ fontWeight: 600, color: 'var(--vn-text)' }}>
          {chain.chain_name ?? chain.chain}
        </div>
        {chain.chain_id && (
          <div style={{ fontSize: '0.72rem', color: 'var(--vn-text-muted)', marginTop: 1 }}>
            {chain.chain_id}
          </div>
        )}
      </td>

      {/* Latest Height */}
      <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
        {fmtHeight(chain.height)}
      </td>

      {/* Block Speed */}
      <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums', color: 'var(--vn-text-muted)' }}>
        {fmtBlockSpeed(chain.avg_block_sec)}
      </td>

      {/* Pending Proposals */}
      <td style={tdStyle}>
        {chain.active_proposals > 0 ? (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: 'rgba(230,73,128,0.12)',
            color: 'var(--vn-accent)',
            borderRadius: '1rem',
            padding: '0.15rem 0.6rem',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}>
            {chain.active_proposals} pending
          </span>
        ) : (
          <span style={{ color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>—</span>
        )}
      </td>

      {/* Upgrade */}
      <td style={tdStyle}>
        {showUpgrade && <UpgradePlanModal chain={chain} onClose={() => setShowUpgrade(false)} />}
        {hasUpgrade ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              background: 'rgba(255,167,38,0.12)',
              color: 'var(--vn-warning)',
              borderRadius: '1rem',
              padding: '0.15rem 0.6rem',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}>
              ⚡ {chain.upgrade_name}
              {chain.upgrade_height ? ` @${chain.upgrade_height.toLocaleString()}` : ''}
            </span>
            <button
              onClick={() => setShowUpgrade(true)}
              title="View upgrade plan details"
              style={{
                padding: '0.1rem 0.5rem', fontSize: '0.7rem', borderRadius: 'var(--vn-radius)',
                border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)',
                color: 'var(--vn-text)', cursor: 'pointer',
              }}
            >
              🔍 Plan
            </button>
          </div>
        ) : (
          <span style={{ color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>—</span>
        )}
      </td>

      {/* Validator */}
      <td style={tdStyle}>
        {chain.has_validator ? (
          <Badge status={chain.val_jailed ? 'jailed' : chain.val_bonded ? 'active' : 'inactive'} />
        ) : (
          <span style={{ color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>—</span>
        )}
      </td>

      {/* Status */}
      <td style={tdStyle}>
        <Badge status={syncStatus} />
        {chain.error && (
          <div style={{ fontSize: '0.7rem', color: 'var(--vn-danger)', marginTop: 3 }}>
            {chain.error}
          </div>
        )}
      </td>

      {/* Actions */}
      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
        <button
          onClick={onEdit}
          title={isRegistered ? 'Edit registered chain' : 'Register this chain for external monitoring'}
          style={{
            padding: '0.2rem 0.55rem', fontSize: '0.72rem', borderRadius: 'var(--vn-radius)',
            border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)',
            color: 'var(--vn-text)', cursor: 'pointer', marginRight: '0.35rem',
          }}
        >
          {isRegistered ? '✏ Edit' : '＋ Register'}
        </button>
        {isRegistered && (
          <button
            onClick={() => {
              if (window.confirm(`Remove chain "${chain.chain_name ?? chain.chain}" from registered list?`)) onRemove();
            }}
            title="Remove registered chain"
            style={{
              padding: '0.2rem 0.55rem', fontSize: '0.72rem', borderRadius: 'var(--vn-radius)',
              border: '1px solid var(--vn-danger)', background: 'rgba(239,68,68,0.08)',
              color: 'var(--vn-danger)', cursor: 'pointer',
            }}
          >
            ✕ Remove
          </button>
        )}
      </td>
    </tr>
  );
}

/* ── Services flat list row ───────────────────────────────────── */
/* ── Edit Chain Modal ────────────────────────────────────────── */
function EditChainModal({
  chain,
  initialRpcUrl,
  onClose,
  onSave,
}: {
  chain: ChainStatus;
  initialRpcUrl: string;
  onClose: () => void;
  onSave: (rpcUrl: string) => void;
}) {
  const [rpcUrl, setRpcUrl] = useState(initialRpcUrl);
  const [err, setErr] = useState('');

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)', padding: '1.5rem', minWidth: 360, maxWidth: 500, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>✏ Edit Chain — {chain.chain_name ?? chain.chain}</h3>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.78rem', color: 'var(--vn-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
            Chain ID (read-only)
          </label>
          <input
            readOnly
            value={chain.chain}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)',
              borderRadius: 'var(--vn-radius)', padding: '0.4rem 0.6rem',
              color: 'var(--vn-text-muted)', fontSize: '0.85rem',
            }}
          />
        </div>
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ fontSize: '0.78rem', color: 'var(--vn-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
            RPC URL
          </label>
          <input
            value={rpcUrl}
            onChange={e => { setRpcUrl(e.target.value); setErr(''); }}
            placeholder="https://rpc.example.com"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--vn-surface-2)', border: `1px solid ${err ? 'var(--vn-error, #e53e3e)' : 'var(--vn-border)'}`,
              borderRadius: 'var(--vn-radius)', padding: '0.4rem 0.6rem',
              color: 'var(--vn-text)', fontSize: '0.85rem',
            }}
          />
          {err && <div style={{ color: 'var(--vn-error, #e53e3e)', fontSize: '0.75rem', marginTop: '0.25rem' }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.4rem 1rem', fontSize: '0.82rem', borderRadius: 'var(--vn-radius)',
              background: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!rpcUrl.trim()) { setErr('RPC URL is required'); return; }
              onSave(rpcUrl.trim());
            }}
            style={{
              padding: '0.4rem 1rem', fontSize: '0.82rem', borderRadius: 'var(--vn-radius)',
              background: 'var(--vn-primary)', border: 'none',
              color: 'var(--vn-on-primary)', cursor: 'pointer', fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   Services Components
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

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

/* \u2500\u2500 Services Inline Content (embedded in Chains tab) \u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

function ServicesInlineContent() {
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

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   Chains Tab Content (merged Chains + Services)
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

function ChainsTabContent() {
  const queryClient = useQueryClient();

  const [editChain, setEditChain] = useState<ChainStatus | null>(null);

  const chainsQ = useQuery({
    queryKey: ['fleet-chains'],
    queryFn: getFleetChains,
    refetchInterval: 30_000,
  });

  const registeredQ = useQuery({
    queryKey: ['registered-chains'],
    queryFn: getRegisteredChains,
    refetchInterval: 60_000,
  });

  const servicesQ = useQuery({
    queryKey: ['services'],
    queryFn: getServices,
    refetchInterval: 30_000,
  });

  const removeMutation = useMutation({
    mutationFn: (chain: string) => unregisterChain(chain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-chains'] });
      queryClient.invalidateQueries({ queryKey: ['registered-chains'] });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ chain, rpc_url }: { chain: string; rpc_url: string }) =>
      registerChain({ chain, rpc_url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-chains'] });
      queryClient.invalidateQueries({ queryKey: ['registered-chains'] });
      setEditChain(null);
    },
  });

  const chains = chainsQ.data?.chains ?? [];
  const services = servicesQ.data?.services ?? [];
  const registeredMap = new Map<string, RegisteredChain>(
    (registeredQ.data?.registered_chains ?? []).map((r: RegisteredChain) => [r.chain, r])
  );

  const synced = chains.filter(c => !c.catching_up && !c.error).length;
  const catching = chains.filter(c => c.catching_up).length;
  const proposals = chains.reduce((s, c) => s + (c.active_proposals ?? 0), 0);
  const upgrades = chains.filter(c => c.upgrade_pending).length;

  const svcOnline = services.filter(s => s.state === 'online').length;
  const svcDown = services.filter(s => s.state === 'down').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      {/* ── Mutation error banner ───────────────────────────────── */}
      {(removeMutation.isError || editMutation.isError) && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid var(--vn-danger)',
          borderRadius: 'var(--vn-radius)', padding: '0.6rem 1rem',
          color: 'var(--vn-danger)', fontSize: '0.82rem',
        }}>
          {removeMutation.isError && `Remove failed: ${(removeMutation.error as Error)?.message ?? 'unknown error'}`}
          {editMutation.isError && `Save failed: ${(editMutation.error as Error)?.message ?? 'unknown error'}`}
        </div>
      )}

      {/* ── Page header ─────────────────────────────────────────── */}
      <header>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--vn-text)' }}>
          Chains &amp; Services
        </h1>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>
          Cosmos node status and registered services across your infrastructure
        </p>
      </header>

      {/* ── Summary pills ───────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Chains', value: chains.length, color: 'var(--vn-info)' },
          { label: 'Synced', value: synced, color: 'var(--vn-success)' },
          { label: 'Syncing', value: catching, color: 'var(--vn-warning)' },
          { label: 'Proposals', value: proposals, color: proposals > 0 ? 'var(--vn-accent)' : 'var(--vn-text-muted)' },
          { label: 'Upgrades', value: upgrades, color: upgrades > 0 ? 'var(--vn-warning)' : 'var(--vn-text-muted)' },
          { label: 'Services', value: services.length, color: 'var(--vn-primary)' },
          { label: 'Svc Online', value: svcOnline, color: 'var(--vn-success)' },
          { label: 'Svc Down', value: svcDown, color: svcDown > 0 ? 'var(--vn-danger)' : 'var(--vn-text-muted)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            ...card,
            padding: '0.6rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 80,
          }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: '0.68rem', color: 'var(--vn-text-muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ── Section 1: Chains ───────────────────────────────────── */}
      <section aria-label="Chains">
        <h2 style={sectionTitle}>⛓ Chains</h2>

        {chainsQ.isLoading && <Spinner />}

        {chainsQ.error && (
          <p role="alert" style={{ color: 'var(--vn-danger)', fontSize: '0.875rem', margin: 0 }}>
            Failed to load chain status. Fleet module may be offline.
          </p>
        )}

        {!chainsQ.isLoading && chains.length === 0 && !chainsQ.error && (
          <div style={{ ...card, textAlign: 'center', padding: '2rem', color: 'var(--vn-text-muted)' }}>
            No chains detected. Register nodes in the Fleet section to see chain status.
          </div>
        )}

        {chains.length > 0 && (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'var(--vn-surface-2)', borderBottom: '1px solid var(--vn-border)' }}>
                    {['Chain / ID', 'Height', 'Block Speed', 'Proposals', 'Upgrade', 'Validator', 'Status', 'Actions'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chains.map(c => (
                    <ChainRow
                      key={`${c.chain}-${c.type}`}
                      chain={c}
                      isRegistered={registeredMap.has(c.chain)}
                      onRemove={() => removeMutation.mutate(c.chain)}
                      onEdit={() => setEditChain(c)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── Section 2: Services (full inline management) ── */}
      <ServicesInlineContent />

      {/* ── Edit Chain Modal ─────────────────────────────────────── */}
      {editChain && (
        <EditChainModal
          chain={editChain}
          initialRpcUrl={registeredMap.get(editChain.chain)?.rpc_url ?? editChain.rpc_url ?? ''}
          onClose={() => setEditChain(null)}
          onSave={(rpcUrl) => editMutation.mutate({ chain: editChain.chain, rpc_url: rpcUrl })}
        />
      )}

    </div>
  );
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   Fleet Tab Components
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

/* ── Mini metric bar ─────────────────────────────────────────── */

function MiniBar({ value, warn = 70, danger = 85, label }: { value: number; warn?: number; danger?: number; label?: string }) {
  const color = value >= danger ? 'var(--vn-danger)' : value >= warn ? 'var(--vn-warning)' : 'var(--vn-success)';
  return (
    <div>
      {label && <div className="text-xs mb-0.5" style={{ color: 'var(--vn-text-subtle)' }}>{label}</div>}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--vn-border)' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }} />
        </div>
        <span className="tabular-nums text-xs w-8 text-right" style={{ color }}>{value.toFixed(0)}%</span>
      </div>
    </div>
  );
}

/* ── Live Servers Section ────────────────────────────────────── */

/* ── History Sparkline ───────────────────────────────────────── */
function Sparkline({ pts, color, height = 28, width = 120 }: { pts: number[]; color: string; height?: number; width?: number }) {
  if (pts.length < 2) return null;
  const step = width / (pts.length - 1);
  const points = pts.map((v, i) => {
    const x = i * step;
    const y = height - Math.min(100, Math.max(0, v)) / 100 * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function HistorySparkline({ vmName }: { vmName: string }) {
  const { data } = useQuery({
    queryKey: ['vm-history', vmName],
    queryFn: () => getVMHistory(vmName, 6),
    staleTime: 60_000,
    retry: false,
  });
  const pts: VMMetricPoint[] = data?.history ?? [];
  if (pts.length < 2) return null;
  const cpu = pts.map(p => p.cpu_pct);
  const mem = pts.map(p => p.mem_pct);
  const disk = pts.map(p => p.storage_pct);
  return (
    <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--vn-border)', paddingTop: '0.5rem' }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--vn-text-subtle)', marginBottom: '0.25rem' }}>
        Last 6h — <span style={{ color: 'var(--vn-primary)' }}>■</span> CPU
        {' '}<span style={{ color: 'var(--vn-success)' }}>■</span> Mem
        {' '}<span style={{ color: 'var(--vn-warning)' }}>■</span> Disk
      </div>
      <div style={{ position: 'relative', height: 28 }}>
        <div style={{ position: 'absolute', top: 0, left: 0 }}><Sparkline pts={disk} color="var(--vn-warning)" /></div>
        <div style={{ position: 'absolute', top: 0, left: 0 }}><Sparkline pts={mem} color="var(--vn-success)" /></div>
        <div style={{ position: 'absolute', top: 0, left: 0 }}><Sparkline pts={cpu} color="var(--vn-primary)" /></div>
      </div>
    </div>
  );
}

function ServersLiveSection() {
  const [upgradeTarget, setUpgradeTarget] = useState<VMStatus | null>(null);
  const [editTarget, setEditTarget] = useState<VMStatus | null>(null);

  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['vm-status'],
    queryFn: getVMStatus,
    refetchInterval: 60_000,
    retry: false,
  });

  const vms: VMStatus[] = data?.vms ?? [];

  return (
    <div style={{ ...card, marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Live Server Metrics</h2>
          {dataUpdatedAt > 0 && (
            <span style={{ fontSize: '0.7rem', color: 'var(--vn-text-subtle)' }}>
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {isLoading ? <Spinner /> : isError ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>
          Fleet SSH not configured — add VMs to <code>config/infra/*.toml</code>.
        </p>
      ) : vms.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>No VMs configured.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {vms.map((vm) => (
            <div
              key={vm.name}
              style={{
                borderRadius: 'var(--vn-radius)',
                border: `1px solid ${vm.online ? 'var(--vn-border)' : 'var(--vn-danger)'}`,
                padding: '1rem',
                backgroundColor: 'var(--vn-surface-2)',
                opacity: vm.online ? 1 : 0.7,
              }}
            >
              {/* Card header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{vm.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--vn-text-subtle)', marginTop: '0.1rem' }}>
                    {vm.os || (vm.online ? 'Linux' : 'offline')} · {vm.datacenter || 'N/A'}
                  </div>
                  {vm.lan_ip && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--vn-text-subtle)', fontFamily: 'monospace' }}>
                      {vm.lan_ip}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Badge status={vm.online ? 'online' : 'offline'} />
                  {vm.type && <Badge status={vm.type} />}
                  <button
                    onClick={e => { e.stopPropagation(); setEditTarget(vm); }}
                    title="View VM details"
                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface)', color: 'var(--vn-text-muted)' }}
                    type="button"
                  >
                    ✏
                  </button>
                </div>
              </div>

              {vm.online ? (
                <>
                  {/* Metric bars */}
                  <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <MiniBar value={vm.cpu_pct} label="CPU" />
                    <MiniBar value={vm.mem_pct} label="Memory" />
                    <MiniBar value={vm.storage_pct} warn={75} danger={90} label="Disk" />
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.75rem', color: 'var(--vn-text-muted)', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <span>
                      <span style={{ color: 'var(--vn-text-subtle)' }}>Load </span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--vn-text)' }}>{vm.load_avg || '—'}</span>
                    </span>
                    <span>
                      <span style={{ color: 'var(--vn-text-subtle)' }}>Updates </span>
                      <span style={{ color: vm.apt_count > 0 ? 'var(--vn-warning)' : 'var(--vn-success)' }}>
                        {vm.apt_count > 0 ? `${vm.apt_count} pending` : '✓ current'}
                      </span>
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => setUpgradeTarget(vm)}
                      style={{
                        ...fleetBtn,
                        background: vm.apt_count > 0 ? 'var(--vn-primary)' : 'var(--vn-surface)',
                        color: vm.apt_count > 0 ? 'var(--vn-on-primary)' : 'var(--vn-text-muted)',
                        border: vm.apt_count > 0 ? 'none' : '1px solid var(--vn-border)',
                        fontSize: '0.75rem',
                        padding: '0.3rem 0.7rem',
                      }}
                      type="button"
                    >
                      {vm.apt_count > 0 ? `⬆ Upgrade (${vm.apt_count})` : 'Upgrade'}
                    </button>
                  </div>
                  <HistorySparkline vmName={vm.name} />
                </>
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--vn-danger)' }}>
                  {vm.error || 'SSH unreachable'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {upgradeTarget && (
        <UpgradeModal
          vmName={upgradeTarget.name}
          upgradeURL={vmUpgradeURL(upgradeTarget.name)}
          onClose={() => setUpgradeTarget(null)}
        />
      )}

      {editTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setEditTarget(null)}>
          <div style={{ background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)', padding: '1.25rem', minWidth: 320, maxWidth: 480, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem' }}>🖥 {editTarget.name}</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <tbody>
                {([
                  ['LAN IP', editTarget.lan_ip],
                  ['Public IP', editTarget.public_ip],
                  ['Datacenter', editTarget.datacenter],
                  ['OS', editTarget.os],
                  ['Type', editTarget.type || 'vm'],
                  ['Status', editTarget.online ? 'online' : 'offline'],
                  ['Load', editTarget.load_avg || '—'],
                  ['Pending Updates', String(editTarget.apt_count ?? 0)],
                ] as [string, string | undefined][]).map(([label, val]) => (
                  <tr key={label} style={{ borderBottom: '1px solid var(--vn-border)' }}>
                    <td style={{ padding: '0.3rem 0.5rem', color: 'var(--vn-text-muted)', width: '40%' }}>{label}</td>
                    <td style={{ padding: '0.3rem 0.5rem', fontFamily: label === 'LAN IP' || label === 'Public IP' ? 'monospace' : undefined }}>{val || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '0.72rem', color: 'var(--vn-text-muted)', margin: '0.75rem 0 0.5rem' }}>
              To edit VM config, update the corresponding <code>config/infra/*.toml</code> file.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditTarget(null)} style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Registered Chains ───────────────────────────────────────── */
function RegisteredChainsSection() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ chain: '', rpc_url: '', rest_url: '', note: '' });
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['registered-chains'],
    queryFn: getRegisteredChains,
  });

  const { mutate: doRegister, isPending: registering } = useMutation({
    mutationFn: () => registerChain(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['registered-chains'] });
      setForm({ chain: '', rpc_url: '', rest_url: '', note: '' });
      setShowForm(false);
    },
  });

  const { mutate: doUnregister } = useMutation({
    mutationFn: (chain: string) => unregisterChain(chain),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registered-chains'] }),
  });

  const { mutate: doPoll, isPending: polling } = useMutation({
    mutationFn: forcePoll,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fleet-chains'] }),
  });

  const chains: RegisteredChain[] = data?.registered_chains ?? [];

  return (
    <div style={{ ...card, marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Registered Chains</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => doPoll()} disabled={polling} style={{ ...fleetBtn, background: 'var(--vn-surface-2)', color: 'var(--vn-text)', border: '1px solid var(--vn-border)' }} type="button">
            {polling ? <Spinner size={14} /> : null}
            Force Poll
          </button>
          <button onClick={() => setShowForm((v) => !v)} style={fleetBtn} type="button">
            + Register Chain
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); doRegister(); }}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem',
            padding: '1rem',
            background: 'var(--vn-surface-2)',
            borderRadius: 'var(--vn-radius)',
          }}
        >
          {(['chain', 'rpc_url', 'rest_url', 'note'] as const).map((f) => (
            <div key={f}>
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--vn-text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase' }}>
                {f === 'rpc_url' ? 'RPC URL' : f === 'rest_url' ? 'REST URL (optional)' : f}
              </label>
              <input
                style={{ ...fleetInputStyle, width: '100%', boxSizing: 'border-box' }}
                value={form[f]}
                onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))}
                required={f === 'chain' || f === 'rpc_url'}
                placeholder={f === 'rpc_url' ? 'http://host:26657' : f === 'rest_url' ? 'http://host:1317' : ''}
              />
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
            <button type="submit" disabled={registering} style={fleetBtn}>
              {registering ? <Spinner size={14} /> : null} Save
            </button>
            <button type="button" onClick={() => setShowForm(false)} style={{ ...fleetBtn, background: 'transparent', color: 'var(--vn-text-muted)', border: '1px solid var(--vn-border)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? <Spinner /> : chains.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>No chains registered. Add one above.</p>
      ) : (
        <table style={fleetTable}>
          <thead>
            <tr>
              {['Chain', 'RPC URL', 'REST URL', 'Note', ''].map((h) => (
                <th key={h} scope="col" style={fleetTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chains.map((c) => (
              <tr key={c.chain}>
                <td style={fleetTd}><code style={{ fontFamily: 'monospace' }}>{c.chain}</code></td>
                <td style={{ ...fleetTd, fontSize: '0.8rem', color: 'var(--vn-text-muted)', fontFamily: 'monospace' }}>{c.rpc_url}</td>
                <td style={{ ...fleetTd, fontSize: '0.8rem', color: 'var(--vn-text-muted)', fontFamily: 'monospace' }}>{c.rest_url ?? '—'}</td>
                <td style={{ ...fleetTd, color: 'var(--vn-text-muted)' }}>{c.note ?? '—'}</td>
                <td style={fleetTd}>
                  <button
                    onClick={() => { if (confirm(`Unregister ${c.chain}?`)) doUnregister(c.chain); }}
                    style={{ ...fleetBtn, background: 'var(--vn-danger)', padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                    type="button"
                    aria-label={`Unregister ${c.chain}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── VMs section ─────────────────────────────────────────────── */
function VMsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['fleet-vms'],
    queryFn: getFleetVMs,
  });

  const vms: VMView[] = data?.vms ?? [];

  return (
    <div style={{ ...card, marginBottom: '1.25rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Fleet VMs</h2>
      {isLoading ? <Spinner /> : vms.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>
          No VMs configured. Add VM definitions to <code>config/infra/*.toml</code>.
        </p>
      ) : (
        <table style={fleetTable}>
          <thead>
            <tr>
              {['Name', 'Host', 'Datacenter', 'Type'].map((h) => (
                <th key={h} scope="col" style={fleetTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vms.map((vm) => (
              <tr key={vm.name}>
                <td style={fleetTd}><strong>{vm.name}</strong></td>
                <td style={{ ...fleetTd, fontFamily: 'monospace', fontSize: '0.85rem' }}>{vm.host}</td>
                <td style={fleetTd}>{vm.datacenter}</td>
                <td style={fleetTd}><Badge status={vm.type || 'vm'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Deployments section ─────────────────────────────────────── */
function DeploymentsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => getDeployments(),
    refetchInterval: 15_000,
  });

  const deployments: Deployment[] = data?.deployments ?? [];

  function fmtDate(iso?: string) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  return (
    <div style={{ ...card, marginBottom: '1.25rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Recent Deployments</h2>
      {isLoading ? <Spinner /> : deployments.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>No deployments yet.</p>
      ) : (
        <table style={fleetTable}>
          <thead>
            <tr>
              {['VM', 'Chain', 'Component', 'Script', 'Status', 'Started', 'Finished'].map((h) => (
                <th key={h} scope="col" style={fleetTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deployments.slice(0, 50).map((d) => (
              <tr key={d.id}>
                <td style={fleetTd}>{d.vm}</td>
                <td style={fleetTd}><code style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{d.chain}</code></td>
                <td style={fleetTd}>{d.component}</td>
                <td style={{ ...fleetTd, fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--vn-text-muted)' }}>{d.script}</td>
                <td style={fleetTd}><Badge status={d.status} /></td>
                <td style={{ ...fleetTd, color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>{fmtDate(d.started_at)}</td>
                <td style={{ ...fleetTd, color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>{fmtDate(d.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Deploy Wizard Modal ──────────────────────────────────────── */
function DeployWizardModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();

  const vmsQ = useQuery({ queryKey: ['fleet-vms'], queryFn: getFleetVMs, staleTime: 60_000 });
  const chainsQ = useQuery({ queryKey: ['registered-chains'], queryFn: getRegisteredChains, staleTime: 60_000 });

  const vms: VMView[] = vmsQ.data?.vms ?? [];
  const chains: RegisteredChain[] = chainsQ.data?.registered_chains ?? [];

  const [vm, setVm] = useState('');
  const [chain, setChain] = useState('');
  const [component, setComponent] = useState('');
  const [script, setScript] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<{ deployment_id: number; status: string } | null>(null);
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(false);

  const deploy = async () => {
    if (!vm || !chain || !component || !script) { setErr('All fields are required.'); return; }
    setRunning(true);
    setErr('');
    try {
      const res = await deployFleet({ vm, chain, component, script, dry_run: dryRun });
      setResult(res);
      qc.invalidateQueries({ queryKey: ['deployments'] });
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const inp: React.CSSProperties = {
    padding: '0.45rem 0.75rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)',
    background: 'var(--vn-surface)', color: 'var(--vn-text)', fontSize: '0.875rem', width: '100%',
  };
  const fld: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.85rem' };
  const lbl: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--vn-text-muted)', fontWeight: 500 };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)', padding: '1.75rem', width: 460, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.1rem', color: 'var(--vn-text)' }}>🚀 Fleet Deploy</h2>

        {result ? (
          <div>
            <div style={{ background: 'color-mix(in srgb, var(--vn-success) 12%, transparent)', color: 'var(--vn-success)', borderRadius: 'var(--vn-radius)', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
              Deployment #{result.deployment_id} started — status: <strong>{result.status}</strong>.
              <br />
              <span style={{ fontSize: '0.78rem', color: 'var(--vn-text-muted)' }}>Check the Recent Deployments table for progress.</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <button onClick={onClose} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <div style={fld}>
              <label style={lbl}>Target VM *</label>
              <select style={inp} value={vm} onChange={e => setVm(e.target.value)} disabled={vmsQ.isLoading}>
                <option value="">{vmsQ.isLoading ? 'Loading VMs…' : vms.length === 0 ? 'No VMs available' : 'Select VM…'}</option>
                {vms.map(v => <option key={v.name} value={v.name}>{v.name}{v.datacenter ? ` (${v.datacenter})` : ''}</option>)}
              </select>
            </div>
            <div style={fld}>
              <label style={lbl}>Chain *</label>
              <select style={inp} value={chain} onChange={e => setChain(e.target.value)} disabled={chainsQ.isLoading}>
                <option value="">{chainsQ.isLoading ? 'Loading chains…' : chains.length === 0 ? 'No chains registered' : 'Select chain…'}</option>
                {chains.map(c => <option key={c.chain} value={c.chain}>{c.chain}</option>)}
              </select>
            </div>
            <div style={fld}>
              <label style={lbl}>Component *</label>
              <input style={inp} value={component} onChange={e => setComponent(e.target.value)} placeholder="e.g. cosmosd, relayer, nginx" />
            </div>
            <div style={fld}>
              <label style={lbl}>Script / Command *</label>
              <input style={inp} value={script} onChange={e => setScript(e.target.value)} placeholder="e.g. /opt/scripts/deploy.sh" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="checkbox" id="dry-run-chk" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
              <label htmlFor="dry-run-chk" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>Dry run (simulate only)</label>
            </div>

            {err && <p style={{ color: 'var(--vn-danger)', fontSize: '0.82rem', margin: '0.5rem 0' }}>{err}</p>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={onClose} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)', cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={deploy}
                disabled={running}
                style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: 'var(--vn-radius)', border: 'none', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)', cursor: 'pointer', fontWeight: 600 }}
              >
                {running ? 'Deploying…' : dryRun ? '🔍 Dry Run' : '🚀 Deploy'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FleetTabContent() {
  const [showDeploy, setShowDeploy] = useState(false);
  return (
    <div>
      {showDeploy && <DeployWizardModal onClose={() => setShowDeploy(false)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Fleet</h1>
        <button
          onClick={() => setShowDeploy(true)}
          style={{
            padding: '0.45rem 1rem', fontSize: '0.85rem', borderRadius: 'var(--vn-radius)',
            border: 'none', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)',
            cursor: 'pointer', fontWeight: 600,
          }}
        >
          🚀 Deploy
        </button>
      </div>
      <ServersLiveSection />
      <RegisteredChainsSection />
      <VMsSection />
      <DeploymentsSection />
    </div>
  );
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   Patches Tab Components
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

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

function PatchesTabContent() {
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
    <div>
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

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   Overview Tab
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

function OverviewStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '1.5rem', fontWeight: 700, color: color ?? 'var(--vn-text)', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: '0.7rem', color: 'var(--vn-text-muted)', marginTop: 2 }}>{label}</span>
    </div>
  );
}

function OverviewTab() {
  const { data: chainsData } = useQuery({ queryKey: ['fleet-chains'], queryFn: getFleetChains, refetchInterval: 30_000 });
  const { data: vmData } = useQuery({ queryKey: ['vm-status'], queryFn: getVMStatus, staleTime: 60_000, retry: false });
  const { data: hostData } = useQuery({ queryKey: ['hosts-overview'], queryFn: getHosts, staleTime: 60_000, retry: false });

  const chains: ChainStatus[] = chainsData?.chains ?? [];
  const chainsSynced = chains.filter(c => !c.catching_up && !c.error).length;
  const chainsSyncing = chains.filter(c => c.catching_up).length;
  const chainsUpgrades = chains.filter(c => c.upgrade_pending).length;
  const chainsProposals = chains.reduce((s, c) => s + (c.active_proposals ?? 0), 0);

  const vms: VMStatus[] = vmData?.vms ?? [];
  const vmsOnline = vms.filter(v => v.online).length;
  const vmsOffline = vms.filter(v => !v.online).length;

  const hosts: HostInventory[] = hostData?.hosts ?? [];
  const hostsOnline = hosts.filter(h => h.status === 'online').length;

  const totalPending = [
    ...vms.map(v => v.apt_count ?? 0),
    ...hosts.map(h => h.apt_pending ?? 0),
  ].reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
        {/* Chains card */}
        <div style={{ ...card }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>\ud83d\udd17 Chains</div>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <OverviewStat label="Total" value={chains.length} />
            <OverviewStat label="Synced" value={chainsSynced} color="var(--vn-success)" />
            <OverviewStat label="Syncing" value={chainsSyncing} color="var(--vn-warning)" />
            {chainsUpgrades > 0 && <OverviewStat label="Upgrades \u26a1" value={chainsUpgrades} color="var(--vn-warning)" />}
            {chainsProposals > 0 && <OverviewStat label="Proposals" value={chainsProposals} color="var(--vn-accent)" />}
          </div>
        </div>
        {/* Fleet/VMs card */}
        <div style={{ ...card }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>\ud83d\udda5 Fleet / VMs</div>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <OverviewStat label="Total VMs" value={vms.length} />
            <OverviewStat label="Online" value={vmsOnline} color="var(--vn-success)" />
            {vmsOffline > 0 && <OverviewStat label="Offline" value={vmsOffline} color="var(--vn-danger)" />}
            <OverviewStat label="Hosts" value={hosts.length} />
            <OverviewStat label="Hosts Online" value={hostsOnline} color={hostsOnline === hosts.length && hosts.length > 0 ? 'var(--vn-success)' : 'var(--vn-warning)'} />
          </div>
        </div>
        {/* Patches card */}
        <div style={{ ...card }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>\ud83e\ude79 Patches</div>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <OverviewStat label="Pending updates" value={totalPending} color={totalPending > 0 ? 'var(--vn-warning)' : 'var(--vn-success)'} />
            <OverviewStat label="Tracked" value={vms.length + hosts.length} />
          </div>
        </div>
      </div>
      {/* Recent activity */}
      <div style={{ ...card }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>\ud83d\udccb Recent Activity</div>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--vn-text-muted)' }}>No recent activity. Navigate to Audit Log for full history.</p>
      </div>
    </div>
  );
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   Main Export \u2014 Tabbed Mega-Module
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

const TABS = ['Overview', 'Chains', 'Fleet', 'Patches', 'VMs'] as const;
type Tab = typeof TABS[number];

export default function VMsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--vn-border)', paddingBottom: '0' }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} type="button" style={{
            padding: '0.5rem 1.25rem',
            border: 'none',
            borderBottom: activeTab === tab ? '2px solid var(--vn-primary)' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === tab ? 'var(--vn-primary)' : 'var(--vn-text-muted)',
            fontWeight: activeTab === tab ? 600 : 400,
            fontSize: '0.875rem',
            cursor: 'pointer',
            marginBottom: '-1px',
          }}>
            {tab}
          </button>
        ))}
      </div>
      {activeTab === 'Overview' && <OverviewTab />}
      {activeTab === 'Chains' && <ChainsTabContent />}
      {activeTab === 'Fleet' && <FleetTabContent />}
      {activeTab === 'Patches' && <PatchesTabContent />}
      {activeTab === 'VMs' && <VMsTabContent />}
    </div>
  );
}
