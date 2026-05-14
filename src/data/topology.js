/**
 * @fileoverview Static network topology data for the routing simulator.
 *
 * Defines five routers (R1–R5), ten hosts (H1A–H5B), and six WAN links.
 * The R1–R3 link is deliberately slow (512 Kbps) to illustrate the key
 * teaching contrast between RIP and OSPF:
 *
 *   RIP  selects: R1 → R3 → R5  (2 hops — fewer hops wins)
 *   OSPF selects: R1 → R2 → R3 → R5  (cost 30 — avoids the satellite link)
 */

/**
 * @typedef {Object} Router
 * @property {string} id      - Unique identifier (e.g. 'R1')
 * @property {string} label   - Display label
 * @property {number} x       - SVG canvas x-coordinate
 * @property {number} y       - SVG canvas y-coordinate
 * @property {string} subnet  - CIDR subnet assigned to this router's LAN
 * @property {string} site    - Human-readable site description
 */

/**
 * @typedef {Object} Host
 * @property {string} id     - Unique identifier (e.g. 'H1A')
 * @property {string} label  - Display label (same as ip)
 * @property {number} x      - SVG canvas x-coordinate
 * @property {number} y      - SVG canvas y-coordinate
 * @property {string} parent - ID of the router this host's LAN belongs to
 * @property {string} switch - ID of the LAN switch this host connects to
 * @property {string} ip     - IPv4 address
 */

/**
 * @typedef {Object} Switch
 * @property {string} id     - Unique identifier (e.g. 'SW1')
 * @property {string} label  - Display label
 * @property {number} x      - SVG canvas x-coordinate
 * @property {number} y      - SVG canvas y-coordinate
 * @property {string} router - ID of the router this switch uplinks to
 */

/**
 * @typedef {Object} Link
 * @property {string}  id        - Unique identifier (e.g. 'R1-R2')
 * @property {string}  from      - Router ID at one end
 * @property {string}  to        - Router ID at the other end
 * @property {string}  bandwidth - Human-readable bandwidth (e.g. '10 Mbps')
 * @property {number}  ospfCost  - OSPF interface cost: 10^8 / bandwidth_bps
 * @property {number}  hops      - RIP hop count (always 1 for a direct link)
 * @property {string}  label     - Short display label for the SVG canvas
 * @property {boolean} isSlow    - True for the satellite link (used to trigger warnings)
 * @property {string}  [note]    - Optional tooltip / warning text
 */

/**
 * @typedef {Object} AdjEntry
 * @property {string} neighbor - ID of the adjacent router
 * @property {Link}   link     - The link object connecting them
 * @property {number} cost     - OSPF cost (mirror of link.ospfCost)
 * @property {number} hops     - RIP hop count (always 1)
 */

/**
 * @typedef {Object} Endpoint
 * @property {string} id     - Host ID (e.g. 'H1A')
 * @property {string} label  - Display string shown in the source/destination dropdowns
 * @property {string} router - ID of the parent router
 * @property {string} ip     - IPv4 address
 */

/**
 * All routers in the simulated network, keyed by router ID.
 * Layout is designed so that R1 (left) and R5 (right) are the default
 * source/destination sites, maximising the number of hops traversed.
 * @type {Object.<string, Router>}
 */
export const ROUTERS = {
  R1: { id: 'R1', label: 'R1', x: 140, y: 290, subnet: '10.1.0.0/24', site: 'Site A\n(HQ)' },
  R2: { id: 'R2', label: 'R2', x: 370, y: 140, subnet: '10.2.0.0/24', site: 'Core 1' },
  R3: { id: 'R3', label: 'R3', x: 600, y: 290, subnet: '10.3.0.0/24', site: 'Core 2' },
  R4: { id: 'R4', label: 'R4', x: 370, y: 440, subnet: '10.4.0.0/24', site: 'Dist.' },
  R5: { id: 'R5', label: 'R5', x: 820, y: 290, subnet: '10.5.0.0/24', site: 'Site B\n(Branch)' },
};

/**
 * All hosts in the simulated network, keyed by host ID.
 * Each router has exactly two hosts attached to its LAN.
 * @type {Object.<string, Host>}
 */
export const HOSTS = {
  H1A: { id: 'H1A', label: '10.1.0.10', x: 40,  y: 210, parent: 'R1', switch: 'SW1', ip: '10.1.0.10' },
  H1B: { id: 'H1B', label: '10.1.0.11', x: 40,  y: 370, parent: 'R1', switch: 'SW1', ip: '10.1.0.11' },
  H2A: { id: 'H2A', label: '10.2.0.10', x: 270, y: 60,  parent: 'R2', switch: 'SW2', ip: '10.2.0.10' },
  H2B: { id: 'H2B', label: '10.2.0.11', x: 460, y: 60,  parent: 'R2', switch: 'SW2', ip: '10.2.0.11' },
  H3A: { id: 'H3A', label: '10.3.0.10', x: 680, y: 180, parent: 'R3', switch: 'SW3', ip: '10.3.0.10' },
  H3B: { id: 'H3B', label: '10.3.0.11', x: 700, y: 390, parent: 'R3', switch: 'SW3', ip: '10.3.0.11' },
  H4A: { id: 'H4A', label: '10.4.0.10', x: 270, y: 520, parent: 'R4', switch: 'SW4', ip: '10.4.0.10' },
  H4B: { id: 'H4B', label: '10.4.0.11', x: 460, y: 520, parent: 'R4', switch: 'SW4', ip: '10.4.0.11' },
  H5A: { id: 'H5A', label: '10.5.0.10', x: 910, y: 210, parent: 'R5', switch: 'SW5', ip: '10.5.0.10' },
  H5B: { id: 'H5B', label: '10.5.0.11', x: 910, y: 370, parent: 'R5', switch: 'SW5', ip: '10.5.0.11' },
};

/**
 * LAN switches, one per router site. Each switch aggregates the site's hosts
 * and uplinks to the router — matching how a real Cisco Packet Tracer topology
 * would be wired.
 * @type {Object.<string, Switch>}
 */
export const SWITCHES = {
  SW1: { id: 'SW1', label: 'SW1', x: 75,  y: 290, router: 'R1' },
  SW2: { id: 'SW2', label: 'SW2', x: 365, y: 78,  router: 'R2' },
  SW3: { id: 'SW3', label: 'SW3', x: 690, y: 290, router: 'R3' },
  SW4: { id: 'SW4', label: 'SW4', x: 365, y: 500, router: 'R4' },
  SW5: { id: 'SW5', label: 'SW5', x: 875, y: 290, router: 'R5' },
};

/**
 * WAN links between routers.
 *
 * OSPF cost formula: cost = 10^8 / bandwidth_bps  (Cisco 100 Mbps reference bandwidth)
 *   - 10 Mbps  → cost 10
 *   - 512 Kbps → cost ~195
 *
 * The R1–R3 link (isSlow: true) is the critical teaching link. RIP routes
 * through it because it counts as only 1 hop. OSPF avoids it because its
 * cost (195) far exceeds the three-hop alternative via R2 (cost 30).
 *
 * @type {Link[]}
 */
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

/**
 * Builds an undirected adjacency map from the LINKS array.
 *
 * Each router ID maps to an array of {@link AdjEntry} objects describing
 * its directly connected neighbours, the link between them, and the
 * associated OSPF cost and RIP hop count.
 *
 * @returns {Object.<string, AdjEntry[]>} Adjacency map keyed by router ID.
 *
 * @example
 * const adj = buildAdjacency();
 * adj['R1']
 * // → [{ neighbor: 'R2', cost: 10, hops: 1, link: {...} },
 * //    { neighbor: 'R3', cost: 195, hops: 1, link: {...} }]
 */
export function buildAdjacency() {
  const adj = {};
  for (const id of Object.keys(ROUTERS)) adj[id] = [];
  for (const link of LINKS) {
    adj[link.from].push({ neighbor: link.to,   link, cost: link.ospfCost, hops: 1 });
    adj[link.to  ].push({ neighbor: link.from, link, cost: link.ospfCost, hops: 1 });
  }
  return adj;
}

/**
 * Pre-built adjacency map for the static topology.
 * Consumed by both ripEngine and ospfEngine without recalculation.
 * @type {Object.<string, AdjEntry[]>}
 */
export const ADJACENCY = buildAdjacency();

/**
 * Flat list of all hosts formatted for use in the source/destination
 * dropdown selectors in {@link ControlPanel}.
 * @type {Endpoint[]}
 */
export const ENDPOINTS = Object.values(HOSTS).map(h => ({
  id:     h.id,
  label:  `${h.ip} (${h.parent} LAN)`,
  router: h.parent,
  ip:     h.ip,
}));
