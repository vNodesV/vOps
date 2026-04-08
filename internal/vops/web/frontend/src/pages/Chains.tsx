import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getFleetChains, getServices, getFleetChainTraffic } from '../api';
import type { ChainStatus, Service, ServiceType } from '../api/types';
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
function ChainRow({ chain }: { chain: ChainStatus }) {
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
/* ── Chain Traffic Section ───────────────────────────────────── */
function TrafficSection() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['chain-traffic'],
    queryFn: getFleetChainTraffic,
    staleTime: 60_000,
  });

  const traffic = data?.traffic ?? [];
  const maxReqs = Math.max(...traffic.map(t => (t.requests ?? 0)), 1);

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--vn-text)' }}>
          📊 Chain Traffic
          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--vn-text-muted)', marginLeft: '0.5rem' }}>requests by host</span>
        </h2>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)', cursor: 'pointer' }}
        >
          {isFetching ? '…' : '⟳'}
        </button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <p style={{ color: 'var(--vn-danger)', fontSize: '0.85rem' }}>Could not load traffic data.</p>
      ) : traffic.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.85rem' }}>No traffic data available.</p>
      ) : (
        <div style={{ background: 'var(--vn-surface)', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', padding: '1rem' }}>
          {traffic.sort((a, b) => (b.requests ?? 0) - (a.requests ?? 0)).map(t => (
            <div key={t.host} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--vn-text)', minWidth: 160, fontFamily: 'monospace' }}>{t.host}</span>
              <div style={{ flex: 1, height: 14, background: 'var(--vn-surface-2)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.round(((t.requests ?? 0) / maxReqs) * 100)}%`,
                  background: 'var(--vn-primary)',
                  borderRadius: 4,
                  transition: 'width 0.3s',
                }} />
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)', minWidth: 60, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {(t.requests ?? 0).toLocaleString()} req
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ChainsPage() {
  const navigate = useNavigate();

  const chainsQ = useQuery({
    queryKey: ['fleet-chains'],
    queryFn: getFleetChains,
    refetchInterval: 30_000,
  });

  const servicesQ = useQuery({
    queryKey: ['services'],
    queryFn: getServices,
    refetchInterval: 30_000,
  });

  const chains = chainsQ.data?.chains ?? [];
  const services = servicesQ.data?.services ?? [];

  const synced = chains.filter(c => !c.catching_up && !c.error).length;
  const catching = chains.filter(c => c.catching_up).length;
  const proposals = chains.reduce((s, c) => s + (c.active_proposals ?? 0), 0);
  const upgrades = chains.filter(c => c.upgrade_pending).length;

  const svcOnline = services.filter(s => s.state === 'online').length;
  const svcDown = services.filter(s => s.state === 'down').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

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
                    {['Chain / ID', 'Height', 'Block Speed', 'Proposals', 'Upgrade', 'Validator', 'Status'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chains.map(c => (
                    <ChainRow key={`${c.chain}-${c.type}`} chain={c} />
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

      {/* ── Chain Traffic ────────────────────────────────────────── */}
      <TrafficSection />

    </div>
  );
}
