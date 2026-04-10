import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getAccounts, syncUFW } from '../api';
import type { IPAccount } from '../api/types';
import Badge from '../components/Badge';
import ThreatScore from '../components/ThreatScore';
import SortableHeader from '../components/SortableHeader';
import Spinner from '../components/Spinner';
import InvestigateModal from '../components/InvestigateModal';

const PAGE_SIZES = [25, 50, 100, 200, 0] as const;

function fmtDate(iso: string): string {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/* ── UFW Sync Modal ──────────────────────────────────────────────────────── */

function UFWSyncModal({
  onConfirm,
  onClose,
  isPending,
}: {
  onConfirm: (pass: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [pass, setPass] = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="UFW Sync"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal">
        <div className="modal-header">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--vn-text)' }}>Sync UFW Rules</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--vn-text-muted)' }}>
              Synchronises blocked IPs from the database into UFW firewall rules.
            </p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium" style={{ color: 'var(--vn-text-muted)' }}>
              Sudo password <span className="font-normal">(leave blank if NOPASSWD configured)</span>
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(pass); }}
              placeholder="password"
              className="vn-input mt-1.5"
            />
          </label>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button
            onClick={() => onConfirm(pass)}
            disabled={isPending}
            className="btn btn-primary disabled:opacity-50"
          >
            {isPending ? 'Syncing\u2026' : 'Sync UFW'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Scan badge ──────────────────────────────────────────────────────────── */

function ScanBadge({ updatedAt }: { updatedAt: string }) {
  if (!updatedAt) {
    return <span style={{ color: 'var(--vn-text-subtle)' }}>&mdash;</span>;
  }
  return (
    <span className="inline-flex items-center gap-1" title={`Scanned: ${updatedAt}`}>
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: 'var(--vn-success)' }}
        aria-hidden="true"
      />
      <span className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
        {fmtDate(updatedAt)}
      </span>
    </span>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Modal state — holds the full account object for the investigate popup.
  const [investigateAcct, setInvestigateAcct] = useState<IPAccount | null>(null);
  const [showUFWModal, setShowUFWModal] = useState(false);

  // URL-driven state
  const page = Number(searchParams.get('page') || '1');
  const limit = Number(searchParams.get('limit') || '50');
  const search = searchParams.get('search') || '';
  const sort = searchParams.get('sort') || 'TotalRequests';
  const dir = searchParams.get('dir') || 'desc';

  // Debounced search input
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (searchInput) next.set('search', searchInput);
        else next.delete('search');
        next.set('page', '1');
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, setSearchParams]);

  // Fetch accounts
  const offset = (page - 1) * (limit || 0);
  const { data: accounts, isLoading, isError, error } = useQuery({
    queryKey: ['accounts', { limit: limit || 10000, offset, search, sort, dir }],
    queryFn: () =>
      getAccounts({
        limit: limit || 10000,
        offset,
        search: search || undefined,
        sort,
        dir,
      }),
  });

  // UFW sync mutation
  const ufwMut = useMutation({
    mutationFn: (pass: string) => syncUFW(pass || undefined),
    onSuccess: () => setShowUFWModal(false),
  });

  const handleSort = useCallback(
    (column: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (sort === column) {
          next.set('dir', dir === 'asc' ? 'desc' : 'asc');
        } else {
          next.set('sort', column);
          next.set('dir', 'desc');
        }
        next.set('page', '1');
        return next;
      });
    },
    [sort, dir, setSearchParams],
  );

  const handlePageSize = useCallback(
    (size: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('limit', String(size));
        next.set('page', '1');
        return next;
      });
    },
    [setSearchParams],
  );

  const totalItems = accounts?.length ?? 0;
  const effectiveLimit = limit || totalItems;
  const totalPages = Math.max(1, Math.ceil(totalItems / effectiveLimit));

  const displayedAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts;
  }, [accounts]);

  const rangeStart = totalItems > 0 ? offset + 1 : 0;
  const rangeEnd = Math.min(offset + effectiveLimit, totalItems);

  return (
    <>
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>
          IP Accounts
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowUFWModal(true)}
            disabled={ufwMut.isPending}
            className="btn btn-primary disabled:opacity-50"
          >
            {ufwMut.isPending ? 'Syncing\u2026' : 'Sync UFW'}
          </button>
        </div>
      </div>

      {ufwMut.isSuccess && (
        <div className="alert alert-success" role="alert">
          UFW sync complete.
        </div>
      )}
      {ufwMut.isError && (
        <div className="alert alert-danger" role="alert">
          UFW sync failed: {(ufwMut.error as Error).message}
        </div>
      )}

      {/* Search + Per-page controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label htmlFor="account-search" className="sr-only">Search IPs, orgs, or ASNs</label>
          <input
            id="account-search"
            type="search"
            placeholder="Search IPs, orgs, ASNs\u2026"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="vn-input w-full"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="page-size" className="text-xs whitespace-nowrap" style={{ color: 'var(--vn-text-muted)' }}>
            Per page:
          </label>
          <select
            id="page-size"
            value={limit}
            onChange={(e) => handlePageSize(Number(e.target.value))}
            className="vn-input cursor-pointer"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? 'All' : s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <Spinner label="Loading accounts" />
      ) : isError ? (
        <div className="card text-center">
          <p className="alert alert-danger" role="alert">
            Failed to load accounts: {(error as Error).message}
          </p>
        </div>
      ) : displayedAccounts.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
            {search ? `No accounts matching "${search}".` : 'No IP accounts recorded yet. Ingest archives to populate data.'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--vn-border)' }}>
            <table className="vn-table w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--vn-border)' }}>
                  <SortableHeader label="IP" column="IP" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Country" column="Country" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Org" column="Org" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--vn-text-muted)' }}>ASN</th>
                  <SortableHeader label="Requests" column="TotalRequests" currentSort={sort} currentDir={dir} onClick={handleSort} align="center" />
                  <SortableHeader label="Rate Limits" column="RatelimitEvents" currentSort={sort} currentDir={dir} onClick={handleSort} align="center" />
                  <SortableHeader label="Threat" column="ThreatScore" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Status" column="Status" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Last Seen" column="LastSeen" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--vn-text-muted)' }}>
                    Scanned
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--vn-text-muted)' }}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedAccounts.map((acct) => (
                  <tr
                    key={acct.IP}
                    className="transition-colors cursor-pointer"
                    style={{ borderBottom: '1px solid var(--vn-border)' }}
                    onClick={() => navigate(`/accounts/${encodeURIComponent(acct.IP)}`)}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--vn-surface-2)')}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '')}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/accounts/${encodeURIComponent(acct.IP)}`); }}
                    role="row"
                  >
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--vn-primary)' }}>
                      {acct.IP}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {acct.Country || '\u2014'}
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate" style={{ color: 'var(--vn-text-muted)' }}>
                      {acct.Org || '\u2014'}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--vn-text-muted)' }}>
                      {acct.ASN || '\u2014'}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{(acct.TotalRequests ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-center tabular-nums" style={{ color: acct.RatelimitEvents > 0 ? 'var(--vn-warning)' : 'var(--vn-text-muted)' }}>
                      {(acct.RatelimitEvents ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <ThreatScore score={acct.ThreatScore} />
                    </td>
                    <td className="px-3 py-2">
                      <Badge status={acct.Status} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
                      {fmtDate(acct.LastSeen)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <ScanBadge updatedAt={acct.IntelUpdatedAt} />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setInvestigateAcct(acct); }}
                        className="px-2 py-1 text-xs rounded cursor-pointer
                                   focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                        style={{ color: 'var(--vn-primary)', backgroundColor: 'transparent' }}
                        aria-label={`Investigate ${acct.IP}`}
                      >
                        Investigate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm" style={{ color: 'var(--vn-text-muted)' }}>
            <span>
              Showing {rangeStart}&ndash;{rangeEnd} of {totalItems}
            </span>
            {limit > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      next.set('page', String(Math.max(1, page - 1)));
                      return next;
                    })
                  }
                  disabled={page <= 1}
                  className="btn btn-secondary btn-sm"
                  aria-label="Previous page"
                >
                  &laquo; Prev
                </button>
                <span className="text-xs tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() =>
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      next.set('page', String(Math.min(totalPages, page + 1)));
                      return next;
                    })
                  }
                  disabled={page >= totalPages}
                  className="btn btn-secondary btn-sm"
                  aria-label="Next page"
                >
                  Next &raquo;
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>

    {investigateAcct && (
      <InvestigateModal
        ip={investigateAcct.IP}
        acct={investigateAcct}
        onClose={() => setInvestigateAcct(null)}
      />
    )}

    {showUFWModal && (
      <UFWSyncModal
        onConfirm={(pass) => ufwMut.mutate(pass)}
        onClose={() => setShowUFWModal(false)}
        isPending={ufwMut.isPending}
      />
    )}
    </>
  );
}
