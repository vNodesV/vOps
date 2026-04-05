// BASE is the sub-path prefix vOps is served under (e.g. "/vlog").
// Injected by the Go server as <meta name="vops-base"> in index.html so that
// API calls resolve correctly when Apache uses prefix-stripping ProxyPass.
const meta = document.querySelector<HTMLMetaElement>('meta[name="vops-base"]');
export const BASE = (meta?.content ?? '').replace(/\/$/, '');

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
