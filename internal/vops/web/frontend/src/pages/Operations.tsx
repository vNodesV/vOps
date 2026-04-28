import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import {
  getVMStatus, getFleetVMs, getServices, getVMHosts, getVMDomains,
  vmDomainAction, getVMSnapshots, createVMSnapshot, revertVMSnapshot, deleteVMSnapshot,
  getRegisteredChains, deployFleet,
  createService, updateService, deleteService,
  vmUpgradeURL,
  resizeDomain, getDomainDisks, resizeDisk, getDomainInterfaces,
  checkGuestAgent, guestAgentInstallURL,
  getHosts, scanHosts, hostUpgradeURL,
  getBannedIPs, unbanIP,
} from '../api';
import type {
  VMStatus, VMView, Service, HypervisorHost, LibvirtDomain, LibvirtSnapshot,
  DomainDisk, Interface as VMIface, RegisteredChain, HostInventory, BannedIPEntry,
} from '../api/types';
import UpgradeModal from '../components/UpgradeModal';
import Spinner from '../components/Spinner';
import { openSSEStream } from '../api/sse';
import { BASE } from '../api/client';
import { useTasks } from '../contexts/TaskContext';

/* ═══════════════════════════════════════════════════════════════
   SVG Icons
   ═══════════════════════════════════════════════════════════════ */

const IconDeploy = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 14V4M8 4L4 8M8 4L12 8"/>
    <path d="M3 14h10"/>
  </svg>
);

const IconReboot = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 4.5A5.5 5.5 0 1 1 3 8"/>
    <polyline points="1 5 3 8 5.5 5.5"/>
  </svg>
);

const IconPowerOff = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="8" y1="2" x2="8" y2="8"/>
    <path d="M5 4.3A5 5 0 1 0 11 4.3"/>
  </svg>
);

const IconShutdown = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="8" y1="2" x2="8" y2="7"/>
    <path d="M5.5 4.8A4.5 4.5 0 1 0 10.5 4.8"/>
  </svg>
);

const IconCPU = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="8" height="8" rx="1"/>
    <rect x="6" y="6" width="4" height="4"/>
    <line x1="6" y1="2" x2="6" y2="4"/><line x1="8" y1="2" x2="8" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/>
    <line x1="6" y1="12" x2="6" y2="14"/><line x1="8" y1="12" x2="8" y2="14"/><line x1="10" y1="12" x2="10" y2="14"/>
    <line x1="2" y1="6" x2="4" y2="6"/><line x1="2" y1="8" x2="4" y2="8"/><line x1="2" y1="10" x2="4" y2="10"/>
    <line x1="12" y1="6" x2="14" y2="6"/><line x1="12" y1="8" x2="14" y2="8"/><line x1="12" y1="10" x2="14" y2="10"/>
  </svg>
);

const IconMemory = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="12" height="6" rx="1"/>
    <line x1="5" y1="5" x2="5" y2="11"/><line x1="8" y1="5" x2="8" y2="11"/><line x1="11" y1="5" x2="11" y2="11"/>
    <line x1="4" y1="11" x2="4" y2="13"/><line x1="12" y1="11" x2="12" y2="13"/>
  </svg>
);

const IconDisk = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <ellipse cx="8" cy="5" rx="6" ry="2"/>
    <path d="M2 5v6c0 1.1 2.7 2 6 2s6-.9 6-2V5"/>
    <ellipse cx="8" cy="11" rx="6" ry="2"/>
  </svg>
);

const IconNetwork = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="3" r="1.5"/>
    <circle cx="3" cy="13" r="1.5"/>
    <circle cx="13" cy="13" r="1.5"/>
    <line x1="8" y1="4.5" x2="3" y2="11.5"/><line x1="8" y1="4.5" x2="13" y2="11.5"/><line x1="4.5" y1="13" x2="11.5" y2="13"/>
  </svg>
);

const IconSnapshot = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="12" height="9" rx="1"/>
    <path d="M5 4V2h6v2"/>
    <circle cx="8" cy="8.5" r="2"/>
  </svg>
);

const IconShell = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="10" rx="1"/>
    <polyline points="5 7 7 9 5 11"/>
    <line x1="8" y1="11" x2="11" y2="11"/>
  </svg>
);

/* ═══════════════════════════════════════════════════════════════
   MiniBar
   ═══════════════════════════════════════════════════════════════ */

function MiniBar({ value, label, warn = 70, danger = 90 }: { value: number; label: string; warn?: number; danger?: number }) {
  const color = value >= danger ? 'var(--vn-danger)' : value >= warn ? 'var(--vn-warning)' : 'var(--vn-success)';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3.5rem 1fr 2.5rem', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--vn-text-muted)' }}>{label}</span>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--vn-border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '0.7rem', textAlign: 'right', color: 'var(--vn-text-muted)', fontFamily: 'monospace' }}>{value.toFixed(0)}%</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ModalBox — shared backdrop + card wrapper
   ═══════════════════════════════════════════════════════════════ */

function ModalBox({
  title,
  onClose,
  children,
  width = 480,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)',
          padding: '1.5rem', width, maxWidth: '95vw', maxHeight: '88vh',
          overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          border: '1px solid var(--vn-border)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--vn-text)' }}>{title}</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vn-text-muted)', fontSize: '1.1rem', padding: '0.2rem 0.4rem', borderRadius: 'var(--vn-radius)' }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AgentInstallModal
   ═══════════════════════════════════════════════════════════════ */

function AgentInstallModal({ host, domain, onClose }: { host: string; domain: string; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const bottomRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { cancelRef.current?.(); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const handleInstall = () => {
    setPhase('running');
    setLines([]);
    const url = guestAgentInstallURL(host, domain);
    cancelRef.current = openSSEStream(
      url,
      'GET',
      (msg) => {
        try {
          const ev = JSON.parse(msg.data) as { step?: string; msg?: string };
          setLines(prev => [...prev, ev.msg ?? msg.data]);
        } catch {
          setLines(prev => [...prev, msg.data]);
        }
      },
      () => setPhase('done'),
      (err) => { setLines(prev => [...prev, `Error: ${err.message}`]); setPhase('error'); },
    );
  };

  return (
    <ModalBox title={`Install VM Agent — ${domain}`} onClose={onClose}>
      <p style={{ fontSize: '0.8rem', color: 'var(--vn-text-muted)', marginBottom: '0.75rem' }}>
        Installs <code style={{ color: 'var(--vn-primary)' }}>qemu-guest-agent</code> on <strong>{domain}</strong> via the hypervisor guest channel.
      </p>

      {phase !== 'idle' && (
        <pre style={{
          background: 'var(--vn-surface-2)', border: '1px solid var(--vn-border)',
          borderRadius: 'var(--vn-radius)', padding: '0.75rem', fontSize: '0.75rem',
          fontFamily: 'monospace', maxHeight: 280, overflow: 'auto', color: 'var(--vn-text)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: '0.75rem',
        }}>
          {lines.length === 0 && phase === 'running' ? 'Connecting…' : lines.join('\n')}
          <div ref={bottomRef} />
        </pre>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: phase === 'done' ? 'var(--vn-success)' : phase === 'error' ? 'var(--vn-danger)' : 'var(--vn-text-muted)' }}>
          {phase === 'running' && <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Spinner size={12} label="" /> Installing…</span>}
          {phase === 'done' && 'Installation complete'}
          {phase === 'error' && 'Installation failed'}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {phase === 'idle' && (
            <button
              onClick={handleInstall}
              style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--vn-radius)', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)', fontWeight: 600 }}
            >
              Install
            </button>
          )}
          {phase !== 'running' && (
            <button onClick={onClose} style={{ padding: '0.35rem 0.8rem', fontSize: '0.82rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}>
              {phase === 'done' || phase === 'error' ? 'Close' : 'Cancel'}
            </button>
          )}
        </div>
      </div>
    </ModalBox>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CPUModal
   ═══════════════════════════════════════════════════════════════ */

function CPUModal({ host, domain, vmDomain, onClose }: { host: string; domain: string; vmDomain: LibvirtDomain; onClose: () => void }) {
  const qc = useQueryClient();
  const [cpus, setCpus] = useState(String(vmDomain.cpus));
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: () => resizeDomain(host, domain, { vcpus: Number(cpus), live: vmDomain.state === 'running' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vm-domains', host] }); setDone(true); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <ModalBox title={`vCPU — ${domain}`} onClose={onClose} width={360}>
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--vn-text-muted)', marginBottom: '0.5rem' }}>
          Current: <strong style={{ color: 'var(--vn-text)' }}>{vmDomain.cpus}</strong> vCPU{vmDomain.cpus !== 1 ? 's' : ''}
        </div>
        <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--vn-text-muted)', marginBottom: '0.3rem' }}>New vCPU count</label>
        <input
          type="number" min={1} max={64} value={cpus}
          onChange={e => { setCpus(e.target.value); setErr(''); setDone(false); }}
          style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)', fontSize: '0.875rem', boxSizing: 'border-box' }}
        />
      </div>
      {vmDomain.state === 'running' && (
        <p style={{ fontSize: '0.75rem', color: 'var(--vn-warning)', marginBottom: '0.5rem' }}>
          Live resize — takes effect immediately without reboot.
        </p>
      )}
      {err && <p style={{ color: 'var(--vn-danger)', fontSize: '0.78rem', marginBottom: '0.5rem' }}>{err}</p>}
      {done && <p style={{ color: 'var(--vn-success)', fontSize: '0.78rem', marginBottom: '0.5rem' }}>vCPU count updated.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button onClick={onClose} style={{ padding: '0.35rem 0.8rem', fontSize: '0.82rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}>
          {done ? 'Close' : 'Cancel'}
        </button>
        {!done && (
          <button onClick={() => mutate()} disabled={isPending} style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--vn-radius)', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)', fontWeight: 600 }}>
            {isPending ? 'Applying…' : 'Apply'}
          </button>
        )}
      </div>
    </ModalBox>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MemModal
   ═══════════════════════════════════════════════════════════════ */

function MemModal({ host, domain, vmDomain, onClose }: { host: string; domain: string; vmDomain: LibvirtDomain; onClose: () => void }) {
  const qc = useQueryClient();
  const currentMiB = Math.round(vmDomain.max_mem_kib / 1024);
  const [memMiB, setMemMiB] = useState(String(currentMiB));
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: () => resizeDomain(host, domain, { memory_mib: Number(memMiB), live: vmDomain.state === 'running' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vm-domains', host] }); setDone(true); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <ModalBox title={`Memory — ${domain}`} onClose={onClose} width={360}>
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--vn-text-muted)', marginBottom: '0.5rem' }}>
          Current: <strong style={{ color: 'var(--vn-text)' }}>{currentMiB} MiB</strong> ({(currentMiB / 1024).toFixed(1)} GiB)
        </div>
        <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--vn-text-muted)', marginBottom: '0.3rem' }}>New memory (MiB)</label>
        <input
          type="number" min={256} step={256} value={memMiB}
          onChange={e => { setMemMiB(e.target.value); setErr(''); setDone(false); }}
          style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)', fontSize: '0.875rem', boxSizing: 'border-box' }}
        />
      </div>
      {vmDomain.state === 'running' && (
        <p style={{ fontSize: '0.75rem', color: 'var(--vn-warning)', marginBottom: '0.5rem' }}>
          Live resize — changes max memory without reboot.
        </p>
      )}
      {Number(memMiB) < currentMiB && (
        <p style={{ fontSize: '0.75rem', color: 'var(--vn-danger)', marginBottom: '0.5rem' }}>
          ⚠ Reducing memory requires a full reboot to take effect.
        </p>
      )}
      {err && <p style={{ color: 'var(--vn-danger)', fontSize: '0.78rem', marginBottom: '0.5rem' }}>{err}</p>}
      {done && <p style={{ color: 'var(--vn-success)', fontSize: '0.78rem', marginBottom: '0.5rem' }}>Memory updated.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button onClick={onClose} style={{ padding: '0.35rem 0.8rem', fontSize: '0.82rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}>
          {done ? 'Close' : 'Cancel'}
        </button>
        {!done && (
          <button onClick={() => mutate()} disabled={isPending} style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--vn-radius)', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)', fontWeight: 600 }}>
            {isPending ? 'Applying…' : 'Apply'}
          </button>
        )}
      </div>
    </ModalBox>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DiskModal
   ═══════════════════════════════════════════════════════════════ */

function DiskModal({ host, domain, onClose }: { host: string; domain: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['domain-disks', host, domain],
    queryFn: () => getDomainDisks(host, domain),
  });

  const disks: DomainDisk[] = data?.disks ?? [];
  const [resizingTarget, setResizingTarget] = useState<string | null>(null);
  const [sizeGb, setSizeGb] = useState('');
  const [msg, setMsg] = useState('');

  const { mutate: doResize, isPending: resizing } = useMutation({
    mutationFn: () => resizeDisk(host, domain, { target: resizingTarget!, size_gb: Number(sizeGb) }),
    onSuccess: (res) => {
      setMsg(res.result || 'Disk resized');
      setResizingTarget(null);
      setSizeGb('');
      qc.invalidateQueries({ queryKey: ['domain-disks', host, domain] });
    },
    onError: (e: Error) => setMsg(`Error: ${e.message}`),
  });

  const tdS: React.CSSProperties = { padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--vn-border)' };

  return (
    <ModalBox title={`Disks — ${domain}`} onClose={onClose} width={540}>
      {isLoading ? <Spinner /> : error ? (
        <p style={{ color: 'var(--vn-danger)', fontSize: '0.82rem' }}>Failed to load disks.</p>
      ) : disks.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.82rem' }}>No disks found.</p>
      ) : (
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                {['Target', 'Type', 'Source', ''].map(h => (
                  <th key={h} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: 'var(--vn-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', borderBottom: '1px solid var(--vn-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {disks.map(d => (
                <React.Fragment key={d.target}>
                  <tr>
                    <td style={{ ...tdS, fontFamily: 'monospace', color: 'var(--vn-text)' }}>{d.target}</td>
                    <td style={{ ...tdS, color: 'var(--vn-text-muted)' }}>{d.type}</td>
                    <td style={{ ...tdS, fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--vn-text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.source || '—'}</td>
                    <td style={tdS}>
                      {d.type === 'disk' && (
                        <button
                          onClick={() => { setResizingTarget(d.target); setSizeGb(''); setMsg(''); }}
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface)', color: 'var(--vn-text)' }}
                        >
                          Resize
                        </button>
                      )}
                    </td>
                  </tr>
                  {resizingTarget === d.target && (
                    <tr>
                      <td colSpan={4} style={{ padding: '0.5rem', background: 'var(--vn-surface-2)' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input
                            type="number" min={1} value={sizeGb}
                            onChange={e => setSizeGb(e.target.value)}
                            placeholder="New size (GB)"
                            style={{ flex: 1, padding: '0.3rem 0.5rem', fontSize: '0.8rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', background: 'var(--vn-surface)', color: 'var(--vn-text)' }}
                          />
                          <button onClick={() => doResize()} disabled={!sizeGb || resizing} style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--vn-radius)', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}>
                            {resizing ? '…' : 'Apply'}
                          </button>
                          <button onClick={() => setResizingTarget(null)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}>
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {msg && <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: msg.startsWith('Error') ? 'var(--vn-danger)' : 'var(--vn-success)' }}>{msg}</p>}
        </div>
      )}
    </ModalBox>
  );
}

/* ═══════════════════════════════════════════════════════════════
   NetworkModal
   ═══════════════════════════════════════════════════════════════ */

function NetworkModal({ host, domain, onClose }: { host: string; domain: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['domain-interfaces', host, domain],
    queryFn: () => getDomainInterfaces(host, domain),
  });

  const ifaces: VMIface[] = data?.interfaces ?? [];
  const tdS: React.CSSProperties = { padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--vn-border)' };

  return (
    <ModalBox title={`Network Interfaces — ${domain}`} onClose={onClose} width={540}>
      {isLoading ? <Spinner /> : error ? (
        <p style={{ color: 'var(--vn-danger)', fontSize: '0.82rem' }}>Failed to load interfaces.</p>
      ) : ifaces.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.82rem' }}>No interfaces found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr>
              {['Interface', 'Type', 'Source', 'Model', 'MAC'].map(h => (
                <th key={h} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: 'var(--vn-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', borderBottom: '1px solid var(--vn-border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ifaces.map((iface, i) => (
              <tr key={i}>
                <td style={{ ...tdS, fontFamily: 'monospace', color: 'var(--vn-text)' }}>{iface.interface}</td>
                <td style={{ ...tdS, color: 'var(--vn-text-muted)' }}>{iface.type}</td>
                <td style={{ ...tdS, fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>{iface.source}</td>
                <td style={{ ...tdS, color: 'var(--vn-text-muted)' }}>{iface.model}</td>
                <td style={{ ...tdS, fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>{iface.mac}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ModalBox>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SnapshotModal
   ═══════════════════════════════════════════════════════════════ */

function SnapshotModal({ host, domain, onClose }: { host: string; domain: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [newSnapName, setNewSnapName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['vm-snapshots', host, domain],
    queryFn: () => getVMSnapshots(host, domain),
    staleTime: 30_000,
  });

  const snaps: LibvirtSnapshot[] = data?.snapshots ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['vm-snapshots', host, domain] });

  const doCreate = async () => {
    const name = newSnapName.trim();
    if (!name) return;
    setBusy('create');
    setMsg('');
    try {
      await createVMSnapshot(host, domain, name);
      setNewSnapName('');
      setMsg(`Snapshot "${name}" created`);
      invalidate();
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const doRevert = async (snap: string) => {
    setBusy(`revert-${snap}`);
    setMsg('');
    try {
      await revertVMSnapshot(host, domain, snap);
      setMsg(`Reverted to "${snap}"`);
      setConfirmRevert(null);
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (snap: string) => {
    setBusy(`delete-${snap}`);
    setMsg('');
    try {
      await deleteVMSnapshot(host, domain, snap);
      setMsg(`Snapshot "${snap}" deleted`);
      setConfirmDelete(null);
      invalidate();
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const tdS: React.CSSProperties = { padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--vn-border)' };

  return (
    <ModalBox title={`Snapshots — ${domain}`} onClose={onClose} width={520}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <input
          value={newSnapName}
          onChange={e => setNewSnapName(e.target.value)}
          placeholder="New snapshot name"
          onKeyDown={e => e.key === 'Enter' && doCreate()}
          style={{ flex: 1, padding: '0.35rem 0.6rem', fontSize: '0.82rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}
        />
        <button
          onClick={doCreate}
          disabled={!newSnapName.trim() || busy === 'create'}
          style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--vn-radius)', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
        >
          {busy === 'create' ? '…' : 'Create'}
        </button>
      </div>
      {msg && <p style={{ fontSize: '0.78rem', color: msg.startsWith('Error') ? 'var(--vn-danger)' : 'var(--vn-success)', marginBottom: '0.5rem' }}>{msg}</p>}
      {isLoading ? <Spinner /> : snaps.length === 0 ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.82rem' }}>No snapshots.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr>
              {['Name', 'Created', 'State', ''].map(h => (
                <th key={h} style={{ padding: '0.35rem 0.5rem', textAlign: 'left', fontWeight: 600, color: 'var(--vn-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', borderBottom: '1px solid var(--vn-border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snaps.map(s => (
              <tr key={s.name}>
                <td style={{ ...tdS, fontFamily: 'monospace', color: 'var(--vn-text)' }}>{s.name}</td>
                <td style={{ ...tdS, color: 'var(--vn-text-muted)', fontSize: '0.75rem' }}>{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</td>
                <td style={{ ...tdS, color: 'var(--vn-text-muted)' }}>{s.state || '—'}</td>
                <td style={tdS}>
                  {confirmRevert === s.name ? (
                    <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                      <button onClick={() => doRevert(s.name)} disabled={busy === `revert-${s.name}`} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--vn-radius)', background: 'var(--vn-warning)', color: '#000' }}>
                        {busy === `revert-${s.name}` ? '…' : 'Confirm Revert'}
                      </button>
                      <button onClick={() => setConfirmRevert(null)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}>
                        Cancel
                      </button>
                    </span>
                  ) : confirmDelete === s.name ? (
                    <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                      <button onClick={() => doDelete(s.name)} disabled={busy === `delete-${s.name}`} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--vn-radius)', background: 'var(--vn-danger)', color: '#fff' }}>
                        {busy === `delete-${s.name}` ? '…' : 'Confirm'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                      <button
                        onClick={() => setConfirmRevert(s.name)}
                        disabled={!!busy}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface)', color: 'var(--vn-text)' }}
                      >
                        Revert
                      </button>
                      <button
                        onClick={() => setConfirmDelete(s.name)}
                        disabled={!!busy}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', border: '1px solid var(--vn-danger)', borderRadius: 'var(--vn-radius)', background: 'transparent', color: 'var(--vn-danger)' }}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ModalBox>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ShellModal
   ═══════════════════════════════════════════════════════════════ */

function ShellModal({ host, vmName, onClose }: { host: string; vmName: string; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsURL = `${proto}://${window.location.host}${BASE}/api/v1/vm/shell?vm=${encodeURIComponent(vmName)}`;
    const ws = new WebSocket(wsURL);
    wsRef.current = ws;

    ws.onopen = () => { setConnected(true); setUnavailable(false); setLines([`Connected to ${vmName} on ${host}`]); };
    ws.onmessage = (event) => setLines(prev => [...prev, String(event.data)]);
    ws.onerror = () => setUnavailable(true);
    ws.onclose = (event) => { setConnected(false); if (event.code === 1006) setUnavailable(true); };

    return () => { ws.close(); wsRef.current = null; };
  }, [host, vmName]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines.length]);

  const send = () => {
    if (!input.trim()) return;
    wsRef.current?.send(input);
    setLines(prev => [...prev, '$ ' + input]);
    setInput('');
  };

  return (
    <ModalBox title={`Shell — ${vmName}`} onClose={onClose} width={620}>
      {!connected && !unavailable ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--vn-text-muted)', padding: '1rem 0' }}>
          <Spinner size={16} label="Connecting…" /> Connecting…
        </div>
      ) : unavailable ? (
        <p style={{ color: 'var(--vn-text-muted)', fontSize: '0.82rem' }}>Shell unavailable — backend not yet configured.</p>
      ) : (
        <>
          <div style={{
            border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)',
            background: 'var(--vn-surface-2)', height: 300, overflow: 'auto',
            padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--vn-text)',
          }}>
            {lines.map((line, i) => <div key={i}>{line}</div>)}
            <div ref={bottomRef} />
          </div>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Type command and press Enter"
            style={{
              width: '100%', marginTop: '0.6rem', padding: '0.45rem 0.6rem',
              borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)',
              background: 'var(--vn-surface)', color: 'var(--vn-text)',
              fontFamily: 'monospace', fontSize: '0.78rem', boxSizing: 'border-box',
            }}
          />
        </>
      )}
    </ModalBox>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DeployWizardModal (adapted from VMs.tsx)
   ═══════════════════════════════════════════════════════════════ */

function DeployWizardModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const vmsQ = useQuery({ queryKey: ['fleet-vms'], queryFn: getFleetVMs, staleTime: 60_000 });
  const chainsQ = useQuery({ queryKey: ['registered-chains'], queryFn: getRegisteredChains, staleTime: 60_000 });

  const vms: VMView[] = vmsQ.data?.vms ?? [];
  const chains: RegisteredChain[] = chainsQ.data?.registered_chains ?? [];

  const [vm, setVm] = useState('');
  const [chain, setChain] = useState('');
  const [component, setComponent] = useState('');
  const [script, setScript] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<{ deployment_id: number; status: string } | null>(null);
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const deploy = async () => {
    if (!vm || !chain || !component || !script) { setErr('All fields are required.'); return; }
    setRunning(true);
    setErr('');
    try {
      const res = await deployFleet({ vm, chain, component, script, dry_run: dryRun });
      setResult(res);
      qc.invalidateQueries({ queryKey: ['deployments'] });
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const inp: React.CSSProperties = {
    padding: '0.45rem 0.75rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)',
    background: 'var(--vn-surface)', color: 'var(--vn-text)', fontSize: '0.875rem', width: '100%', boxSizing: 'border-box',
  };
  const fld: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.85rem' };
  const lbl: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--vn-text-muted)', fontWeight: 500 };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)', padding: '1.75rem', width: 460, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid var(--vn-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--vn-text)', fontWeight: 700 }}>Fleet Deploy</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vn-text-muted)', fontSize: '1.1rem', padding: '0.2rem 0.4rem' }}>✕</button>
        </div>

        {result ? (
          <div>
            <div style={{ background: 'color-mix(in srgb, var(--vn-success) 12%, transparent)', color: 'var(--vn-success)', borderRadius: 'var(--vn-radius)', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
              Deployment #{result.deployment_id} started — status: <strong>{result.status}</strong>.
              <br /><span style={{ fontSize: '0.78rem', color: 'var(--vn-text-muted)' }}>Check deployments table for progress.</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <button onClick={onClose} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <div style={fld}>
              <label style={lbl}>Target VM *</label>
              <select style={inp} value={vm} onChange={e => setVm(e.target.value)}>
                <option value="">{vmsQ.isLoading ? 'Loading…' : vms.length === 0 ? 'No VMs available' : 'Select VM…'}</option>
                {vms.map(v => <option key={v.name} value={v.name}>{v.name}{v.datacenter ? ` (${v.datacenter})` : ''}</option>)}
              </select>
            </div>
            <div style={fld}>
              <label style={lbl}>Chain *</label>
              <select style={inp} value={chain} onChange={e => setChain(e.target.value)}>
                <option value="">{chainsQ.isLoading ? 'Loading…' : chains.length === 0 ? 'No chains registered' : 'Select chain…'}</option>
                {chains.map(c => <option key={c.chain} value={c.chain}>{c.chain}</option>)}
              </select>
            </div>
            <div style={fld}>
              <label style={lbl}>Component *</label>
              <input style={inp} value={component} onChange={e => setComponent(e.target.value)} placeholder="e.g. cosmosd, relayer, nginx" />
            </div>
            <div style={fld}>
              <label style={lbl}>Script / Command *</label>
              <input style={inp} value={script} onChange={e => setScript(e.target.value)} placeholder="e.g. /opt/scripts/deploy.sh" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="checkbox" id="ops-deploy-dry-run" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
              <label htmlFor="ops-deploy-dry-run" style={{ fontSize: '0.85rem', cursor: 'pointer', color: 'var(--vn-text)' }}>Dry run (simulate only)</label>
            </div>
            {err && <p style={{ color: 'var(--vn-danger)', fontSize: '0.82rem', margin: '0.5rem 0' }}>{err}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={onClose} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: 'var(--vn-radius)', border: '1px solid var(--vn-border)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)', cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={deploy}
                disabled={running}
                style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: 'var(--vn-radius)', border: 'none', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)', cursor: 'pointer', fontWeight: 600 }}
              >
                {running ? 'Deploying…' : dryRun ? 'Dry Run' : 'Deploy'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Shared styles
   ═══════════════════════════════════════════════════════════════ */

const advPill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
  fontSize: '0.7rem', padding: '0.2rem 0.5rem',
  borderRadius: '999px',
  border: '1px solid var(--vn-border)',
  color: 'var(--vn-text-muted)',
  background: 'transparent', cursor: 'pointer',
};

const SERVICE_TYPES = ['validator', 'api', 'rpc', 'node', 'relayer', 'webserver', 'vprox', 'other'] as const;

/* ═══════════════════════════════════════════════════════════════
   ServicesSection
   ═══════════════════════════════════════════════════════════════ */

function ServicesSection({ vm, services }: { vm: VMStatus; services: Service[] }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', service_type: '', chain_id: '' });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ chain_id?: string; state?: string }>({});
  const [addErr, setAddErr] = useState('');

  const { mutate: doCreate, isPending: creating } = useMutation({
    mutationFn: () => createService({
      name: addForm.name,
      service_type: addForm.service_type,
      vm_name: vm.name,
      datacenter: vm.datacenter,
      chain_id: addForm.chain_id || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      setShowAdd(false);
      setAddForm({ name: '', service_type: '', chain_id: '' });
      setAddErr('');
    },
    onError: (e: Error) => setAddErr(e.message),
  });

  const { mutate: doUpdate } = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateService>[1] }) => updateService(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); setEditId(null); },
  });

  const { mutate: doDelete } = useMutation({
    mutationFn: (id: number) => deleteService(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });

  const stateColor = (state: string) => {
    if (state === 'online') return '#22c55e';
    if (state === 'down' || state === 'error') return 'var(--vn-danger)';
    return 'var(--vn-text-subtle)';
  };

  const inpS: React.CSSProperties = {
    padding: '0.2rem 0.4rem', fontSize: '0.75rem', borderRadius: 'var(--vn-radius)',
    border: '1px solid var(--vn-border)', background: 'var(--vn-surface)', color: 'var(--vn-text)',
  };

  return (
    <div>
      {services.length === 0 && !showAdd ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--vn-text-subtle)', padding: '0.1rem 0' }}>No services</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {services.map(svc => (
            <div key={svc.id}>
              {editId === svc.id ? (
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    value={editForm.chain_id ?? svc.chain_id}
                    onChange={e => setEditForm(f => ({ ...f, chain_id: e.target.value }))}
                    placeholder="chain_id"
                    style={{ ...inpS, width: 100 }}
                  />
                  <input
                    value={editForm.state ?? svc.state}
                    onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))}
                    placeholder="state"
                    style={{ ...inpS, width: 80 }}
                  />
                  <button
                    onClick={() => doUpdate({ id: svc.id, body: { chain_id: editForm.chain_id ?? svc.chain_id, state: editForm.state ?? svc.state } })}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--vn-radius)', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--vn-text)' }}>{svc.name}</span>
                  <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface)', border: '1px solid var(--vn-border)', color: 'var(--vn-text-muted)' }}>
                    {svc.service_type}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: stateColor(svc.state) }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: stateColor(svc.state), display: 'inline-block' }} />
                    {svc.state || 'unknown'}
                  </span>
                  {svc.chain_id && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--vn-text-subtle)', fontFamily: 'monospace' }}>{svc.chain_id}</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                    <button
                      onClick={() => { setEditId(svc.id); setEditForm({ chain_id: svc.chain_id, state: svc.state }); }}
                      style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface)', color: 'var(--vn-text-muted)' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { if (confirm(`Delete service "${svc.name}"?`)) doDelete(svc.id); }}
                      style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', cursor: 'pointer', border: '1px solid var(--vn-danger)', borderRadius: 'var(--vn-radius)', background: 'transparent', color: 'var(--vn-danger)' }}
                    >
                      Del
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd ? (
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <input
            value={addForm.name}
            onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
            placeholder="name"
            style={{ ...inpS, width: 100 }}
          />
          <select
            value={addForm.service_type}
            onChange={e => setAddForm(f => ({ ...f, service_type: e.target.value }))}
            style={{ ...inpS }}
          >
            <option value="">type…</option>
            {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            value={addForm.chain_id}
            onChange={e => setAddForm(f => ({ ...f, chain_id: e.target.value }))}
            placeholder="chain_id (opt)"
            style={{ ...inpS, width: 100 }}
          />
          <button
            onClick={() => {
              if (!addForm.name || !addForm.service_type) { setAddErr('Name and type required'); return; }
              doCreate();
            }}
            disabled={creating}
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--vn-radius)', background: 'var(--vn-primary)', color: 'var(--vn-on-primary)' }}
          >
            {creating ? '…' : 'Add'}
          </button>
          <button
            onClick={() => { setShowAdd(false); setAddErr(''); }}
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}
          >
            Cancel
          </button>
          {addErr && <span style={{ fontSize: '0.7rem', color: 'var(--vn-danger)', alignSelf: 'center' }}>{addErr}</span>}
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          style={{ marginTop: '0.5rem', fontSize: '0.72rem', padding: '0.2rem 0.5rem', cursor: 'pointer', border: '1px dashed var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'transparent', color: 'var(--vn-text-muted)' }}
        >
          + Add Service
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VMWidget
   ═══════════════════════════════════════════════════════════════ */

type ModalType = 'cpu' | 'mem' | 'disk' | 'network' | 'snapshot' | 'shell' | 'upgrade' | 'agent-install' | null;

function VMWidget({
  vm,
  hostName,
  domain,
  services,
}: {
  vm: VMStatus;
  hostName: string | undefined;
  domain: LibvirtDomain | undefined;
  services: Service[];
}) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ModalType>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'reboot' | 'destroy' | 'shutdown' | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const { addTask, updateTask } = useTasks();

  const agentQ = useQuery({
    queryKey: ['vm-agent', hostName, vm.name],
    queryFn: () => checkGuestAgent(hostName!, vm.name),
    enabled: !!hostName && vm.online,
    staleTime: 60_000,
  });

  const { mutate: doAction, isPending: actionPending } = useMutation({
    mutationFn: (action: string) => vmDomainAction(hostName!, vm.name, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vm-domains', hostName] });
      setConfirmAction(null);
      setActionMsg('');
    },
    onError: (e: Error) => setActionMsg(e.message),
  });

  const agentPresent = agentQ.data?.present;
  const agentLoading = agentQ.isLoading;
  const isRunning = domain?.state === 'running';
  const hasDomain = !!domain;

  return (
    <div style={{
      border: `1px solid ${!vm.online ? 'var(--vn-danger)' : 'var(--vn-border)'}`,
      borderRadius: 'var(--vn-radius)',
      background: 'var(--vn-surface-2)',
      padding: '0.85rem',
      opacity: !vm.online ? 0.75 : 1,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* ── Modals ── */}
      {modal === 'upgrade' && (
        <UpgradeModal
          vmName={vm.name}
          upgradeURL={vmUpgradeURL(vm.name)}
          onClose={() => { setModal(null); qc.invalidateQueries({ queryKey: ['vm-status'] }); }}
          onStart={() => addTask({ id: `vm-upgrade-${vm.name}`, label: `Upgrading ${vm.name}…`, status: 'running', startedAt: new Date() })}
          onDone={(success, detail) => updateTask(`vm-upgrade-${vm.name}`, { status: success ? 'done' : 'error', detail })}
        />
      )}
      {modal === 'agent-install' && hostName && (
        <AgentInstallModal host={hostName} domain={vm.name} onClose={() => setModal(null)} />
      )}
      {modal === 'cpu' && hostName && domain && (
        <CPUModal host={hostName} domain={vm.name} vmDomain={domain} onClose={() => setModal(null)} />
      )}
      {modal === 'mem' && hostName && domain && (
        <MemModal host={hostName} domain={vm.name} vmDomain={domain} onClose={() => setModal(null)} />
      )}
      {modal === 'disk' && hostName && (
        <DiskModal host={hostName} domain={vm.name} onClose={() => setModal(null)} />
      )}
      {modal === 'network' && hostName && (
        <NetworkModal host={hostName} domain={vm.name} onClose={() => setModal(null)} />
      )}
      {modal === 'snapshot' && hostName && (
        <SnapshotModal host={hostName} domain={vm.name} onClose={() => setModal(null)} />
      )}
      {modal === 'shell' && hostName && (
        <ShellModal host={hostName} vmName={vm.name} onClose={() => setModal(null)} />
      )}

      {/* ── Confirm action dialog ── */}
      {confirmAction && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setConfirmAction(null)}
        >
          <div
            style={{ background: 'var(--vn-surface)', borderRadius: 'var(--vn-radius)', padding: '1.25rem', width: 340, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', border: '1px solid var(--vn-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--vn-text)' }}>
              {confirmAction === 'reboot' ? 'Reboot' : confirmAction === 'destroy' ? 'Force Power Off' : 'Shutdown'} {vm.name}?
            </h4>
            {confirmAction === 'destroy' && (
              <p style={{ fontSize: '0.8rem', color: 'var(--vn-danger)', marginBottom: '0.75rem' }}>
                Warning: Force power-off may corrupt disk data.
              </p>
            )}
            {(confirmAction === 'shutdown' || confirmAction === 'reboot') && (
              <p style={{ fontSize: '0.8rem', color: 'var(--vn-text-muted)', marginBottom: '0.75rem' }}>
                {confirmAction === 'shutdown' ? 'Sends ACPI shutdown signal. VM will gracefully power off.' : 'Sends ACPI reboot signal. VM will restart gracefully.'}
              </p>
            )}
            {actionMsg && <p style={{ fontSize: '0.8rem', color: 'var(--vn-danger)', marginBottom: '0.5rem' }}>{actionMsg}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setConfirmAction(null); setActionMsg(''); }}
                style={{ padding: '0.35rem 0.8rem', fontSize: '0.82rem', cursor: 'pointer', border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', background: 'var(--vn-surface-2)', color: 'var(--vn-text)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => doAction(confirmAction)}
                disabled={actionPending}
                style={{
                  padding: '0.35rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer', borderRadius: 'var(--vn-radius)', fontWeight: 600,
                  border: 'none',
                  background: confirmAction === 'destroy' ? 'var(--vn-danger)' : confirmAction === 'reboot' ? 'var(--vn-warning)' : 'var(--vn-primary)',
                  color: '#fff',
                }}
              >
                {actionPending ? '…' : confirmAction === 'reboot' ? 'Reboot' : confirmAction === 'destroy' ? 'Force Off' : 'Shutdown'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Section 1: Overview ── */}
      <div style={{ marginBottom: '0.7rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--vn-text)', marginBottom: '0.15rem' }}>{vm.name}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--vn-text-subtle)' }}>
          {vm.os || (vm.online ? 'Linux' : 'offline')} · {vm.datacenter || 'N/A'}
        </div>
        {vm.lan_ip && (
          <div style={{ fontSize: '0.72rem', color: 'var(--vn-text-subtle)', fontFamily: 'monospace' }}>{vm.lan_ip}</div>
        )}

        {/* Pills */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
          {/* Online pill */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
            fontSize: '0.7rem', padding: '0.15rem 0.5rem',
            borderRadius: '999px',
            border: `1px solid ${vm.online ? '#22c55e' : 'var(--vn-danger)'}`,
            color: vm.online ? '#22c55e' : 'var(--vn-danger)',
            background: 'transparent',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: vm.online ? '#22c55e' : 'var(--vn-danger)', display: 'inline-block' }} />
            {vm.online ? 'online' : 'offline'}
          </span>

          {/* VM Agent pill */}
          {hostName && (
            agentLoading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '999px', border: '1px solid var(--vn-text-subtle)', color: 'var(--vn-text-subtle)', background: 'transparent' }}>
                <Spinner size={8} label="" /> vm agent
              </span>
            ) : (
              <button
                onClick={agentPresent ? undefined : () => setModal('agent-install')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  fontSize: '0.7rem', padding: '0.15rem 0.5rem',
                  borderRadius: '999px',
                  border: `1px solid ${agentPresent ? '#22c55e' : 'var(--vn-text-subtle)'}`,
                  color: agentPresent ? '#22c55e' : 'var(--vn-text-subtle)',
                  background: 'transparent',
                  cursor: agentPresent ? 'default' : 'pointer',
                }}
              >
                vm agent
              </button>
            )
          )}

          {/* Domain state pill */}
          {domain && (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              fontSize: '0.7rem', padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              border: `1px solid ${isRunning ? 'var(--vn-primary)' : 'var(--vn-text-subtle)'}`,
              color: isRunning ? 'var(--vn-primary)' : 'var(--vn-text-subtle)',
              background: 'transparent',
              textTransform: 'capitalize',
            }}>
              {domain.state}
            </span>
          )}
        </div>

        {/* Metrics */}
        {vm.online && (
          <>
            <div style={{ display: 'grid', gap: '0.35rem', margin: '0.6rem 0 0.4rem' }}>
              <MiniBar value={vm.cpu_pct} label="CPU" />
              <MiniBar value={vm.mem_pct} label="Mem" />
              <MiniBar value={vm.storage_pct} label="Disk" warn={75} danger={90} />
            </div>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem', color: 'var(--vn-text-muted)', flexWrap: 'wrap' }}>
              <span>
                <span style={{ color: 'var(--vn-text-subtle)' }}>Load </span>
                <span style={{ fontFamily: 'monospace', color: 'var(--vn-text)' }}>{vm.load_avg || '—'}</span>
              </span>
              <span>
                <span style={{ color: 'var(--vn-text-subtle)' }}>Updates </span>
                <span style={{ color: vm.apt_count > 0 ? 'var(--vn-warning)' : 'var(--vn-success)' }}>
                  {vm.apt_count > 0 ? `${vm.apt_count} pending` : '✓ current'}
                </span>
              </span>
            </div>
          </>
        )}
        {!vm.online && vm.error && (
          <div style={{ fontSize: '0.75rem', color: 'var(--vn-danger)', marginTop: '0.3rem' }}>{vm.error}</div>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: '1px solid var(--vn-border)', margin: '0.4rem 0' }} />

      {/* ── Section 2: Controls ── */}
      <div style={{ marginBottom: '0.7rem' }}>
        {/* Standard controls */}
        {vm.online && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
            <button
              onClick={() => setModal('upgrade')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                fontSize: '0.72rem', padding: '0.2rem 0.6rem',
                borderRadius: '999px',
                border: vm.apt_count > 0 ? '1px solid var(--vn-primary)' : '1px solid var(--vn-border)',
                color: vm.apt_count > 0 ? 'var(--vn-primary)' : 'var(--vn-text-muted)',
                background: 'transparent', cursor: 'pointer',
                fontWeight: vm.apt_count > 0 ? 600 : 400,
              }}
            >
              Upgrade{vm.apt_count > 0 ? ` (${vm.apt_count})` : ''}
            </button>

            {hostName && hasDomain && isRunning && (
              <button
                onClick={() => setConfirmAction('reboot')}
                style={{ ...advPill, borderColor: 'var(--vn-warning)', color: 'var(--vn-warning)' }}
              >
                <IconReboot /> Reboot
              </button>
            )}

            {hostName && hasDomain && (isRunning || domain?.state === 'paused') && (
              <button
                onClick={() => setConfirmAction('destroy')}
                style={{ ...advPill, borderColor: 'var(--vn-danger)', color: 'var(--vn-danger)' }}
              >
                <IconPowerOff /> Power Off
              </button>
            )}
          </div>
        )}

        {/* Advanced controls */}
        {hostName && (
          <div>
            <button
              onClick={() => setAdvancedOpen(o => !o)}
              style={{ fontSize: '0.72rem', color: 'var(--vn-text-subtle)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0' }}
            >
              Advanced {advancedOpen ? '▲' : '▾'}
            </button>
            {advancedOpen && (
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                {hasDomain && (
                  <>
                    <button onClick={() => setModal('cpu')} style={advPill}><IconCPU /> CPU</button>
                    <button onClick={() => setModal('mem')} style={advPill}><IconMemory /> Mem</button>
                  </>
                )}
                <button onClick={() => setModal('disk')} style={advPill}><IconDisk /> Disk</button>
                <button onClick={() => setModal('network')} style={advPill}><IconNetwork /> Net</button>
                {hasDomain && (
                  <button onClick={() => setModal('snapshot')} style={advPill}><IconSnapshot /> Snap</button>
                )}
                {hasDomain && isRunning && (
                  <button
                    onClick={() => setConfirmAction('shutdown')}
                    style={{ ...advPill, borderColor: 'var(--vn-text-subtle)', color: 'var(--vn-text-subtle)' }}
                  >
                    <IconShutdown /> Shutdown
                  </button>
                )}
                <button onClick={() => setModal('shell')} style={advPill}><IconShell /> Shell</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: '1px solid var(--vn-border)', margin: '0.4rem 0' }} />

      {/* ── Section 3: Services ── */}
      <div>
        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--vn-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
          Services
        </div>
        <ServicesSection vm={vm} services={services} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DatacenterBox
   ═══════════════════════════════════════════════════════════════ */

function DatacenterBox({
  datacenter,
  vms,
  vmHostMap,
  domainMap,
  services,
  inventoryHosts,
}: {
  datacenter: string;
  vms: VMStatus[];
  vmHostMap: Record<string, string>;
  domainMap: Record<string, Record<string, LibvirtDomain>>;
  services: Service[];
  inventoryHosts: HostInventory[];
}) {
  const [showDeploy, setShowDeploy] = useState(false);
  const [upgradeHost, setUpgradeHost] = useState<string | null>(null);
  const { addTask, updateTask } = useTasks();
  const runningCount = vms.filter(vm => vm.online).length;

  const hostsWithUpdates = inventoryHosts.filter(
    h => h.apt_pending > 0 && (!h.datacenter || h.datacenter === datacenter),
  );

  return (
    <div style={{ border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)', padding: '1rem', marginBottom: '1.5rem', background: 'var(--vn-surface)' }}>
      {showDeploy && <DeployWizardModal onClose={() => setShowDeploy(false)} />}
      {upgradeHost && (
        <UpgradeModal
          vmName={upgradeHost}
          upgradeURL={hostUpgradeURL(upgradeHost)}
          onClose={() => setUpgradeHost(null)}
          onStart={() => addTask({ id: `host-upgrade-${upgradeHost}`, label: `Upgrading host ${upgradeHost}…`, status: 'running', startedAt: new Date() })}
          onDone={(success, detail) => updateTask(`host-upgrade-${upgradeHost}`, { status: success ? 'done' : 'error', detail })}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--vn-text)' }}>{datacenter}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-muted)' }}>
            {runningCount}/{vms.length} online
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {hostsWithUpdates.map(host => (
            <button
              key={host.name}
              onClick={() => setUpgradeHost(host.name)}
              title={`${host.apt_pending} pending updates on ${host.name}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                fontSize: '0.72rem', padding: '0.2rem 0.6rem',
                borderRadius: '999px', border: '1px solid var(--vn-warning)',
                color: 'var(--vn-warning)', background: 'transparent', cursor: 'pointer',
              }}
            >
              {host.host_name ?? host.name} 🔄 {host.apt_pending}
            </button>
          ))}
          <button
            onClick={() => setShowDeploy(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              fontSize: '0.75rem', padding: '0.3rem 0.75rem',
              border: '1px solid var(--vn-primary)', borderRadius: 'var(--vn-radius)',
              background: 'transparent', color: 'var(--vn-primary)', cursor: 'pointer',
            }}
          >
            <IconDeploy /> Deploy
          </button>
        </div>
      </div>

      {/* VM grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
        {vms.map(vm => {
          const hostName = vmHostMap[vm.name];
          const domain = hostName ? domainMap[hostName]?.[vm.name] : undefined;
          const vmServices = services.filter(s => s.vm_name === vm.name);
          return (
            <VMWidget
              key={vm.name}
              vm={vm}
              hostName={hostName}
              domain={domain}
              services={vmServices}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   OperationsPage
   ═══════════════════════════════════════════════════════════════ */

export default function OperationsPage() {
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const { addTask, updateTask } = useTasks();
  const qc = useQueryClient();

  const statusQ = useQuery({
    queryKey: ['vm-status'],
    queryFn: () => getVMStatus().then(r => { setLastUpdated(new Date()); return r; }),
    refetchInterval: 60_000,
  });

  const fleetVMsQ = useQuery({
    queryKey: ['fleet-vms'],
    queryFn: getFleetVMs,
    staleTime: 60_000,
  });

  const servicesQ = useQuery({
    queryKey: ['services'],
    queryFn: getServices,
    staleTime: 30_000,
  });

  const hostsQ = useQuery({
    queryKey: ['vm-hosts'],
    queryFn: getVMHosts,
    staleTime: 60_000,
  });

  const hostInventoryQ = useQuery({
    queryKey: ['fleet-host-inventory'],
    queryFn: getHosts,
    staleTime: 60_000,
  });

  const bannedIPsQ = useQuery({
    queryKey: ['intel-banned'],
    queryFn: getBannedIPs,
    refetchInterval: 30_000,
  });

  const vms: VMStatus[] = statusQ.data?.vms ?? [];
  const vmViews: VMView[] = fleetVMsQ.data?.vms ?? [];
  const services: Service[] = servicesQ.data?.services ?? [];
  const hosts: HypervisorHost[] = hostsQ.data?.hosts ?? [];
  const hostInventory: HostInventory[] = hostInventoryQ.data?.hosts ?? [];
  const banned: BannedIPEntry[] = bannedIPsQ.data?.banned ?? [];

  // vmHostMap: vmName → hypervisor hostName (from fleet config)
  const vmHostMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const v of vmViews) {
      if (v.name && v.host) m[v.name] = v.host;
    }
    return m;
  }, [vmViews]);

  // Unique hypervisor host names referenced by vmHostMap
  const uniqueHosts = React.useMemo(() => {
    const hostSet = new Set(Object.values(vmHostMap));
    return hosts.filter(h => hostSet.has(h.name)).map(h => h.name);
  }, [hosts, vmHostMap]);

  // Parallel per-host domain queries
  const domainQueries = useQueries({
    queries: uniqueHosts.map(host => ({
      queryKey: ['vm-domains', host],
      queryFn: () => getVMDomains(host),
      staleTime: 30_000,
    })),
  });

  // domainMap: { [hostName]: { [domainName]: LibvirtDomain } }
  const domainMap = React.useMemo(() => {
    const m: Record<string, Record<string, LibvirtDomain>> = {};
    domainQueries.forEach((q, i) => {
      const host = uniqueHosts[i];
      if (host && q.data?.domains) {
        m[host] = {};
        for (const d of q.data.domains) {
          m[host][d.name] = d;
        }
      }
    });
    return m;
  }, [domainQueries, uniqueHosts]);

  // Group VMStatus by datacenter
  const byDC = React.useMemo(() => {
    const m: Record<string, VMStatus[]> = {};
    for (const vm of vms) {
      const dc = vm.datacenter || 'Unknown';
      if (!m[dc]) m[dc] = [];
      m[dc].push(vm);
    }
    return m;
  }, [vms]);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const handleScanHosts = async () => {
    addTask({ id: 'host-scan', label: 'Scanning hosts…', status: 'running', startedAt: new Date() });
    try {
      const res = await scanHosts();
      updateTask('host-scan', { status: 'done', detail: `Scanned ${res.hosts.length} hosts` });
      qc.invalidateQueries({ queryKey: ['fleet-host-inventory'] });
    } catch (err) {
      updateTask('host-scan', { status: 'error', detail: (err as Error).message });
    }
  };

  const formatCountdown = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--vn-text)' }}>Operations Center</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--vn-text-subtle)' }}>
            Last updated: {formatTime(lastUpdated)}
          </span>
          <button
            onClick={handleScanHosts}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              fontSize: '0.75rem', padding: '0.3rem 0.75rem',
              border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)',
              background: 'transparent', color: 'var(--vn-text-muted)', cursor: 'pointer',
            }}
          >
            🔍 Scan Hosts
          </button>
        </div>
      </div>

      {statusQ.isLoading ? (
        <Spinner label="Loading fleet status…" />
      ) : statusQ.isError ? (
        <div style={{ color: 'var(--vn-danger)', fontSize: '0.875rem', padding: '1rem 0' }}>
          Failed to load VM status. {(statusQ.error as Error)?.message}
        </div>
      ) : vms.length === 0 ? (
        <div style={{ color: 'var(--vn-text-muted)', fontSize: '0.875rem', padding: '2rem 0', textAlign: 'center' }}>
          No VMs in fleet. Add VM definitions to <code>config/infra/*.toml</code>.
        </div>
      ) : (
        Object.entries(byDC)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dc, dcVms]) => (
            <DatacenterBox
              key={dc}
              datacenter={dc}
              vms={dcVms}
              vmHostMap={vmHostMap}
              domainMap={domainMap}
              services={services}
              inventoryHosts={hostInventory}
            />
          ))
      )}

      {/* Auto-Banned IPs */}
      {(bannedIPsQ.isLoading || banned.length > 0) && (
        <div style={{
          border: '1px solid var(--vn-border)',
          borderRadius: 'var(--vn-radius)',
          padding: '1rem',
          background: 'var(--vn-surface)',
          marginTop: '1.5rem',
        }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--vn-text)', marginBottom: '0.75rem' }}>
            Auto-Banned IPs
          </div>
          {bannedIPsQ.isLoading ? (
            <Spinner size={16} label="Loading banned IPs…" />
          ) : banned.length === 0 ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--vn-text-muted)' }}>No active auto-bans.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {banned.map((entry) => (
                <div
                  key={entry.ip}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexWrap: 'wrap', gap: '0.5rem',
                    padding: '0.5rem 0.75rem',
                    background: 'var(--vn-surface-2)',
                    borderRadius: 'var(--vn-radius)',
                    border: '1px solid var(--vn-border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <code style={{ fontSize: '0.85rem', color: 'var(--vn-danger)', fontWeight: 600 }}>{entry.ip}</code>
                    <span style={{ fontSize: '0.78rem', color: 'var(--vn-text-muted)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.reason.length > 60 ? entry.reason.slice(0, 60) + '…' : entry.reason}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--vn-warning)', fontVariantNumeric: 'tabular-nums' }}>
                      ⏱ {formatCountdown(entry.remaining_seconds)}
                    </span>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await unbanIP(entry.ip);
                        qc.invalidateQueries({ queryKey: ['intel-banned'] });
                      } catch { /* ignore */ }
                    }}
                    style={{
                      fontSize: '0.75rem', padding: '0.2rem 0.6rem',
                      border: '1px solid var(--vn-border)', borderRadius: 'var(--vn-radius)',
                      background: 'transparent', color: 'var(--vn-text-muted)', cursor: 'pointer',
                    }}
                  >
                    Unban
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
