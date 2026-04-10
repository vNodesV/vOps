import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { BASE } from '../api/client';
import Spinner from '../components/Spinner';

interface BuildInfo {
  release: string;
  version: string;
  commit: string;
  build_date: string;
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    fetch(BASE + '/api/v1/version')
      .then((r) => r.ok ? r.json() : null)
      .then((data: BuildInfo | null) => data && setBuildInfo(data))
      .catch(() => {});
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');
      setLoading(true);

      try {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        const res = await fetch(BASE + '/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData,
          redirect: 'manual',
        });

        // opaqueredirect: browser prevented reading redirect target
        if (res.status === 0 || res.type === 'opaqueredirect') {
          // Try to determine if login succeeded by hitting a protected route
          const check = await fetch(BASE + '/api/v1/stats', { credentials: 'include' });
          if (check.ok) {
            window.location.href = BASE + '/';
            return;
          }
          setError('Invalid credentials');
          setLoading(false);
          return;
        }

        if (res.ok) {
          window.location.href = BASE + '/';
          return;
        }

        setError('Invalid credentials');
      } catch {
        setError('Unable to reach server. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [username, password],
  );

  return (
    <div
      className="relative min-h-screen flex items-center justify-center p-4"
      style={{
        background:
          'linear-gradient(135deg, var(--vn-primary) 0%, var(--vn-accent) 100%)',
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{
          backgroundColor: 'var(--vn-surface)',
          boxShadow: 'var(--vn-shadow-md)',
          borderRadius: 'var(--vn-radius)',
        }}
      >
        {/* Brand */}
        <div className="text-center mb-8">
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: 'var(--vn-primary)' }}
          >
            vOps
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--vn-text-muted)' }}>
            Proxy &amp; Access Intelligence
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--vn-text-muted)', opacity: 0.7 }}>
            Use your Linux system credentials
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Username */}
          <div className="mb-4">
            <label
              htmlFor="login-user"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--vn-text)' }}
            >
              Username
            </label>
            <input
              id="login-user"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              autoFocus
              disabled={loading}
              aria-label="Username"
              className="vn-input w-full focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            />
          </div>

          {/* Password */}
          <div className="mb-6">
            <label
              htmlFor="login-pass"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--vn-text)' }}
            >
              Password
            </label>
            <input
              id="login-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={loading}
              aria-label="Password"
              className="vn-input w-full focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="alert alert-danger mb-4 text-sm text-center"
              role="alert"
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="btn btn-primary w-full flex items-center justify-center gap-2 btn-vn-primary
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)] focus-visible:ring-offset-2"
          >
            {loading ? (
              <>
                <Spinner size={16} label="Signing in" />
                Signing in…
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>

      {/* Version badge */}
      {buildInfo && (
        <p
          className="absolute bottom-4 text-xs"
          style={{ color: 'rgba(255,255,255,0.45)' }}
        >
          vOps v{buildInfo.release || '1.0.0'} build {buildInfo.version} · {buildInfo.commit}
        </p>
      )}
    </div>
  );
}
