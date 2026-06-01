/**
 * settings/index.tsx
 * Settings page: nav shell with group/section switcher.
 *
 * Config-file-driven edit panels were retired (v1.5.x): settings backed by
 * TOML files are now managed via config files / CLI, not the GUI. The sections
 * that remain genuinely live are Fleet Scan, Services & Chains, Keys &
 * Credentials, and Appearance. Retired sections render an honest notice via
 * RetiredPanel rather than a Save button that silently 501s.
 */
import { useState } from 'react';

import { FleetScanPanel } from './InfraPanel';
import { SecurityPanel } from './SecurityPanel';
import { PreferencesPanel } from './SystemPanel';
import { RetiredPanel } from './shared';
import ServicesPage from '../CosmosNodes';

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

/* ── Nav groups ──────────────────────────────────────────────── */

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
      { id: 'ports',             label: 'vProx Ports' },
      { id: 'proxy-controls',    label: 'Proxy Controls' },
      { id: 'chain-profiles',    label: 'Chain Profiles' },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    desc: 'Cosmos node services and chain endpoints monitored by vOps',
    sections: [
      { id: 'cosmos-nodes', label: 'Services & Chains' },
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
      { id: 'keys',       label: 'Keys & Credentials' },
      { id: 'intel-keys', label: 'Intel API Keys' },
      { id: 'auto-ban',   label: 'Auto-Ban' },
    ],
  },
];

/* ── SettingsPage ────────────────────────────────────────────── */

export default function SettingsPage() {
  const [activeGroup, setActiveGroup] = useState('infrastructure');
  const [activeSection, setActiveSection] = useState('fleet-scan');

  const selectSection = (groupId: string, sectionId: string) => {
    setActiveGroup(groupId);
    setActiveSection(sectionId);
  };

  const renderSection = () => {
    switch (activeSection) {
      /* ── Live sections ── */
      case 'fleet-scan':
        return <FleetScanPanel />;
      case 'cosmos-nodes':
        return <ServicesPage />;
      case 'keys':
        return <SecurityPanel />;
      case 'appearance':
        return <PreferencesPanel />;

      /* ── Retired config-file-driven sections ── */
      case 'ssh-defaults':
        return (
          <RetiredPanel
            title="Fleet SSH Defaults"
            detail="Edit fleet SSH defaults in config/fleet/settings.toml, then restart vOps."
          />
        );
      case 'datacenters':
        return (
          <RetiredPanel
            title="Datacenters & VM Inventory"
            detail="Datacenters and VMs are defined per file in config/infra/<datacenter>.toml. Use Fleet Scan to discover and add VMs to inventory."
          />
        );
      case 'ports':
        return (
          <RetiredPanel
            title="vProx Ports"
            detail="vProx ports are configured in the vprox.toml config file."
          />
        );
      case 'proxy-controls':
        return (
          <RetiredPanel
            title="Proxy Controls"
            detail="Rate limiting, auto-quarantine, and debug settings live in the vprox.toml config file."
          />
        );
      case 'chain-profiles':
        return (
          <RetiredPanel
            title="Chain Profiles"
            detail="Chain profiles are defined per file in config/chains/<chain>.toml."
          />
        );
      case 'vops':
        return (
          <RetiredPanel
            title="vOps Dashboard & Auth"
            detail="Network binding, admin credentials, and IP-intelligence tuning are set in config/vops/vops.toml. SSH/API keys and the password hash are generated under Security → Keys & Credentials."
          />
        );
      case 'backups':
        return (
          <RetiredPanel
            title="Backup & Import Configuration"
            detail="Backup schedule and import mode are configured in the backup.toml config file."
          />
        );
      case 'intel-keys':
        return (
          <RetiredPanel
            title="Intel API Keys"
            detail="AbuseIPDB / VirusTotal / Shodan keys are set in config/vops/vops.toml under [vops.intel.keys]."
          />
        );
      case 'auto-ban':
        return (
          <RetiredPanel
            title="UFW Auto-Ban"
            detail="Auto-ban thresholds, duration, and whitelist are set in config/vops/vops.toml under [vops.intel]."
          />
        );

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
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--vn-text)' }}>
          Settings
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--vn-text-muted)' }}>
          Configure vOps, fleet, chains, authentication, and infrastructure.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
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
        </main>
      </div>
    </div>
  );
}
