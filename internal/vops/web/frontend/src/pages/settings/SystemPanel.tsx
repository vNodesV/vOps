/**
 * settings/SystemPanel.tsx
 * System panels: VOpsPanel, BackupsPanel, PreferencesPanel (Appearance).
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveConfig } from '../../api';
import { applyTheme, THEMES } from '../../lib/theme';
import { getLayoutMode, setLayoutMode, LAYOUTS, type LayoutMode } from '../../lib/layout';
import type { ConfigSnapshot } from '../../api/types';
import {
  SectionCard,
  SaveBar,
  TOMLEditor,
  LabeledInput,
  parseTOML,
} from './shared';

/* ── System → Dashboard & Auth ───────────────────────────────── */

export function VOpsPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const raw = typeof config.vops === 'string' ? config.vops : '';
  const t = parseTOML(raw);

  const [fields, setFields] = useState({
    port:              t['vops.port']                 ?? '8889',
    bind_address:      t['vops.bind_address']         ?? '127.0.0.1',
    base_path:         t['vops.base_path']            ?? '/vlog/',
    username:          t['vops.auth.username']        ?? 'admin',
    auto_enrich:       t['vops.intel.auto_enrich']    ?? 'true',
    cache_ttl_hours:   t['vops.intel.cache_ttl_hours']?? '24',
    rate_limit_rpm:    t['vops.intel.rate_limit_rpm'] ?? '10',
    watch_interval_sec:t['vops.watch_interval_sec']   ?? '60',
    poll_interval_sec: t['vops.push.poll_interval_sec']?? '60',
  });

  const [showToml, setShowToml] = useState(false);
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveConfig('vops', {
      port:               Number(fields.port)               || 8889,
      bind_address:       fields.bind_address,
      base_path:          fields.base_path,
      username:           fields.username,
      auto_enrich:        fields.auto_enrich === 'true',
      cache_ttl_hours:    Number(fields.cache_ttl_hours)    || 24,
      rate_limit_rpm:     Number(fields.rate_limit_rpm)     || 10,
      watch_interval_sec: Number(fields.watch_interval_sec) || 60,
      poll_interval_sec:  Number(fields.poll_interval_sec)  || 60,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  return (
    <SectionCard
      title="vOps Dashboard & Auth"
      subtitle="Core vOps settings: network binding, admin username, IP intelligence tuning. API keys and password hash are managed via Security → Keys & Credentials and the raw TOML below."
    >
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>Network</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <LabeledInput label="Bind Address" value={fields.bind_address} onChange={set('bind_address')} placeholder="127.0.0.1" />
        <LabeledInput label="Port" value={fields.port} onChange={set('port')} placeholder="8889" />
        <LabeledInput label="Base Path" value={fields.base_path} onChange={set('base_path')} placeholder="/vlog/" wide />
      </div>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>Authentication</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <LabeledInput label="Admin Username" value={fields.username} onChange={set('username')} placeholder="admin" />
      </div>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>IP Intelligence</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>Auto-Enrich</label>
          <select value={fields.auto_enrich} onChange={(e) => set('auto_enrich')(e.target.value)}
            className="vn-input w-full">
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
        <LabeledInput label="Cache TTL (hours)" value={fields.cache_ttl_hours} onChange={set('cache_ttl_hours')} placeholder="24" />
        <LabeledInput label="Rate Limit (req/min)" value={fields.rate_limit_rpm} onChange={set('rate_limit_rpm')} placeholder="10" />
      </div>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--vn-text-muted)' }}>Polling</p>
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput label="Watch Interval (sec)" value={fields.watch_interval_sec} onChange={set('watch_interval_sec')} placeholder="60" />
        <LabeledInput label="Fleet Poll Interval (sec)" value={fields.poll_interval_sec} onChange={set('poll_interval_sec')} placeholder="60" />
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--vn-text-subtle)' }}>
        API keys (VirusTotal, AbuseIPDB, Shodan), password hash, and API key are set via the raw TOML editor below.
        Secrets show as <code>[REDACTED]</code> — paste a new value to update.
      </p>
      <SaveBar
        onSave={() => saveMut.mutate()}
        isPending={saveMut.isPending}
        isSuccess={saveMut.isSuccess}
        isError={saveMut.isError}
        error={saveMut.error as Error | null}
      />
      <div className="pt-2">
        <button onClick={() => setShowToml((s) => !s)} className="text-xs cursor-pointer" style={{ color: 'var(--vn-text-muted)' }}>
          {showToml ? 'Hide' : 'View / Edit raw TOML'} (includes secrets)
        </button>
        {showToml && <div className="mt-2"><TOMLEditor sectionKey="vops" rawValue={config.vops} /></div>}
      </div>
    </SectionCard>
  );
}

/* ── System → Backups ────────────────────────────────────────── */

export function BackupsPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const raw = typeof config.backup === 'string' ? config.backup : '';
  const t = parseTOML(raw);

  // Derive import_mode from existing automation + check_interval_min values.
  const getImportMode = () => {
    if ((t['backup.automation'] ?? 'true') !== 'true') return 'manual';
    const interval = Number(t['backup.check_interval_min'] ?? '10');
    if (interval <= 2)    return 'live';
    if (interval <= 15)   return '10m';
    if (interval <= 45)   return '30m';
    if (interval <= 90)   return '60m';
    return 'daily';
  };

  const [importMode, setImportMode] = useState(getImportMode);
  const [fields, setFields] = useState({
    max_size_mb:  t['backup.max_size_mb']  ?? '100',
    destination:  t['backup.destination']  ?? '',
    compression:  t['backup.compression']  ?? 'tar.gz',
    interval_days: t['backup.interval_days'] ?? '7',
  });

  const [showToml, setShowToml] = useState(false);
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const MODE_INTERVALS: Record<string, { automation: boolean; check_interval_min: number }> = {
    manual: { automation: false, check_interval_min: 10 },
    live:   { automation: true,  check_interval_min: 1  },
    '10m':  { automation: true,  check_interval_min: 10 },
    '30m':  { automation: true,  check_interval_min: 30 },
    '60m':  { automation: true,  check_interval_min: 60 },
    daily:  { automation: true,  check_interval_min: 1440 },
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const { automation, check_interval_min } = MODE_INTERVALS[importMode] ?? MODE_INTERVALS['10m'];
      return saveConfig('backup', {
        automation,
        interval_days:      Number(fields.interval_days)  || 7,
        max_size_mb:        Number(fields.max_size_mb)    || 100,
        check_interval_min,
        destination:        fields.destination,
        compression:        fields.compression,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  return (
    <SectionCard
      title="Backup & Import Configuration"
      subtitle="Backup schedule for vProx log archives. Import mode controls how often vOps automatically ingests new archives."
    >
      {/* Import mode */}
      <div>
        <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>
          Import Mode
        </label>
        <select
          value={importMode}
          onChange={(e) => setImportMode(e.target.value)}
          className="vn-input w-full"
        >
          <option value="manual">Manual — import only when triggered</option>
          <option value="live">Live — import every ~1 min (near real-time)</option>
          <option value="10m">Every 10 minutes</option>
          <option value="30m">Every 30 minutes</option>
          <option value="60m">Every hour</option>
          <option value="daily">Daily</option>
        </select>
        <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-subtle)' }}>
          {importMode === 'manual'
            ? 'Use the IMPORTS button on the dashboard to ingest manually.'
            : importMode === 'live'
            ? 'vProx polls archives every minute. Use for near-realtime log ingestion.'
            : 'vProx polls on the selected interval and ingests new archive files automatically.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <LabeledInput label="Interval (days)" value={fields.interval_days} onChange={set('interval_days')} placeholder="7" />
        <LabeledInput label="Max Size (MB)" value={fields.max_size_mb} onChange={set('max_size_mb')} placeholder="100" />
        <LabeledInput label="Destination Path" value={fields.destination} onChange={set('destination')} placeholder="/var/backups/vprox" wide />
        <div>
          <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>Compression</label>
          <select value={fields.compression} onChange={(e) => set('compression')(e.target.value)}
            className="vn-input w-full">
            <option value="tar.gz">tar.gz</option>
            <option value="zip">zip</option>
          </select>
        </div>
      </div>
      <SaveBar
        onSave={() => saveMut.mutate()}
        isPending={saveMut.isPending}
        isSuccess={saveMut.isSuccess}
        isError={saveMut.isError}
        error={saveMut.error as Error | null}
      />
      <div className="pt-2">
        <button onClick={() => setShowToml((s) => !s)} className="text-xs cursor-pointer" style={{ color: 'var(--vn-text-muted)' }}>
          {showToml ? 'Hide' : 'View'} raw TOML (includes file lists)
        </button>
        {showToml && <div className="mt-2"><TOMLEditor sectionKey="backup" rawValue={config.backup} /></div>}
      </div>
    </SectionCard>
  );
}

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
    mutationFn: (t: string) => saveConfig('preferences', { theme: t }),
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
