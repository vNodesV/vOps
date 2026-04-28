import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccount, blockIP, unblockIP } from '../api';
import { BASE } from '../api/client';
import Badge from '../components/Badge';
import ThreatScore from '../components/ThreatScore';
import PortGrid from '../components/PortGrid';
import SSEStream from '../components/SSEStream';
import Spinner from '../components/Spinner';

function parseJSON<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function fmtDate(iso: string): string {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

type StreamAction = 'enrich' | 'osint' | 'investigate' | null;

export default function AccountDetailPage() {
  const { ip } = useParams<{ ip: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeStream, setActiveStream] = useState<StreamAction>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);

  // Stable callback — prevents SSEStream useEffect from looping on re-render.
  const handleStreamDone = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['account', ip] });
  }, [queryClient, ip]);

  const { data: account, isLoading, isError, error } = useQuery({
    queryKey: ['account', ip],
    queryFn: () => getAccount(ip!),
    enabled: !!ip,
  });

  const blockMut = useMutation({
    mutationFn: () => blockIP(ip!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account', ip] }),
  });

  const unblockMut = useMutation({
    mutationFn: () => unblockIP(ip!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account', ip] }),
  });

  const handleBlockToggle = useCallback(() => {
    if (!account) return;
    if (account.Status === 'blocked') {
      unblockMut.mutate();
      setConfirmBlock(false);
    } else {
      if (!confirmBlock) {
        setConfirmBlock(true);
        return;
      }
      blockMut.mutate();
      setConfirmBlock(false);
    }
  }, [account, confirmBlock, blockMut, unblockMut]);

  if (isLoading) return <Spinner label="Loading account details" />;
  if (isError) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/accounts')}
          className="text-sm cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ color: 'var(--vn-primary)' }}
          aria-label="Back to accounts"
        >
          &larr; Back to Accounts
        </button>
        <div className="alert alert-danger" role="alert">
          <p>
            Failed to load account: {(error as Error).message}
          </p>
        </div>
      </div>
    );
  }

  if (!account) return null;

  const threatFlags = parseJSON<string[]>(account.ThreatFlags, []);
  const tags = parseJSON<string[]>(account.Tags, []);
  const isBlocked = account.Status === 'blocked';
  const shodanPorts: number[] = parseJSON<{ ports?: number[] }>(account.ShodanData, {}).ports ?? [];

  const detailRows: Array<{ label: string; value: string | number | null }> = [
    { label: 'IP Address', value: account.IP },
    { label: 'First Seen', value: fmtDate(account.FirstSeen) },
    { label: 'Last Seen', value: fmtDate(account.LastSeen) },
    { label: 'Total Requests', value: (account.TotalRequests ?? 0).toLocaleString() },
    { label: 'Rate Limit Events', value: (account.RatelimitEvents ?? 0).toLocaleString() },
    { label: 'Country', value: account.Country },
    { label: 'ASN', value: account.ASN },
    { label: 'Org', value: account.Org },
    { label: 'RDNS', value: account.RDNS },
    { label: 'Abuse Email', value: account.AbuseEmail },
    { label: 'Abuse Score', value: account.AbuseScore },
    { label: 'VT Malicious', value: account.VTMalicious },
    { label: 'Moniker', value: account.Moniker },
    { label: 'Chain ID', value: account.ChainID },
    { label: 'Protocol', value: account.Protocol },
    { label: 'Ping Latency', value: account.PingMs > 0 ? `${account.PingMs}ms` : null },
    { label: 'OSINT Updated', value: fmtDate(account.OSINTUpdatedAt) },
    { label: 'Intel Updated', value: fmtDate(account.IntelUpdatedAt) },
  ];

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/accounts')}
        className="text-sm cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
        style={{ color: 'var(--vn-primary)' }}
        aria-label="Back to accounts"
      >
        &larr; Back to Accounts
      </button>

      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <h2 className="text-xl font-bold font-mono" style={{ color: 'var(--vn-text)' }}>
          {account.IP}
        </h2>
        <Badge status={account.Status} />
        <div className="ml-auto">
          <ThreatScore score={account.ThreatScore} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Detail table */}
          <div className="card card-flush overflow-hidden">
            <table className="vn-table">
              <tbody>
                {detailRows.map(({ label, value }) => (
                  <tr key={label}>
                    <td
                      className="font-medium whitespace-nowrap w-40"
                      style={{ color: 'var(--vn-text-muted)' }}
                    >
                      {label}
                    </td>
                    <td>{value || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Port Grid */}
          <div className="card card-sm">
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
              Port Scan
            </h3>
            <PortGrid openPorts={account.OpenPorts} extraPorts={shodanPorts} />
          </div>

          {/* Threat Flags */}
          {threatFlags.length > 0 && (
            <div className="card card-sm">
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
                Threat Flags
              </h3>
              <div className="flex flex-wrap gap-2">
                {threatFlags.map((flag) => (
                  <span
                    key={flag}
                    className="px-2.5 py-1 text-xs font-medium rounded-md"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--vn-danger) 12%, transparent)',
                      color: 'var(--vn-danger)',
                      border: '1px solid color-mix(in srgb, var(--vn-danger) 25%, transparent)',
                    }}
                  >
                    {flag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="card card-sm">
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--vn-text-muted)' }}>
                Tags
              </h3>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-1 text-xs font-medium rounded-md"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--vn-primary) 12%, transparent)',
                      color: 'var(--vn-primary)',
                      border: '1px solid color-mix(in srgb, var(--vn-primary) 25%, transparent)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {account.Notes && (
            <div className="card card-sm">
              <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>
                Notes
              </h3>
              <p className="text-sm whitespace-pre-wrap">{account.Notes}</p>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="space-y-4">
          <div className="card card-sm space-y-3">
            <h3 className="text-sm font-medium" style={{ color: 'var(--vn-text-muted)' }}>
              Actions
            </h3>

            {/* Block / Unblock */}
            <button
              onClick={handleBlockToggle}
              disabled={blockMut.isPending || unblockMut.isPending}
              className={`w-full btn disabled:opacity-50 ${isBlocked ? 'btn-primary' : confirmBlock ? 'btn-danger' : 'btn-secondary'}`}
            >
              {blockMut.isPending || unblockMut.isPending
                ? 'Processing\u2026'
                : isBlocked
                  ? 'Unblock IP'
                  : confirmBlock
                    ? 'Confirm Block'
                    : 'Block IP'}
            </button>
            {confirmBlock && !isBlocked && (
              <button
                onClick={() => setConfirmBlock(false)}
                className="btn btn-ghost btn-sm w-full"
              >
                Cancel
              </button>
            )}
            {(blockMut.isError || unblockMut.isError) && (
              <p className="alert alert-danger text-xs" role="alert">
                {((blockMut.error || unblockMut.error) as Error)?.message}
              </p>
            )}

            <hr style={{ borderColor: 'var(--vn-border)' }} />

            {/* Enrich */}
            <button
              onClick={() => setActiveStream(activeStream === 'enrich' ? null : 'enrich')}
              className={`w-full btn ${activeStream === 'enrich' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Run Enrichment
            </button>

            {/* OSINT */}
            <button
              onClick={() => setActiveStream(activeStream === 'osint' ? null : 'osint')}
              className={`w-full btn ${activeStream === 'osint' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Run OSINT
            </button>

            {/* Full Investigation */}
            <button
              onClick={() => setActiveStream(activeStream === 'investigate' ? null : 'investigate')}
              className={`w-full btn ${activeStream === 'investigate' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Full Investigation
            </button>
          </div>

          {/* SSE Stream Panel */}
          {activeStream && ip && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium uppercase" style={{ color: 'var(--vn-text-muted)' }}>
                  {activeStream === 'enrich' && 'Enrichment'}
                  {activeStream === 'osint' && 'OSINT Scan'}
                  {activeStream === 'investigate' && 'Full Investigation'}
                </h4>
                <button
                  onClick={() => setActiveStream(null)}
                  className="text-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                  style={{ color: 'var(--vn-text-muted)' }}
                  aria-label="Close stream"
                >
                  Close
                </button>
              </div>
              <SSEStream
                url={`${BASE}/api/v1/${activeStream}/${encodeURIComponent(ip)}`}
                method="POST"
                onDone={handleStreamDone}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
