import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getFleetVMs,
  getDeployments,
  getRegisteredChains,
  registerChain,
  unregisterChain,
  forcePoll,
  getVMStatus,
  vmUpgradeURL,
  getVMHistory,
} from '../api';
import type { RegisteredChain, VMView, Deployment, VMStatus, VMMetricPoint } from '../api/types';
import Spinner from '../components/Spinner';
import Badge from '../components/Badge';
import UpgradeModal from '../components/UpgradeModal';

const card: React.CSSProperties = {
  background: 'var(--vn-surface)',
  border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)',
  padding: '1.25rem 1.5rem',
  marginBottom: '1.25rem',
  boxShadow: 'var(--vn-shadow)',
};

const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
};

const th: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '0.75rem',
  color: 'var(--vn-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--vn-border)',
};

const td: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--vn-border)',
  color: 'var(--vn-text)',
};

const btn: React.CSSProperties = {
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

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.65rem',
  border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)',
  background: 'var(--vn-surface-2)',
  color: 'var(--vn-text)',
  fontSize: '0.875rem',
};

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

  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['vm-status'],
    queryFn: getVMStatus,
    refetchInterval: 60_000,
    retry: false,
  });

  const vms: VMStatus[] = data?.vms ?? [];

  return (
    <div style={card}>
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
                        ...btn,
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

  const chains: RegisteredChain[] = data?.chains ?? [];

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Registered Chains</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => doPoll()} disabled={polling} style={{ ...btn, background: 'var(--vn-surface-2)', color: 'var(--vn-text)', border: '1px solid var(--vn-border)' }} type="button">
            {polling ? <Spinner size={14} /> : null}
            Force Poll
          </button>
          <button onClick={() => setShowForm((v) => !v)} style={btn} type="button">
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
                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                value={form[f]}
                onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))}
                required={f === 'chain' || f === 'rpc_url'}
                placeholder={f === 'rpc_url' ? 'http://host:26657' : f === 'rest_url' ? 'http://host:1317' : ''}
              />
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
            <button type="submit" disabled={registering} style={btn}>
              {registering ? <Spinner size={14} /> : null} Save
            </button>
            <button type="button" onClick={() => setShowForm(false)} style={{ ...btn, background: 'transparent', color: 'var(--vn-text-muted)', border: '1px solid var(--vn-border)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? <Spinner /> : chains.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>No chains registered. Add one above.</p>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              {['Chain', 'RPC URL', 'REST URL', 'Note', ''].map((h) => (
                <th key={h} scope="col" style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chains.map((c) => (
              <tr key={c.chain}>
                <td style={td}><code style={{ fontFamily: 'monospace' }}>{c.chain}</code></td>
                <td style={{ ...td, fontSize: '0.8rem', color: 'var(--vn-text-muted)', fontFamily: 'monospace' }}>{c.rpc_url}</td>
                <td style={{ ...td, fontSize: '0.8rem', color: 'var(--vn-text-muted)', fontFamily: 'monospace' }}>{c.rest_url ?? '—'}</td>
                <td style={{ ...td, color: 'var(--vn-text-muted)' }}>{c.note ?? '—'}</td>
                <td style={td}>
                  <button
                    onClick={() => { if (confirm(`Unregister ${c.chain}?`)) doUnregister(c.chain); }}
                    style={{ ...btn, background: 'var(--vn-danger)', padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
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
    <div style={card}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Fleet VMs</h2>
      {isLoading ? <Spinner /> : vms.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>
          No VMs configured. Add VM definitions to <code>config/infra/*.toml</code>.
        </p>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              {['Name', 'Host', 'Datacenter', 'Type'].map((h) => (
                <th key={h} scope="col" style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vms.map((vm) => (
              <tr key={vm.name}>
                <td style={td}><strong>{vm.name}</strong></td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.85rem' }}>{vm.host}</td>
                <td style={td}>{vm.datacenter}</td>
                <td style={td}><Badge status={vm.type || 'vm'} /></td>
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
    <div style={card}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Recent Deployments</h2>
      {isLoading ? <Spinner /> : deployments.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>No deployments yet.</p>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              {['VM', 'Chain', 'Component', 'Script', 'Status', 'Started', 'Finished'].map((h) => (
                <th key={h} scope="col" style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deployments.slice(0, 50).map((d) => (
              <tr key={d.id}>
                <td style={td}>{d.vm}</td>
                <td style={td}><code style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{d.chain}</code></td>
                <td style={td}>{d.component}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--vn-text-muted)' }}>{d.script}</td>
                <td style={td}><Badge status={d.status} /></td>
                <td style={{ ...td, color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>{fmtDate(d.started_at)}</td>
                <td style={{ ...td, color: 'var(--vn-text-muted)', fontSize: '0.8rem' }}>{fmtDate(d.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */
export default function FleetPage() {
  return (
    <div>
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 700 }}>Fleet</h1>
      <ServersLiveSection />
      <RegisteredChainsSection />
      <VMsSection />
      <DeploymentsSection />
    </div>
  );
}
