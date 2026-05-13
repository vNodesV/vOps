import { memo, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { getHosts, getFleetVMs, getUnits } from '../api';
import type { HostInventory, CosmosUnitWithStatus } from '../api/types';
import Spinner from '../components/Spinner';

/* ── local VM shape ──────────────────────────────────────────── */
interface VMView {
  name: string;
  host_ref?: string;
  host?: string;
  host_name?: string;
  state?: string;
  lan_ip?: string;
  cpu_pct?: number;
  mem_mib?: number;
  max_mem_mib?: number;
  os?: string;
  datacenter?: string;
}

/* ── helpers ─────────────────────────────────────────────────── */
function statusColor(s?: string): string {
  if (!s) return 'var(--vn-text-muted)';
  const l = s.toLowerCase();
  if (l.includes('running') || l === 'online' || l === 'active') return 'var(--vn-success)';
  if (l.includes('shut') || l === 'offline' || l === 'inactive') return 'var(--vn-text-muted)';
  if (l.includes('paus') || l.includes('catch') || l === 'syncing') return 'var(--vn-warning)';
  return 'var(--vn-danger)';
}

function statusColorHex(s?: string): string {
  if (!s) return '#6b7280';
  const l = s.toLowerCase();
  if (l.includes('running') || l === 'online' || l === 'active') return '#22c55e';
  if (l.includes('shut') || l === 'offline' || l === 'inactive') return '#6b7280';
  if (l.includes('paus') || l.includes('catch') || l === 'syncing') return '#f59e0b';
  return '#ef4444';
}

function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      borderRadius: '50%', background: color, flexShrink: 0,
    }} />
  );
}

/* ── node dimensions (must match dagre graph) ────────────────── */
const NW = { dc: 200, host: 195, vm: 185, unit: 170 } as const;
const NH = { dc: 68,  host: 108, vm: 90,  unit: 78  } as const;

const hStyle: React.CSSProperties = {
  width: 7, height: 7,
  background: 'var(--vn-border)',
  border: '1px solid var(--vn-surface-1)',
};

/* ── Custom node renderers ───────────────────────────────────── */
const DCNode = memo(function DCNode({ data }: { data: Record<string, unknown> }) {
  const d = data as { label: string; hostCount: number; vmCount: number };
  return (
    <div style={{
      position: 'relative', padding: '10px 14px',
      background: 'var(--vn-surface-1)',
      border: '2px solid var(--vn-primary)',
      borderRadius: 8, width: NW.dc, boxSizing: 'border-box',
    }}>
      <Handle type="source" position={Position.Right} style={hStyle} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>🏢</span>
        <strong style={{ fontSize: 13 }}>{d.label}</strong>
      </div>
      <div style={{ fontSize: 11, color: 'var(--vn-text-muted)', marginTop: 4 }}>
        {d.hostCount} host{d.hostCount !== 1 ? 's' : ''} · {d.vmCount} VM{d.vmCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
});

const HostNode = memo(function HostNode({ data }: { data: Record<string, unknown> }) {
  const h = (data as { host: HostInventory }).host;
  return (
    <div style={{
      position: 'relative', padding: '10px 12px',
      background: 'var(--vn-surface-2)',
      border: '1px solid var(--vn-border)',
      borderRadius: 8, width: NW.host, boxSizing: 'border-box',
    }}>
      <Handle type="target" position={Position.Left} style={hStyle} />
      <Handle type="source" position={Position.Right} style={hStyle} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12 }}>🖥</span>
        <strong style={{ fontSize: 12 }}>{h.name}</strong>
        <Dot color={statusColor(h.status)} size={7} />
      </div>
      {h.lan_ip && (
        <div style={{ fontSize: 11, color: 'var(--vn-text-muted)', marginTop: 3, fontFamily: 'monospace' }}>
          {h.lan_ip}
        </div>
      )}
      {h.os && (
        <div style={{ fontSize: 11, color: 'var(--vn-text-subtle)', marginTop: 2 }}>{h.os}</div>
      )}
      {h.apt_pending > 0 && (
        <div style={{ fontSize: 11, color: 'var(--vn-warning)', marginTop: 3 }}>
          ⚠ {h.apt_pending} update{h.apt_pending !== 1 ? 's' : ''} pending
        </div>
      )}
    </div>
  );
});

const VMNode = memo(function VMNode({ data }: { data: Record<string, unknown> }) {
  const navigate = useNavigate();
  const vm = (data as { vm: VMView }).vm;
  const color = statusColor(vm.state);
  const memPct = vm.mem_mib && vm.max_mem_mib
    ? Math.round(vm.mem_mib / vm.max_mem_mib * 100) : null;
  return (
    <div
      role="button" tabIndex={0}
      style={{
        position: 'relative', padding: '8px 12px',
        background: 'var(--vn-surface-2)',
        border: `1px solid ${color}44`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 6, cursor: 'pointer',
        width: NW.vm, boxSizing: 'border-box',
      }}
      onClick={() => navigate(`/vms?filter=${encodeURIComponent(vm.name)}`)}
      onKeyDown={e => e.key === 'Enter' && navigate(`/vms?filter=${encodeURIComponent(vm.name)}`)}
      title="Open in VM Manager"
    >
      <Handle type="target" position={Position.Left} style={hStyle} />
      <Handle type="source" position={Position.Right} style={hStyle} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Dot color={color} size={7} />
        <strong style={{ fontSize: 12 }}>{vm.name}</strong>
      </div>
      <div style={{ fontSize: 11, color: 'var(--vn-text-muted)', marginTop: 3 }}>
        {vm.state ?? '—'}{vm.lan_ip ? ` · ${vm.lan_ip}` : ''}
      </div>
      {(vm.cpu_pct !== undefined || memPct !== null) && (
        <div style={{ fontSize: 11, color: 'var(--vn-text-muted)', marginTop: 2 }}>
          {vm.cpu_pct !== undefined ? `CPU ${vm.cpu_pct.toFixed(0)}%` : ''}
          {vm.cpu_pct !== undefined && memPct !== null ? ' · ' : ''}
          {memPct !== null ? `Mem ${memPct}%` : ''}
        </div>
      )}
    </div>
  );
});

const UnitNode = memo(function UnitNode({ data }: { data: Record<string, unknown> }) {
  const navigate = useNavigate();
  const u = (data as { unit: CosmosUnitWithStatus }).unit;
  const color = u.status
    ? statusColor(u.status.service_active ? (u.status.syncing ? 'syncing' : 'running') : 'down')
    : 'var(--vn-text-muted)';
  return (
    <div
      role="button" tabIndex={0}
      style={{
        position: 'relative', padding: '7px 10px',
        background: 'var(--vn-surface-2)',
        border: '1px solid var(--vn-border)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 5, cursor: 'pointer',
        width: NW.unit, boxSizing: 'border-box',
      }}
      onClick={() => navigate(`/units?filter=${encodeURIComponent(u.name)}`)}
      onKeyDown={e => e.key === 'Enter' && navigate(`/units?filter=${encodeURIComponent(u.name)}`)}
      title="Open in Services"
    >
      <Handle type="target" position={Position.Left} style={hStyle} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Dot color={color} size={6} />
        <strong style={{ fontSize: 11 }}>{u.name}</strong>
        {u.status?.upgrade_name && (
          <span style={{ fontSize: 10, color: 'var(--vn-warning)', marginLeft: 'auto' }}>⬆</span>
        )}
      </div>
      {u.status && (
        <div style={{ fontSize: 10, color: 'var(--vn-text-muted)', marginTop: 3 }}>
          ht {u.status.block_height?.toLocaleString() ?? '?'} · {u.status.peers}p
        </div>
      )}
    </div>
  );
});

const nodeTypes: NodeTypes = {
  dc: DCNode,
  host: HostNode,
  vm: VMNode,
  unit: UnitNode,
} as NodeTypes;

/* ── dagre auto-layout ───────────────────────────────────────── */
function applyLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 60, nodesep: 22, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const t = (n.type ?? 'vm') as keyof typeof NW;
    g.setNode(n.id, { width: NW[t] ?? 185, height: NH[t as keyof typeof NH] ?? 90 });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map(n => {
    const pos = g.node(n.id);
    const t = (n.type ?? 'vm') as keyof typeof NW;
    return { ...n, position: { x: pos.x - (NW[t] ?? 185) / 2, y: pos.y - (NH[t as keyof typeof NH] ?? 90) / 2 } };
  });
}

/* ── graph builder ───────────────────────────────────────────── */
function buildGraph(hosts: HostInventory[], vms: VMView[], units: CosmosUnitWithStatus[]) {
  const rawNodes: Node[] = [];
  const rawEdges: Edge[] = [];

  const vmsByHost: Record<string, VMView[]> = {};
  for (const vm of vms) {
    const key = vm.host_ref ?? vm.host_name ?? vm.host ?? vm.datacenter ?? 'unknown';
    (vmsByHost[key] ??= []).push(vm);
  }
  const unitsByVM: Record<string, CosmosUnitWithStatus[]> = {};
  for (const u of units) (unitsByVM[u.vm_name] ??= []).push(u);

  const hostsByDC: Record<string, HostInventory[]> = {};
  for (const h of hosts) (hostsByDC[h.datacenter ?? 'Unknown DC'] ??= []).push(h);
  for (const vm of vms) {
    const dc = vm.datacenter ?? 'Unknown DC';
    if (!hostsByDC[dc]) hostsByDC[dc] = [];
  }

  for (const dc of Object.keys(hostsByDC).sort()) {
    const dcHosts = hostsByDC[dc];
    const orphans = vms.filter(v =>
      (v.datacenter ?? 'Unknown DC') === dc &&
      !dcHosts.find(h => h.name === (v.host_ref ?? v.host_name ?? v.host))
    );
    const totalVMs = dcHosts.reduce((a, h) => a + (vmsByHost[h.name]?.length ?? 0), 0) + orphans.length;
    const dcId = `dc::${dc}`;

    rawNodes.push({ id: dcId, type: 'dc', data: { label: dc, hostCount: dcHosts.length, vmCount: totalVMs }, position: { x: 0, y: 0 } });

    const addVM = (vm: VMView, parentId: string) => {
      const vmId = `vm::${vm.name}`;
      rawNodes.push({ id: vmId, type: 'vm', data: { vm }, position: { x: 0, y: 0 } });
      rawEdges.push({ id: `e:${parentId}:${vmId}`, source: parentId, target: vmId, type: 'smoothstep', style: { stroke: 'var(--vn-border)', strokeWidth: 1.5 } });
      for (const u of (unitsByVM[vm.name] ?? [])) {
        const uid = `unit::${u.name}`;
        rawNodes.push({ id: uid, type: 'unit', data: { unit: u }, position: { x: 0, y: 0 } });
        rawEdges.push({ id: `e:${vmId}:${uid}`, source: vmId, target: uid, type: 'smoothstep', style: { stroke: 'var(--vn-border)', strokeWidth: 1, strokeDasharray: '4 3' } });
      }
    };

    for (const h of dcHosts) {
      const hostId = `host::${h.name}`;
      rawNodes.push({ id: hostId, type: 'host', data: { host: h }, position: { x: 0, y: 0 } });
      rawEdges.push({ id: `e:${dcId}:${hostId}`, source: dcId, target: hostId, type: 'smoothstep', style: { stroke: 'var(--vn-primary)', strokeWidth: 2 } });
      for (const vm of (vmsByHost[h.name] ?? [])) addVM(vm, hostId);
    }
    for (const vm of orphans) addVM(vm, dcId);
  }

  return { nodes: applyLayout(rawNodes, rawEdges), edges: rawEdges };
}

/* ── Page ────────────────────────────────────────────────────── */
export default function TopologyPage() {
  const { data: hostsData, isLoading: hL } = useQuery({ queryKey: ['topology-hosts'], queryFn: getHosts, staleTime: 30_000 });
  const { data: vmsData,   isLoading: vL } = useQuery({ queryKey: ['topology-vms'],   queryFn: getFleetVMs, staleTime: 30_000 });
  const { data: unitsData, isLoading: uL } = useQuery({ queryKey: ['topology-units'],  queryFn: getUnits, staleTime: 30_000 });

  const hosts = (hostsData?.hosts ?? []) as HostInventory[];
  const vms   = (vmsData?.vms   ?? []) as VMView[];
  const units = (unitsData?.units ?? []) as CosmosUnitWithStatus[];

  const { nodes, edges } = useMemo(() => buildGraph(hosts, vms, units), [hosts, vms, units]);

  const dcCount = [...new Set(hosts.map(h => h.datacenter))].filter(Boolean).length;

  if (hL || vL || uL) return <div><h1 className="text-xl font-bold mb-4">Topology</h1><Spinner /></div>;

  if (nodes.length === 0) return (
    <div>
      <h1 className="text-xl font-bold mb-4">Topology</h1>
      <div className="card card-sm">
        <p style={{ margin: 0, color: 'var(--vn-text-muted)' }}>
          No topology data yet. Configure hypervisor hosts and register units to see the map.
        </p>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl font-bold m-0">Topology</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--vn-text-subtle)' }}>
            Interactive map — scroll to zoom · drag to pan · click node to open
          </p>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: '0.78rem', color: 'var(--vn-text-muted)', alignItems: 'center' }}>
          <span>🏢 {dcCount} DC</span>
          <span>🖥 {hosts.length} hosts</span>
          <span>⬡ {vms.length} VMs</span>
          <span>◉ {units.length} services</span>
        </div>
      </div>

      <div style={{
        flex: 1, height: 'calc(100vh - 160px)', minHeight: 520,
        border: '1px solid var(--vn-border)',
        borderRadius: 'var(--vn-radius)', overflow: 'hidden',
      }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          style={{ background: 'var(--vn-bg)' }}
        >
          <Background variant={BackgroundVariant.Dots} color="var(--vn-border)" gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={n => {
              if (n.type === 'dc') return '#3b82f6';
              if (n.type === 'host') return '#14b8a6';
              if (n.type === 'vm') return statusColorHex((n.data as { vm?: VMView }).vm?.state);
              return '#9ca3af';
            }}
            style={{ background: 'var(--vn-surface-1)', border: '1px solid var(--vn-border)' }}
            maskColor="rgba(0,0,0,0.25)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
