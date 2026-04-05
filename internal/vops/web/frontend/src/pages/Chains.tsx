import { useQuery } from '@tanstack/react-query';
import { getFleetChains } from '../api';
import type { ChainStatus } from '../api/types';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';

const card: React.CSSProperties = {
  background: 'var(--vn-surface)',
  border: '1px solid var(--vn-border)',
  borderRadius: 'var(--vn-radius)',
  padding: '1.25rem 1.5rem',
  boxShadow: 'var(--vn-shadow)',
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '1rem',
};

function chainStatus(c: ChainStatus): string {
  if (c.catching_up) return 'syncing';
  return 'synced';
}

function HeightBar({ height, earliest }: { height: number; earliest: number }) {
  const pct = earliest > 0 ? Math.min(100, ((height - earliest) / height) * 100) : 100;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Sync progress ${Math.round(pct)}%`}
      style={{
        height: 4,
        background: 'var(--vn-surface-2)',
        borderRadius: 2,
        overflow: 'hidden',
        marginTop: '0.5rem',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${pct}%`,
          background: pct < 99 ? 'var(--vn-warning)' : 'var(--vn-success)',
          borderRadius: 2,
          transition: 'width 0.3s',
        }}
      />
    </div>
  );
}

function ChainCard({ chain }: { chain: ChainStatus }) {
  const status = chainStatus(chain);
  return (
    <article style={card} aria-label={`Chain ${chain.chain_name ?? chain.chain}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--vn-text)' }}>
            {chain.chain_name ?? chain.chain}
          </h3>
          {chain.chain_id && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>
              {chain.chain_id}
            </p>
          )}
        </div>
        <Badge status={status} />
      </div>

      <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 1rem', fontSize: '0.8125rem', margin: 0 }}>
        <dt style={{ color: 'var(--vn-text-muted)' }}>Height</dt>
        <dd style={{ margin: 0, color: 'var(--vn-text)', fontVariantNumeric: 'tabular-nums' }}>
          {(chain.height ?? 0).toLocaleString()}
        </dd>

        <dt style={{ color: 'var(--vn-text-muted)' }}>Type</dt>
        <dd style={{ margin: 0, color: 'var(--vn-text)' }}>{chain.type || '—'}</dd>

        {chain.moniker && (
          <>
            <dt style={{ color: 'var(--vn-text-muted)' }}>Moniker</dt>
            <dd style={{ margin: 0, color: 'var(--vn-text)', wordBreak: 'break-all' }}>{chain.moniker}</dd>
          </>
        )}

        {chain.has_validator && (
          <>
            <dt style={{ color: 'var(--vn-text-muted)' }}>Validator</dt>
            <dd style={{ margin: 0 }}>
              <Badge status={chain.val_jailed ? 'jailed' : chain.val_bonded ? 'active' : 'inactive'} />
            </dd>
          </>
        )}

        {chain.lan_ping_ms > 0 && (
          <>
            <dt style={{ color: 'var(--vn-text-muted)' }}>Latency</dt>
            <dd style={{ margin: 0, color: 'var(--vn-text)', fontVariantNumeric: 'tabular-nums' }}>
              {chain.lan_ping_ms} ms
            </dd>
          </>
        )}

        {chain.rpc_url && (
          <>
            <dt style={{ color: 'var(--vn-text-muted)' }}>RPC</dt>
            <dd style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <a href={chain.rpc_url} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--vn-primary)', fontSize: '0.75rem' }}
                aria-label={`Open RPC for ${chain.chain_name ?? chain.chain}`}
              >
                {chain.rpc_url}
              </a>
            </dd>
          </>
        )}
      </dl>

      <HeightBar height={chain.height} earliest={chain.earliest_height} />
    </article>
  );
}

export default function ChainsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['fleet-chains'],
    queryFn: getFleetChains,
    refetchInterval: 30_000,
  });

  const chains = data?.chains ?? [];
  const synced = chains.filter(c => !c.catching_up).length;
  const catching = chains.filter(c => c.catching_up).length;

  return (
    <div>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--vn-text)' }}>
          Chains
        </h1>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>
          Cosmos chain node status across your fleet
        </p>
      </header>

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total', value: chains.length, color: 'var(--vn-info)' },
          { label: 'Synced', value: synced, color: 'var(--vn-success)' },
          { label: 'Syncing', value: catching, color: 'var(--vn-warning)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            ...card,
            padding: '0.75rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 100,
          }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>

      {isLoading && <Spinner />}

      {error && (
        <p role="alert" style={{ color: 'var(--vn-danger)', fontSize: '0.875rem' }}>
          Failed to load chain status. Fleet module may be offline.
        </p>
      )}

      {!isLoading && chains.length === 0 && !error && (
        <div style={{ ...card, textAlign: 'center', padding: '3rem', color: 'var(--vn-text-muted)' }}>
          <p style={{ margin: 0 }}>No chains detected. Configure fleet nodes to see chain status.</p>
        </div>
      )}

      <section aria-label="Chain status cards" style={grid}>
        {chains.map(c => (
          <ChainCard key={`${c.chain}-${c.type}`} chain={c} />
        ))}
      </section>
    </div>
  );
}
