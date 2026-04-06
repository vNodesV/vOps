import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

/* ── Section group definitions ───────────────────────────────── */

interface NavSection {
  id: string;
  label: string;
  icon: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: string;
  desc: string;
  sections: NavSection[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    icon: '🏗',
    desc: 'Hosts, virtual machines, and fleet SSH connectivity',
    sections: [
      { id: 'fleet-scan', label: 'Fleet Scan', icon: '📡' },
      { id: 'fleet-ssh', label: 'SSH Defaults', icon: '🔑' },
      { id: 'datacenters', label: 'Datacenters & VMs', icon: '🖥' },
    ],
  },
  {
    id: 'proxy',
    label: 'Proxy & Chains',
    icon: '⚡',
    desc: 'vProx reverse proxy and Cosmos chain endpoint configuration',
    sections: [
      { id: 'ports', label: 'vProx Ports', icon: '🔌' },
      { id: 'proxy-controls', label: 'Proxy Controls', icon: '⚙' },
      { id: 'chain-profiles', label: 'Chain Profiles', icon: '⛓' },
    ],
  },
  {
    id: 'vops-core',
    label: 'vOps Core',
    icon: '📊',
    desc: 'Dashboard, authentication, ingestion, and backup settings',
    sections: [
      { id: 'vops', label: 'Dashboard & Auth', icon: '🔐' },
      { id: 'backup', label: 'Backups', icon: '💾' },
    ],
  },
  {
    id: 'security',
    label: 'Security & Access',
    icon: '🛡',
    desc: 'SSH keys, API keys, password management, and firewall',
    sections: [
      { id: 'credentials', label: 'Keys & Credentials', icon: '🗝' },
    ],
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: '🎨',
    desc: 'Dashboard appearance and display options',
    sections: [
      { id: 'display', label: 'Display', icon: '🌗' },
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
          {scanMut.isPending ? 'Scanning…' : '📡 Scan All VMs'}
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
  return (
    <SectionCard
      title="Fleet SSH Defaults"
      subtitle="Controls how vOps connects to your VMs via SSH for polling metrics, running scripts, and deploying upgrades. These defaults apply to all VMs unless overridden per-datacenter."
    >
      <TOMLEditor
        sectionKey="fleet"
        rawValue={config.fleet}
        fieldDocs={[
          {
            label: '[defaults] user',
            hint: 'SSH username used to connect to VMs. Must have passwordless sudo for script execution.',
            example: 'ubuntu',
          },
          {
            label: '[defaults] key_path',
            hint: 'Path to the SSH private key on the vOps server. Generate one in Security → Keys & Credentials.',
            example: '/home/ubuntu/.vprox/secret/vops_ssh_key',
          },
          {
            label: '[defaults] poll_interval',
            hint: 'How often the background fleet poller checks VM health. Use Go duration format.',
            example: '60s',
          },
          {
            label: '[ssh] key_path',
            hint: 'Override key path specifically for the fleet SSH service (optional).',
            example: '/home/ubuntu/.vprox/secret/vops_ssh_key',
          },
        ]}
      />
    </SectionCard>
  );
}

/* ── Infrastructure → Datacenters & VMs ─────────────────────── */

function DatacentersPanel({ config }: { config: ConfigSnapshot }) {
  const infras = (config.infras as { file: string; name: string; raw: string }[]) ?? [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="Datacenters & VM Inventory"
        subtitle="Each TOML file in config/infra/ represents one datacenter. Define [[host]] entries for physical hypervisors and [[vm]] entries for the virtual machines they run. vOps uses these to poll metrics, run fleet commands, and manage VM lifecycle via libvirt."
      >
        <div className="space-y-2 mb-4">
          <FieldDoc
            label="[[host]] name"
            hint="Identifier for the physical hypervisor host."
            example="qc.vnodesv.net"
          />
          <FieldDoc
            label="[[host]] public_ip"
            hint="Public IP or hostname of the hypervisor. Used for SSH and libvirt connections."
            example="203.0.113.10"
          />
          <FieldDoc
            label="[[vm]] name"
            hint="VM hostname or identifier. Must match what the fleet poller uses."
            example="www-vm"
          />
          <FieldDoc
            label="[[vm]] type"
            hint="Role of the VM: validator | node | sp | relayer | webserver | bastion | other."
            example="validator"
          />
          <FieldDoc
            label="[[vm]] lan_ip"
            hint="LAN/private IP address for SSH polling."
            example="10.0.0.2"
          />
          <FieldDoc
            label="[[vm]] public_ip"
            hint="Public IP if different from the host. Leave blank to inherit from [[host]]."
            example="203.0.113.11"
          />
          <FieldDoc
            label="[[vm]] host_ref"
            hint="References the parent [[host]] name. Used for VM Manager libvirt operations."
            example="qc.vnodesv.net"
          />
          <FieldDoc
            label="[[vm.ping]] country"
            hint="Country code for latency probing in Chain Status (e.g., CA for Canada)."
            example="CA"
          />
          <FieldDoc
            label="[[vm.ping]] provider"
            hint="Cloud/datacenter provider name shown in the ping probe card."
            example="Hetzner"
          />
        </div>

        {infras.length === 0 ? (
          <div
            className="p-4 rounded-lg text-xs text-center"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px dashed var(--vn-border)', color: 'var(--vn-text-muted)' }}
          >
            No datacenter files found. Use the Setup Wizard to create your first datacenter, or
            add a <code>.toml</code> file to <code>config/infra/</code>.
          </div>
        ) : (
          <div className="space-y-6">
            {infras.map((dc) => (
              <div key={dc.file} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--vn-text)' }}>
                    📁 {dc.name}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
                    {dc.file}
                  </span>
                </div>
                <TOMLEditor sectionKey="infra" rawValue={dc.raw} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ── Proxy & Chains → Ports ──────────────────────────────────── */

function PortsPanel({ config }: { config: ConfigSnapshot }) {
  return (
    <SectionCard
      title="vProx Ports"
      subtitle="Defines which TCP ports vProx listens on for each service. The proxy port is the main entry point; per-chain ports forward to specific node RPC endpoints. Changes require a vProx service restart."
    >
      <TOMLEditor
        sectionKey="ports"
        rawValue={config.ports}
        fieldDocs={[
          {
            label: 'vprox_port',
            hint: 'Main vProx proxy listening port. Apache or nginx should forward to this.',
            example: '8888',
          },
          {
            label: '[chain.*] port',
            hint: 'Per-chain port for direct RPC access. Each chain gets its own port.',
            example: '26657 (cosmos), 26697 (osmosis)',
          },
        ]}
      />
    </SectionCard>
  );
}

/* ── Proxy & Chains → Proxy Controls ─────────────────────────── */

function ProxyControlsPanel({ config }: { config: ConfigSnapshot }) {
  return (
    <SectionCard
      title="Proxy Controls"
      subtitle="Fine-tune vProx reverse proxy behavior: rate limiting, GeoIP filtering, threat score thresholds, bot protection, and request routing rules. Changes require a vProx restart."
    >
      <TOMLEditor
        sectionKey="settings"
        rawValue={config.settings}
        fieldDocs={[
          {
            label: 'rate_limit_per_minute',
            hint: 'Max requests per minute per IP before throttling kicks in.',
            example: '300',
          },
          {
            label: 'rate_limit_burst',
            hint: 'Burst allowance above the rate limit before hard throttle.',
            example: '50',
          },
          {
            label: 'geoip_enabled',
            hint: 'Enable GeoIP country-level filtering and analytics.',
            example: 'true',
          },
          {
            label: 'geoip_db_path',
            hint: 'Path to the MaxMind GeoLite2-Country.mmdb database file.',
            example: '/etc/geoip/GeoLite2-Country.mmdb',
          },
          {
            label: 'threat_score_block_threshold',
            hint: 'Block IPs with a composite threat score at or above this value (0–100).',
            example: '80',
          },
          {
            label: 'bot_protection',
            hint: 'Enable heuristic bot detection. Suspicious user-agents get flagged.',
            example: 'true',
          },
          {
            label: 'mask_rpc',
            hint: 'Rewrite node RPC error messages to hide internal details from clients.',
            example: 'true',
          },
          {
            label: 'trusted_proxy_cidrs',
            hint: 'Comma-separated CIDR list of trusted upstream proxies (Apache, nginx). IPs in this range pass X-Forwarded-For.',
            example: '127.0.0.1/32, 10.0.0.0/8',
          },
        ]}
      />
    </SectionCard>
  );
}

/* ── Proxy & Chains → Chain Profiles ─────────────────────────── */

function ChainProfilesPanel({ config }: { config: ConfigSnapshot }) {
  const chains = (config.chains as { file: string; name: string; raw: string }[]) ?? [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="Chain Profiles"
        subtitle="Each TOML file in config/chains/ (or config/vops/chains/) defines one Cosmos chain endpoint. These profiles control which node RPC/REST/gRPC/WS endpoints vProx routes to, plus management and validator tracking settings."
      >
        <div className="space-y-2 mb-4">
          <FieldDoc
            label="chain_id"
            hint="Cosmos chain ID, e.g. cosmoshub-4 or osmosis-1."
            example="cosmoshub-4"
          />
          <FieldDoc
            label="tree_name"
            hint="Internal identifier linking this chain to its service nodes."
            example="cosmos"
          />
          <FieldDoc
            label="network_type"
            hint="mainnet | testnet | devnet"
            example="mainnet"
          />
          <FieldDoc
            label="[management] rpc_url"
            hint="RPC URL of the node to use for fleet management operations."
            example="http://10.0.0.3:26657"
          />
          <FieldDoc
            label="[management] rest_url"
            hint="REST/LCD URL for governance and upgrade tracking."
            example="http://10.0.0.3:1317"
          />
          <FieldDoc
            label="[management.ping] country"
            hint="Country code for the latency probe shown in Chain Status."
            example="US"
          />
          <FieldDoc
            label="[validator] valoper"
            hint="Validator operator address for participation tracking."
            example="cosmosvaloper1..."
          />
          <FieldDoc
            label="expose"
            hint="List of services to expose: rpc, rest, grpc, ws."
            example="['rpc', 'rest', 'ws']"
          />
        </div>

        {chains.length === 0 ? (
          <div
            className="p-4 rounded-lg text-xs text-center"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px dashed var(--vn-border)', color: 'var(--vn-text-muted)' }}
          >
            No chain profiles found. Use the Setup Wizard to create your first chain, or add a
            <code>.toml</code> file to <code>config/vops/chains/</code>.
          </div>
        ) : (
          <div className="space-y-6">
            {chains.map((chain) => (
              <div key={chain.file} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--vn-text)' }}>
                    ⛓ {chain.name}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
                    {chain.file}
                  </span>
                </div>
                <TOMLEditor sectionKey="chain" rawValue={chain.raw} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ── vOps Core → Dashboard & Auth ────────────────────────────── */

function VOpsPanel({ config }: { config: ConfigSnapshot }) {
  return (
    <SectionCard
      title="vOps Dashboard & Auth"
      subtitle="Core vOps settings: bind address, URL base path, authentication credentials, IP intelligence API keys, and UI preferences. Secrets shown as [REDACTED] — paste a new value to update."
    >
      <TOMLEditor
        sectionKey="vops"
        rawValue={config.vops}
        fieldDocs={[
          {
            label: '[vops] bind_address',
            hint: 'IP:port that vOps listens on. Keep 127.0.0.1 and let Apache proxy.',
            example: '127.0.0.1:8889',
          },
          {
            label: '[vops] base_path',
            hint: 'URL prefix under which vOps is served (matches Apache ProxyPass path).',
            example: '/vlog/',
          },
          {
            label: '[vops.auth] password_hash',
            hint: 'bcrypt hash of the admin password (cost=12). Generate in Security → Keys & Credentials.',
            example: '$2a$12$...',
          },
          {
            label: '[vops.auth] api_key',
            hint: 'API key for programmatic access. Generate in Security → Keys & Credentials.',
            example: 'vops_abc123...',
          },
          {
            label: '[vops.intel] virustotal',
            hint: 'VirusTotal v3 API key for IP threat intelligence.',
          },
          {
            label: '[vops.intel] abuseipdb',
            hint: 'AbuseIPDB v2 API key for abuse score lookup.',
          },
          {
            label: '[vops.intel] shodan',
            hint: 'Shodan API key for open-port OSINT scanning.',
          },
          {
            label: '[vops.ui] theme',
            hint: 'Dashboard color theme. Options: vnodes (green), dark-blue, light-blue.',
            example: 'vnodes',
          },
        ]}
      />
    </SectionCard>
  );
}

/* ── vOps Core → Backups ─────────────────────────────────────── */

function BackupsPanel({ config }: { config: ConfigSnapshot }) {
  return (
    <SectionCard
      title="Backup Configuration"
      subtitle="Automated backup schedule for vProx log archives. Backups can be stored locally, pushed to S3-compatible object storage, or synced via rsync to a remote host. Disable automation to manage backups manually via CLI."
    >
      <TOMLEditor
        sectionKey="backup"
        rawValue={config.backup}
        fieldDocs={[
          {
            label: 'automation',
            hint: 'Enable (true) or disable (false) automated scheduled backups.',
            example: 'true',
          },
          {
            label: 'interval',
            hint: 'How often to create a backup. Use Go duration format.',
            example: '24h',
          },
          {
            label: 'target_dir',
            hint: 'Local directory where backup .tar.gz archives are written.',
            example: '/var/backups/vprox',
          },
          {
            label: 's3_bucket',
            hint: 'S3-compatible bucket URL (optional). Leave blank to skip S3.',
            example: 's3://my-bucket/vprox-backups/',
          },
          {
            label: 'rsync_target',
            hint: 'rsync destination for offsite copy (optional).',
            example: 'backup@remote.host:/backups/vprox/',
          },
        ]}
      />
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
    onSuccess: () => {
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
  const navigate = useNavigate();

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
          onClick={() => navigate('/settings/wizard')}
          className="px-4 py-2 text-xs font-medium rounded-md cursor-pointer flex items-center gap-2
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{
            backgroundColor: 'var(--vn-surface)',
            border: '1px solid var(--vn-border)',
            color: 'var(--vn-text)',
          }}
        >
          🧙 Setup Wizard
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
                <span>{group.icon}</span>
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
                      <span style={{ fontSize: '0.75rem' }}>{sec.icon}</span>
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
                <span style={{ fontSize: '1.1rem' }}>{grp.icon}</span>
                <div>
                  <span className="font-semibold" style={{ color: 'var(--vn-text)' }}>
                    {grp.label} → {sec.icon} {sec.label}
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
                onClick={() => navigate('/settings/wizard')}
                className="px-4 py-2 text-sm font-medium rounded-md cursor-pointer
                           focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
              >
                🧙 Open Setup Wizard
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

