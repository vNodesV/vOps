/**
 * settings/SecurityPanel.tsx
 * Security & Access panel: SSH keys, API key generation, password hash utility.
 *
 * These are the genuinely live key/credential generators (genSSHKey, genAPIKey,
 * hashPassword, getSSHPubKey). The config-file-driven panels (Intel API Keys,
 * UFW Auto-Ban) were retired; those settings are managed in config/vops/vops.toml.
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  genAPIKey,
  hashPassword,
  getSSHPubKey,
  genSSHKey,
} from '../../api';
import Spinner from '../../components/Spinner';
import { SectionCard, FieldDoc } from './shared';

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
          hint="Private key is stored at ~/.vOps/secret/vops_ssh_key (mode 0600). Public key has .pub suffix."
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
