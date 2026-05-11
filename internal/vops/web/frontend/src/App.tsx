import { useState, useEffect, useRef } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { TaskProvider } from './contexts/TaskContext';

import CosmosNodes from './pages/CosmosNodes';
import Dashboard from './pages/Dashboard';
import AccountsPage from './pages/Accounts';
import AccountDetail from './pages/AccountDetail';
import LoginPage from './pages/Login';
import SettingsPage from './pages/settings';
import OperationsPage from './pages/Operations';
import TopologyPage from './pages/Topology';
import MultiProxPage from './pages/MultiProx';
import AuditPage from './pages/Audit';
import ProxyPage from './pages/proxy';
import DebugPanel from './components/DebugPanel';
import SettingsDrawer, { GearButton } from './components/SettingsDrawer';
import { VOpsPanel, BackupsPanel, PreferencesPanel } from './pages/settings/SystemPanel';
import GlobalProgressBar from './components/GlobalProgressBar';
import Spinner from './components/Spinner';
import { logout, getDebugMode, setDebugMode, getConfig, savePreferences } from './api';
import { BASE } from './api/client';
import { applyTheme, THEMES } from './lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/* ── Global settings drawer ──────────────────────────────────── */

function GlobalSettingsDrawer({ onClose }: { onClose: () => void }) {
  const { data: config, isLoading } = useQuery({ queryKey: ['config'], queryFn: getConfig });
  return (
    <SettingsDrawer title="System Settings" onClose={onClose}>
      {isLoading ? (
        <Spinner label="Loading settings…" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {config && <VOpsPanel config={config} />}
          {config && <BackupsPanel config={config} />}
          <PreferencesPanel />
        </div>
      )}
    </SettingsDrawer>
  );
}


function Shell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') ?? 'vthemedgr'
  );
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loc.pathname === '/login') return;
    getDebugMode().then((d) => setDebugEnabled(d.enabled)).catch(() => {});
  }, [loc.pathname]);

  // Close More dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close mobile nav on route change
  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);

  const handleLogout = async () => {
    await logout().catch(() => {});
    window.location.href = BASE + '/login';
  };

  const handleThemeChange = (id: string) => {
    setCurrentTheme(id);
    applyTheme(id);
    savePreferences({ theme: id }).catch(() => {});
  };

  const toggleDebug = async () => {
    const next = !debugEnabled;
    try { await setDebugMode(next); setDebugEnabled(next); } catch { /* ignore */ }
  };

  if (loc.pathname === '/login') return <>{children}</>;

  const primaryLinks = [
    { to: '/', label: 'Dashboard', end: true },
    { to: '/proxy', label: 'Proxy', end: false },
    { to: '/accounts', label: 'IP Accounts', end: false },
    { to: '/ops', label: 'OpsCenter', end: false },
  ];

  const moreLinks = [
    { to: '/chains', label: 'Chains' },
    { to: '/topology', label: 'Topology' },
    { to: '/multiprox', label: 'Multi-vProx' },
    { to: '/audit', label: 'Audit Log' },
    { to: '/settings', label: 'Settings' },
  ];

  const allLinks = [...primaryLinks, ...moreLinks];
  const isMoreActive = moreLinks.some(l => loc.pathname.startsWith(l.to));

  return (
    <>
      <GlobalProgressBar />
      <a className="skip-to-content" href="#main-content">Skip to main content</a>

      {/* ── Top nav ────────────────────────────────────────────── */}
      <nav className="page-nav" role="navigation" aria-label="Main navigation">
        <div className="nav-inner">
          {/* Left: logo */}
          <a className="vops-logo-link" href={BASE + '/'} aria-label="vOps home">
            <div className="vops-logo" aria-hidden="true" />
            <noscript>
              <span className="vops-logo-fallback">v[O]ps</span>
            </noscript>
          </a>

          {/* Center: nav links */}
          <div className="nav-links">
            {primaryLinks.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                {l.label}
              </NavLink>
            ))}

            {/* More ▾ */}
            <div className="nav-more" ref={moreRef}>
              <button
                className={`nav-more-btn${moreOpen ? ' open' : ''}${isMoreActive ? ' open' : ''}`}
                onClick={() => setMoreOpen(o => !o)}
                aria-haspopup="true"
                aria-expanded={moreOpen}
              >
                More ▾
              </button>
              {moreOpen && (
                <div className="nav-more-dropdown" role="menu">
                  {moreLinks.map(l => (
                    <NavLink
                      key={l.to}
                      to={l.to}
                      className={({ isActive }) => isActive ? 'active' : ''}
                      role="menuitem"
                      onClick={() => setMoreOpen(false)}
                    >
                      {l.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: theme + debug + logout + hamburger */}
          <div className="nav-right">
            <select
              className="nav-theme-select"
              value={currentTheme}
              onChange={e => handleThemeChange(e.target.value)}
              aria-label="Select theme"
            >
              {THEMES.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>

            <button
              onClick={toggleDebug}
              className={`nav-debug-btn${debugEnabled ? ' on' : ''}`}
              title={debugEnabled ? 'Disable debug console' : 'Enable debug console'}
              aria-pressed={debugEnabled}
            >
              🐛
            </button>

            <GearButton
              onClick={() => setGlobalSettingsOpen(true)}
              label="System settings"
              style={{ opacity: 0.6, padding: '0.3rem' }}
            />

            <button className="nav-logout-btn" onClick={handleLogout} aria-label="Log out">
              Logout
            </button>

            <button
              className="hamburger-btn"
              onClick={() => setMobileOpen(o => !o)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* ── Global settings drawer ─────────────────────────────── */}
      {globalSettingsOpen && (
        <GlobalSettingsDrawer onClose={() => setGlobalSettingsOpen(false)} />
      )}

      {/* ── Mobile nav drawer ──────────────────────────────────── */}
      {mobileOpen && (
        <div className="nav-mobile-drawer open" role="dialog" aria-modal="true" aria-label="Mobile navigation">
          <div className="nav-mobile-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="nav-mobile-panel">
            <div style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--vn-green-border)' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--vn-primary)', letterSpacing: '-0.02em' }}>
                v<span>[O]</span>ps
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--vn-text-muted)', marginTop: 2 }}>
                ACCESS INTELLIGENCE &amp; OPERATIONS
              </div>
            </div>
            {allLinks.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={'end' in l ? (l as { end: boolean }).end : false}
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                {l.label}
              </NavLink>
            ))}
            <div style={{ flex: 1 }} />
            <button
              className="nav-logout-btn"
              onClick={handleLogout}
              style={{ marginTop: '1rem', width: '100%', justifyContent: 'center' }}
            >
              Logout
            </button>
          </div>
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────── */}
      <main
        id="main-content"
        className="app-main"
        style={{ paddingBottom: debugEnabled ? '270px' : undefined }}
        tabIndex={-1}
      >
        <div className="container">
          {children}
        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="vlog-footer">
        v<span>[O]</span>ps · ACCESS INTELLIGENCE &amp; OPERATIONS
      </footer>

      {debugEnabled && <DebugPanel onDisable={() => setDebugEnabled(false)} />}
    </>
  );
}

export default function App() {
  return (
    <TaskProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={BASE || ''}>
          <Shell>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Dashboard />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/accounts/:ip" element={<AccountDetail />} />
              <Route path="/vms" element={<Navigate to="/ops" replace />} />
              <Route path="/ops" element={<OperationsPage />} />
              <Route path="/proxy" element={<ProxyPage />} />
              <Route path="/services" element={<Navigate to="/settings" replace />} />
              <Route path="/chains" element={<CosmosNodes />} />
              <Route path="/topology" element={<TopologyPage />} />
              <Route path="/multiprox" element={<MultiProxPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        </BrowserRouter>
      </QueryClientProvider>
    </TaskProvider>
  );
}
