import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import SSEStream from './SSEStream';
import { BASE } from '../api/client';
import type { IPAccount } from '../api/types';

// ── Types ────────────────────────────────────────────────────────────────────

type ProviderStatus = 'pending' | 'loading' | 'done' | 'skip' | 'error';
type PortScanStatus = 'idle' | 'scanning' | 'done';

interface Providers { vt: ProviderStatus; abuse: ProviderStatus; shodan: ProviderStatus; }
interface PortScan  { status: PortScanStatus; openPorts: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_LABEL: Record<keyof Providers, string> = {
  vt: 'VirusTotal',
  abuse: 'AbuseIPDB',
  shodan: 'Shodan',
};

function providerIcon(s: ProviderStatus) {
  if (s === 'done')  return { icon: '✓', color: 'var(--vn-success)' };
  if (s === 'error') return { icon: '✗', color: 'var(--vn-danger)'  };
  if (s === 'skip')  return { icon: '—', color: 'var(--vn-text-subtle)' };
  return { icon: '',  color: 'var(--vn-primary)' };
}

// ── ProviderPill ──────────────────────────────────────────────────────────────

function ProviderPill({ label, status }: { label: string; status: ProviderStatus }) {
  const { icon, color } = providerIcon(status);
  const isLoading = status === 'loading';
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
      style={{
        border: `1px solid ${status === 'done' ? 'var(--vn-success)' : status === 'error' ? 'var(--vn-danger)' : 'var(--vn-border)'}`,
        backgroundColor: 'var(--vn-surface-2)',
        color,
        opacity: status === 'pending' ? 0.5 : 1,
        transition: 'all 0.3s',
      }}
    >
      {isLoading ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="var(--vn-border)" strokeWidth="3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--vn-primary)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        <span style={{ fontSize: '10px', lineHeight: 1 }}>{icon || '·'}</span>
      )}
      {label}
    </div>
  );
}

// ── ProgressBar ───────────────────────────────────────────────────────────────

function ProgressBar({ pct, color, striped }: { pct: number; color: string; striped?: boolean }) {
  return (
    <div
      className="h-1.5 rounded-full overflow-hidden"
      style={{ backgroundColor: 'var(--vn-surface-2)' }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.min(100, pct)}%`,
          backgroundColor: color,
          backgroundImage: striped
            ? 'repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(255,255,255,0.12) 10px,rgba(255,255,255,0.12) 20px)'
            : undefined,
        }}
      />
    </div>
  );
}

// ── InvestigateModal ──────────────────────────────────────────────────────────

interface InvestigateModalProps {
  ip: string;
  acct?: IPAccount;
  onClose: () => void;
}

export default function InvestigateModal({ ip, acct, onClose }: InvestigateModalProps) {
  const queryClient = useQueryClient();

  const [overallPct,  setOverallPct]  = useState(0);
  const [streamDone,  setStreamDone]  = useState(false);
  const [providers,   setProviders]   = useState<Providers>({ vt: 'pending', abuse: 'pending', shodan: 'pending' });
  const [portScan,    setPortScan]    = useState<PortScan>({ status: 'idle', openPorts: '' });
  const [portPct,     setPortPct]     = useState(0);

  const handleDone = useCallback(() => {
    setStreamDone(true);
    setOverallPct(100);
    setPortPct(100);
    // Refresh the accounts list so updated data and sort are shown after dismiss.
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    queryClient.invalidateQueries({ queryKey: ['account', ip] });
  }, [queryClient, ip]);

  const handleMessage = useCallback((data: string) => {
    try {
      const ev = JSON.parse(data) as { step?: string; pct?: number; msg?: string; is_err?: boolean };
      const step = ev.step ?? '';
      if (typeof ev.pct === 'number') setOverallPct(ev.pct);

      if (step === 'ti:querying') {
        setProviders({ vt: 'loading', abuse: 'loading', shodan: 'loading' });
      } else if (step.startsWith('ti:vt_')) {
        const s = step.slice(6);
        setProviders(p => ({ ...p, vt: (s === 'done' || s === 'cached') ? 'done' : s === 'skip' ? 'skip' : 'error' }));
      } else if (step.startsWith('ti:abuse_')) {
        const s = step.slice(9);
        setProviders(p => ({ ...p, abuse: (s === 'done' || s === 'cached') ? 'done' : s === 'skip' ? 'skip' : 'error' }));
      } else if (step.startsWith('ti:shodan_')) {
        const s = step.slice(10);
        setProviders(p => ({ ...p, shodan: (s === 'done' || s === 'cached' || s === 'none') ? 'done' : s === 'skip' ? 'skip' : 'error' }));
      }

      if (step === 'osint:portscan') {
        setPortScan({ status: 'scanning', openPorts: '' });
        setPortPct(0);
        let p = 0;
        const tick = setInterval(() => {
          p = Math.min(90, p + 12);
          setPortPct(p);
          if (p >= 90) clearInterval(tick);
        }, 200);
        void tick;
      } else if (step === 'osint:ports_done' || step === 'osint:ports_none') {
        const msg = ev.msg ?? '';
        const match = msg.match(/Open ports: (.+)/);
        setPortScan({ status: 'done', openPorts: match ? match[1] : '' });
        setPortPct(100);
      }
    } catch { /* non-JSON line — ignore */ }
  }, []);

  // Escape key dismiss.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const portColor = portScan.status === 'done'
    ? (portScan.openPorts ? 'var(--vn-warning)' : 'var(--vn-success)')
    : 'var(--vn-primary)';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Investigating ${ip}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--vn-surface)',
          border: '1px solid var(--vn-border)',
          boxShadow: 'var(--vn-shadow-md)',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div
          className="flex items-start justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--vn-border)' }}
        >
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--vn-text)' }}>
              Full Investigation
            </h2>
            <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--vn-primary)' }}>
              {ip}
            </p>
            {/* Account metadata — populated from the acct prop if provided */}
            {acct && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--vn-text-muted)' }}>
                {acct.Org && (
                  <span className="truncate max-w-[180px]" title={acct.Org}>
                    <span style={{ color: 'var(--vn-text-subtle)' }}>Org</span>{' '}
                    <span style={{ color: 'var(--vn-text)' }}>{acct.Org}</span>
                  </span>
                )}
                <span>
                  <span style={{ color: 'var(--vn-text-subtle)' }}>Requests</span>{' '}
                  <span className="tabular-nums" style={{ color: 'var(--vn-text)' }}>
                    {(acct.TotalRequests ?? 0).toLocaleString()}
                  </span>
                </span>
                <span>
                  <span style={{ color: 'var(--vn-text-subtle)' }}>Rate limits</span>{' '}
                  <span
                    className="tabular-nums"
                    style={{ color: acct.RatelimitEvents > 0 ? 'var(--vn-warning)' : 'var(--vn-text)' }}
                  >
                    {(acct.RatelimitEvents ?? 0).toLocaleString()}
                  </span>
                </span>
                {acct.ThreatScore > 0 && (
                  <span>
                    <span style={{ color: 'var(--vn-text-subtle)' }}>Score</span>{' '}
                    <span
                      style={{
                        color: acct.ThreatScore >= 70
                          ? 'var(--vn-danger)'
                          : acct.ThreatScore >= 40
                          ? 'var(--vn-warning)'
                          : 'var(--vn-text)',
                      }}
                    >
                      {acct.ThreatScore}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)] flex-shrink-0 ml-3"
            style={{ color: 'var(--vn-text-muted)' }}
            aria-label="Close investigation"
          >
            ✕
          </button>
        </div>

        {/* ── Progress Section ────────────────────────────────────────────────── */}
        <div className="px-5 pt-4 pb-3 space-y-4" style={{ borderBottom: '1px solid var(--vn-border)' }}>

          {/* Overall progress */}
          <div>
            <div
              className="flex justify-between text-xs mb-1.5"
              style={{ color: 'var(--vn-text-muted)' }}
            >
              <span>{streamDone ? 'Complete' : 'Overall progress'}</span>
              <span>{overallPct}%</span>
            </div>
            <ProgressBar
              pct={overallPct}
              color={streamDone ? 'var(--vn-success)' : 'var(--vn-primary)'}
            />
          </div>

          {/* Provider pills */}
          <div>
            <div className="text-xs mb-2" style={{ color: 'var(--vn-text-muted)' }}>
              Intelligence Providers
            </div>
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(PROVIDER_LABEL) as Array<keyof Providers>).map(key => (
                <ProviderPill key={key} label={PROVIDER_LABEL[key]} status={providers[key]} />
              ))}
            </div>
          </div>

          {/* Port scan */}
          <div>
            <div
              className="flex justify-between text-xs mb-1.5"
              style={{ color: 'var(--vn-text-muted)' }}
            >
              <span>Port Scan</span>
              <span style={{ color: portColor, fontVariantNumeric: 'tabular-nums' }}>
                {portScan.status === 'idle'     && <span style={{ color: 'var(--vn-text-subtle)' }}>waiting…</span>}
                {portScan.status === 'scanning' && 'scanning 22, 80, 443, 1317, 9090, 26656, 26657…'}
                {portScan.status === 'done'     && (portScan.openPorts
                  ? `open: ${portScan.openPorts}`
                  : 'no open ports')}
              </span>
            </div>
            <ProgressBar
              pct={portScan.status === 'idle' ? 0 : portPct}
              color={portColor}
              striped={portScan.status === 'scanning'}
            />
          </div>
        </div>

        {/* ── Stream log ─────────────────────────────────────────────────────── */}
        <div className="p-4">
          <SSEStream
            url={`${BASE}/api/v1/investigate/${encodeURIComponent(ip)}`}
            method="POST"
            onDone={handleDone}
            onMessage={handleMessage}
          />
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div
          className="flex justify-end px-5 py-3"
          style={{ borderTop: '1px solid var(--vn-border)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-md cursor-pointer
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{ border: '1px solid var(--vn-border)', color: 'var(--vn-text-muted)' }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
