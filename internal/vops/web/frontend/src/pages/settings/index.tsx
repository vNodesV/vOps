/**
 * settings/index.tsx
 * Settings page: nav shell with group/section switcher.
 * Config state lives here and is passed as props to each panel.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConfig } from '../../api';
import { BASE } from '../../api/client';
import type { ConfigSnapshot } from '../../api/types';
import Spinner from '../../components/Spinner';

import { FleetScanPanel, FleetSSHPanel, DatacentersPanel } from './InfraPanel';
import { PortsPanel, ProxyControlsPanel, ChainProfilesPanel } from './ProxyPanel';
import { VOpsPanel, BackupsPanel, PreferencesPanel } from './SystemPanel';
import { SecurityPanel } from './SecurityPanel';

/* ── Nav types ───────────────────────────────────────────────── */

interface NavSection {
  id: string;
  label: string;
}

interface NavGroup {
  id: string;
  label: string;
  desc: string;
  sections: NavSection[];
}

/* ── Nav groups (updated: System group merges Preferences) ────── */

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    desc: 'Hosts, virtual machines, and fleet SSH connectivity',
    sections: [
      { id: 'fleet-scan',  label: 'Fleet Scan' },
      { id: 'ssh-defaults', label: 'SSH Defaults' },
      { id: 'datacenters', label: 'Datacenters & VMs' },
    ],
  },
  {
    id: 'proxy',
    label: 'Proxy & Chains',
    desc: 'vProx reverse proxy and Cosmos chain endpoint configuration',
    sections: [
      { id: 'ports',          label: 'vProx Ports' },
      { id: 'proxy-controls', label: 'Proxy Controls' },
      { id: 'chain-profiles', label: 'Chain Profiles' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    desc: 'Dashboard, authentication, ingestion, backup, and appearance settings',
    sections: [
      { id: 'vops',       label: 'Dashboard & Auth' },
      { id: 'backups',    label: 'Backups' },
      { id: 'appearance', label: 'Appearance' },
    ],
  },
  {
    id: 'security',
    label: 'Security & Access',
    desc: 'SSH keys, API keys, password management, and firewall',
    sections: [
      { id: 'keys', label: 'Keys & Credentials' },
    ],
  },
];

/* ── SettingsPage ────────────────────────────────────────────── */

export default function SettingsPage() {
  const [activeGroup, setActiveGroup] = useState('infrastructure');
  const [activeSection, setActiveSection] = useState('fleet-scan');

  const { data: config, isLoading } = useQuery<ConfigSnapshot>({
    queryKey: ['config'],
    queryFn: getConfig,
    retry: false,
  });

  const selectSection = (groupId: string, sectionId: string) => {
    setActiveGroup(groupId);
    setActiveSection(sectionId);
  };

  const renderSection = () => {
    if (isLoading) return <Spinner label="Loading configuration" />;

    switch (activeSection) {
      case 'fleet-scan':
        return <FleetScanPanel />;
      case 'ssh-defaults':
        return config ? <FleetSSHPanel config={config} /> : null;
      case 'datacenters':
        return config ? <DatacentersPanel config={config} /> : null;
      case 'ports':
        return config ? <PortsPanel config={config} /> : null;
      case 'proxy-controls':
        return config ? <ProxyControlsPanel config={config} /> : null;
      case 'chain-profiles':
        return config ? <ChainProfilesPanel config={config} /> : null;
      case 'vops':
        return config ? <VOpsPanel config={config} /> : null;
      case 'backups':
        return config ? <BackupsPanel config={config} /> : null;
      case 'appearance':
        return <PreferencesPanel />;
      case 'keys':
        return <SecurityPanel />;
      default:
        return (
          <p className="text-sm" style={{ color: 'var(--vn-text-muted)' }}>
            Select a section from the left.
          </p>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>
            Settings
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-muted)' }}>
            Configure vProx, fleet, chains, authentication, and infrastructure.
          </p>
        </div>
        <button
          onClick={() => { window.location.href = BASE + '/settings/wizard'; }}
          className="btn btn-secondary"
        >
          Setup Wizard
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        {/* Left sidebar — groups + sections */}
        <nav className="md:col-span-1 space-y-1" aria-label="Settings navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.id}>
              {/* Group header */}
              <button
                onClick={() => {
                  setActiveGroup(group.id);
                  setActiveSection(group.sections[0].id);
                }}
                className="w-full text-left px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider
                           flex items-center gap-2 cursor-pointer transition-colors
                           focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                style={{
                  color: activeGroup === group.id ? 'var(--vn-primary)' : 'var(--vn-text-muted)',
                  backgroundColor:
                    activeGroup === group.id ? 'var(--vn-surface-2)' : 'transparent',
                }}
              >
                <span>{group.label}</span>
              </button>

              {/* Sub-sections (visible when group is active) */}
              {activeGroup === group.id && (
                <div className="ml-4 space-y-0.5 mt-0.5">
                  {group.sections.map((sec) => (
                    <button
                      key={sec.id}
                      onClick={() => selectSection(group.id, sec.id)}
                      className="w-full text-left px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors
                                 flex items-center gap-2
                                 focus-visible:ring-2 focus-visible:ring-[var(--vn-primary)]"
                      style={{
                        backgroundColor:
                          activeSection === sec.id ? 'var(--vn-primary)' : 'transparent',
                        color:
                          activeSection === sec.id
                            ? 'var(--vn-on-primary)'
                            : 'var(--vn-text)',
                      }}
                      aria-current={activeSection === sec.id ? 'page' : undefined}
                    >
                      {sec.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Right panel — section content */}
        <main className="md:col-span-3 space-y-4">
          {/* Group description banner */}
          {(() => {
            const grp = NAV_GROUPS.find((g) => g.id === activeGroup);
            const sec = grp?.sections.find((s) => s.id === activeSection);
            if (!grp || !sec) return null;
            return (
              <div
                className="card card-sm text-xs flex items-start gap-3"
                style={{ color: 'var(--vn-text-muted)' }}
              >
                <div>
                  <span className="font-semibold" style={{ color: 'var(--vn-text)' }}>
                    {grp.label} — {sec.label}
                  </span>
                  <span className="ml-2">{grp.desc}</span>
                </div>
              </div>
            );
          })()}

          {/* Main section content */}
          {renderSection()}

          {/* Wizard callout if config not loaded */}
          {!isLoading && !config && (
            <div
              className="p-4 rounded-lg text-sm text-center space-y-3"
              style={{ backgroundColor: 'var(--vn-surface)', border: '1px dashed var(--vn-border)' }}
            >
              <p style={{ color: 'var(--vn-text-muted)' }}>
                Configuration not yet initialized. Run the Setup Wizard to get started.
              </p>
              <button
                onClick={() => { window.location.href = BASE + '/settings/wizard'; }}
                className="btn btn-primary"
              >
                Open Setup Wizard
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
