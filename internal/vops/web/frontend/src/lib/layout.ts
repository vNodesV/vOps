export type LayoutMode = 'classic' | 'sidebar';

const STORAGE_KEY = 'vops-layout';

export const LAYOUT_EVENT = 'vops:layout-changed';

export const LAYOUTS: { id: LayoutMode; label: string; desc: string }[] = [
  { id: 'classic', label: 'Classic',  desc: 'Top navigation bar (default)' },
  { id: 'sidebar', label: 'Sidebar',  desc: 'Left sidebar + per-page toolbar' },
];

export function getLayoutMode(): LayoutMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'sidebar' ? 'sidebar' : 'classic';
  } catch {
    return 'classic';
  }
}

export function setLayoutMode(mode: LayoutMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: { mode } }));
}
