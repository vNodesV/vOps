import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getHosts, getFleetVMs, getUnits } from '../api';
import type { HostInventory, CosmosUnitWithStatus } from '../api/types';
import Spinner from '../components/Spinner';

/* ── types ────────────────────────────────────────────────────── */
interface VMView {
  name: string;
  host?: string;
  host_name?: string;
  state?: string;
  lan_ip?: string;
  cpu_pct?: number;
  mem_mib?: number;
  max_mem_mib?: number;
  os?: string;
  datacenter?: string;
}

/* ── helpers ──────────────────────────────────────────────────── */
function statusColor(s: string | undefined): string {
  if (!s) return 'var(--vn-text-muted)';
  const l = s.toLowerCase();
  if (l.includes('running') || l === 'online' || l === 'active') return 'var(--vn-success)';
  if (l.includes('shut') || l === 'offline' || l === 'inactive') return 'var(--vn-text-muted)';
  if (l.includes('paus') || l.includes('catch') || l === 'syncing') return 'var(--vn-warning)';
  return 'var(--vn-danger)';
}

function dot(color: string) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, marginRight: 5, flexShrink: 0,
    }} />
  );
}

/* ── main component ───────────────────────────────────────────── */
export default function TopologyPage() {
  const { data: hostsData, isLoading: hostsLoading } = useQuery({
    queryKey: ['topology-hosts'],
    queryFn: getHosts,
    staleTime: 30_000,
  });
  const { data: vmsData, isLoading: vmsLoading } = useQuery({
    queryKey: ['topology-vms'],
    queryFn: getFleetVMs,
    staleTime: 30_000,
  });
  const { data: unitsData, isLoading: unitsLoading } = useQuery({
    queryKey: ['topology-units'],
    queryFn: getUnits,
    staleTime: 30_000,
  });

  const isLoading = hostsLoading || vmsLoading || unitsLoading;

  const hosts: HostInventory[] = hostsData?.hosts ?? [];
  const vms: VMView[] = (vmsData?.vms ?? []) as VMView[];
  const units: CosmosUnitWithStatus[] = (unitsData?.units ?? []) as CosmosUnitWithStatus[];

  // Group VMs by datacenter/host.
  const vmsByHost: Record<string, VMView[]> = {};
  for (const vm of vms) {
    const key = vm.host_name ?? vm.host ?? vm.datacenter ?? 'unknown';
    (vmsByHost[key] ??= []).push(vm);
  }

  // Group units by vm_name.
  const unitsByVM: Record<string, CosmosUnitWithStatus[]> = {};
  for (const u of units) {
    (unitsByVM[u.vm_name] ??= []).push(u);
  }

  // Group hosts by datacenter.
  const hostsByDC: Record<string, HostInventory[]> = {};
  for (const h of hosts) {
    const dc = h.datacenter ?? 'Unknown DC';
    (hostsByDC[dc] ??= []).push(h);
  }
  // Add hosts from VM list that might not be in hosts array.
  for (const vm of vms) {
    const dc = vm.datacenter ?? 'Unknown DC';
    if (!hostsByDC[dc]) hostsByDC[dc] = [];
  }

  const dcs = Object.keys(hostsByDC).sort();

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-xl font-bold m-0">Topology</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--vn-text-subtle)' }}>
            Multi-datacenter visual map — Hosts → VMs → Units
          </p>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--vn-text-muted)' }}>
          {hosts.length} hosts · {vms.length} VMs · {units.length} units
        </div>
      </div>

      {isLoading ? <Spinner /> : (
        <>
          {dcs.length === 0 && (
            <div className="card card-sm">
              <p style={{ margin: 0, color: 'var(--vn-text-muted)' }}>
                No topology data yet. Configure hypervisor hosts and register units to see the map.
              </p>
            </div>
          )}

          {dcs.map(dc => {
            const dcHosts = hostsByDC[dc];
            const dcVMs = vms.filter(v => (v.datacenter ?? 'Unknown DC') === dc && !dcHosts.find(h => h.name === (v.host_name ?? v.host)));
            return (
              <div key={dc} className="card card-sm" style={{ borderLeft: '3px solid var(--vn-primary)', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '1rem' }}>🏢</span>
                  <strong style={{ fontSize: '1rem' }}>{dc}</strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>
                    ({dcHosts.length} host{dcHosts.length !== 1 ? 's' : ''})
                  </span>
                </div>

                {/* Hosts */}
                {dcHosts.map(h => {
                  const hVMs = vmsByHost[h.name] ?? [];
                  return (
                    <div key={h.name} className="card-sm" style={{
                      border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)',
                      padding: '0.75rem', marginBottom: '0.75rem',
                      background: 'var(--vn-surface-2)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.9rem' }}>🖥</span>
                        <strong>{h.name}</strong>
                        {dot(statusColor(h.status))}
                        <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>
                          {h.lan_ip ?? ''} {h.os ? `· ${h.os}` : ''}
                          {h.apt_pending > 0 && (
                            <span style={{ color: 'var(--vn-warning)', marginLeft: 6 }}>
                              ⚠ {h.apt_pending} pending
                            </span>
                          )}
                        </span>
                      </div>

                      {/* VMs on this host */}
                      {hVMs.length === 0 ? (
                        <p style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)', margin: 0 }}>No VMs discovered</p>
                      ) : (
                        hVMs.map(vm => <VMRow key={vm.name} vm={vm} unitsByVM={unitsByVM} />)
                      )}
                    </div>
                  );
                })}

                {/* Orphan VMs (DC matches but no matching host record) */}
                {dcVMs.map(vm => <VMRow key={vm.name} vm={vm} unitsByVM={unitsByVM} />)}
              </div>
            );
          })}

          {/* VMs with no DC at all */}
          {(() => {
            const unplaced = vms.filter(v =>
              !dcs.includes(v.datacenter ?? 'Unknown DC') && v.datacenter !== undefined
            );
            if (!unplaced.length) return null;
            return (
              <div className="card card-sm" style={{ marginBottom: '1rem' }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--vn-text-muted)' }}>Unassigned</strong>
                {unplaced.map(vm => <VMRow key={vm.name} vm={vm} unitsByVM={unitsByVM} />)}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

/* ── VM row ───────────────────────────────────────────────────── */
function VMRow({ vm, unitsByVM }: { vm: VMView; unitsByVM: Record<string, CosmosUnitWithStatus[]> }) {
  const navigate = useNavigate();
  const vmUnits = unitsByVM[vm.name] ?? [];
  const color = statusColor(vm.state);
  return (
    <div
      className="card card-sm"
      style={{ background: 'var(--vn-surface-2)', cursor: 'pointer', marginBottom: '0.5rem' }}
      onClick={() => navigate(`/vms?filter=${encodeURIComponent(vm.name)}`)}
      title={`Open ${vm.name} in VM Manager`}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate(`/vms?filter=${encodeURIComponent(vm.name)}`)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {dot(color)}
        <strong style={{ fontSize: '0.85rem' }}>{vm.name}</strong>
        <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>
          {vm.state ?? '—'}
          {vm.lan_ip ? ` · ${vm.lan_ip}` : ''}
          {vm.cpu_pct !== undefined ? ` · CPU ${vm.cpu_pct.toFixed(1)}%` : ''}
          {vm.mem_mib && vm.max_mem_mib ? ` · Mem ${Math.round(vm.mem_mib / vm.max_mem_mib * 100)}%` : ''}
          {vm.os ? ` · ${vm.os}` : ''}
        </span>
        <span style={{ fontSize: '0.68rem', color: 'var(--vn-text-muted)', marginLeft: 'auto' }}>→ VM Manager</span>
      </div>

      {/* Unit badges */}
      {vmUnits.length > 0 && (
        <div style={{ marginTop: '0.35rem' }} onClick={e => e.stopPropagation()}>
          {vmUnits.map(u => {
            const uColor = u.status
              ? statusColor(u.status.service_active ? (u.status.syncing ? 'syncing' : 'running') : 'down')
              : 'var(--vn-text-muted)';
            return (
              <span
                key={u.name}
                className="pill"
                style={{ cursor: 'pointer', fontSize: '0.72rem', marginRight: '0.35rem', marginTop: '0.3rem' }}
                title={`chain: ${u.chain_id} | height: ${u.status?.block_height ?? '?'} | peers: ${u.status?.peers ?? '?'} — click to manage`}
                onClick={() => navigate(`/units?filter=${encodeURIComponent(u.name)}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/units?filter=${encodeURIComponent(u.name)}`)}
              >
                {dot(uColor)}
                {u.name}
                {u.status?.upgrade_name && (
                  <span style={{ color: 'var(--vn-warning)', marginLeft: 4 }}>⬆ {u.status.upgrade_name}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
