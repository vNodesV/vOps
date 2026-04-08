import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAuditLog } from '../api';
import Spinner from '../components/Spinner';

const PAGE_SIZE = 50;

const RESULT_COLORS: Record<string, string> = {
  ok: 'var(--vn-success)',
  error: 'var(--vn-danger)',
  warn: 'var(--vn-warning)',
};

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function actionBadgeColor(action: string): string {
  if (action.startsWith('delete') || action.startsWith('remove')) return 'var(--vn-danger)';
  if (action.startsWith('create') || action.startsWith('add')) return 'var(--vn-success)';
  if (action.startsWith('update') || action.startsWith('edit')) return 'var(--vn-info)';
  return 'var(--vn-text-muted)';
}

export default function AuditPage() {
  const [page, setPage] = useState(0);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  // Debounced filter values sent to the API (500ms delay to avoid per-keystroke fetches).
  const [debouncedActor, setDebouncedActor] = useState('');
  const [debouncedAction, setDebouncedAction] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedActor(actorFilter);
      setDebouncedAction(actionFilter);
      setPage(0); // reset to first page whenever filters change
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [actorFilter, actionFilter]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-log', page, debouncedActor, debouncedAction],
    queryFn: () => getAuditLog(PAGE_SIZE, page * PAGE_SIZE, debouncedActor, debouncedAction),
    staleTime: 30_000,
  });

  const entries = data?.entries ?? [];

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Audit Log</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--vn-text-subtle)' }}>
          All management actions performed by vOps operators — who did what, when, and whether it succeeded.
        </p>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={actorFilter}
          onChange={e => setActorFilter(e.target.value)}
          placeholder="Filter by actor…"
          style={{
            padding: '0.35rem 0.6rem', fontSize: '0.8rem', borderRadius: 'var(--vn-radius)',
            border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)',
            color: 'var(--vn-text)', minWidth: 160,
          }}
        />
        <input
          type="search"
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          placeholder="Filter by action…"
          style={{
            padding: '0.35rem 0.6rem', fontSize: '0.8rem', borderRadius: 'var(--vn-radius)',
            border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)',
            color: 'var(--vn-text)', minWidth: 160,
          }}
        />
        {(actorFilter || actionFilter) && (
          <button
            onClick={() => { setActorFilter(''); setActionFilter(''); }}
            style={{
              padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: 'var(--vn-radius)',
              border: '1px solid var(--vn-border)', background: 'var(--vn-surface)',
              color: 'var(--vn-text-muted)', cursor: 'pointer',
            }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <p style={{ color: 'var(--vn-danger)', fontSize: '0.875rem' }}>
          Audit log unavailable. Fleet must be configured to enable audit logging.
        </p>
      ) : entries.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem' }}>
          {actorFilter || actionFilter ? 'No entries match your filters.' : 'No audit entries yet.'}
        </p>
      ) : (
        <div style={{ background: 'var(--vn-surface)', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: 'var(--vn-surface-2)', borderBottom: '1px solid var(--vn-border)' }}>
                {['Time', 'Actor', 'Action', 'Target', 'Result', 'Details'].map(h => (
                  <th key={h} style={{ padding: '0.6rem 0.85rem', textAlign: 'left', fontWeight: 600, color: 'var(--vn-text-muted)', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--vn-border)' }}>
                  <td style={{ padding: '0.55rem 0.85rem', color: 'var(--vn-text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: '0.78rem' }}>
                    {fmtTs(e.ts)}
                  </td>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 600, color: 'var(--vn-text)' }}>
                    {e.actor || '—'}
                  </td>
                  <td style={{ padding: '0.55rem 0.85rem' }}>
                    <span style={{
                      background: 'rgba(128,128,128,0.1)',
                      color: actionBadgeColor(e.action),
                      borderRadius: '1rem',
                      padding: '0.1rem 0.5rem',
                      fontFamily: 'monospace',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                    }}>
                      {e.action}
                    </span>
                  </td>
                  <td style={{ padding: '0.55rem 0.85rem', color: 'var(--vn-text)' }}>
                    {e.target_type && <span style={{ color: 'var(--vn-text-muted)', marginRight: '0.35rem', fontSize: '0.75rem' }}>{e.target_type}</span>}
                    {e.target_name || '—'}
                  </td>
                  <td style={{ padding: '0.55rem 0.85rem' }}>
                    {e.result ? (
                      <span style={{ color: RESULT_COLORS[e.result] ?? 'var(--vn-text-muted)', fontSize: '0.78rem', fontWeight: 600 }}>
                        {e.result}
                      </span>
                    ) : e.error ? (
                      <span style={{ color: 'var(--vn-danger)', fontSize: '0.78rem' }} title={e.error}>⚠ error</span>
                    ) : (
                      <span style={{ color: 'var(--vn-text-muted)', fontSize: '0.78rem' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '0.55rem 0.85rem', color: 'var(--vn-text-muted)', fontSize: '0.75rem', maxWidth: 260 }}>
                    {e.error ? (
                      <span style={{ color: 'var(--vn-danger)' }} title={e.error}>{e.error.length > 60 ? e.error.slice(0, 60) + '…' : e.error}</span>
                    ) : e.params ? (
                      <span title={e.params}>{e.params.length > 60 ? e.params.slice(0, 60) + '…' : e.params}</span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !isError && entries.length === PAGE_SIZE && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              padding: '0.35rem 0.85rem', fontSize: '0.8rem', borderRadius: 'var(--vn-radius)',
              border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)',
              color: page === 0 ? 'var(--vn-text-muted)' : 'var(--vn-text)',
              cursor: page === 0 ? 'default' : 'pointer',
            }}
          >
            ← Prev
          </button>
          <span style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', color: 'var(--vn-text-muted)' }}>
            Page {page + 1}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            style={{
              padding: '0.35rem 0.85rem', fontSize: '0.8rem', borderRadius: 'var(--vn-radius)',
              border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)',
              color: 'var(--vn-text)', cursor: 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
