/**
 * settings/InfraPanel.tsx
 * Infrastructure panels: FleetScanPanel, FleetSSHPanel, DatacentersPanel,
 * DatacenterCard, NewDatacenterForm.
 */
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  saveConfig,
  scanAllVMs,
  registerDiscoveredVM,
} from '../../api';
import type { ConfigSnapshot, VMStatus, VirshVM } from '../../api/types';
import Badge from '../../components/Badge';
import {
  SectionCard,
  MetricBar,
  VMHistorySparkline,
  SaveBar,
  TOMLEditor,
  LabeledInput,
  parseTOML,
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

/* ── Infrastructure → SSH Defaults ──────────────────────────── */

export function FleetSSHPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const raw = typeof config.fleet === 'string' ? config.fleet : '';
  const t = parseTOML(raw);

  const [fields, setFields] = useState({
    ssh_user:          t['ssh.user']              ?? '',
    ssh_key_path:      t['ssh.key_path']          ?? '',
    known_hosts_path:  t['ssh.known_hosts_path']  ?? '',
    ssh_port:          t['ssh.port']              ?? '22',
    ssh_timeout_sec:   t['ssh.timeout_sec']       ?? '15',
    poll_interval_sec: t['poll.interval_sec']     ?? '60',
    datacenter:        t['defaults.datacenter']   ?? '',
  });

  const [showToml, setShowToml] = useState(false);

  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveConfig('fleet', {
      ssh_user:          fields.ssh_user,
      ssh_key_path:      fields.ssh_key_path,
      known_hosts_path:  fields.known_hosts_path,
      ssh_port:          Number(fields.ssh_port) || 22,
      ssh_timeout_sec:   Number(fields.ssh_timeout_sec) || 15,
      poll_interval_sec: Number(fields.poll_interval_sec) || 60,
      datacenter:        fields.datacenter,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  return (
    <SectionCard
      title="Fleet SSH Defaults"
      subtitle="Controls how vOps connects to your VMs via SSH for polling metrics, running scripts, and deploying upgrades. These defaults apply to all VMs unless overridden per-VM."
    >
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput label="SSH User" value={fields.ssh_user} onChange={set('ssh_user')} placeholder="ubuntu" />
        <LabeledInput label="SSH Port" value={fields.ssh_port} onChange={set('ssh_port')} placeholder="22" />
        <LabeledInput label="SSH Key Path" value={fields.ssh_key_path} onChange={set('ssh_key_path')} placeholder="/home/ubuntu/.vOps/secret/vops_ssh_key" wide />
        <LabeledInput label="Known Hosts File" value={fields.known_hosts_path} onChange={set('known_hosts_path')} placeholder="~/.ssh/known_hosts" wide />
        <LabeledInput label="Connection Timeout (sec)" value={fields.ssh_timeout_sec} onChange={set('ssh_timeout_sec')} placeholder="15" />
        <LabeledInput label="Poll Interval (sec)" value={fields.poll_interval_sec} onChange={set('poll_interval_sec')} placeholder="60" />
        <LabeledInput label="Default Datacenter" value={fields.datacenter} onChange={set('datacenter')} placeholder="hetzner" />
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--vn-text-subtle)' }}>
        SSH User must have passwordless <code>sudo</code> on each VM. Generate the SSH key in Security → Keys &amp; Credentials.
        Known Hosts File — path to SSH known_hosts for host-key verification. Leave blank to use <code>~/.ssh/known_hosts</code>.
      </p>
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
        {showToml && (
          <div className="mt-2">
            <TOMLEditor sectionKey="fleet" rawValue={config.fleet} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ── Infrastructure → Datacenters & VMs ─────────────────────── */

interface InfraVM {
  name: string;
  host: string;
  lan_ip: string;
  public_ip: string;
  type: string;
  port: string;
  user: string;
  key_path: string;
  chain_name: string;
  ping_country: string;
  ping_provider: string;
}

interface InfraHostFields {
  name: string;
  lan_ip: string;
  public_ip: string;
  vrack_ip: string;
  user: string;
  ssh_key_path: string;
  port: string;
}

interface InfraVproxFields {
  user: string;
  ssh_key_path: string;
}

interface InfraEntry {
  file: string;
  datacenter: string;
  host: Partial<InfraHostFields>;
  vprox: Partial<InfraVproxFields>;
  vms: Array<Record<string, unknown>>;
}

const emptyVM = (): InfraVM => ({
  name: '', host: '', lan_ip: '', public_ip: '', type: 'validator',
  port: '22', user: '', key_path: '', chain_name: '',
  ping_country: '', ping_provider: '',
});

const emptyHost = (): InfraHostFields => ({
  name: '', lan_ip: '', public_ip: '', vrack_ip: '', user: '', ssh_key_path: '', port: '22',
});

const emptyVprox = (): InfraVproxFields => ({
  user: '', ssh_key_path: '',
});

const VM_TYPE_OPTIONS = ['validator', 'sp', 'rpc', 'relayer', 'node', 'webserver', 'bastion', 'other'];

export function DatacenterCard({ entry, onSaved }: { entry: InfraEntry; onSaved: () => void }) {
  const [host, setHost] = useState<InfraHostFields>(() => ({
    name:         String(entry.host?.name         ?? ''),
    lan_ip:       String(entry.host?.lan_ip       ?? ''),
    public_ip:    String(entry.host?.public_ip    ?? ''),
    vrack_ip:     String(entry.host?.vrack_ip     ?? ''),
    user:         String(entry.host?.user         ?? ''),
    ssh_key_path: String(entry.host?.ssh_key_path ?? ''),
    port:         String(entry.host?.port         ?? '22'),
  }));

  const [vprox, setVprox] = useState<InfraVproxFields>(() => ({
    user:         String(entry.vprox?.user         ?? ''),
    ssh_key_path: String(entry.vprox?.ssh_key_path ?? ''),
  }));

  const [vms, setVMs] = useState<InfraVM[]>(() =>
    (entry.vms ?? []).map((v) => ({
      name:         String(v.name         ?? ''),
      host:         String(v.host         ?? ''),
      lan_ip:       String(v.lan_ip       ?? ''),
      public_ip:    String(v.public_ip    ?? ''),
      type:         String(v.type         ?? 'validator'),
      port:         String(v.port         ?? '22'),
      user:         String(v.user         ?? ''),
      key_path:     String(v.key_path     ?? ''),
      chain_name:   String(v.chain_name   ?? ''),
      ping_country: String(v.ping_country ?? ''),
      ping_provider:String(v.ping_provider ?? ''),
    }))
  );

  const [showRaw, setShowRaw] = useState(false);

  const saveMut = useMutation({
    mutationFn: () => saveConfig('infra', {
      datacenter:       entry.datacenter,
      host_name:        host.name,
      host_lan_ip:      host.lan_ip,
      host_public_ip:   host.public_ip,
      host_vrack_ip:    host.vrack_ip,
      host_user:        host.user,
      host_ssh_key_path:host.ssh_key_path,
      host_port:        host.port ? Number(host.port) : 22,
      vprox_user:       vprox.user,
      vprox_ssh_key_path:vprox.ssh_key_path,
      vms_json:         JSON.stringify(vms.map((v) => ({
        ...v,
        port: v.port ? Number(v.port) : 22,
      }))),
    }),
    onSuccess: onSaved,
  });

  const setHostField = (k: keyof InfraHostFields) => (v: string) =>
    setHost((h) => ({ ...h, [k]: v }));

  const setVproxField = (k: keyof InfraVproxFields) => (v: string) =>
    setVprox((p) => ({ ...p, [k]: v }));

  const setVMField = (i: number, k: keyof InfraVM) => (v: string) =>
    setVMs((rows) => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  const removeVM = (i: number) =>
    setVMs((rows) => rows.filter((_, idx) => idx !== i));

  const addVM = () => setVMs((rows) => [...rows, emptyVM()]);

  return (
    <div className="card space-y-4">
      {/* Datacenter header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--vn-text)' }}>
          {entry.datacenter}
        </span>
        <span className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
          config/infra/{entry.file}
        </span>
      </div>

      {/* Host section */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>
          Host / Hypervisor
          <span className="ml-1 font-normal">— Physical server running the VMs. Leave blank if using standalone VPS.</span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <LabeledInput label="Hostname / FQDN" value={host.name} onChange={setHostField('name')} placeholder="qc.vnodesv.net" />
          <LabeledInput label="LAN IP" value={host.lan_ip} onChange={setHostField('lan_ip')} placeholder="10.0.0.1" />
          <LabeledInput label="Public IP" value={host.public_ip} onChange={setHostField('public_ip')} placeholder="203.0.113.10" />
          <LabeledInput label="vRack IP (cross-DC private, optional)" value={host.vrack_ip} onChange={setHostField('vrack_ip')} placeholder="10.1.0.1" />
          <LabeledInput label="SSH Port" value={host.port} onChange={setHostField('port')} placeholder="22" />
          <LabeledInput label="SSH User (hypervisor only)" value={host.user} onChange={setHostField('user')} placeholder="ubuntu" />
          <LabeledInput label="SSH Key Path (hypervisor only)" value={host.ssh_key_path} onChange={setHostField('ssh_key_path')} placeholder="/home/ubuntu/.ssh/id_rsa" />
        </div>
      </div>

      {/* vOps → VM Credentials section */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>
          vOps → VM Credentials
          <span className="ml-1 font-normal">— Default SSH user and key used to connect to VMs (separate from hypervisor).</span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <LabeledInput label="VM SSH User" value={vprox.user} onChange={setVproxField('user')} placeholder="vnodesv" />
          <LabeledInput label="VM SSH Key Path" value={vprox.ssh_key_path} onChange={setVproxField('ssh_key_path')} placeholder="/home/vnodesv/.vOps/secret/vops_ssh_key" wide />
        </div>
      </div>

      {/* VMs section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium" style={{ color: 'var(--vn-text-muted)' }}>
            Virtual Machines
            <span className="ml-1 font-normal">— VMs polled via SSH for metrics and fleet commands.</span>
          </p>
          <button
            onClick={addVM}
            className="btn btn-secondary btn-sm"
          >
            + Add VM
          </button>
        </div>

        {vms.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
            No VMs defined. Click "+ Add VM" to add one.
          </p>
        ) : (
          <div className="space-y-3">
            {vms.map((vm, i) => (
              <div
                key={i}
                className="rounded-md p-3 space-y-2"
                style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: 'var(--vn-text)' }}>
                    VM {i + 1}{vm.name ? ` — ${vm.name}` : ''}
                  </span>
                  <button
                    onClick={() => removeVM(i)}
                    className="btn btn-danger btn-sm"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <LabeledInput label="VM Name" value={vm.name} onChange={setVMField(i, 'name')} placeholder="www-vm" />
                  <LabeledInput label="SSH Host (IP or hostname)" value={vm.host} onChange={setVMField(i, 'host')} placeholder="10.0.0.2" />
                  <LabeledInput label="LAN IP" value={vm.lan_ip} onChange={setVMField(i, 'lan_ip')} placeholder="10.0.0.2" />
                  <LabeledInput label="Public IP" value={vm.public_ip} onChange={setVMField(i, 'public_ip')} placeholder="203.0.113.11" />
                  <div>
                    <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>Type</label>
                    <select
                      value={vm.type}
                      onChange={(e) => setVMField(i, 'type')(e.target.value)}
                      className="vn-input w-full"
                    >
                      {VM_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <LabeledInput label="SSH Port" value={vm.port} onChange={setVMField(i, 'port')} placeholder="22" />
                  <LabeledInput label="SSH User" value={vm.user} onChange={setVMField(i, 'user')} placeholder="ubuntu" />
                  <LabeledInput label="SSH Key Path" value={vm.key_path} onChange={setVMField(i, 'key_path')} placeholder="/path/to/key" />
                  <LabeledInput label="Chain Name (slug)" value={vm.chain_name} onChange={setVMField(i, 'chain_name')} placeholder="cosmos" />
                  <LabeledInput label="Ping Country (ISO)" value={vm.ping_country} onChange={setVMField(i, 'ping_country')} placeholder="CA" />
                  <LabeledInput label="Ping Provider" value={vm.ping_provider} onChange={setVMField(i, 'ping_provider')} placeholder="Hetzner" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Raw TOML toggle */}
      <div>
        <button
          onClick={() => setShowRaw((s) => !s)}
          className="text-xs cursor-pointer"
          style={{ color: 'var(--vn-text-muted)' }}
        >
          {showRaw ? 'Hide' : 'Show'} raw TOML
        </button>
        {showRaw && (
          <pre
            className="mt-2 p-3 rounded-md text-xs overflow-x-auto"
            style={{
              backgroundColor: 'var(--vn-surface-2)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text-subtle)',
              maxHeight: 280,
            }}
          >
            {JSON.stringify({ datacenter: entry.datacenter, host, vms }, null, 2)}
          </pre>
        )}
      </div>

      <SaveBar
        onSave={() => saveMut.mutate()}
        isPending={saveMut.isPending}
        isSuccess={saveMut.isSuccess}
        isError={saveMut.isError}
        error={saveMut.error as Error | null}
      />
    </div>
  );
}

export function NewDatacenterForm({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [dc, setDC] = useState('');
  const [host, setHost] = useState<InfraHostFields>(emptyHost());
  const [vprox, setVprox] = useState<InfraVproxFields>(emptyVprox());

  const saveMut = useMutation({
    mutationFn: () => saveConfig('infra', {
      datacenter:        dc.trim().toLowerCase(),
      host_name:         host.name,
      host_lan_ip:       host.lan_ip,
      host_public_ip:    host.public_ip,
      host_vrack_ip:     host.vrack_ip,
      host_user:         host.user,
      host_ssh_key_path: host.ssh_key_path,
      host_port:         host.port ? Number(host.port) : 22,
      vprox_user:        vprox.user,
      vprox_ssh_key_path:vprox.ssh_key_path,
      vms_json:          '[]',
    }),
    onSuccess: () => {
      setOpen(false);
      setDC('');
      setHost(emptyHost());
      setVprox(emptyVprox());
      onSaved();
    },
  });

  const setHostField = (k: keyof InfraHostFields) => (v: string) =>
    setHost((h) => ({ ...h, [k]: v }));

  const setVproxField = (k: keyof InfraVproxFields) => (v: string) =>
    setVprox((p) => ({ ...p, [k]: v }));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2 text-xs rounded-lg cursor-pointer"
        style={{
          border: '1px dashed var(--vn-border)',
          color: 'var(--vn-text-muted)',
          backgroundColor: 'transparent',
        }}
      >
        + Add New Datacenter
      </button>
    );
  }

  return (
    <div
      className="rounded-lg p-4 space-y-4"
      style={{ border: '1px dashed var(--vn-primary)', backgroundColor: 'var(--vn-surface)' }}
    >
      <p className="text-xs font-semibold" style={{ color: 'var(--vn-text)' }}>New Datacenter</p>
      <LabeledInput label="Datacenter Name (slug, e.g. hetzner-fsn1)" value={dc} onChange={setDC} placeholder="hetzner-fsn1" />
      <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>Host / Hypervisor (optional — leave blank for standalone VPS)</p>
      <div className="grid grid-cols-2 gap-2">
        <LabeledInput label="Hostname / FQDN" value={host.name} onChange={setHostField('name')} placeholder="qc.vnodesv.net" />
        <LabeledInput label="LAN IP" value={host.lan_ip} onChange={setHostField('lan_ip')} placeholder="10.0.0.1" />
        <LabeledInput label="Public IP" value={host.public_ip} onChange={setHostField('public_ip')} placeholder="203.0.113.10" />
        <LabeledInput label="vRack IP (cross-DC private, optional)" value={host.vrack_ip} onChange={setHostField('vrack_ip')} placeholder="10.1.0.1" />
        <LabeledInput label="SSH Port" value={host.port} onChange={setHostField('port')} placeholder="22" />
        <LabeledInput label="SSH User (hypervisor only)" value={host.user} onChange={setHostField('user')} placeholder="ubuntu" />
        <LabeledInput label="SSH Key Path (hypervisor only)" value={host.ssh_key_path} onChange={setHostField('ssh_key_path')} placeholder="/home/ubuntu/.ssh/id_rsa" />
      </div>
      <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>vOps → VM Credentials (default SSH creds for VM connections)</p>
      <div className="grid grid-cols-2 gap-2">
        <LabeledInput label="VM SSH User" value={vprox.user} onChange={setVproxField('user')} placeholder="vnodesv" />
        <LabeledInput label="VM SSH Key Path" value={vprox.ssh_key_path} onChange={setVproxField('ssh_key_path')} placeholder="/home/vnodesv/.vOps/secret/vops_ssh_key" wide />
      </div>
      <SaveBar
        onSave={() => saveMut.mutate()}
        onCancel={() => { setOpen(false); setDC(''); setHost(emptyHost()); setVprox(emptyVprox()); }}
        isPending={saveMut.isPending}
        isSuccess={saveMut.isSuccess}
        isError={saveMut.isError}
        error={saveMut.error as Error | null}
      />
    </div>
  );
}

export function DatacentersPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const infras = (config.infras as InfraEntry[]) ?? [];
  const onSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['config'] });
    queryClient.invalidateQueries({ queryKey: ['fleet-host-inventory'] });
  }, [queryClient]);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Datacenters & VM Inventory"
        subtitle="Each file in config/infra/ represents one datacenter. Hosts are physical hypervisors; VMs are the machines they run. vOps uses this inventory for SSH polling, fleet commands, and VM lifecycle management via libvirt."
      >
        <div className="space-y-3">
          {infras.length === 0 ? (
            <div
              className="p-4 rounded-lg text-xs text-center"
              style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px dashed var(--vn-border)', color: 'var(--vn-text-muted)' }}
            >
              No datacenter files found in <code>config/infra/</code>. Add one below or run the Setup Wizard.
            </div>
          ) : (
            infras.map((dc) => (
              <DatacenterCard key={dc.file} entry={dc} onSaved={onSaved} />
            ))
          )}
          <NewDatacenterForm onSaved={onSaved} />
        </div>
      </SectionCard>
    </div>
  );
}
