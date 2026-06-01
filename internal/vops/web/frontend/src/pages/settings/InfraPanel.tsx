/**
 * settings/InfraPanel.tsx
 * Infrastructure panel: FleetScanPanel — the live on-demand SSH poll surface.
 * Config-file-driven panels (SSH Defaults, Datacenters & VMs) were retired;
 * those settings are managed via config/fleet and config/infra TOML files.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  scanAllVMs,
  registerDiscoveredVM,
} from '../../api';
import type { VMStatus, VirshVM } from '../../api/types';
import Badge from '../../components/Badge';
import {
  SectionCard,
  MetricBar,
  VMHistorySparkline,
} from './shared';

/* ── Infrastructure → Fleet Scan ─────────────────────────────── */

export function FleetScanPanel() {
  const queryClient = useQueryClient();

  const scanMut = useMutation({
    mutationFn: scanAllVMs,
    onSuccess: (data) => {
      queryClient.setQueryData(['vm-status'], data);
    },
  });

  const registerMut = useMutation({
    mutationFn: ({ name, lan_ip, datacenter }: { name: string; lan_ip: string; datacenter: string }) =>
      registerDiscoveredVM(name, lan_ip, datacenter),
  });

  const [registered, setRegistered] = useState<Set<string>>(new Set());

  const cachedQ = useQuery({
    queryKey: ['vm-status'],
    queryFn: () => Promise.resolve({ vms: [] as VMStatus[], discovered: [] as VirshVM[], hosts: [] as unknown[] }),
    enabled: false,
  });

  const vms: VMStatus[] =
    (scanMut.data?.vms ?? (cachedQ.data as { vms: VMStatus[] } | undefined)?.vms) ?? [];

  const discovered: VirshVM[] =
    (scanMut.data as { discovered?: VirshVM[] } | undefined)?.discovered ??
    (cachedQ.data as { discovered?: VirshVM[] } | undefined)?.discovered ?? [];

  const lastScanned = scanMut.data
    ? new Date().toLocaleTimeString()
    : cachedQ.dataUpdatedAt
      ? new Date(cachedQ.dataUpdatedAt).toLocaleTimeString()
      : null;

  return (
    <SectionCard
      title="Fleet Scan"
      subtitle="Perform an on-demand SSH poll of all configured VMs. Collects CPU, memory, disk, load average, OS version, and pending apt upgrades in real time. Results are stored in the metrics history for sparkline graphs."
    >
      {/* Pre-requisite checklist */}
      <div
        className="rounded-lg p-3 text-xs space-y-1.5 mb-2"
        style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
      >
        <div className="font-semibold" style={{ color: 'var(--vn-text)' }}>
          Scan requires only a <strong>hypervisor host</strong> — no VMs needed in advance.
        </div>
        <ul className="space-y-1 list-none" style={{ color: 'var(--vn-text-muted)' }}>
          <li>1. <strong>Hypervisor host</strong> — add a <code>[[host]]</code> entry in <code>config/infra/&lt;datacenter&gt;.toml</code> with <code>lan_ip</code>, <code>user</code>, and <code>ssh_key_path</code>. VMs are discovered automatically from that host via <code>virsh list --all</code>.</li>
          <li>2. <strong>SSH key</strong> — the key at <code>ssh_key_path</code> must exist on this vOps host and be readable by the vOps process (mode 0600).</li>
          <li>3. <strong>VM SSH access</strong> — for live metrics (CPU/mem/load), vOps will also SSH into each running VM. The same or per-VM key_path is used. Skip this step if only discovery (virsh) is needed.</li>
          <li>4. <strong>Restart vOps</strong> after saving the host config — the fleet service initializes on startup from <code>config/infra/*.toml</code>.</li>
        </ul>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
          {lastScanned ? `Last scanned: ${lastScanned}` : 'Not yet scanned this session.'}
        </div>
        <button
          onClick={() => scanMut.mutate()}
          disabled={scanMut.isPending}
          className="btn btn-primary disabled:opacity-50 flex items-center gap-2"
        >
          {scanMut.isPending && (
            <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          )}
          {scanMut.isPending ? 'Scanning…' : 'Scan All VMs'}
        </button>
      </div>

      {scanMut.isError && (
        <p className="text-xs" style={{ color: 'var(--vn-danger)' }}>
          ✗ Scan failed — {(scanMut.error as Error)?.message}
        </p>
      )}

      {vms.length > 0 && (
        <div className="card card-flush overflow-x-auto">
          <table className="vn-table">
            <thead>
              <tr>
                {[
                  'VM / Host',
                  'Type',
                  'OS',
                  'CPU',
                  'Memory',
                  'Disk',
                  'Load',
                  'Updates',
                  '6h Trend',
                  'Status',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-medium uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'var(--vn-text-subtle)', fontSize: '0.65rem' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vms.map((vm) => (
                <tr
                  key={vm.name}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{vm.name}</div>
                    <div style={{ color: 'var(--vn-text-subtle)' }}>{vm.datacenter}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--vn-text-muted)' }}>
                    {vm.type || '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--vn-text-muted)' }}>
                    {vm.online ? (vm.os || 'Linux') : '—'}
                  </td>
                  <td className="px-3 py-2" style={{ minWidth: 90 }}>
                    {vm.online ? <MetricBar value={vm.cpu_pct} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                  </td>
                  <td className="px-3 py-2" style={{ minWidth: 90 }}>
                    {vm.online ? <MetricBar value={vm.mem_pct} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                  </td>
                  <td className="px-3 py-2" style={{ minWidth: 90 }}>
                    {vm.online ? (
                      <MetricBar value={vm.storage_pct} warn={75} danger={90} />
                    ) : (
                      <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--vn-text-muted)' }}>
                    {vm.online ? vm.load_avg || '—' : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {vm.online ? (
                      vm.apt_count > 0 ? (
                        <span style={{ color: 'var(--vn-warning)' }}>
                          ⚠ {vm.apt_count} pending
                        </span>
                      ) : (
                        <span style={{ color: 'var(--vn-success)' }}>✓ current</span>
                      )
                    ) : (
                      <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2" style={{ minWidth: 100 }}>
                    {vm.online ? <VMHistorySparkline vmName={vm.name} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge status={vm.online ? 'online' : 'offline'} />
                    {vm.error && (
                      <span
                        className="ml-1"
                        style={{ color: 'var(--vn-danger)' }}
                        title={vm.error}
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vms.length === 0 && !scanMut.isPending && (
        <div
          className="p-4 rounded-lg text-xs text-center"
          style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px dashed var(--vn-border)', color: 'var(--vn-text-muted)' }}
        >
          Click <strong>Scan All VMs</strong> to discover VMs via virsh and poll metrics over SSH.
          Make sure the hypervisor host is configured in <code>config/infra/*.toml</code> with a valid
          <code> lan_ip</code>, <code>user</code>, and <code>ssh_key_path</code>.
        </div>
      )}

      {/* Hypervisor-discovered VMs (virsh list --all) */}
      {discovered.length > 0 && (
        <SectionCard
          title="Hypervisor Discovery"
          subtitle="VMs found by querying virsh on the hypervisor host. Running VMs with a known IP were also probed via SSH for live metrics."
        >
          {/* Add All button */}
          <div className="flex justify-end mb-2">
            <button
              onClick={async () => {
                const toAdd = discovered.filter(
                  (vm) => vm.lan_ip && !registered.has(vm.name),
                );
                for (const vm of toAdd) {
                  try {
                    await registerMut.mutateAsync({
                      name: vm.name,
                      lan_ip: vm.lan_ip ?? '',
                      datacenter: vm.datacenter,
                    });
                    setRegistered((prev) => new Set(prev).add(vm.name));
                  } catch (_) { /* individual errors shown per-row */ }
                }
              }}
              disabled={registerMut.isPending}
              className="btn btn-secondary btn-sm"
            >
              ➕ Add All to Inventory
            </button>
          </div>
          <div className="card card-flush overflow-x-auto">
            <table className="vn-table">
              <thead>
                <tr>
                  {['VM Name', 'Datacenter', 'LAN IP', 'OS', 'State', 'CPU %', 'Mem %', 'Load Avg', 'Status', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-medium uppercase tracking-wider whitespace-nowrap"
                      style={{ color: 'var(--vn-text-subtle)', fontSize: '0.65rem' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {discovered.map((vm, i) => {
                  const isRegistered = registered.has(vm.name);
                  return (
                    <tr
                      key={`${vm.name}-${i}`}
                    >
                      <td className="px-3 py-2 font-medium">{vm.name}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--vn-text-subtle)' }}>{vm.datacenter || '—'}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--vn-text-muted)' }}>{vm.lan_ip || '—'}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--vn-text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={vm.os_version}>
                        {vm.os_version || '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge status={vm.state === 'running' ? 'online' : vm.state.includes('error') || vm.state.includes('unreachable') ? 'offline' : 'idle'} />
                        <span className="ml-1.5 text-xs" style={{ color: 'var(--vn-text-muted)' }}>{vm.state}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--vn-text-muted)' }}>
                        {vm.cpu_pct != null && vm.cpu_pct > 0 ? `${vm.cpu_pct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3 py-2" style={{ minWidth: 80 }}>
                        {vm.online && vm.mem_pct != null ? <MetricBar value={vm.mem_pct} /> : <span style={{ color: 'var(--vn-text-subtle)' }}>—</span>}
                      </td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--vn-text-muted)' }}>
                        {vm.load_avg || '—'}
                      </td>
                      <td className="px-3 py-2">
                        {vm.error ? (
                          <span style={{ color: 'var(--vn-danger)' }} title={vm.error}>
                            ⚠ {vm.error.replace(/^VM SSH(?: skipped)?:?\s*/i, '').slice(0, 42) || 'error'}
                          </span>
                        ) : vm.online ? (
                          <span style={{ color: 'var(--vn-success)' }}>online</span>
                        ) : vm.state === 'shut off' ? (
                          <span style={{ color: 'var(--vn-text-subtle)' }}>stopped</span>
                        ) : (
                          <span style={{ color: 'var(--vn-text-muted)' }}>{vm.state}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isRegistered ? (
                          <span style={{ color: 'var(--vn-success)', fontSize: '0.7rem' }}>✓ added</span>
                        ) : vm.lan_ip ? (
                          <button
                            onClick={async () => {
                              try {
                                await registerMut.mutateAsync({
                                  name: vm.name,
                                  lan_ip: vm.lan_ip ?? '',
                                  datacenter: vm.datacenter,
                                });
                                setRegistered((prev) => new Set(prev).add(vm.name));
                              } catch (_) {}
                            }}
                            disabled={registerMut.isPending}
                            className="btn btn-secondary btn-sm"
                          >
                            ➕ Add
                          </button>
                        ) : (
                          <span style={{ color: 'var(--vn-text-subtle)', fontSize: '0.7rem' }}>no IP</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </SectionCard>
  );
}
