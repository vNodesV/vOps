import { useState, useEffect, type CSSProperties } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import Dashboard from './pages/Dashboard';
import AccountsPage from './pages/Accounts';
import AccountDetail from './pages/AccountDetail';
import LoginPage from './pages/Login';
import SettingsPage from './pages/Settings';
import FleetPage from './pages/Fleet';
import ChainsPage from './pages/Chains';
import VMsPage from './pages/VMs';
import ServicesPage from './pages/Services';
import PatchesPage from './pages/Patches';
import DebugPanel from './components/DebugPanel';
import { logout, getDebugMode, setDebugMode } from './api';
import { BASE } from './api/client';

/* ── Query client ─────────────────────────────────────────────── */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/* ── Sidebar nav link ─────────────────────────────────────────── */
function SideLink({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      style={({ isActive }: { isActive: boolean }): CSSProperties => ({
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        borderRadius: 'var(--vn-radius)',
        fontWeight: 500,
        fontSize: '0.875rem',
        color: isActive ? 'var(--vn-on-primary)' : 'var(--vn-text-muted)',
        background: isActive ? 'var(--vn-primary)' : 'transparent',
        textDecoration: 'none',
        transition: 'background 0.15s, color 0.15s',
      })}
    >
      {children}
    </NavLink>
  );
}

/* ── App shell ────────────────────────────────────────────────── */
function Shell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);

  // Sync debug state with server on mount
  useEffect(() => {
    if (loc.pathname === '/login') return;
    getDebugMode().then((d) => setDebugEnabled(d.enabled)).catch(() => {});
  }, [loc.pathname]);

  const toggleDebug = async () => {
    const next = !debugEnabled;
    try {
      await setDebugMode(next);
      setDebugEnabled(next);
    } catch {
      // ignore
    }
  };

  if (loc.pathname === '/login') return <>{children}</>;

  const sidebar: CSSProperties = {
    width: 220,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--vn-surface)',
    borderRight: '1px solid var(--vn-border)',
    padding: '1rem 0.75rem',
    gap: '0.25rem',
    minHeight: '100vh',
  };

  const handleLogout = async () => {
    await logout().catch(() => {});
    window.location.href = '/login';
  };

  return (
    <>
      {/* Skip to main content — WCAG 2.4.1 */}
      <a className="skip-to-content" href="#main-content">
        Skip to main content
      </a>

      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Mobile hamburger button — shown via CSS media query */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          className="hamburger-btn"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
            className="sidebar-overlay"
          />
        )}

        {/* Sidebar */}
        <nav
          id="app-sidebar"
          className={`app-sidebar${sidebarOpen ? ' open' : ''}`}
          style={sidebar}
          aria-label="Main navigation"
        >
          {/* Logo */}
          <div
            style={{
              padding: '0.5rem 0.25rem 1.25rem',
              borderBottom: '1px solid var(--vn-border)',
              marginBottom: '0.5rem',
            }}
          >
            <span
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                color: 'var(--vn-primary)',
                letterSpacing: '-0.02em',
              }}
            >
              v<span style={{ color: 'var(--vn-accent)' }}>[O]</span>ps
            </span>
            <div style={{ fontSize: '0.7rem', color: 'var(--vn-text-subtle)', marginTop: 2 }}>
              Proxy &amp; Access Intelligence
            </div>
          </div>

          {/* Nav items */}
          <SideLink to="/">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
            Dashboard
          </SideLink>
          <SideLink to="/accounts">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            IP Accounts
          </SideLink>
          <SideLink to="/chains">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Chains &amp; Services
          </SideLink>
          <SideLink to="/services">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
            Svc Manager
          </SideLink>
          <SideLink to="/fleet">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <path d="M8 21h8m-4-4v4" />
            </svg>
            Fleet
          </SideLink>
          <SideLink to="/vms">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="1" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              <circle cx="12" cy="16" r="1" />
            </svg>
            VM Manager
          </SideLink>
          <SideLink to="/patches">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            Patches
          </SideLink>
          <SideLink to="/settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </SideLink>

          {/* Spacer + Logout */}
          <div style={{ flex: 1 }} />
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 'var(--vn-radius)',
              border: 'none',
              background: 'transparent',
              color: 'var(--vn-text-muted)',
              fontSize: '0.875rem',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
            aria-label="Log out"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>

          {/* Debug mode toggle */}
          <button
            onClick={toggleDebug}
            title={debugEnabled ? 'Disable debug console' : 'Enable debug console'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 0.75rem',
              borderRadius: 'var(--vn-radius)',
              border: debugEnabled ? '1px solid var(--vn-accent)' : '1px solid transparent',
              background: debugEnabled ? 'rgba(var(--vn-accent-rgb, 230,73,128), 0.1)' : 'transparent',
              color: debugEnabled ? 'var(--vn-accent)' : 'var(--vn-text-muted)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
          >
            🐛 Debug {debugEnabled ? 'ON' : 'OFF'}
          </button>
        </nav>

        {/* Main content */}
        <main
          id="main-content"
          className="app-main"
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '1.5rem',
            minWidth: 0,
            paddingBottom: debugEnabled ? '270px' : '1.5rem',
          }}
          tabIndex={-1}
        >
          {children}
        </main>
      </div>

      {/* Global debug panel — floats at bottom when enabled */}
      {debugEnabled && (
        <DebugPanel onDisable={() => setDebugEnabled(false)} />
      )}
    </>
  );
}

/* ── Root component ───────────────────────────────────────────── */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={BASE || ''}>
        <Shell>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:ip" element={<AccountDetail />} />
            <Route path="/chains" element={<ChainsPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/fleet" element={<FleetPage />} />
            <Route path="/vms" element={<VMsPage />} />
            <Route path="/patches" element={<PatchesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
