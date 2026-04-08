import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFleetChains, getServices, getRegisteredChains, registerChain, unregisterChain } from '../api';
import type { ChainStatus, RegisteredChain, Service, ServiceType } from '../api/types';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';

/* ── Shared styles ────────────────────────────────────────────── */
const card: React.CSSProperties = {
  background: 'var(--vn-surface)',
  border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)',
  padding: '1.25rem 1.5rem',
  boxShadow: 'var(--vn-shadow)',
};

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

/* ── Type labels ──────────────────────────────────────────────── */
const typeLabel: Record<ServiceType, string> = {
  validator: '🔐 Validator',
  api: '🔌 API',
  rpc: '📡 RPC',
  node: '🟢 Node',
  relayer: '🔄 Relayer',
  webserver: '🌐 Web',
  vprox: '🛡 vProx',
  other: '⚙ Other',
};

/* ── Helpers ──────────────────────────────────────────────────── */
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
function ServiceItem({ svc, onClick }: { svc: Service; onClick: () => void }) {
  const stateColor = svc.state === 'online' ? 'var(--vn-success)'
    : svc.state === 'down' ? 'var(--vn-danger)'
    : 'var(--vn-text-muted)';

  const stateStatus = svc.state === 'online' ? 'online'
    : svc.state === 'down' ? 'error'
    : 'inactive';

  return (
    <tr
      onClick={onClick}
      style={{
        borderBottom: '1px solid var(--vn-border)',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--vn-surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      aria-label={`Manage service ${svc.name}`}
    >
      <td style={tdStyle}>
        <span style={{ fontSize: '0.82rem' }}>{typeLabel[svc.service_type] ?? svc.service_type}</span>
      </td>
      <td style={{ ...tdStyle, fontWeight: 600 }}>{svc.name}</td>
      <td style={{ ...tdStyle, color: 'var(--vn-text-muted)' }}>{svc.chain_id || '—'}</td>
      <td style={{ ...tdStyle, color: 'var(--vn-text-muted)' }}>{svc.vm_name || '—'}</td>
      <td style={{ ...tdStyle, color: 'var(--vn-text-muted)' }}>{svc.datacenter || '—'}</td>
      <td style={tdStyle}>
        <Badge status={stateStatus} />
        <span style={{ display: 'none' }}>{stateColor}</span>
      </td>
      <td style={{ ...tdStyle, color: 'var(--vn-primary)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
        Manage →
      </td>
    </tr>
  );
}

/* ── Main page ────────────────────────────────────────────────── */
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

export default function ChainsPage() {
  const navigate = useNavigate();
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

      {/* ── Section 2: Services ─────────────────────────────────── */}
      <section aria-label="Services">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ ...sectionTitle, margin: 0 }}>⚙ Services</h2>
          <button
            onClick={() => navigate('/services')}
            style={{
              cursor: 'pointer',
              border: '1px solid var(--vn-border)',
              borderRadius: 'var(--vn-radius)',
              padding: '0.3rem 0.75rem',
              fontSize: '0.78rem',
              fontWeight: 500,
              background: 'var(--vn-primary)',
              color: 'var(--vn-on-primary)',
            }}
          >
            + Manage Services
          </button>
        </div>

        {servicesQ.isLoading && <Spinner />}

        {!servicesQ.isLoading && services.length === 0 && (
          <div style={{ ...card, textAlign: 'center', padding: '2rem', color: 'var(--vn-text-muted)' }}>
            <p style={{ margin: '0 0 0.75rem' }}>No services registered yet.</p>
            <button
              onClick={() => navigate('/services')}
              style={{
                cursor: 'pointer',
                border: 'none',
                borderRadius: 'var(--vn-radius)',
                padding: '0.4rem 1rem',
                fontSize: '0.82rem',
                fontWeight: 500,
                background: 'var(--vn-primary)',
                color: 'var(--vn-on-primary)',
              }}
            >
              Register a service
            </button>
          </div>
        )}

        {services.length > 0 && (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'var(--vn-surface-2)', borderBottom: '1px solid var(--vn-border)' }}>
                    {['Type', 'Name', 'Chain', 'VM', 'Datacenter', 'Status', ''].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {services.map(svc => (
                    <ServiceItem
                      key={svc.id}
                      svc={svc}
                      onClick={() => navigate('/services')}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

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
