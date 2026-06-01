/**
 * components/SettingsDrawer.tsx
 * Right slide-in drawer for contextual/per-module settings.
 *
 * Exports:
 *   default  SettingsDrawer  — the drawer shell (portal-based)
 *   GearButton               — reusable ⚙ trigger button
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/* ── GearButton ──────────────────────────────────────────────── */

export function GearButton({
  onClick,
  label = 'Open settings',
  style,
}: {
  onClick: (e: React.MouseEvent) => void;
  label?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'none',
        border: 'none',
        padding: '0.2rem',
        cursor: 'pointer',
        color: 'var(--vn-text-subtle, var(--vn-text-muted))',
        opacity: 0.5,
        borderRadius: '4px',
        transition: 'opacity 0.15s',
        ...style,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.5'; }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  );
}

/* ── SettingsDrawer ──────────────────────────────────────────── */

interface SettingsDrawerProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function SettingsDrawer({ title, onClose, children }: SettingsDrawerProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        style={{
          width: '480px',
          maxWidth: '100vw',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--vn-surface)',
          borderLeft: '1px solid var(--vn-border)',
          boxShadow: '-4px 0 32px rgba(0,0,0,0.35)',
          overflowY: 'auto',
        }}
      >
        {/* Drawer header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--vn-border)',
          flexShrink: 0,
        }}>
          <h2 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--vn-text)' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              color: 'var(--vn-text-muted)',
              fontSize: '1rem',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Drawer content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
