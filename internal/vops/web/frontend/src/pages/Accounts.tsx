import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getAccounts, syncUFW } from '../api';
import Badge from '../components/Badge';
import ThreatScore from '../components/ThreatScore';
import SortableHeader from '../components/SortableHeader';
import Spinner from '../components/Spinner';

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

export default function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

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
  const ufwMut = useMutation({ mutationFn: syncUFW });

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

  // Paginate client-side if API returned all results
  const displayedAccounts = useMemo(() => {
    if (!accounts) return [];
    if (limit === 0) return accounts;
    return accounts;
  }, [accounts, limit]);

  const rangeStart = totalItems > 0 ? offset + 1 : 0;
  const rangeEnd = Math.min(offset + effectiveLimit, totalItems);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>
          IP Accounts
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => ufwMut.mutate()}
            disabled={ufwMut.isPending}
            className="px-3 py-1.5 text-xs font-medium rounded-md text-white
                       disabled:opacity-50 cursor-pointer
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{ backgroundColor: 'var(--vn-primary)' }}
          >
            {ufwMut.isPending ? 'Syncing\u2026' : 'Sync UFW'}
          </button>
        </div>
      </div>

      {ufwMut.isSuccess && (
        <div
          className="p-2 rounded text-xs"
          style={{ backgroundColor: 'color-mix(in srgb, var(--vn-success) 12%, transparent)', color: 'var(--vn-success)' }}
          role="alert"
        >
          UFW sync complete.
        </div>
      )}
      {ufwMut.isError && (
        <div
          className="p-2 rounded text-xs"
          style={{ backgroundColor: 'color-mix(in srgb, var(--vn-danger) 12%, transparent)', color: 'var(--vn-danger)' }}
          role="alert"
        >
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
            className="w-full px-3 py-2 rounded-md text-sm outline-none
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{
              backgroundColor: 'var(--vn-surface)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)',
            }}
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
            className="px-2 py-1.5 rounded-md text-sm outline-none cursor-pointer
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{
              backgroundColor: 'var(--vn-surface)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)',
            }}
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
        <div className="p-6 text-center rounded-lg" style={{ backgroundColor: 'var(--vn-surface)', border: '1px solid var(--vn-border)' }}>
          <p style={{ color: 'var(--vn-danger)' }} role="alert">
            Failed to load accounts: {(error as Error).message}
          </p>
        </div>
      ) : displayedAccounts.length === 0 ? (
        <div className="p-8 text-center rounded-lg" style={{ backgroundColor: 'var(--vn-surface)', border: '1px solid var(--vn-border)' }}>
          <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
            {search ? `No accounts matching "${search}".` : 'No IP accounts recorded yet. Ingest archives to populate data.'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--vn-border)' }}>
            <table className="w-full text-sm" style={{ backgroundColor: 'var(--vn-surface)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--vn-border)' }}>
                  <SortableHeader label="IP" column="IP" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Country" column="Country" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Org" column="Org" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--vn-text-muted)' }}>ASN</th>
                  <SortableHeader label="Requests" column="TotalRequests" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Rate Limits" column="RatelimitEvents" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Threat" column="ThreatScore" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Status" column="Status" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <SortableHeader label="Last Seen" column="LastSeen" currentSort={sort} currentDir={dir} onClick={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--vn-text-muted)' }}>
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
                    <td className="px-3 py-2 text-right tabular-nums">{acct.TotalRequests.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: acct.RatelimitEvents > 0 ? 'var(--vn-warning)' : 'var(--vn-text-muted)' }}>
                      {acct.RatelimitEvents.toLocaleString()}
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
                    <td className="px-3 py-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/accounts/${encodeURIComponent(acct.IP)}`); }}
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
                  className="px-3 py-1 rounded-md text-sm disabled:opacity-40 cursor-pointer
                             focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                  style={{ border: '1px solid var(--vn-border)', backgroundColor: 'var(--vn-surface)' }}
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
                  className="px-3 py-1 rounded-md text-sm disabled:opacity-40 cursor-pointer
                             focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                  style={{ border: '1px solid var(--vn-border)', backgroundColor: 'var(--vn-surface)' }}
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
  );
}
