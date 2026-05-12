import { NavLink, useLocation } from 'react-router-dom';
import GlobalProgressBar from './GlobalProgressBar';
import DebugPanel from './DebugPanel';
import { GearButton } from './SettingsDrawer';
import { BASE } from '../api/client';

const NAV_SECTIONS = [
  {
    section: 'Main',
    items: [
      { to: '/',         label: 'Dashboard',   end: true },
      { to: '/accounts', label: 'IP Accounts', end: false },
      { to: '/proxy',    label: 'Proxy Logs',  end: false },
    ],
  },
  {
    section: 'Infrastructure',
    items: [
      { to: '/ops',       label: 'OpsCenter',  end: false },
      { to: '/chains',    label: 'Services',   end: false },
      { to: '/topology',  label: 'Topology',   end: false },
      { to: '/multiprox', label: 'Multi-vProx',end: false },
    ],
  },
  {
    section: 'System',
    items: [
      { to: '/audit',    label: 'Audit Log', end: false },
      { to: '/settings', label: 'Settings',  end: false },
    ],
  },
];

interface SidebarShellProps {
  children: React.ReactNode;
  debugEnabled: boolean;
  onToggleDebug: () => void;
  onGlobalSettings: () => void;
  onLogout: () => void;
}

export default function SidebarShell({
  children,
  debugEnabled,
  onToggleDebug,
  onGlobalSettings,
  onLogout,
}: SidebarShellProps) {
  const loc = useLocation();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Fixed sidebar ─────────────────────────────────────── */}
      <aside
        aria-label="Sidebar navigation"
        style={{
          width: 220,
          minHeight: '100vh',
          position: 'fixed',
          left: 0, top: 0, bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--vn-surface)',
          borderRight: '1px solid var(--vn-border)',
          zIndex: 100,
          overflowY: 'auto',
        }}
      >
        {/* Logo */}
        <div style={{ padding: '1.1rem 1.1rem 0.85rem', borderBottom: '1px solid var(--vn-border)', flexShrink: 0 }}>
          <a href={BASE + '/'} className="vops-logo-link" aria-label="vOps home">
            <div className="vops-logo">
              <span className="vops-logo-fallback">
                v<span style={{ opacity: 0.55 }}>[</span>O<span style={{ opacity: 0.55 }}>]</span>ps
              </span>
            </div>
            <div className="vops-logo-tagline">Access Intelligence &amp; Operations</div>
          </a>
        </div>

        {/* Nav sections */}
        <nav
          role="navigation"
          aria-label="Sidebar"
          style={{ flex: 1, paddingTop: '0.6rem', paddingBottom: '0.4rem' }}
        >
          {NAV_SECTIONS.map(({ section, items }) => (
            <div key={section} style={{ marginBottom: '0.6rem' }}>
              <div style={{
                fontSize: '0.6rem', fontWeight: 700,
                color: 'var(--vn-text-subtle)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                padding: '0.3rem 1.1rem 0.15rem',
              }}>
                {section}
              </div>
              {items.map(item => {
                const isActive = item.end
                  ? loc.pathname === item.to
                  : loc.pathname === item.to || loc.pathname.startsWith(item.to + '/');
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    style={{
                      display: 'block',
                      padding: '0.4rem 1.1rem 0.4rem 1.2rem',
                      fontSize: '0.81rem',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? 'var(--vn-primary)' : 'var(--vn-text-muted)',
                      textDecoration: 'none',
                      borderLeft: `2px solid ${isActive ? 'var(--vn-primary)' : 'transparent'}`,
                      background: isActive ? 'var(--vn-green-dim)' : 'transparent',
                      transition: 'color 0.1s, background 0.1s, border-color 0.1s',
                    }}
                  >
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Sidebar footer */}
        <div style={{
          padding: '0.7rem 1.1rem',
          borderTop: '1px solid var(--vn-border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <GearButton
              onClick={onGlobalSettings}
              label="System settings"
              style={{ opacity: 0.6, padding: '0.25rem' }}
            />
            <button
              onClick={onToggleDebug}
              title={debugEnabled ? 'Disable debug console' : 'Enable debug console'}
              aria-pressed={debugEnabled}
              style={{
                background: 'none',
                border: debugEnabled ? '1px solid var(--vn-primary)' : '1px solid transparent',
                color: debugEnabled ? 'var(--vn-primary)' : 'var(--vn-text-subtle)',
                borderRadius: 4, padding: '0.18rem 0.3rem',
                cursor: 'pointer', fontSize: '0.78rem', lineHeight: 1,
              }}
            >
              🐛
            </button>
            <button
              onClick={onLogout}
              aria-label="Log out"
              style={{
                marginLeft: 'auto', background: 'none',
                border: '1px solid var(--vn-border)',
                color: 'var(--vn-text-muted)', borderRadius: 4,
                padding: '0.18rem 0.45rem', cursor: 'pointer',
                fontSize: '0.7rem', fontWeight: 500,
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content area ──────────────────────────────────── */}
      <div style={{ marginLeft: 220, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <GlobalProgressBar />
        <a className="skip-to-content" href="#main-content">Skip to main content</a>
        <main
          id="main-content"
          className="app-main"
          style={{ flex: 1, paddingBottom: debugEnabled ? '270px' : undefined }}
          tabIndex={-1}
        >
          <div className="container">
            {children}
          </div>
        </main>
        <footer className="vlog-footer">
          v<span>[O]</span>ps · Access Intelligence &amp; Operations
        </footer>
        {debugEnabled && <DebugPanel onDisable={onToggleDebug} />}
      </div>

    </div>
  );
}
