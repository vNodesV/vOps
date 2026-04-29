// BASE is the sub-path prefix vOps is served under (e.g. "/vops").
// Primary source: <meta name="vops-base"> injected by the Go server (requires
// base_path = "/vops" in vops.toml).
// Fallback: inferred from the Vite asset URL — works even when base_path is
// not set, as long as Apache strips the prefix before forwarding to Go
// (ProxyPass /vops/ http://127.0.0.1:PORT/).
function detectBase(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="vops-base"]');
  const configured = (meta?.content ?? '').replace(/\/$/, '');
  if (configured) return configured;

  // Walk script[src] elements; Vite always puts bundles under /assets/.
  // If the resolved pathname is e.g. /vops/assets/index-xxx.js the prefix is /vops.
  for (const s of document.querySelectorAll<HTMLScriptElement>('script[src]')) {
    try {
      const pathname = new URL(s.src).pathname;
      const idx = pathname.indexOf('/assets/');
      if (idx > 0) return pathname.slice(0, idx);
    } catch { /* cross-origin or malformed — skip */ }
  }
  return '';
}

export const BASE = detectBase();

export class APIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (res.status === 302 || res.redirected) {
    window.location.href = BASE + '/login';
    throw new APIError(401, 'Not authenticated');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new APIError(res.status, text);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
