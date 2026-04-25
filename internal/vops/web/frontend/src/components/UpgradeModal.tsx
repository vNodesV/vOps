import { useCallback, useEffect, useRef, useState } from 'react';
import { openSSEStream } from '../api/sse';
import Spinner from './Spinner';

type Phase = 'input' | 'running' | 'done' | 'error';

interface UpgradeModalProps {
  vmName: string;
  upgradeURL: string;
  onClose: () => void;
  onStart?: () => void;
  onDone?: (success: boolean, detail?: string) => void;
}

interface LogEntry { text: string; step: string; }

export default function UpgradeModal({ vmName, upgradeURL, onClose, onStart, onDone }: UpgradeModalProps) {
  const [pass, setPass]         = useState('');
  const [phase, setPhase]       = useState<Phase>('input');
  const [log, setLog]           = useState<LogEntry[]>([]);
  const [errMsg, setErrMsg]     = useState('');
  const cancelRef               = useRef<(() => void) | null>(null);
  const bottomRef               = useRef<HTMLDivElement>(null);

  // Escape to close only when not actively running.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'running') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, phase]);

  // Auto-scroll log.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  // Cleanup on unmount.
  useEffect(() => () => { cancelRef.current?.(); }, []);

  const handleRun = useCallback(() => {
    setPhase('running');
    setLog([]);
    setErrMsg('');
    onStart?.();

    const body = pass ? { sudo_password: pass } : {};

    cancelRef.current = openSSEStream(
      upgradeURL,
      'POST',
      (msg) => {
        try {
          const ev = JSON.parse(msg.data) as { step: string; msg: string };
          setLog(prev => [...prev, { step: ev.step ?? '', text: ev.msg ?? msg.data }]);
        } catch {
          setLog(prev => [...prev, { step: '', text: msg.data }]);
        }
      },
      () => { setPhase('done'); onDone?.(true); },
      (err) => { setErrMsg(err.message); setPhase('error'); onDone?.(false, err.message); },
      body,
    );
  }, [upgradeURL, pass, onStart, onDone]);

  const stepColor = (step: string) => {
    if (step.endsWith(':error') || step === 'error') return 'var(--vn-danger)';
    if (step === 'complete' || step.endsWith(':done')) return 'var(--vn-success)';
    if (step.endsWith(':start') || step === 'connected') return 'var(--vn-primary)';
    return 'var(--vn-text)';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Upgrade ${vmName}`}
      onClick={(e) => { if (e.target === e.currentTarget && phase !== 'running') onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: 'var(--vn-surface)',
          border: '1px solid var(--vn-border)',
          boxShadow: 'var(--vn-shadow-md)',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--vn-border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--vn-text)' }}>
              Upgrade Server
            </h2>
            <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--vn-primary)' }}>
              {vmName}
            </p>
          </div>
          {phase !== 'running' && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-md cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
              style={{ color: 'var(--vn-text-muted)' }}
              aria-label="Close upgrade modal"
            >
              ✕
            </button>
          )}
        </div>

        {/* Input phase */}
        {phase === 'input' && (
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
              Runs <code style={{ color: 'var(--vn-primary)' }}>sudo apt update && sudo apt upgrade -y</code> on this server via SSH.
            </p>
            <label className="block">
              <span className="text-xs font-medium" style={{ color: 'var(--vn-text-muted)' }}>
                Sudo password <span className="font-normal">(leave blank if NOPASSWD configured)</span>
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRun(); }}
                placeholder="password"
                className="mt-1.5 w-full px-3 py-2 rounded-md text-sm outline-none
                           focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                style={{
                  backgroundColor: 'var(--vn-surface-2)',
                  border: '1px solid var(--vn-border)',
                  color: 'var(--vn-text)',
                }}
              />
            </label>
          </div>
        )}

        {/* Log output */}
        {(phase === 'running' || phase === 'done' || phase === 'error') && (
          <div className="flex-1 overflow-y-auto p-4 min-h-0" style={{ maxHeight: '400px' }}>
            <div
              className="rounded-lg p-3 font-mono text-xs leading-relaxed space-y-1"
              style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
              role="log"
              aria-live="polite"
            >
              {log.map((entry, i) => (
                <div
                  key={i}
                  className="whitespace-pre-wrap break-all"
                  style={{ color: stepColor(entry.step) }}
                >
                  {entry.step && <span className="opacity-60 mr-2">[{entry.step}]</span>}
                  {entry.text}
                </div>
              ))}
              {phase === 'running' && log.length === 0 && <Spinner size={14} label="Connecting…" />}
              {phase === 'error' && errMsg && (
                <div style={{ color: 'var(--vn-danger)' }}>Error: {errMsg}</div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 px-5 py-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--vn-border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
            {phase === 'running' && (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--vn-warning)' }} />
                Upgrading…
              </span>
            )}
            {phase === 'done' && <span style={{ color: 'var(--vn-success)' }}>✓ Upgrade complete</span>}
            {phase === 'error' && <span style={{ color: 'var(--vn-danger)' }}>✗ Upgrade failed</span>}
          </span>
          <div className="flex gap-2">
            {phase !== 'running' && (
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-sm rounded-md cursor-pointer"
                style={{ border: '1px solid var(--vn-border)', color: 'var(--vn-text-muted)' }}
              >
                {phase === 'done' || phase === 'error' ? 'Close' : 'Cancel'}
              </button>
            )}
            {phase === 'input' && (
              <button
                onClick={handleRun}
                className="px-4 py-1.5 text-sm font-medium rounded-md cursor-pointer
                           focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
              >
                Run Upgrade
              </button>
            )}
            {phase === 'running' && (
              <span className="flex items-center gap-1.5 px-4 py-1.5 text-sm" style={{ color: 'var(--vn-text-muted)' }}>
                <Spinner size={14} /> Running…
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
