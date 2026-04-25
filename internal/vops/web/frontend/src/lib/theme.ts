import { BASE } from '../api/client';

const BG_IMAGES: Record<string, string> = {
  vthemedgr:   '2026_logos/default/background/bg.png',
  vthemedbl:   '2026_logos/dark_blue/background/bg.png',
  vthemedlite: '2026_logos/white_blue/background/bg.png',
};

const LOGO_IMAGES: Record<string, string> = {
  vthemedgr:   '2026_logos/default/logo/logo.png',
  vthemedbl:   '2026_logos/dark_blue/logo/logo.png',
  vthemedlite: '2026_logos/white_blue/logo/logo.png',
};

export const THEMES = [
  { id: 'axiom',       label: 'Axiom',          desc: 'Enterprise dark — electric blue', swatch: '#4f8ef7' },
  { id: 'vthemedgr',   label: 'v[T]hemedGR',   desc: 'Matrix neon-green terminal',      swatch: '#00ff00' },
  { id: 'vthemedbl',   label: 'v[T]hemedBL',   desc: 'Deep navy + blue-teal accents',   swatch: '#3b82f6' },
  { id: 'vthemedlite', label: 'v[T]hemedLITE', desc: 'Silver-blue professional light',  swatch: '#2563eb' },
];

export function applyTheme(id: string): void {
  document.documentElement.setAttribute('data-theme', id);
  if (id === 'axiom') {
    // Axiom is pure CSS — clear any image overrides from previous themes
    document.documentElement.style.removeProperty('--vn-bg-url');
    document.documentElement.style.removeProperty('--vn-logo-url');
    return;
  }
  const staticBase = BASE + '/static/';
  const bgFile   = BG_IMAGES[id]   ?? BG_IMAGES['vthemedgr'];
  const logoFile = LOGO_IMAGES[id] ?? LOGO_IMAGES['vthemedgr'];
  document.documentElement.style.setProperty('--vn-bg-url',   `url('${staticBase}${bgFile}')`);
  document.documentElement.style.setProperty('--vn-logo-url', `url('${staticBase}${logoFile}')`);
}
