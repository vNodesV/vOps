import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BASE } from '../api/client';
import {
  getConfig,
  saveConfig,
  genAPIKey,
  hashPassword,
  getSSHPubKey,
  genSSHKey,
  scanAllVMs,
  getVMHistory,
} from '../api';
import type { ConfigSnapshot, VMStatus, VMMetricPoint } from '../api/types';
import Spinner from '../components/Spinner';
import Badge from '../components/Badge';

/* ── Utility components ──────────────────────────────────────── */

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg p-5 space-y-4"
      style={{ backgroundColor: 'var(--vn-surface)', border: '1px solid var(--vn-border)' }}
    >
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--vn-text)' }}>{title}</h3>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-muted)' }}>{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function FieldDoc({
  label,
  hint,
  example,
}: {
  label: string;
  hint: string;
  example?: string;
}) {
  return (
    <div className="flex gap-3 py-1.5" style={{ borderBottom: '1px solid var(--vn-border)' }}>
      <code
        className="text-xs shrink-0 w-44 pt-0.5"
        style={{ color: 'var(--vn-primary)' }}
      >
        {label}
      </code>
      <div>
        <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>{hint}</p>
        {example && (
          <code className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
            e.g. {example}
          </code>
        )}
      </div>
    </div>
  );
}

function MetricBar({
  value,
  warn = 70,
  danger = 85,
}: {
  value: number;
  warn?: number;
  danger?: number;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const color =
    pct >= danger
      ? 'var(--vn-danger)'
      : pct >= warn
        ? 'var(--vn-warning)'
        : 'var(--vn-success)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 90 }}>
      <div
        style={{
          flex: 1,
          height: 5,
          borderRadius: 3,
          backgroundColor: 'var(--vn-border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </div>
      <span className="text-xs tabular-nums" style={{ color, minWidth: 30 }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function Sparkline({
  pts,
  color,
  height = 22,
  width = 90,
}: {
  pts: number[];
  color: string;
  height?: number;
  width?: number;
}) {
  if (pts.length < 2) return null;
  const step = width / (pts.length - 1);
  const points = pts
    .map((v, i) => {
      const x = i * step;
      const y = height - (Math.min(100, Math.max(0, v)) / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function VMHistorySparkline({ vmName }: { vmName: string }) {
  const { data } = useQuery({
    queryKey: ['vm-history', vmName],
    queryFn: () => getVMHistory(vmName, 6),
    staleTime: 60_000,
    retry: false,
  });
  const pts: VMMetricPoint[] = data?.history ?? [];
  if (pts.length < 2)
    return <span style={{ color: 'var(--vn-text-subtle)', fontSize: '0.65rem' }}>no data</span>;
  return (
    <div style={{ position: 'relative', height: 22, width: 90 }}>
      <div style={{ position: 'absolute', top: 0, left: 0 }}>
        <Sparkline pts={pts.map((p) => p.storage_pct)} color="var(--vn-warning)" />
      </div>
      <div style={{ position: 'absolute', top: 0, left: 0 }}>
        <Sparkline pts={pts.map((p) => p.mem_pct)} color="var(--vn-success)" />
      </div>
      <div style={{ position: 'absolute', top: 0, left: 0 }}>
        <Sparkline pts={pts.map((p) => p.cpu_pct)} color="var(--vn-primary)" />
      </div>
    </div>
  );
}

function SaveBar({
  onSave,
  onCancel,
  isPending,
  isSuccess,
  isError,
  error,
}: {
  onSave: () => void;
  onCancel?: () => void;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={isPending}
          className="px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer disabled:opacity-50
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{ border: '1px solid var(--vn-border)', color: 'var(--vn-text-muted)' }}
          >
            Cancel
          </button>
        )}
      </div>
      {isSuccess && (
        <p className="text-xs" style={{ color: 'var(--vn-success)' }} role="alert">
          ✓ Saved successfully.
        </p>
      )}
      {isError && (
        <p className="text-xs" style={{ color: 'var(--vn-danger)' }} role="alert">
          ✗ {(error as Error)?.message ?? 'Save failed.'}
        </p>
      )}
    </div>
  );
}

function TOMLEditor({
  sectionKey,
  rawValue,
  fieldDocs,
}: {
  sectionKey: string;
  rawValue: unknown;
  fieldDocs?: { label: string; hint: string; example?: string }[];
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const toDisplay = (v: unknown) =>
    typeof v === 'string' ? v : JSON.stringify(v ?? 'Not configured', null, 2);

  const [text, setText] = useState(() => toDisplay(rawValue));

  const saveMut = useMutation({
    mutationFn: (payload: unknown) => saveConfig(sectionKey, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setEditing(false);
    },
  });

  const handleSave = useCallback(() => {
    try {
      saveMut.mutate(JSON.parse(text));
    } catch {
      saveMut.mutate(text);
    }
  }, [text, saveMut]);

  return (
    <div className="space-y-3">
      {fieldDocs && !editing && (
        <div className="space-y-0">
          {fieldDocs.map((f) => (
            <FieldDoc key={f.label} label={f.label} hint={f.hint} example={f.example} />
          ))}
        </div>
      )}

      {!editing ? (
        <div>
          <pre
            className="p-3 rounded-md text-xs overflow-x-auto"
            style={{
              backgroundColor: 'var(--vn-surface-2)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)',
              maxHeight: 320,
            }}
          >
            {toDisplay(rawValue) || 'Not configured — click Edit to add.'}
          </pre>
          <button
            onClick={() => {
              setText(toDisplay(rawValue));
              setEditing(true);
            }}
            className="mt-2 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`cfg-${sectionKey}`} className="sr-only">
            {sectionKey} configuration
          </label>
          <textarea
            id={`cfg-${sectionKey}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            className="w-full p-3 rounded-md text-xs font-mono outline-none resize-y
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{
              backgroundColor: 'var(--vn-surface-2)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)',
            }}
          />
          <SaveBar
            onSave={handleSave}
            onCancel={() => setEditing(false)}
            isPending={saveMut.isPending}
            isSuccess={saveMut.isSuccess}
            isError={saveMut.isError}
            error={saveMut.error as Error | null}
          />
        </div>
      )}
    </div>
  );
}

/* ── TOML helpers ────────────────────────────────────────────── */

function parseTOML(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  let section = '';
  for (const line of (raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[[')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1).trim();
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      const hi = val.indexOf(' #');
      if (hi > 0) val = val.slice(0, hi).trim();
    }
    result[section ? `${section}.${key}` : key] = val;
  }
  return result;
}

/* ── Section group definitions ───────────────────────────────── */

interface NavSection {
  id: string;
  label: string;
}

interface NavGroup {
  id: string;
  label: string;
  desc: string;
  sections: NavSection[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    desc: 'Hosts, virtual machines, and fleet SSH connectivity',
    sections: [
      { id: 'fleet-scan', label: 'Fleet Scan' },
      { id: 'fleet-ssh', label: 'SSH Defaults' },
      { id: 'datacenters', label: 'Datacenters & VMs' },
    ],
  },
  {
    id: 'proxy',
    label: 'Proxy & Chains',
    desc: 'vProx reverse proxy and Cosmos chain endpoint configuration',
    sections: [
      { id: 'ports', label: 'vProx Ports' },
      { id: 'proxy-controls', label: 'Proxy Controls' },
      { id: 'chain-profiles', label: 'Chain Profiles' },
    ],
  },
  {
    id: 'vops-core',
    label: 'vOps Core',
    desc: 'Dashboard, authentication, ingestion, and backup settings',
    sections: [
      { id: 'vops', label: 'Dashboard & Auth' },
      { id: 'backup', label: 'Backups' },
    ],
  },
  {
    id: 'security',
    label: 'Security & Access',
    desc: 'SSH keys, API keys, password management, and firewall',
    sections: [
      { id: 'credentials', label: 'Keys & Credentials' },
    ],
  },
  {
    id: 'preferences',
    label: 'Preferences',
    desc: 'Dashboard appearance and display options',
    sections: [
      { id: 'display', label: 'Display' },
    ],
  },
];

/* ── Infrastructure → Fleet Scan ─────────────────────────────── */

function FleetScanPanel() {
  const queryClient = useQueryClient();

  const scanMut = useMutation({
    mutationFn: scanAllVMs,
    onSuccess: (data) => {
      queryClient.setQueryData(['vm-status'], data);
    },
  });

  const cachedQ = useQuery({
    queryKey: ['vm-status'],
    queryFn: () => Promise.resolve({ vms: [] as VMStatus[], hosts: [] as unknown[] }),
    enabled: false,
  });

  const vms: VMStatus[] =
    (scanMut.data?.vms ?? (cachedQ.data as { vms: VMStatus[] } | undefined)?.vms) ?? [];

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
          Before scanning, confirm all pre-requisites:
        </div>
        <ul className="space-y-1 list-none" style={{ color: 'var(--vn-text-muted)' }}>
          <li>1. <strong>SSH key path</strong> — set in <em>Infrastructure → SSH Defaults → key_path</em>. The key must exist on this host and be readable by the vOps process.</li>
          <li>2. <strong>SSH user &amp; port</strong> — configured in <em>Infrastructure → SSH Defaults</em>. The user must have passwordless sudo on each VM (<code>sudoers NOPASSWD</code>).</li>
          <li>3. <strong>VM inventory</strong> — each VM must be listed in <code>config/infra/&lt;datacenter&gt;.toml</code> with a valid <code>lan_ip</code> or <code>public_ip</code>.</li>
          <li>4. <strong>Network reachability</strong> — the vOps host must be able to reach each VM on the configured SSH port (default 22). Check firewall rules if a VM is offline after scanning.</li>
          <li>5. <strong>Known hosts</strong> — if <code>known_hosts_path</code> is set, each VM's host key must be pre-accepted. Run <code>ssh-keyscan &lt;vm-ip&gt; &gt;&gt; ~/.ssh/known_hosts</code> on first connection.</li>
        </ul>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
          {lastScanned ? `Last scanned: ${lastScanned}` : 'Not yet scanned this session.'}
        </div>
        <button
          onClick={() => scanMut.mutate()}
          disabled={scanMut.isPending}
          className="px-4 py-2 text-sm font-medium rounded-md cursor-pointer disabled:opacity-50 flex items-center gap-2
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
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
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--vn-border)' }}>
          <table className="w-full text-xs" style={{ backgroundColor: 'var(--vn-surface)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--vn-border)' }}>
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
                  style={{ borderBottom: '1px solid var(--vn-border)' }}
                  onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--vn-surface-2)')}
                  onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '')}
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
          Click <strong>Scan All VMs</strong> to poll your fleet via SSH. Make sure VMs are configured
          in <code>config/infra/*.toml</code> and the SSH key is deployed.
        </div>
      )}
    </SectionCard>
  );
}

/* ── Infrastructure → SSH Defaults ──────────────────────────── */

function FleetSSHPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const raw = typeof config.fleet === 'string' ? config.fleet : '';
  const t = parseTOML(raw);

  const [fields, setFields] = useState({
    ssh_user:          t['ssh.user']              ?? '',
    ssh_key_path:      t['ssh.key_path']          ?? '',
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
        <LabeledInput label="SSH Key Path" value={fields.ssh_key_path} onChange={set('ssh_key_path')} placeholder="/home/ubuntu/.vprox/secret/vops_ssh_key" wide />
        <LabeledInput label="Connection Timeout (sec)" value={fields.ssh_timeout_sec} onChange={set('ssh_timeout_sec')} placeholder="15" />
        <LabeledInput label="Poll Interval (sec)" value={fields.poll_interval_sec} onChange={set('poll_interval_sec')} placeholder="60" />
        <LabeledInput label="Default Datacenter" value={fields.datacenter} onChange={set('datacenter')} placeholder="hetzner" />
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--vn-text-subtle)' }}>
        SSH User must have passwordless <code>sudo</code> on each VM. Generate the SSH key in Security → Keys &amp; Credentials.
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
  user: string;
  ssh_key_path: string;
}

interface InfraEntry {
  file: string;
  datacenter: string;
  host: Partial<InfraHostFields>;
  vms: Array<Record<string, unknown>>;
}

const emptyVM = (): InfraVM => ({
  name: '', host: '', lan_ip: '', public_ip: '', type: 'validator',
  port: '22', user: '', key_path: '', chain_name: '',
  ping_country: '', ping_provider: '',
});

const emptyHost = (): InfraHostFields => ({
  name: '', lan_ip: '', public_ip: '', user: '', ssh_key_path: '',
});

const VM_TYPE_OPTIONS = ['validator', 'sp', 'rpc', 'relayer', 'node', 'webserver', 'bastion', 'other'];

function LabeledInput({
  label, value, onChange, placeholder, wide,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1 text-xs rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
        style={{
          backgroundColor: 'var(--vn-surface-2)',
          border: '1px solid var(--vn-border)',
          color: 'var(--vn-text)',
        }}
      />
    </div>
  );
}

function DatacenterCard({ entry, onSaved }: { entry: InfraEntry; onSaved: () => void }) {
  const [host, setHost] = useState<InfraHostFields>(() => ({
    name:         String(entry.host?.name         ?? ''),
    lan_ip:       String(entry.host?.lan_ip       ?? ''),
    public_ip:    String(entry.host?.public_ip    ?? ''),
    user:         String(entry.host?.user         ?? ''),
    ssh_key_path: String(entry.host?.ssh_key_path ?? ''),
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
      host_user:        host.user,
      host_ssh_key_path:host.ssh_key_path,
      vms_json:         JSON.stringify(vms.map((v) => ({
        ...v,
        port: v.port ? Number(v.port) : 22,
      }))),
    }),
    onSuccess: onSaved,
  });

  const setHostField = (k: keyof InfraHostFields) => (v: string) =>
    setHost((h) => ({ ...h, [k]: v }));

  const setVMField = (i: number, k: keyof InfraVM) => (v: string) =>
    setVMs((rows) => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  const removeVM = (i: number) =>
    setVMs((rows) => rows.filter((_, idx) => idx !== i));

  const addVM = () => setVMs((rows) => [...rows, emptyVM()]);

  return (
    <div
      className="rounded-lg p-4 space-y-4"
      style={{ border: '1px solid var(--vn-border)', backgroundColor: 'var(--vn-surface)' }}
    >
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
          <LabeledInput label="SSH User" value={host.user} onChange={setHostField('user')} placeholder="ubuntu" />
          <LabeledInput label="SSH Key Path" value={host.ssh_key_path} onChange={setHostField('ssh_key_path')} placeholder="/home/ubuntu/.vprox/secret/fleet_key" wide />
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
            className="px-2 py-0.5 text-xs rounded cursor-pointer"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)', color: 'var(--vn-primary)' }}
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
                    className="text-xs cursor-pointer px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--vn-danger)', border: '1px solid var(--vn-danger)' }}
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
                      className="w-full px-2 py-1 text-xs rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                      style={{
                        backgroundColor: 'var(--vn-surface-2)',
                        border: '1px solid var(--vn-border)',
                        color: 'var(--vn-text)',
                      }}
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

function NewDatacenterForm({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [dc, setDC] = useState('');
  const [host, setHost] = useState<InfraHostFields>(emptyHost());

  const saveMut = useMutation({
    mutationFn: () => saveConfig('infra', {
      datacenter:       dc.trim().toLowerCase(),
      host_name:        host.name,
      host_lan_ip:      host.lan_ip,
      host_public_ip:   host.public_ip,
      host_user:        host.user,
      host_ssh_key_path:host.ssh_key_path,
      vms_json:         '[]',
    }),
    onSuccess: () => {
      setOpen(false);
      setDC('');
      setHost(emptyHost());
      onSaved();
    },
  });

  const setHostField = (k: keyof InfraHostFields) => (v: string) =>
    setHost((h) => ({ ...h, [k]: v }));

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
        <LabeledInput label="SSH User" value={host.user} onChange={setHostField('user')} placeholder="ubuntu" />
        <LabeledInput label="SSH Key Path" value={host.ssh_key_path} onChange={setHostField('ssh_key_path')} placeholder="/home/ubuntu/.vprox/secret/fleet_key" wide />
      </div>
      <SaveBar
        onSave={() => saveMut.mutate()}
        onCancel={() => { setOpen(false); setDC(''); setHost(emptyHost()); }}
        isPending={saveMut.isPending}
        isSuccess={saveMut.isSuccess}
        isError={saveMut.isError}
        error={saveMut.error as Error | null}
      />
    </div>
  );
}

function DatacentersPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const infras = (config.infras as InfraEntry[]) ?? [];
  const onSaved = useCallback(() => queryClient.invalidateQueries({ queryKey: ['config'] }), [queryClient]);

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

/* ── Proxy & Chains → Ports ──────────────────────────────────── */

function PortsPanel({ config }: { config: ConfigSnapshot }) {
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

function ProxyControlsPanel({ config }: { config: ConfigSnapshot }) {
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
            className="w-full px-2 py-1 text-xs rounded-md outline-none"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)', color: 'var(--vn-text)' }}
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
            className="w-full px-2 py-1 text-xs rounded-md outline-none"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)', color: 'var(--vn-text)' }}
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

function ChainCard({ chain, onSaved }: { chain: ChainEntry; onSaved: () => void }) {
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
    <div
      className="rounded-lg p-4 space-y-3"
      style={{ border: '1px solid var(--vn-border)', backgroundColor: 'var(--vn-surface)' }}
    >
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

function NewChainForm({ onSaved }: { onSaved: () => void }) {
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

function ChainProfilesPanel({ config }: { config: ConfigSnapshot }) {
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

/* ── vOps Core → Dashboard & Auth ────────────────────────────── */

function VOpsPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const raw = typeof config.vops === 'string' ? config.vops : '';
  const t = parseTOML(raw);

  const [fields, setFields] = useState({
    port:              t['vops.port']                 ?? '8889',
    bind_address:      t['vops.bind_address']         ?? '127.0.0.1',
    base_path:         t['vops.base_path']            ?? '/vlog/',
    username:          t['vops.auth.username']        ?? 'admin',
    auto_enrich:       t['vops.intel.auto_enrich']    ?? 'true',
    cache_ttl_hours:   t['vops.intel.cache_ttl_hours']?? '24',
    rate_limit_rpm:    t['vops.intel.rate_limit_rpm'] ?? '10',
    watch_interval_sec:t['vops.watch_interval_sec']   ?? '60',
    poll_interval_sec: t['vops.push.poll_interval_sec']?? '60',
  });

  const [showToml, setShowToml] = useState(false);
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveConfig('vops', {
      port:               Number(fields.port)               || 8889,
      bind_address:       fields.bind_address,
      base_path:          fields.base_path,
      username:           fields.username,
      auto_enrich:        fields.auto_enrich === 'true',
      cache_ttl_hours:    Number(fields.cache_ttl_hours)    || 24,
      rate_limit_rpm:     Number(fields.rate_limit_rpm)     || 10,
      watch_interval_sec: Number(fields.watch_interval_sec) || 60,
      poll_interval_sec:  Number(fields.poll_interval_sec)  || 60,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  return (
    <SectionCard
      title="vOps Dashboard & Auth"
      subtitle="Core vOps settings: network binding, admin username, IP intelligence tuning. API keys and password hash are managed via Security → Keys & Credentials and the raw TOML below."
    >
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>Network</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <LabeledInput label="Bind Address" value={fields.bind_address} onChange={set('bind_address')} placeholder="127.0.0.1" />
        <LabeledInput label="Port" value={fields.port} onChange={set('port')} placeholder="8889" />
        <LabeledInput label="Base Path" value={fields.base_path} onChange={set('base_path')} placeholder="/vlog/" wide />
      </div>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>Authentication</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <LabeledInput label="Admin Username" value={fields.username} onChange={set('username')} placeholder="admin" />
      </div>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>IP Intelligence</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>Auto-Enrich</label>
          <select value={fields.auto_enrich} onChange={(e) => set('auto_enrich')(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded-md outline-none"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)', color: 'var(--vn-text)' }}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
        <LabeledInput label="Cache TTL (hours)" value={fields.cache_ttl_hours} onChange={set('cache_ttl_hours')} placeholder="24" />
        <LabeledInput label="Rate Limit (req/min)" value={fields.rate_limit_rpm} onChange={set('rate_limit_rpm')} placeholder="10" />
      </div>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>Polling</p>
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput label="Watch Interval (sec)" value={fields.watch_interval_sec} onChange={set('watch_interval_sec')} placeholder="60" />
        <LabeledInput label="Fleet Poll Interval (sec)" value={fields.poll_interval_sec} onChange={set('poll_interval_sec')} placeholder="60" />
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--vn-text-subtle)' }}>
        API keys (VirusTotal, AbuseIPDB, Shodan), password hash, and API key are set via the raw TOML editor below.
        Secrets show as <code>[REDACTED]</code> — paste a new value to update.
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
          {showToml ? 'Hide' : 'View / Edit raw TOML'} (includes secrets)
        </button>
        {showToml && <div className="mt-2"><TOMLEditor sectionKey="vops" rawValue={config.vops} /></div>}
      </div>
    </SectionCard>
  );
}

/* ── vOps Core → Backups ─────────────────────────────────────── */

function BackupsPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const raw = typeof config.backup === 'string' ? config.backup : '';
  const t = parseTOML(raw);

  const [fields, setFields] = useState({
    automation:         t['backup.automation']          ?? 'false',
    interval_days:      t['backup.interval_days']       ?? '7',
    max_size_mb:        t['backup.max_size_mb']         ?? '100',
    check_interval_min: t['backup.check_interval_min']  ?? '10',
    destination:        t['backup.destination']         ?? '',
    compression:        t['backup.compression']         ?? 'tar.gz',
  });

  const [showToml, setShowToml] = useState(false);
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveConfig('backup', {
      automation:          fields.automation === 'true',
      interval_days:       Number(fields.interval_days)       || 7,
      max_size_mb:         Number(fields.max_size_mb)         || 100,
      check_interval_min:  Number(fields.check_interval_min)  || 10,
      destination:         fields.destination,
      compression:         fields.compression,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  return (
    <SectionCard
      title="Backup Configuration"
      subtitle="Automated backup schedule for vProx log archives. Disable automation to manage backups manually via the CLI (vprox --new-backup)."
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>Automation</label>
          <select value={fields.automation} onChange={(e) => set('automation')(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded-md outline-none"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)', color: 'var(--vn-text)' }}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
        <LabeledInput label="Interval (days)" value={fields.interval_days} onChange={set('interval_days')} placeholder="7" />
        <LabeledInput label="Max Size (MB)" value={fields.max_size_mb} onChange={set('max_size_mb')} placeholder="100" />
        <LabeledInput label="Check Interval (min)" value={fields.check_interval_min} onChange={set('check_interval_min')} placeholder="10" />
        <LabeledInput label="Destination Path" value={fields.destination} onChange={set('destination')} placeholder="/var/backups/vprox" wide />
        <div>
          <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>Compression</label>
          <select value={fields.compression} onChange={(e) => set('compression')(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded-md outline-none"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)', color: 'var(--vn-text)' }}>
            <option value="tar.gz">tar.gz</option>
            <option value="zip">zip</option>
          </select>
        </div>
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
          {showToml ? 'Hide' : 'View'} raw TOML (includes file lists)
        </button>
        {showToml && <div className="mt-2"><TOMLEditor sectionKey="backup" rawValue={config.backup} /></div>}
      </div>
    </SectionCard>
  );
}

/* ── Security → Keys & Credentials ──────────────────────────── */

function SecurityPanel() {
  const [passwordInput, setPasswordInput] = useState('');
  const [generatedHash, setGeneratedHash] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [sshMsg, setSSHMsg] = useState('');

  const sshQ = useQuery({
    queryKey: ['ssh-pub-key'],
    queryFn: getSSHPubKey,
    retry: false,
  });

  const genSSHMut = useMutation({
    mutationFn: genSSHKey,
    onSuccess: (data) => {
      sshQ.refetch();
      setSSHMsg(`Key written to: ${data.private_key_path}`);
    },
  });

  const apiKeyMut = useMutation({
    mutationFn: genAPIKey,
    onSuccess: (data) => setGeneratedKey(data.key),
  });

  const hashMut = useMutation({
    mutationFn: () => hashPassword(passwordInput),
    onSuccess: (data) => {
      setGeneratedHash(data.hash);
      setPasswordInput('');
    },
  });

  return (
    <div className="space-y-4">
      {/* SSH Key */}
      <SectionCard
        title="Fleet SSH Key"
        subtitle="vOps uses an ed25519 SSH key to connect to your VMs for polling, script execution, and upgrades. After generating, copy the public key to each VM's ~/.ssh/authorized_keys file."
      >
        <FieldDoc
          label="Key location"
          hint="Private key is stored at ~/.vprox/secret/vops_ssh_key (mode 0600). Public key has .pub suffix."
        />
        {sshQ.isLoading ? (
          <Spinner size={16} label="Loading SSH key" />
        ) : sshQ.data?.public_key ? (
          <pre
            className="p-3 rounded text-xs overflow-x-auto"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)', wordBreak: 'break-all' }}
          >
            {sshQ.data.public_key}
          </pre>
        ) : (
          <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
            No SSH key found — generate one below.
          </p>
        )}
        <button
          onClick={() => genSSHMut.mutate()}
          disabled={genSSHMut.isPending}
          className="px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer disabled:opacity-50
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
        >
          {genSSHMut.isPending ? 'Generating…' : sshQ.data?.public_key ? '↺ Regenerate SSH Key' : '+ Generate SSH Key'}
        </button>
        {sshMsg && (
          <p className="text-xs" style={{ color: 'var(--vn-success)' }}>✓ {sshMsg}</p>
        )}
        {genSSHMut.isError && (
          <p className="text-xs" style={{ color: 'var(--vn-danger)' }}>
            ✗ {(genSSHMut.error as Error).message}
          </p>
        )}
      </SectionCard>

      {/* API Key */}
      <SectionCard
        title="API Key"
        subtitle="The vOps API key is used for programmatic access and vProx webhook integration. After generating, save the key — it will not be shown again. Paste it into vops.toml [vops.auth] api_key."
      >
        <button
          onClick={() => apiKeyMut.mutate()}
          disabled={apiKeyMut.isPending}
          className="px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer disabled:opacity-50
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
        >
          {apiKeyMut.isPending ? 'Generating…' : '+ Generate API Key'}
        </button>
        {generatedKey && (
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--vn-warning)' }}>
              ⚠ Copy this key now — it will not be shown again.
            </p>
            <pre
              className="p-3 rounded text-xs font-mono overflow-x-auto"
              style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
            >
              {generatedKey}
            </pre>
          </div>
        )}
        {apiKeyMut.isError && (
          <p className="text-xs" style={{ color: 'var(--vn-danger)' }}>
            ✗ {(apiKeyMut.error as Error).message}
          </p>
        )}
      </SectionCard>

      {/* Password Hash Utility */}
      <SectionCard
        title="Password Hash Utility"
        subtitle="Generate a bcrypt hash (cost=12) for a new admin password. Paste the result into vops.toml [vops.auth] password_hash. The password itself is never stored."
      >
        <div className="flex gap-2">
          <label htmlFor="hash-pw" className="sr-only">
            Password to hash
          </label>
          <input
            id="hash-pw"
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="Enter new password"
            className="flex-1 px-3 py-1.5 rounded-md text-sm outline-none
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{
              backgroundColor: 'var(--vn-surface-2)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)',
            }}
            onKeyDown={(e) => e.key === 'Enter' && passwordInput && hashMut.mutate()}
          />
          <button
            onClick={() => hashMut.mutate()}
            disabled={hashMut.isPending || !passwordInput}
            className="px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer disabled:opacity-50
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
          >
            {hashMut.isPending ? 'Hashing…' : 'Hash'}
          </button>
        </div>
        {generatedHash && (
          <pre
            className="p-3 rounded text-xs font-mono break-all"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
          >
            {generatedHash}
          </pre>
        )}
        {hashMut.isError && (
          <p className="text-xs" style={{ color: 'var(--vn-danger)' }}>
            ✗ {(hashMut.error as Error).message}
          </p>
        )}
      </SectionCard>
    </div>
  );
}

/* ── Preferences → Display ───────────────────────────────────── */

function PreferencesPanel() {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState(() => {
    return document.documentElement.getAttribute('data-theme') ?? 'vnodes';
  });
  const [saved, setSaved] = useState(false);

  const saveMut = useMutation({
    mutationFn: (t: string) => saveConfig('preferences', { theme: t }),
    onSuccess: (_, t) => {
      document.documentElement.setAttribute('data-theme', t);
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const themes = [
    { id: 'vnodes', label: 'vNodes Green', desc: 'Classic neon-green terminal aesthetic' },
    { id: 'dark-blue', label: 'Dark Blue', desc: 'Deep navy with blue-teal accents' },
    { id: 'light-blue', label: 'Light Blue', desc: 'Silver-blue professional look' },
  ];

  return (
    <SectionCard
      title="Display Preferences"
      subtitle="Customize the vOps dashboard appearance. The selected theme applies instantly and is saved to vops.toml for persistence across sessions and page reloads."
    >
      <div className="space-y-3">
        {themes.map((t) => (
          <label
            key={t.id}
            className="flex items-start gap-3 p-3 rounded-lg cursor-pointer"
            style={{
              backgroundColor: theme === t.id ? 'var(--vn-surface-2)' : 'transparent',
              border: `1px solid ${theme === t.id ? 'var(--vn-primary)' : 'var(--vn-border)'}`,
            }}
          >
            <input
              type="radio"
              name="theme"
              value={t.id}
              checked={theme === t.id}
              onChange={() => setTheme(t.id)}
              className="mt-0.5 accent-[var(--vn-primary)]"
            />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--vn-text)' }}>
                {t.label}
              </div>
              <div className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
                {t.desc}
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={() => saveMut.mutate(theme)}
          disabled={saveMut.isPending}
          className="px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer disabled:opacity-50
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
        >
          {saveMut.isPending ? 'Saving…' : 'Apply Theme'}
        </button>
        {saved && (
          <span className="text-xs" style={{ color: 'var(--vn-success)' }}>
            ✓ Theme saved.
          </span>
        )}
      </div>
    </SectionCard>
  );
}

/* ── Settings Page (root) ────────────────────────────────────── */

export default function SettingsPage() {
  const [activeGroup, setActiveGroup] = useState('infrastructure');
  const [activeSection, setActiveSection] = useState('fleet-scan');

  const { data: config, isLoading } = useQuery<ConfigSnapshot>({
    queryKey: ['config'],
    queryFn: getConfig,
    retry: false,
  });

  const selectSection = (groupId: string, sectionId: string) => {
    setActiveGroup(groupId);
    setActiveSection(sectionId);
  };

  const renderSection = () => {
    if (isLoading) return <Spinner label="Loading configuration" />;

    switch (activeSection) {
      case 'fleet-scan':
        return <FleetScanPanel />;
      case 'fleet-ssh':
        return config ? <FleetSSHPanel config={config} /> : null;
      case 'datacenters':
        return config ? <DatacentersPanel config={config} /> : null;
      case 'ports':
        return config ? <PortsPanel config={config} /> : null;
      case 'proxy-controls':
        return config ? <ProxyControlsPanel config={config} /> : null;
      case 'chain-profiles':
        return config ? <ChainProfilesPanel config={config} /> : null;
      case 'vops':
        return config ? <VOpsPanel config={config} /> : null;
      case 'backup':
        return config ? <BackupsPanel config={config} /> : null;
      case 'credentials':
        return <SecurityPanel />;
      case 'display':
        return <PreferencesPanel />;
      default:
        return (
          <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
            Select a section from the left.
          </p>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>
            Settings
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-muted)' }}>
            Configure vProx, fleet, chains, authentication, and infrastructure.
          </p>
        </div>
        <button
          onClick={() => { window.location.href = BASE + '/settings/wizard'; }}
          className="px-4 py-2 text-xs font-medium rounded-md cursor-pointer flex items-center gap-2
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{
            backgroundColor: 'var(--vn-surface)',
            border: '1px solid var(--vn-border)',
            color: 'var(--vn-text)',
          }}
        >
          Setup Wizard
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        {/* Left sidebar — groups + sections */}
        <nav className="md:col-span-1 space-y-1" aria-label="Settings navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.id}>
              {/* Group header */}
              <button
                onClick={() => {
                  setActiveGroup(group.id);
                  setActiveSection(group.sections[0].id);
                }}
                className="w-full text-left px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider
                           flex items-center gap-2 cursor-pointer transition-colors
                           focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                style={{
                  color: activeGroup === group.id ? 'var(--vn-primary)' : 'var(--vn-text-muted)',
                  backgroundColor:
                    activeGroup === group.id ? 'var(--vn-surface-2)' : 'transparent',
                }}
              >
                <span>{group.label}</span>
              </button>

              {/* Sub-sections (visible when group is active) */}
              {activeGroup === group.id && (
                <div className="ml-4 space-y-0.5 mt-0.5">
                  {group.sections.map((sec) => (
                    <button
                      key={sec.id}
                      onClick={() => selectSection(group.id, sec.id)}
                      className="w-full text-left px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors
                                 flex items-center gap-2
                                 focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                      style={{
                        backgroundColor:
                          activeSection === sec.id ? 'var(--vn-primary)' : 'transparent',
                        color:
                          activeSection === sec.id
                            ? 'var(--vn-on-primary)'
                            : 'var(--vn-text)',
                      }}
                      aria-current={activeSection === sec.id ? 'page' : undefined}
                    >
                      {sec.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Right panel — section content */}
        <main className="md:col-span-3 space-y-4">
          {/* Group description banner */}
          {(() => {
            const grp = NAV_GROUPS.find((g) => g.id === activeGroup);
            const sec = grp?.sections.find((s) => s.id === activeSection);
            if (!grp || !sec) return null;
            return (
              <div
                className="px-4 py-3 rounded-lg text-xs flex items-start gap-3"
                style={{
                  backgroundColor: 'var(--vn-surface)',
                  border: '1px solid var(--vn-border)',
                  color: 'var(--vn-text-muted)',
                }}
              >
                <div>
                  <span className="font-semibold" style={{ color: 'var(--vn-text)' }}>
                    {grp.label} — {sec.label}
                  </span>
                  <span className="ml-2">{grp.desc}</span>
                </div>
              </div>
            );
          })()}

          {/* Main section content */}
          {renderSection()}

          {/* Wizard callout if config not loaded */}
          {!isLoading && !config && (
            <div
              className="p-4 rounded-lg text-sm text-center space-y-3"
              style={{ backgroundColor: 'var(--vn-surface)', border: '1px dashed var(--vn-border)' }}
            >
              <p style={{ color: 'var(--vn-text-muted)' }}>
                Configuration not yet initialized. Run the Setup Wizard to get started.
              </p>
              <button
                onClick={() => { window.location.href = BASE + '/settings/wizard'; }}
                className="px-4 py-2 text-sm font-medium rounded-md cursor-pointer
                           focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
              >
                Open Setup Wizard
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

