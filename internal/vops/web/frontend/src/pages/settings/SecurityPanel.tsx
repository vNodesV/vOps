/**
 * settings/SecurityPanel.tsx
 * Security & Access panel: SSH keys, API key generation, password hash utility,
 * and UFW Auto-Ban configuration.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  genAPIKey,
  hashPassword,
  getSSHPubKey,
  genSSHKey,
  saveConfig,
} from '../../api';
import Spinner from '../../components/Spinner';
import { SectionCard, FieldDoc, SaveBar, parseTOML } from './shared';
import type { ConfigSnapshot } from '../../api/types';

export function SecurityPanel() {
  const [passwordInput, setPasswordInput] = useState('');
  const [generatedHash, setGeneratedHash] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [sshMsg, setSSHMsg] = useState('');

  const sshQ = useQuery({
    queryKey: ['ssh-pub-key'],
    queryFn: getSSHPubKey,
    retry: false,
  });

  const genSSHMut = useMutation({
    mutationFn: genSSHKey,
    onSuccess: (data) => {
      sshQ.refetch();
      setSSHMsg(`Key written to: ${data.private_key_path}`);
    },
  });

  const apiKeyMut = useMutation({
    mutationFn: genAPIKey,
    onSuccess: (data) => setGeneratedKey(data.key),
  });

  const hashMut = useMutation({
    mutationFn: () => hashPassword(passwordInput),
    onSuccess: (data) => {
      setGeneratedHash(data.hash);
      setPasswordInput('');
    },
  });

  return (
    <div className="space-y-4">
      {/* SSH Key */}
      <SectionCard
        title="Fleet SSH Key"
        subtitle="vOps uses an ed25519 SSH key to connect to your VMs for polling, script execution, and upgrades. After generating, copy the public key to each VM's ~/.ssh/authorized_keys file."
      >
        <FieldDoc
          label="Key location"
          hint="Private key is stored at ~/.vprox/secret/vops_ssh_key (mode 0600). Public key has .pub suffix."
        />
        {sshQ.isLoading ? (
          <Spinner size={16} label="Loading SSH key" />
        ) : sshQ.data?.public_key ? (
          <pre
            className="p-3 rounded text-xs overflow-x-auto"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)', wordBreak: 'break-all' }}
          >
            {sshQ.data.public_key}
          </pre>
        ) : (
          <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
            No SSH key found — generate one below.
          </p>
        )}
        <button
          onClick={() => genSSHMut.mutate()}
          disabled={genSSHMut.isPending}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {genSSHMut.isPending ? 'Generating…' : sshQ.data?.public_key ? '↺ Regenerate SSH Key' : '+ Generate SSH Key'}
        </button>
        {sshMsg && (
          <p className="text-xs" style={{ color: 'var(--vn-success)' }}>✓ {sshMsg}</p>
        )}
        {genSSHMut.isError && (
          <p className="text-xs" style={{ color: 'var(--vn-danger)' }}>
            ✗ {(genSSHMut.error as Error).message}
          </p>
        )}
      </SectionCard>

      {/* API Key */}
      <SectionCard
        title="API Key"
        subtitle="The vOps API key is used for programmatic access and vProx webhook integration. After generating, save the key — it will not be shown again. Paste it into vops.toml [vops.auth] api_key."
      >
        <button
          onClick={() => apiKeyMut.mutate()}
          disabled={apiKeyMut.isPending}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {apiKeyMut.isPending ? 'Generating…' : '+ Generate API Key'}
        </button>
        {generatedKey && (
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--vn-warning)' }}>
              ⚠ Copy this key now — it will not be shown again.
            </p>
            <pre
              className="p-3 rounded text-xs font-mono overflow-x-auto"
              style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
            >
              {generatedKey}
            </pre>
          </div>
        )}
        {apiKeyMut.isError && (
          <p className="text-xs" style={{ color: 'var(--vn-danger)' }}>
            ✗ {(apiKeyMut.error as Error).message}
          </p>
        )}
      </SectionCard>

      {/* Password Hash Utility */}
      <SectionCard
        title="Password Hash Utility"
        subtitle="Generate a bcrypt hash (cost=12) for a new admin password. Paste the result into vops.toml [vops.auth] password_hash. The password itself is never stored."
      >
        <div className="flex gap-2">
          <label htmlFor="hash-pw" className="sr-only">
            Password to hash
          </label>
          <input
            id="hash-pw"
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="Enter new password"
            className="vn-input flex-1"
            onKeyDown={(e) => e.key === 'Enter' && passwordInput && hashMut.mutate()}
          />
          <button
            onClick={() => hashMut.mutate()}
            disabled={hashMut.isPending || !passwordInput}
            className="btn btn-primary btn-sm disabled:opacity-50"
          >
            {hashMut.isPending ? 'Hashing…' : 'Hash'}
          </button>
        </div>
        {generatedHash && (
          <pre
            className="p-3 rounded text-xs font-mono break-all"
            style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
          >
            {generatedHash}
          </pre>
        )}
        {hashMut.isError && (
          <p className="text-xs" style={{ color: 'var(--vn-danger)' }}>
            ✗ {(hashMut.error as Error).message}
          </p>
        )}
      </SectionCard>
    </div>
  );
}

/* ── Security → Auto-Ban ─────────────────────────────────────── */

export function AutoBanPanel({ config }: { config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const raw = typeof config.vops === 'string' ? config.vops : '';
  const t = parseTOML(raw);

  const [fields, setFields] = useState({
    auto_ban_enabled:     t['vops.intel.auto_ban_enabled']     ?? 'true',
    auto_ban_threshold:   t['vops.intel.auto_ban_threshold']   ?? '5',
    ban_duration_minutes: t['vops.intel.ban_duration_minutes'] ?? '60',
    ban_whitelist:        t['vops.intel.ban_whitelist']        ?? '',
  });

  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveConfig('vops', {
      // Preserve all other vops settings by re-reading them from the parsed config
      port:               Number(t['vops.port'])               || 8889,
      bind_address:       t['vops.bind_address']               ?? '127.0.0.1',
      base_path:          t['vops.base_path']                  ?? '/vlog/',
      username:           t['vops.auth.username']              ?? 'admin',
      auto_enrich:        (t['vops.intel.auto_enrich']         ?? 'true') === 'true',
      cache_ttl_hours:    Number(t['vops.intel.cache_ttl_hours'])  || 24,
      rate_limit_rpm:     Number(t['vops.intel.rate_limit_rpm'])   || 10,
      watch_interval_sec: Number(t['vops.watch_interval_sec'])     || 60,
      poll_interval_sec:  Number(t['vops.push.poll_interval_sec']) || 60,
      // Auto-ban fields (overrides)
      auto_ban_enabled:     fields.auto_ban_enabled === 'true',
      auto_ban_threshold:   Number(fields.auto_ban_threshold)   || 5,
      ban_duration_minutes: Number(fields.ban_duration_minutes) || 60,
      ban_whitelist:        fields.ban_whitelist,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  const DURATION_PRESETS = [
    { label: '15m', value: '15' },
    { label: '30m', value: '30' },
    { label: '1h',  value: '60' },
    { label: '6h',  value: '360' },
    { label: '24h', value: '1440' },
  ];

  return (
    <SectionCard
      title="UFW Auto-Ban"
      subtitle="Automatically ban IPs via UFW when they trigger too many rate-limit events. Requires ufw installed and vOps running with sufficient privileges to modify firewall rules."
    >
      {/* Enable toggle */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium" style={{ color: 'var(--vn-text-muted)' }}>
          Enable Auto-Ban
        </label>
        <button
          onClick={() => set('auto_ban_enabled')(fields.auto_ban_enabled === 'true' ? 'false' : 'true')}
          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{
            backgroundColor: fields.auto_ban_enabled === 'true' ? 'var(--vn-primary)' : 'var(--vn-border)',
          }}
          role="switch"
          aria-checked={fields.auto_ban_enabled === 'true'}
        >
          <span
            className="inline-block h-3.5 w-3.5 rounded-full transition-transform"
            style={{
              backgroundColor: 'white',
              transform: fields.auto_ban_enabled === 'true' ? 'translateX(18px)' : 'translateX(2px)',
            }}
          />
        </button>
        <span className="text-xs" style={{ color: 'var(--vn-text-subtle)' }}>
          {fields.auto_ban_enabled === 'true' ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {/* Threshold */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>
            Ban Threshold
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={fields.auto_ban_threshold}
            onChange={(e) => set('auto_ban_threshold')(e.target.value)}
            className="vn-input w-full"
          />
          <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-subtle)' }}>
            Number of rate-limit events before IP is banned (1–100)
          </p>
        </div>

        {/* Ban Duration with quick-select presets */}
        <div>
          <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>
            Ban Duration (minutes)
          </label>
          <input
            type="number"
            min={1}
            value={fields.ban_duration_minutes}
            onChange={(e) => set('ban_duration_minutes')(e.target.value)}
            className="vn-input w-full"
          />
          <div className="flex gap-1 mt-1 flex-wrap">
            {DURATION_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => set('ban_duration_minutes')(p.value)}
                className="text-xs px-2 py-0.5 rounded cursor-pointer transition-colors"
                style={{
                  backgroundColor:
                    fields.ban_duration_minutes === p.value
                      ? 'var(--vn-primary)'
                      : 'var(--vn-surface-2)',
                  color:
                    fields.ban_duration_minutes === p.value
                      ? 'var(--vn-on-primary)'
                      : 'var(--vn-text-muted)',
                  border: '1px solid var(--vn-border)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Whitelist */}
      <div>
        <label className="block text-xs mb-0.5" style={{ color: 'var(--vn-text-muted)' }}>
          Whitelisted IPs
        </label>
        <textarea
          value={fields.ban_whitelist}
          onChange={(e) => set('ban_whitelist')(e.target.value)}
          rows={4}
          placeholder={"127.0.0.1\n10.0.0.1\n192.168.1.0/24"}
          className="vn-input w-full font-mono resize-y"
          style={{ minHeight: 80 }}
        />
        <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-subtle)' }}>
          One IP or CIDR per line. These IPs will never be auto-banned.
        </p>
      </div>

      <SaveBar
        onSave={() => saveMut.mutate()}
        isPending={saveMut.isPending}
        isSuccess={saveMut.isSuccess}
        isError={saveMut.isError}
        error={saveMut.error as Error | null}
      />
    </SectionCard>
  );
}
