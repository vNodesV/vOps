import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import { BASE } from '../api/client';
import Spinner from '../components/Spinner';

interface BuildInfo {
  version: string;
  commit: string;
  build_date: string;
}

const MATRIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*!/\\|<>';
const FONT_SIZE = 13;

function MatrixCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const cols = () => Math.floor(canvas.width / FONT_SIZE);
    let drops = Array(cols()).fill(1);

    const primary = getComputedStyle(document.documentElement)
      .getPropertyValue('--vn-primary').trim() || '#00ff00';

    const draw = () => {
      const c = cols();
      if (drops.length !== c) drops = Array(c).fill(1);

      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = primary;
      ctx.font = `${FONT_SIZE}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const ch = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
        ctx.fillText(ch, i * FONT_SIZE, drops[i] * FONT_SIZE);
        if (drops[i] * FONT_SIZE > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    };

    const id = setInterval(draw, 40);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, opacity: 0.22, pointerEvents: 'none', zIndex: 0 }}
    />
  );
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [cursor, setCursor] = useState(true);

  useEffect(() => {
    fetch(BASE + '/api/v1/version')
      .then((r) => r.ok ? r.json() : null)
      .then((data: BuildInfo | null) => data && setBuildInfo(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => setCursor((c) => !c), 530);
    return () => clearInterval(id);
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

        if (res.status === 0 || res.type === 'opaqueredirect') {
          const check = await fetch(BASE + '/api/v1/stats', { credentials: 'include' });
          if (check.ok) { window.location.href = BASE + '/'; return; }
          setError('Invalid credentials');
          setLoading(false);
          return;
        }

        if (res.ok) { window.location.href = BASE + '/'; return; }
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
      style={{ background: 'var(--vn-bg)', overflow: 'hidden' }}
    >
      <MatrixCanvas />

      {/* Card */}
      <div
        style={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: 360,
          background: 'var(--vn-bg-card, var(--vn-surface))',
          border: '1px solid var(--vn-primary)',
          borderRadius: 'var(--vn-radius)',
          padding: '2.25rem 2rem',
          boxShadow: 'var(--vn-shadow)',
        }}
      >
        {/* Brand */}
        <div className="text-center mb-8">
          <div
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.65rem',
              color: 'var(--vn-primary)',
              opacity: 0.55,
              letterSpacing: '0.15em',
              marginBottom: '0.4rem',
              userSelect: 'none',
            }}
          >
            ▓▒░ vNODES.V ░▒▓
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '2rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: 'var(--vn-primary)',
              textShadow: '0 0 18px var(--vn-primary), 0 0 36px rgba(0,255,0,0.3)',
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            vOps
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.72rem',
              color: 'var(--vn-text-muted)',
              marginTop: '0.5rem',
              letterSpacing: '0.05em',
            }}
          >
            PROXY &amp; ACCESS INTELLIGENCE
            <span style={{ color: 'var(--vn-primary)', opacity: cursor ? 1 : 0 }}>_</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-4">
            <label
              htmlFor="login-user"
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                color: 'var(--vn-primary)',
                marginBottom: '0.35rem',
                textTransform: 'uppercase',
              }}
            >
              &gt; user
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
              className="vn-input w-full"
              style={{ fontFamily: 'var(--font-mono, monospace)' }}
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="login-pass"
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                color: 'var(--vn-primary)',
                marginBottom: '0.35rem',
                textTransform: 'uppercase',
              }}
            >
              &gt; pass
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
              className="vn-input w-full"
              style={{ fontFamily: 'var(--font-mono, monospace)' }}
            />
          </div>

          {error && (
            <div
              className="alert alert-danger mb-4 text-sm text-center"
              style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem' }}
              role="alert"
            >
              ✗ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="btn btn-primary w-full flex items-center justify-center gap-2 btn-vn-primary
                       disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.1em' }}
          >
            {loading ? (
              <>
                <Spinner size={16} label="Signing in" />
                CONNECTING…
              </>
            ) : (
              '> SIGN IN'
            )}
          </button>
        </form>
      </div>

      {/* Version badge */}
      {buildInfo && (
        <p
          style={{
            position: 'absolute', bottom: '1rem',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.65rem',
            color: 'var(--vn-primary)',
            opacity: 0.45,
            letterSpacing: '0.08em',
            zIndex: 1,
          }}
        >
          vOps v{buildInfo.version} · {buildInfo.commit}
        </p>
      )}
    </div>
  );
}
