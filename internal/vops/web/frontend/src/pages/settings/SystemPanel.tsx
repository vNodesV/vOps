/**
 * settings/SystemPanel.tsx
 * System panel: PreferencesPanel (Appearance) — the live theme/layout surface.
 *
 * The config-file-driven panels (VOpsPanel "Dashboard & Auth", BackupsPanel)
 * were retired; those settings are managed via config/vops/vops.toml and the
 * backup config file. PreferencesPanel persists the theme via the live
 * /settings/api/config/preferences endpoint via savePreferences.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { savePreferences } from '../../api';
import { applyTheme, THEMES } from '../../lib/theme';
import { getLayoutMode, setLayoutMode, LAYOUTS, type LayoutMode } from '../../lib/layout';
import { SectionCard } from './shared';

/* ── System → Appearance (was Preferences/Display) ───────────── */

export function PreferencesPanel() {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState(() => {
    return document.documentElement.getAttribute('data-theme') ?? 'vthemedgr';
  });
  const [layout, setLayout] = useState<LayoutMode>(() => getLayoutMode());
  const [saved, setSaved] = useState(false);

  const pickTheme = (id: string) => {
    setTheme(id);
    applyTheme(id);
  };

  const pickLayout = (id: LayoutMode) => {
    setLayout(id);
    setLayoutMode(id);
  };

  const saveMut = useMutation({
    mutationFn: (t: string) => savePreferences({ theme: t }),
    onSuccess: (_, t) => {
      applyTheme(t);
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: () => {
      // Revert preview to persisted theme on save failure.
      const saved = document.documentElement.getAttribute('data-theme') ?? 'vthemedgr';
      setTheme(saved);
      applyTheme(saved);
    },
  });

  return (
    <SectionCard
      title="Display Preferences"
      subtitle="Select a theme below — it previews instantly. Click Apply to save it to vops.toml so it persists across page reloads."
    >
      <div className="space-y-3">
        {THEMES.map((t) => (
          <label
            key={t.id}
            className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
            style={{
              backgroundColor: theme === t.id ? 'var(--vn-surface-2)' : 'transparent',
              border: `1px solid ${theme === t.id ? 'var(--vn-primary)' : 'var(--vn-border)'}`,
            }}
          >
            <input
              type="radio"
              name="theme"
              value={t.id}
              checked={theme === t.id}
              onChange={() => pickTheme(t.id)}
              className="mt-0.5 accent-[var(--vn-primary)]"
            />
            <span
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: t.swatch, border: '1px solid rgba(255,255,255,0.2)' }}
            />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--vn-text)' }}>
                {t.label}
              </div>
              <div className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
                {t.desc}
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={() => saveMut.mutate(theme)}
          disabled={saveMut.isPending}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {saveMut.isPending ? 'Saving…' : 'Apply & Save Theme'}
        </button>
        {saved && (
          <span className="text-xs" style={{ color: 'var(--vn-success)' }}>✓ Theme saved.</span>
        )}
        {saveMut.isError && (
          <span className="text-xs" style={{ color: 'var(--vn-danger)' }}>Save failed — preview reverted.</span>
        )}
      </div>

      {/* ── Layout preference (localStorage only — no backend round-trip) ── */}
      <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--vn-border)' }}>
        <div className="text-sm font-semibold mb-1" style={{ color: 'var(--vn-text)' }}>Navigation Layout</div>
        <div className="text-xs mb-3" style={{ color: 'var(--vn-text-muted)' }}>
          Switch between the classic top bar and a sidebar. Applies instantly — stored in your browser.
        </div>
        <div className="space-y-2">
          {LAYOUTS.map((l) => (
            <label
              key={l.id}
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: layout === l.id ? 'var(--vn-surface-2)' : 'transparent',
                border: `1px solid ${layout === l.id ? 'var(--vn-primary)' : 'var(--vn-border)'}`,
              }}
            >
              <input
                type="radio"
                name="layout"
                value={l.id}
                checked={layout === l.id}
                onChange={() => pickLayout(l.id)}
                className="mt-0.5 accent-[var(--vn-primary)]"
              />
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--vn-text)' }}>{l.label}</div>
                <div className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>{l.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
