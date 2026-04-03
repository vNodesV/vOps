import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConfig,
  saveConfig,
  genAPIKey,
  hashPassword,
  getSSHPubKey,
  genSSHKey,
} from '../api';
import type { ConfigSnapshot } from '../api/types';
import Spinner from '../components/Spinner';

/* ── Section definitions ─────────────────────────────────────── */

interface SectionDef {
  id: string;
  label: string;
  endpoint: string;
  configKey: string;
  description: string;
}

const SECTIONS: SectionDef[] = [
  { id: 'preferences', label: 'Preferences', endpoint: '', configKey: '', description: 'Display preferences' },
  { id: 'ports', label: 'vProx Ports', endpoint: 'ports', configKey: 'ports', description: 'Configure listening ports for vProxy and chain RPC endpoints.' },
  { id: 'settings', label: 'Proxy Controls', endpoint: 'settings', configKey: 'settings', description: 'Rate limiting, GeoIP, threat scoring, and proxy behavior settings.' },
  { id: 'chain', label: 'Chain Profiles', endpoint: 'chain', configKey: 'chain', description: 'Cosmos chain endpoint profiles and routing rules.' },
  { id: 'vops', label: 'vOps Core', endpoint: 'vops', configKey: 'vops', description: 'vOps dashboard, authentication, and API settings.' },
  { id: 'fleet', label: 'Fleet Defaults', endpoint: 'fleet', configKey: 'fleet', description: 'Fleet SSH access, polling intervals, and default datacenter config.' },
  { id: 'infra', label: 'Infra Datacenters', endpoint: 'infra', configKey: 'infra', description: 'VM inventory and datacenter topology.' },
  { id: 'backup', label: 'Backups', endpoint: 'backup', configKey: 'backup', description: 'Backup schedule and S3/rsync targets.' },
  { id: 'security', label: 'Security', endpoint: '', configKey: '', description: 'SSH keys, API keys, and password management.' },
];

/* ── Config Editor ───────────────────────────────────────────── */

function ConfigEditor({ section, config }: { section: SectionDef; config: ConfigSnapshot }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const rawValue = config[section.configKey];
  const [text, setText] = useState(() =>
    typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue ?? {}, null, 2),
  );

  const saveMut = useMutation({
    mutationFn: (payload: unknown) => saveConfig(section.endpoint, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setEditing(false);
    },
  });

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(text);
      saveMut.mutate(parsed);
    } catch {
      // If not valid JSON, send as raw string
      saveMut.mutate(text);
    }
  }, [text, saveMut]);

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>{section.description}</p>

      {!editing ? (
        <div>
          <pre
            className="p-3 rounded-md text-xs overflow-x-auto"
            style={{
              backgroundColor: 'var(--vn-surface-2)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)',
              maxHeight: '400px',
            }}
          >
            {typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue ?? 'Not configured', null, 2)}
          </pre>
          <button
            onClick={() => {
              setText(typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue ?? {}, null, 2));
              setEditing(true);
            }}
            className="mt-2 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{ backgroundColor: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`config-${section.id}`} className="sr-only">
            {section.label} configuration
          </label>
          <textarea
            id={`config-${section.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            className="w-full p-3 rounded-md text-xs font-mono outline-none resize-y
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{
              backgroundColor: 'var(--vn-surface-2)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)',
            }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saveMut.isPending}
              className="px-3 py-1.5 text-xs font-medium rounded-md text-white
                         disabled:opacity-50 cursor-pointer
                         focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
              style={{ backgroundColor: 'var(--vn-primary)' }}
            >
              {saveMut.isPending ? 'Saving\u2026' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer
                         focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
              style={{ border: '1px solid var(--vn-border)', color: 'var(--vn-text-muted)' }}
            >
              Cancel
            </button>
          </div>
          {saveMut.isSuccess && (
            <p className="text-xs" style={{ color: 'var(--vn-success)' }} role="alert">Configuration saved.</p>
          )}
          {saveMut.isError && (
            <p className="text-xs" style={{ color: 'var(--vn-danger)' }} role="alert">
              Save failed: {(saveMut.error as Error).message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Preferences Panel ───────────────────────────────────────── */

function PreferencesPanel() {
  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
        Display preferences for the vOps dashboard.
      </p>
      <div
        className="p-4 rounded-md"
        style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
      >
        <h4 className="text-sm font-medium mb-1">Theme</h4>
        <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>
          Follows your operating system&apos;s dark/light preference automatically via{' '}
          <code className="px-1 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--vn-surface)' }}>
            prefers-color-scheme
          </code>.
          Switch your OS appearance to change the dashboard theme.
        </p>
      </div>
    </div>
  );
}

/* ── Security Panel ──────────────────────────────────────────── */

function SecurityPanel() {
  const [passwordInput, setPasswordInput] = useState('');
  const [generatedHash, setGeneratedHash] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');

  const sshQ = useQuery({
    queryKey: ['ssh-pub-key'],
    queryFn: getSSHPubKey,
    retry: false,
  });

  const genSSHMut = useMutation({
    mutationFn: genSSHKey,
    onSuccess: (data) => {
      sshQ.refetch();
      setGeneratedKey(`Key generated at: ${data.private_key_path}`);
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
    <div className="space-y-6">
      <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
        Manage SSH keys, API keys, and password hashes.
      </p>

      {/* SSH Key */}
      <div
        className="p-4 rounded-md space-y-3"
        style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
      >
        <h4 className="text-sm font-medium">SSH Public Key</h4>
        {sshQ.isLoading ? (
          <Spinner size={16} label="Loading SSH key" />
        ) : sshQ.data ? (
          <pre
            className="p-2 rounded text-xs overflow-x-auto"
            style={{ backgroundColor: 'var(--vn-surface)', border: '1px solid var(--vn-border)' }}
          >
            {sshQ.data.public_key}
          </pre>
        ) : (
          <p className="text-xs" style={{ color: 'var(--vn-text-muted)' }}>No SSH key found.</p>
        )}
        <button
          onClick={() => genSSHMut.mutate()}
          disabled={genSSHMut.isPending}
          className="px-3 py-1.5 text-xs font-medium rounded-md text-white
                     disabled:opacity-50 cursor-pointer
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ backgroundColor: 'var(--vn-primary)' }}
        >
          {genSSHMut.isPending ? 'Generating\u2026' : 'Generate SSH Key'}
        </button>
        {genSSHMut.isError && (
          <p className="text-xs" style={{ color: 'var(--vn-danger)' }} role="alert">
            {(genSSHMut.error as Error).message}
          </p>
        )}
      </div>

      {/* API Key */}
      <div
        className="p-4 rounded-md space-y-3"
        style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
      >
        <h4 className="text-sm font-medium">API Key</h4>
        <button
          onClick={() => apiKeyMut.mutate()}
          disabled={apiKeyMut.isPending}
          className="px-3 py-1.5 text-xs font-medium rounded-md text-white
                     disabled:opacity-50 cursor-pointer
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ backgroundColor: 'var(--vn-primary)' }}
        >
          {apiKeyMut.isPending ? 'Generating\u2026' : 'Generate API Key'}
        </button>
        {generatedKey && (
          <div className="p-2 rounded text-xs font-mono overflow-x-auto"
            style={{ backgroundColor: 'var(--vn-surface)', border: '1px solid var(--vn-border)' }}
          >
            {generatedKey}
          </div>
        )}
        {apiKeyMut.isError && (
          <p className="text-xs" style={{ color: 'var(--vn-danger)' }} role="alert">
            {(apiKeyMut.error as Error).message}
          </p>
        )}
      </div>

      {/* Password Hash */}
      <div
        className="p-4 rounded-md space-y-3"
        style={{ backgroundColor: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)' }}
      >
        <h4 className="text-sm font-medium">Password Hash Utility</h4>
        <div className="flex gap-2">
          <label htmlFor="hash-pw" className="sr-only">Password to hash</label>
          <input
            id="hash-pw"
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="Enter password"
            className="flex-1 px-3 py-1.5 rounded-md text-sm outline-none
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{
              backgroundColor: 'var(--vn-surface)',
              border: '1px solid var(--vn-border)',
              color: 'var(--vn-text)',
            }}
          />
          <button
            onClick={() => hashMut.mutate()}
            disabled={hashMut.isPending || !passwordInput}
            className="px-3 py-1.5 text-xs font-medium rounded-md text-white
                       disabled:opacity-50 cursor-pointer
                       focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
            style={{ backgroundColor: 'var(--vn-primary)' }}
          >
            {hashMut.isPending ? 'Hashing\u2026' : 'Hash'}
          </button>
        </div>
        {generatedHash && (
          <div className="p-2 rounded text-xs font-mono break-all"
            style={{ backgroundColor: 'var(--vn-surface)', border: '1px solid var(--vn-border)' }}
          >
            {generatedHash}
          </div>
        )}
        {hashMut.isError && (
          <p className="text-xs" style={{ color: 'var(--vn-danger)' }} role="alert">
            {(hashMut.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Settings Page ───────────────────────────────────────────── */

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('preferences');
  const navigate = useNavigate();

  const { data: config, isLoading } = useQuery<ConfigSnapshot>({
    queryKey: ['config'],
    queryFn: getConfig,
    retry: false,
  });

  const currentSection = SECTIONS.find((s) => s.id === activeSection)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>
          Settings
        </h2>
        <button
          onClick={() => navigate('/settings/wizard')}
          className="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer
                     focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
          style={{ backgroundColor: 'var(--vn-primary)' }}
        >
          Open Wizard
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Sidebar Nav */}
        <nav
          className="space-y-1"
          aria-label="Settings sections"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="w-full text-left px-3 py-2 rounded-md text-sm cursor-pointer transition-colors
                         focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
              style={{
                backgroundColor: activeSection === s.id ? 'var(--vn-primary)' : 'transparent',
                color: activeSection === s.id ? 'var(--vn-on-primary)' : 'var(--vn-text)',
              }}
              aria-current={activeSection === s.id ? 'page' : undefined}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="md:col-span-3">
          <div
            className="rounded-lg p-6"
            style={{ backgroundColor: 'var(--vn-surface)', border: '1px solid var(--vn-border)' }}
          >
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--vn-text)' }}>
              {currentSection.label}
            </h3>

            {activeSection === 'preferences' && <PreferencesPanel />}
            {activeSection === 'security' && <SecurityPanel />}
            {activeSection !== 'preferences' && activeSection !== 'security' && (
              isLoading ? (
                <Spinner label="Loading configuration" />
              ) : config ? (
                <ConfigEditor section={currentSection} config={config} />
              ) : (
                <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
                  Configuration not available. Run the setup wizard to initialize.
                </p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
