// Network topology: 5 routers with a deliberately slow R1-R3 link
// KEY TEACHING POINT: RIP picks R1→R3→R5 (2 hops) even though
// the R1-R3 link is only 512 Kbps. OSPF correctly picks R1→R2→R3→R5 (cost 30).

export const ROUTERS = {
  R1: { id: 'R1', label: 'R1', x: 140, y: 290, subnet: '10.1.0.0/24', site: 'Site A\n(HQ)' },
  R2: { id: 'R2', label: 'R2', x: 370, y: 140, subnet: '10.2.0.0/24', site: 'Core 1' },
  R3: { id: 'R3', label: 'R3', x: 600, y: 290, subnet: '10.3.0.0/24', site: 'Core 2' },
  R4: { id: 'R4', label: 'R4', x: 370, y: 440, subnet: '10.4.0.0/24', site: 'Dist.' },
  R5: { id: 'R5', label: 'R5', x: 820, y: 290, subnet: '10.5.0.0/24', site: 'Site B\n(Branch)' },
};

export const HOSTS = {
  H1A: { id: 'H1A', label: '10.1.0.10', x: 40,  y: 210, parent: 'R1', ip: '10.1.0.10' },
  H1B: { id: 'H1B', label: '10.1.0.11', x: 40,  y: 370, parent: 'R1', ip: '10.1.0.11' },
  H2A: { id: 'H2A', label: '10.2.0.10', x: 270, y: 60,  parent: 'R2', ip: '10.2.0.10' },
  H2B: { id: 'H2B', label: '10.2.0.11', x: 460, y: 60,  parent: 'R2', ip: '10.2.0.11' },
  H3A: { id: 'H3A', label: '10.3.0.10', x: 680, y: 180, parent: 'R3', ip: '10.3.0.10' },
  H3B: { id: 'H3B', label: '10.3.0.11', x: 700, y: 390, parent: 'R3', ip: '10.3.0.11' },
  H4A: { id: 'H4A', label: '10.4.0.10', x: 270, y: 520, parent: 'R4', ip: '10.4.0.10' },
  H4B: { id: 'H4B', label: '10.4.0.11', x: 460, y: 520, parent: 'R4', ip: '10.4.0.11' },
  H5A: { id: 'H5A', label: '10.5.0.10', x: 910, y: 210, parent: 'R5', ip: '10.5.0.10' },
  H5B: { id: 'H5B', label: '10.5.0.11', x: 910, y: 370, parent: 'R5', ip: '10.5.0.11' },
};

// WAN links between routers
// OSPF cost = 10^8 / bandwidth_bps (Cisco reference bandwidth 100 Mbps)
export const LINKS = [
  {
    id: 'R1-R2', from: 'R1', to: 'R2',
    bandwidth: '10 Mbps', ospfCost: 10, hops: 1,
    label: '10 Mbps', isSlow: false,
  },
  {
    id: 'R1-R3', from: 'R1', to: 'R3',
    bandwidth: '512 Kbps', ospfCost: 195, hops: 1,
    label: '512 Kbps', isSlow: true,
    note: '⚠ Slow satellite link',
  },
  {
    id: 'R2-R3', from: 'R2', to: 'R3',
    bandwidth: '10 Mbps', ospfCost: 10, hops: 1,
    label: '10 Mbps', isSlow: false,
  },
  {
    id: 'R2-R4', from: 'R2', to: 'R4',
    bandwidth: '10 Mbps', ospfCost: 10, hops: 1,
    label: '10 Mbps', isSlow: false,
  },
  {
    id: 'R3-R5', from: 'R3', to: 'R5',
    bandwidth: '10 Mbps', ospfCost: 10, hops: 1,
    label: '10 Mbps', isSlow: false,
  },
  {
    id: 'R4-R5', from: 'R4', to: 'R5',
    bandwidth: '10 Mbps', ospfCost: 10, hops: 1,
    label: '10 Mbps', isSlow: false,
  },
];

// Helper: build adjacency map
export function buildAdjacency() {
  const adj = {};
  for (const id of Object.keys(ROUTERS)) adj[id] = [];
  for (const link of LINKS) {
    adj[link.from].push({ neighbor: link.to, link, cost: link.ospfCost, hops: 1 });
    adj[link.to].push({ neighbor: link.from, link, cost: link.ospfCost, hops: 1 });
  }
  return adj;
}

export const ADJACENCY = buildAdjacency();

// Selectable source/destination endpoints (hosts)
export const ENDPOINTS = Object.values(HOSTS).map(h => ({
  id: h.id,
  label: `${h.ip} (${h.parent} LAN)`,
  router: h.parent,
  ip: h.ip,
}));
