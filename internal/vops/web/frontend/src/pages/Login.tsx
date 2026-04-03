import { useState, useCallback, type FormEvent } from 'react';
import Spinner from '../components/Spinner';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');
      setLoading(true);

      try {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        const res = await fetch('/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData,
          redirect: 'manual',
        });

        // opaqueredirect: browser prevented reading redirect target
        if (res.status === 0 || res.type === 'opaqueredirect') {
          // Try to determine if login succeeded by hitting a protected route
          const check = await fetch('/api/v1/stats', { credentials: 'include' });
          if (check.ok) {
            window.location.href = '/';
            return;
          }
          setError('Invalid credentials');
          setLoading(false);
          return;
        }

        if (res.ok) {
          window.location.href = '/';
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
      className="min-h-screen flex items-center justify-center p-4"
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
              className="w-full px-3 py-2 rounded-md text-sm outline-none
                         focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
              style={{
                backgroundColor: 'var(--vn-surface-2)',
                border: '1px solid var(--vn-border)',
                color: 'var(--vn-text)',
              }}
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
              className="w-full px-3 py-2 rounded-md text-sm outline-none
                         focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
              style={{
                backgroundColor: 'var(--vn-surface-2)',
                border: '1px solid var(--vn-border)',
                color: 'var(--vn-text)',
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="mb-4 p-3 rounded-md text-sm text-center"
              style={{
                backgroundColor: 'var(--vn-danger)' + '14',
                color: 'var(--vn-danger)',
                border: '1px solid var(--vn-danger)' + '40',
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md
                       text-sm font-medium btn-vn-primary cursor-pointer
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)] focus-visible:ring-offset-2"
            style={{
              backgroundColor: 'var(--vn-primary)',
            }}
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
    </div>
  );
}
