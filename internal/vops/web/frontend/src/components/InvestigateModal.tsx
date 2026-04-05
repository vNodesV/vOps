import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import SSEStream from './SSEStream';
import { BASE } from '../api/client';

interface InvestigateModalProps {
  ip: string;
  onClose: () => void;
}

export default function InvestigateModal({ ip, onClose }: InvestigateModalProps) {
  const queryClient = useQueryClient();

  // Stable callback — only recreated when ip changes.
  const handleDone = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    queryClient.invalidateQueries({ queryKey: ['account', ip] });
  }, [queryClient, ip]);

  // Close on Escape key.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Investigating ${ip}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--vn-surface)',
          border: '1px solid var(--vn-border)',
          boxShadow: 'var(--vn-shadow-md)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--vn-border)' }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--vn-text)' }}>
              Full Investigation
            </h2>
            <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--vn-primary)' }}>
              {ip}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{ color: 'var(--vn-text-muted)' }}
            aria-label="Close investigation"
          >
            ✕
          </button>
        </div>

        {/* Stream */}
        <div className="p-4">
          <SSEStream
            url={`${BASE}/api/v1/investigate/${encodeURIComponent(ip)}`}
            method="POST"
            onDone={handleDone}
          />
        </div>

        {/* Footer */}
        <div
          className="flex justify-end px-5 py-3"
          style={{ borderTop: '1px solid var(--vn-border)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-md cursor-pointer
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text-muted)',
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
