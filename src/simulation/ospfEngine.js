/**
 * @fileoverview OSPF Simulation Engine.
 *
 * Generates an ordered array of discrete simulation steps representing the
 * full OSPF lifecycle for a given source/destination pair:
 *
 *   Phase 1 — Convergence
 *     1. Hello packets       → neighbour discovery and adjacency formation
 *     2. DBD exchange        → LSDB summary comparison
 *     3. LSR / LSU / LSAck   → reliable LSA flooding
 *     4. SPF calculation     → Dijkstra's algorithm run step by step
 *
 *   Phase 2 — Forwarding
 *     - Route decision: shows path OSPF computed (always cost-optimal)
 *     - Hop-by-hop: one step per router along the SPF-derived path
 *     - Delivery confirmation
 *
 * Teaching note — the key OSPF strength illustrated here:
 *   OSPF selects R1 → R2 → R3 → R5 (cost 30, all 10 Mbps links) rather
 *   than R1 → R3 → R5 (2 hops but 512 Kbps satellite) which RIP would
 *   choose. Cost = 10^8 / bandwidth_bps distinguishes fast from slow links.
 */

import { ROUTERS, LINKS, ADJACENCY } from '../data/topology.js';

/** @type {string[]} Ordered list of all router IDs in the topology. */
const ROUTER_IDS = Object.keys(ROUTERS);

// ─────────────────────────────────────────────────────────────────────────────
// Type definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} OspfTableEntry
 * @property {string} network  - CIDR network (e.g. '10.1.0.0/24')
 * @property {string} nextHop  - Next-hop router ID, or 'Direct' for connected subnets
 * @property {number} cost     - OSPF cumulative cost from this router to the network
 * @property {string} via      - Same as nextHop (first hop on the SPF path)
 */

/**
 * @typedef {Object.<string, OspfTableEntry>} OspfTable
 * A single router's SPF-derived routing table, keyed by network CIDR.
 */

/**
 * @typedef {Object.<string, OspfTable>} AllOspfTables
 * Routing tables for all routers, keyed by router ID.
 */

/**
 * @typedef {Object} LsaLink
 * @property {string} neighbor  - Adjacent router ID
 * @property {number} cost      - OSPF cost to that neighbour
 * @property {string} bandwidth - Human-readable bandwidth string
 * @property {string} linkId    - Link identifier (e.g. 'R1-R2')
 */

/**
 * @typedef {Object} RouterLsa
 * @property {string}    routerId - Router ID that originated this LSA (Type 1)
 * @property {string}    subnet   - Connected subnet of the originating router
 * @property {LsaLink[]} links    - All adjacencies and their costs
 */

/**
 * @typedef {Object.<string, RouterLsa>} Lsdb
 * The complete Link State Database, keyed by advertising router ID.
 */

/**
 * @typedef {Object} DijkstraExploration
 * @property {string}  neighbor  - Neighbour router being examined
 * @property {string}  via       - Router being visited when this exploration occurs
 * @property {number}  linkCost  - Cost of the link from via to neighbor
 * @property {number}  newCost   - Candidate cost: cost[via] + linkCost
 * @property {number}  oldCost   - Cost[neighbor] before this step
 * @property {boolean} improved  - True if newCost < oldCost (edge was relaxed)
 */

/**
 * @typedef {Object} DijkstraTraceStep
 * @property {string}                  visitedNode    - Node selected this iteration
 * @property {number}                  nodeCost       - Accumulated cost to visitedNode
 * @property {DijkstraExploration[]}   explorations   - Neighbours examined this iteration
 * @property {Object.<string,number>}  costsSnapshot  - Full cost table after this iteration
 * @property {Object.<string,string>}  prevSnapshot   - Full prev table after this iteration
 */

/**
 * @typedef {Object} SpfStepPayload
 * @property {string}                 visitedNode  - Node visited this step
 * @property {string[]}               visited      - All nodes visited so far
 * @property {Object.<string,number>} costs        - Current cost table
 * @property {Object.<string,string>} prev         - Current prev table
 * @property {DijkstraExploration[]}  explorations - Explorations this step
 */

// ─────────────────────────────────────────────────────────────────────────────
// Dijkstra's algorithm (exported for unit testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs Dijkstra's Shortest Path First algorithm from `srcRouter` using the
 * OSPF costs defined in the static topology adjacency map.
 *
 * Algorithm overview:
 *   1. Set cost[src] = 0; all others = ∞
 *   2. While unvisited nodes remain:
 *      a. Pick u = unvisited node with minimum cost[u]
 *      b. If cost[u] = ∞, stop (disconnected graph)
 *      c. For each unvisited neighbour v of u:
 *           alt = cost[u] + link_cost(u,v)
 *           if alt < cost[v]: relax → cost[v] = alt, prev[v] = u
 *
 * Time complexity: O(V²) with this linear-scan implementation (suitable for
 * small topologies). A binary-heap version would be O((V+E) log V).
 *
 * @param {string} srcRouter - Router ID to use as the SPF root.
 * @returns {{ costs: Object.<string,number>, prev: Object.<string,string|null> }}
 *   `costs` maps each router ID to its minimum-cost distance from srcRouter.
 *   `prev`  maps each router ID to its predecessor on the optimal path.
 *
 * @example
 * const { costs, prev } = dijkstra('R1');
 * costs['R5']; // → 30  (R1→R2→R3→R5, all cost-10 links)
 * prev['R5'];  // → 'R3'
 */
export function dijkstra(srcRouter) {
  const costs = {};
  const prev  = {};
  const visited = new Set();

  for (const id of ROUTER_IDS) { costs[id] = Infinity; prev[id] = null; }
  costs[srcRouter] = 0;

  const unvisited = new Set(ROUTER_IDS);

  while (unvisited.size > 0) {
    // Select unvisited node with the smallest accumulated cost
    let u = null;
    for (const id of unvisited) {
      if (u === null || costs[id] < costs[u]) u = id;
    }
    if (costs[u] === Infinity) break; // remaining nodes are unreachable

    unvisited.delete(u);
    visited.add(u);

    // Relax edges to unvisited neighbours
    for (const { neighbor, cost } of ADJACENCY[u]) {
      if (visited.has(neighbor)) continue;
      const alt = costs[u] + cost;
      if (alt < costs[neighbor]) {
        costs[neighbor] = alt;
        prev[neighbor]  = u;
      }
    }
  }
  return { costs, prev };
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs the full path from source to `dst` by walking the `prev` map
 * backwards from destination to source, then reversing.
 *
 * @param {Object.<string,string|null>} prev - Predecessor map from {@link dijkstra}.
 * @param {string} dst - Destination router ID.
 * @returns {string[]} Ordered path from source to destination.
 *
 * @example
 * buildPath(prev, 'R5'); // → ['R1', 'R2', 'R3', 'R5']
 */
function buildPath(prev, dst) {
  const path = [];
  let cur = dst;
  while (cur !== null) { path.unshift(cur); cur = prev[cur]; }
  return path;
}

/**
 * Builds the SPF-derived routing table for a single router by running
 * {@link dijkstra} and extracting the first-hop next hop for each destination.
 *
 * @param {string} srcRouter - Router ID for which to build the table.
 * @returns {OspfTable} Routing table mapping subnet → route entry.
 */
function buildRoutingTable(srcRouter) {
  const { costs, prev } = dijkstra(srcRouter);
  const table = {};

  for (const id of ROUTER_IDS) {
    const subnet = ROUTERS[id].subnet;
    if (id === srcRouter) {
      table[subnet] = { network: subnet, nextHop: 'Direct', cost: 0, via: srcRouter };
      continue;
    }
    if (costs[id] === Infinity) continue;

    // The first hop is the second element of the reconstructed path
    const path    = buildPath(prev, id);
    const nextHop = path.length > 1 ? path[1] : id;
    table[subnet] = { network: subnet, nextHop, cost: costs[id], via: nextHop };
  }
  return table;
}

/**
 * Builds SPF-derived routing tables for all routers in the topology.
 *
 * @returns {AllOspfTables} All routing tables keyed by router ID.
 */
function buildAllTables() {
  const tables = {};
  for (const id of ROUTER_IDS) tables[id] = buildRoutingTable(id);
  return tables;
}

/**
 * Constructs the Link State Database (LSDB) from the static topology.
 *
 * In a real network each router independently originates its own Type 1
 * Router-LSA. Here the LSDB is derived directly from the adjacency map
 * to keep the simulation deterministic.
 *
 * @returns {Lsdb} Complete LSDB keyed by originating router ID.
 */
function buildLSDB() {
  const lsdb = {};
  for (const id of ROUTER_IDS) {
    lsdb[id] = {
      routerId: id,
      subnet:   ROUTERS[id].subnet,
      links:    ADJACENCY[id].map(({ neighbor, cost, link }) => ({
        neighbor, cost, bandwidth: link.bandwidth, linkId: link.id,
      })),
    };
  }
  return lsdb;
}

/**
 * Finds the {@link Link} object connecting two routers, regardless of direction.
 *
 * @param {string} a - Router ID.
 * @param {string} b - Router ID.
 * @returns {Link|undefined} Matching link or undefined.
 */
function findLink(a, b) {
  return LINKS.find(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

/**
 * Runs Dijkstra's algorithm recording a detailed trace of every iteration.
 * Used to generate the step-by-step SPF simulation steps in Phase 4.
 *
 * @param {string} srcRouter - SPF root router ID.
 * @returns {DijkstraTraceStep[]} One entry per Dijkstra iteration.
 */
function dijkstraTrace(srcRouter) {
  const costs   = {};
  const prev    = {};
  const visited = new Set();
  const trace   = [];

  for (const id of ROUTER_IDS) { costs[id] = Infinity; prev[id] = null; }
  costs[srcRouter] = 0;

  const unvisited = new Set(ROUTER_IDS);

  while (unvisited.size > 0) {
    let u = null;
    for (const id of unvisited) {
      if (u === null || costs[id] < costs[u]) u = id;
    }
    if (costs[u] === Infinity) break;

    unvisited.delete(u);
    visited.add(u);

    const explorations = [];
    for (const { neighbor, cost } of ADJACENCY[u]) {
      if (visited.has(neighbor)) continue;
      const alt      = costs[u] + cost;
      const improved = alt < costs[neighbor];
      explorations.push({
        neighbor, via: u, linkCost: cost,
        newCost: alt, oldCost: costs[neighbor], improved,
      });
      if (improved) {
        costs[neighbor] = alt;
        prev[neighbor]  = u;
      }
    }

    trace.push({
      visitedNode:   u,
      nodeCost:      costs[u],
      explorations,
      costsSnapshot: { ...costs },
      prevSnapshot:  { ...prev  },
    });
  }
  return trace;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the complete ordered array of simulation steps for an OSPF run
 * between two hosts.
 *
 * The step sequence covers:
 *   - OSPF Phase 1: Hello → adjacency discovery
 *   - OSPF Phase 2: DBD + LSR → database synchronisation
 *   - OSPF Phase 3: LSU + LSAck per router → LSA flooding
 *   - OSPF Phase 4: SPF initialisation + one step per Dijkstra iteration
 *   - Forwarding: route decision + hop-by-hop + delivery
 *
 * The returned `steps` array is consumed directly by {@link useSimulation}.
 *
 * @param {string}   srcHostId - ID of the source host (e.g. 'H1A').
 * @param {string}   dstHostId - ID of the destination host (e.g. 'H5B').
 * @param {Object}   topology  - Topology module (passed in to allow mocking in tests).
 * @param {Object.<string, Host>} topology.HOSTS - All host definitions.
 * @returns {{ steps: SimStep[], finalTables: AllOspfTables, lsdb: Lsdb, path: string[] }}
 *
 * @example
 * const { steps, path } = generateOspfSteps('H1A', 'H5B', topology);
 * path; // → ['R1', 'R2', 'R3', 'R5']  (avoids the slow satellite link)
 */
export function generateOspfSteps(srcHostId, dstHostId, topology) {
  const { HOSTS } = topology;
  const srcHost  = HOSTS[srcHostId];
  const dstHost  = HOSTS[dstHostId];
  const srcRouter = srcHost.parent;
  const dstRouter = dstHost.parent;

  const steps      = [];
  const lsdb       = buildLSDB();
  const finalTables = buildAllTables();

  // ── PHASE 1: CONVERGENCE ──────────────────────────────────────────────────

  // Initial tables — only directly connected subnets known
  const initTables = {};
  for (const id of ROUTER_IDS) {
    initTables[id] = {
      [ROUTERS[id].subnet]: { network: ROUTERS[id].subnet, nextHop: 'Direct', cost: 0 },
    };
  }

  steps.push({
    id: 'ospf_init',
    phase: 'convergence',
    ospfPhase: 1,
    subtype: 'init',
    title: 'Initial State',
    description: 'Routers start — they know only their own directly connected networks.',
    teachingNote:
      'OSPF (Open Shortest Path First) is a Link-State routing protocol. Unlike RIP (Distance Vector), each OSPF router builds a complete map of the entire network topology — the Link State Database (LSDB). From this map, each router independently runs Dijkstra\'s SPF algorithm to compute the shortest path.',
    packetType: null,
    animatedPackets: [],
    highlightLinks: [],
    highlightNodes: ROUTER_IDS,
    tables: initTables,
    lsdb: {},
    calculation: null,
  });

  // Phase 1 — Hello packets on every link (bidirectional)
  const helloPackets = [];
  for (const link of LINKS) {
    helloPackets.push({ from: link.from, to: link.to, type: 'HELLO', label: 'Hello' });
    helloPackets.push({ from: link.to, to: link.from, type: 'HELLO', label: 'Hello' });
  }

  steps.push({
    id: 'ospf_hello',
    phase: 'convergence',
    ospfPhase: 1,
    subtype: 'hello',
    title: 'Phase 1 — Hello Packets',
    description: 'Routers multicast Hello packets on every interface to discover neighbours.',
    teachingNote:
      'OSPF Hello packets (sent to 224.0.0.5 — AllSPFRouters multicast) establish and maintain neighbour relationships. They contain: Router ID, Hello/Dead intervals, Area ID, and DR/BDR information. Routers must agree on Hello/Dead timers to form an adjacency. Hellos are sent every 10 seconds on point-to-point links.',
    packetType: 'HELLO',
    packetLabel: 'Hello',
    animatedPackets: helloPackets,
    highlightLinks: LINKS.map(l => l.id),
    highlightNodes: ROUTER_IDS,
    tables: initTables,
    lsdb: {},
    calculation: 'Hello interval: 10 seconds\nDead interval: 40 seconds\nMulticast: 224.0.0.5',
  });

  // Phase 2 — DBD exchange
  const dbdPackets = [];
  for (const link of LINKS) {
    dbdPackets.push({ from: link.from, to: link.to, type: 'DBD', label: 'DBD' });
    dbdPackets.push({ from: link.to, to: link.from, type: 'DBD', label: 'DBD' });
  }

  steps.push({
    id: 'ospf_dbd',
    phase: 'convergence',
    ospfPhase: 2,
    subtype: 'dbd',
    title: 'Phase 2 — Database Description (DBD)',
    description: 'Neighbours exchange DBD packets listing their LSDB contents (LSA headers only).',
    teachingNote:
      'After forming adjacency, routers exchange Database Description (DBD) packets — a summary of their LSDB using LSA headers (Router ID, LSA type, sequence number). This lets each router determine which LSAs it is missing. The router with the higher Router ID becomes the Master and sends first. This is much more efficient than sending full tables.',
    packetType: 'DBD',
    packetLabel: 'DBD',
    animatedPackets: dbdPackets,
    highlightLinks: LINKS.map(l => l.id),
    highlightNodes: ROUTER_IDS,
    tables: initTables,
    lsdb: {},
    calculation: 'DBD contains: LSA headers (type, link-state ID, advertising router, sequence number)',
  });

  // Phase 2 — LSR
  const lsrPackets = [];
  for (const link of LINKS) {
    lsrPackets.push({ from: link.from, to: link.to, type: 'LSR', label: 'LSR' });
    lsrPackets.push({ from: link.to, to: link.from, type: 'LSR', label: 'LSR' });
  }

  steps.push({
    id: 'ospf_lsr',
    phase: 'convergence',
    ospfPhase: 2,
    subtype: 'lsr',
    title: 'Phase 2 — Link State Request (LSR)',
    description: 'Routers request the full LSAs they are missing from their neighbours.',
    teachingNote:
      'After comparing DBDs, each router sends a Link State Request (LSR) asking for the complete LSA data it is missing. This targeted approach means only missing information is transmitted — unlike RIP\'s full periodic table dumps. This makes OSPF far more bandwidth-efficient in stable networks.',
    packetType: 'LSR',
    packetLabel: 'LSR',
    animatedPackets: lsrPackets,
    highlightLinks: LINKS.map(l => l.id),
    highlightNodes: ROUTER_IDS,
    tables: initTables,
    lsdb: {},
    calculation: 'LSR specifies: LSA type + Link-State ID + Advertising Router',
  });

  // Phase 3 — LSA flooding: one LSU + LSAck pair per router
  const partialLsdb = {};
  for (const routerId of ROUTER_IDS) {
    const lsa = lsdb[routerId];

    // LSU — flood this router's LSA to all adjacent neighbours
    const floodPackets = ADJACENCY[routerId].map(a => ({
      from: routerId, to: a.neighbor, type: 'LSU', label: 'LSU',
    }));

    partialLsdb[routerId] = lsa;
    const linkDesc = lsa.links.map(l => `${l.neighbor} (cost ${l.cost}, ${l.bandwidth})`).join(', ');

    steps.push({
      id: `ospf_lsu_${routerId}`,
      phase: 'convergence',
      ospfPhase: 3,
      subtype: 'lsu',
      title: `Phase 3 — LSA Flood from ${routerId}`,
      description: `${routerId} floods its Type 1 Router-LSA: connected to ${linkDesc}`,
      teachingNote:
        `${routerId} generates a Router-LSA describing all its links and their costs. This LSA is flooded across the entire OSPF area. Each receiving router re-floods it out all other interfaces (reliable flooding). Every router will eventually receive every other router's LSA — building a complete topology map.`,
      packetType: 'LSU',
      packetLabel: 'LSU',
      animatedPackets: floodPackets,
      highlightLinks: ADJACENCY[routerId].map(a => a.link.id),
      highlightNodes: [routerId, ...ADJACENCY[routerId].map(a => a.neighbor)],
      tables: initTables,
      lsdb: { ...partialLsdb },
      calculation: `LSA from ${routerId}:\n  Router ID: ${routerId}\n  Subnet: ${lsa.subnet}\n  Links:\n${lsa.links.map(l => `    → ${l.neighbor}: cost ${l.cost} (${l.bandwidth})`).join('\n')}`,
    });

    // LSAck — neighbours acknowledge receipt
    const ackPackets = ADJACENCY[routerId].map(({ neighbor }) => ({
      from: neighbor, to: routerId, type: 'LSACK', label: 'LSAck',
    }));

    steps.push({
      id: `ospf_lsack_${routerId}`,
      phase: 'convergence',
      ospfPhase: 3,
      subtype: 'lsack',
      title: `LSAck for ${routerId}'s LSA`,
      description: `Neighbours acknowledge receipt of ${routerId}'s LSA.`,
      teachingNote:
        'OSPF uses reliable flooding — every LSU must be explicitly acknowledged with an LSAck. This guarantees every router receives every LSA. Without reliable flooding, a dropped LSA could leave routers with inconsistent views of the topology, causing routing loops.',
      packetType: 'LSACK',
      packetLabel: 'LSAck',
      animatedPackets: ackPackets,
      highlightLinks: ADJACENCY[routerId].map(a => a.link.id),
      highlightNodes: [routerId, ...ADJACENCY[routerId].map(a => a.neighbor)],
      tables: initTables,
      lsdb: { ...partialLsdb },
      calculation: null,
    });
  }

  // LSDB synchronisation complete
  steps.push({
    id: 'ospf_lsdb_complete',
    phase: 'convergence',
    ospfPhase: 3,
    subtype: 'lsdb_complete',
    title: 'LSDB Complete — All Routers Synchronised',
    description: 'Every router now holds an identical copy of the Link State Database.',
    teachingNote:
      'All five routers now share the same LSDB — a complete directed graph of the network with costs. This is the key advantage of OSPF: every router has the full picture before computing routes. RIP routers only know what their neighbours told them. Now each router independently runs Dijkstra\'s SPF algorithm.',
    packetType: null,
    animatedPackets: [],
    highlightLinks: [],
    highlightNodes: ROUTER_IDS,
    tables: initTables,
    lsdb: { ...lsdb },
    calculation: `Complete topology known:\n${LINKS.map(l => `  ${l.from} ↔ ${l.to}: cost ${l.ospfCost} (${l.bandwidth})`).join('\n')}`,
  });

  // ── PHASE 4: SPF CALCULATION (DIJKSTRA) ──────────────────────────────────

  const spfTrace = dijkstraTrace(srcRouter);

  steps.push({
    id: 'ospf_spf_start',
    phase: 'convergence',
    ospfPhase: 4,
    subtype: 'spf_start',
    title: `Phase 4 — SPF Calculation at ${srcRouter}`,
    description: `${srcRouter} runs Dijkstra's Shortest Path First algorithm on its LSDB.`,
    teachingNote:
      `Dijkstra's algorithm finds the shortest path from ${srcRouter} to all other routers. It maintains a "tentative" cost table, repeatedly picking the unvisited node with the lowest cost and relaxing its neighbours. This guarantees the optimal (lowest-cost) path to every destination. Time complexity: O((V+E) log V).`,
    packetType: null,
    animatedPackets: [],
    highlightLinks: [],
    highlightNodes: [srcRouter],
    tables: initTables,
    lsdb: { ...lsdb },
    calculation: `Initialise:\n  ${srcRouter}: cost 0\n  All others: cost ∞\n  Unvisited: {${ROUTER_IDS.join(', ')}}`,
    spfStep: {
      visited: [],
      costs: Object.fromEntries(ROUTER_IDS.map(id => [id, id === srcRouter ? 0 : Infinity])),
      prev: {},
    },
  });

  // One simulation step per Dijkstra iteration
  for (let i = 0; i < spfTrace.length; i++) {
    const t = spfTrace[i];

    const explorationLines = t.explorations.map(e =>
      `  Check ${e.neighbor}: ${e.oldCost === Infinity ? '∞' : e.oldCost} vs (${t.nodeCost} + ${e.linkCost}) = ${e.newCost}${e.improved ? ' ← UPDATE' : ' (no improvement)'}`
    ).join('\n');

    const costsDisplay = ROUTER_IDS.map(id => {
      const c = t.costsSnapshot[id];
      const p = t.prevSnapshot[id];
      return `  ${id}: ${c === Infinity ? '∞' : c}${p ? ` via ${p}` : ''}`;
    }).join('\n');

    steps.push({
      id: `ospf_spf_${i}`,
      phase: 'convergence',
      ospfPhase: 4,
      subtype: 'spf_step',
      title: `SPF Step ${i + 1}: Visit ${t.visitedNode} (cost ${t.nodeCost})`,
      description: `Visit ${t.visitedNode} (lowest unvisited cost = ${t.nodeCost}). Relax ${t.explorations.length} neighbour(s).`,
      teachingNote:
        `Dijkstra picks the unvisited node with the LOWEST accumulated cost (${t.visitedNode}, cost ${t.nodeCost}). It then checks if going through ${t.visitedNode} would give a shorter path to any of its unvisited neighbours. If yes, the neighbour's cost is updated ("relaxed"). ${t.explorations.some(e => e.improved) ? `Cost improved for: ${t.explorations.filter(e => e.improved).map(e => e.neighbor).join(', ')}.` : 'No costs improved this step.'}`,
      packetType: null,
      animatedPackets: [],
      highlightLinks: t.explorations
        .map(e => { const l = findLink(t.visitedNode, e.neighbor); return l ? l.id : null; })
        .filter(Boolean),
      highlightNodes: [t.visitedNode, ...t.explorations.filter(e => e.improved).map(e => e.neighbor)],
      tables: initTables,
      lsdb: { ...lsdb },
      calculation: `Visit: ${t.visitedNode} (cost ${t.nodeCost})\nExamine neighbours:\n${explorationLines}\n\nCurrent cost table:\n${costsDisplay}`,
      spfStep: {
        visitedNode: t.visitedNode,
        visited:     spfTrace.slice(0, i + 1).map(s => s.visitedNode),
        costs:       t.costsSnapshot,
        prev:        t.prevSnapshot,
        explorations: t.explorations,
      },
    });
  }

  // SPF complete — populate routing tables from SPF tree
  const { costs, prev } = dijkstra(srcRouter);
  const allTables       = buildAllTables();
  const pathToDestTrace = buildPath(prev, dstRouter);
  const pathCost        = costs[dstRouter];

  steps.push({
    id: 'ospf_spf_done',
    phase: 'convergence',
    ospfPhase: 4,
    subtype: 'spf_done',
    title: '✓ SPF Complete — Routing Table Built',
    description: `Optimal path to ${dstRouter}: ${pathToDestTrace.join(' → ')} (cost ${pathCost})`,
    teachingNote:
      `Dijkstra's algorithm complete. ${srcRouter} now has the optimal (lowest-cost) path to every router. The routing table is populated from the SPF tree. Crucially, OSPF correctly avoids the 512 Kbps satellite link (R1↔R3, cost 195) in favour of fast 10 Mbps links (cost 10 each). RIP would have taken the satellite link because it only counts hops.`,
    packetType: null,
    animatedPackets: [],
    highlightLinks: [],
    highlightNodes: ROUTER_IDS,
    tables: allTables,
    lsdb: { ...lsdb },
    calculation: `SPF result from ${srcRouter}:\n${ROUTER_IDS.filter(id => id !== srcRouter).map(id => {
      const p = buildPath(dijkstra(srcRouter).prev, id);
      return `  → ${id}: ${costs[id] === Infinity ? '∞' : costs[id]} cost, path: ${p.join('→')}`;
    }).join('\n')}`,
    spfComplete: true,
  });

  steps.push({
    id: 'ospf_converged',
    phase: 'convergence',
    ospfPhase: 4,
    subtype: 'converged',
    title: '✓ OSPF Converged',
    description: 'All routers have complete, cost-optimal routing tables. OSPF convergence is complete.',
    teachingNote:
      'OSPF convergence is fast: typically under 1 second for the full process (neighbour discovery can take 10–40 seconds on initial startup, but subsequent topology changes trigger immediate LSA flooding). Compare this to RIP\'s 30-second periodic updates which can take minutes to converge after a link failure.',
    packetType: null,
    animatedPackets: [],
    highlightLinks: [],
    highlightNodes: ROUTER_IDS,
    tables: allTables,
    lsdb: { ...lsdb },
    calculation: `Convergence time:\n  Hello/Dead: ~40 seconds (initial)\n  Post-failure: < 1 second (triggered updates)\n  RIP comparison: 30s–5min (periodic)`,
  });

  // ── PHASE 2: FORWARDING ───────────────────────────────────────────────────

  const path    = buildPath(prev, dstRouter);
  const pathStr = path.join(' → ');

  steps.push({
    id: 'ospf_fwd_start',
    phase: 'forwarding',
    subtype: 'route_decision',
    title: 'Route Selected by OSPF',
    description: `OSPF chose: ${pathStr} (total cost ${pathCost})`,
    teachingNote:
      `OSPF selected the lowest-COST path: ${pathStr} with total cost ${pathCost}. Notice it uses only 10 Mbps links (cost 10 each). It avoids the R1↔R3 satellite link (cost 195). Compare to RIP: RIP would choose R1→R3→R5 (only 2 hops!) but that goes through the slow 512 Kbps link. OSPF's cost metric is bandwidth-aware, so it always finds the truly fastest path.`,
    packetType: 'DATA',
    packetLabel: srcHost.ip,
    animatedPackets: [],
    highlightLinks: [],
    highlightNodes: path,
    tables: allTables,
    lsdb: { ...lsdb },
    calculation: `OSPF path: ${pathStr}\nTotal cost: ${pathCost}\n\nOSPF cost = 10^8 / bandwidth_bps\n  10 Mbps → cost 10\n  512 Kbps → cost 195\n\nRIP alternative: R1→R3→R5 (2 hops, cost 205) ← AVOIDED`,
    ospfPath: path,
  });

  // One step per hop along the SPF-derived forwarding path
  const dstSubnet = ROUTERS[dstRouter].subnet;
  for (let i = 0; i < path.length - 1; i++) {
    const fromR  = path[i];
    const toR    = path[i + 1];
    const link   = findLink(fromR, toR);
    const isLast = i === path.length - 2;
    const entry  = allTables[fromR][dstSubnet];

    steps.push({
      id: `ospf_hop_${i}`,
      phase: 'forwarding',
      subtype: 'hop',
      hopIndex: i,
      hopCount: path.length - 1,
      title: `Hop ${i + 1}/${path.length - 1}: ${fromR} → ${toR}`,
      description: `${fromR} looks up ${dstSubnet} → next hop: ${toR} (cost ${entry ? entry.cost : '?'})`,
      teachingNote: isLast
        ? `Packet arrives at ${toR}. Delivered to ${dstHost.ip} on the ${ROUTERS[toR].subnet} LAN. OSPF chose this path using Dijkstra's algorithm — every link was selected for its bandwidth capacity, not just hop count.`
        : `${fromR} consults its SPF-built routing table. The entry for ${dstSubnet} shows next hop: ${toR}, cost: ${entry ? entry.cost : '?'}. This cost was computed by Dijkstra — it represents the minimum-cost path from ${fromR} to the destination. Link bandwidth: ${link ? link.bandwidth : 'N/A'}.`,
      packetType: 'DATA',
      packetLabel: `${srcHost.ip} → ${dstHost.ip}`,
      animatedPackets: [{ from: fromR, to: toR, type: 'DATA', label: 'DATA' }],
      highlightLinks: link ? [link.id] : [],
      highlightNodes: [fromR, toR],
      tables: allTables,
      lsdb: { ...lsdb },
      calculation: `Table lookup at ${fromR}:\n  Dest: ${dstHost.ip}\n  Match: ${dstSubnet}\n  Next hop: ${toR}\n  OSPF cost: ${entry ? entry.cost : '?'}\n  Link: ${link ? link.bandwidth : 'N/A'} (cost ${link ? link.ospfCost : '?'})`,
      currentRouter: fromR,
      nextRouter:    toR,
      linkId:        link ? link.id : null,
    });
  }

  // Final delivery confirmation
  steps.push({
    id: 'ospf_delivered',
    phase: 'forwarding',
    subtype: 'delivered',
    title: '✓ Packet Delivered',
    description: `Packet delivered to ${dstHost.ip} via OSPF routing.`,
    teachingNote:
      `OSPF successfully delivered the packet via the optimal cost path: ${pathStr}. Every link was a fast 10 Mbps connection. OSPF's cost-based metric (derived from bandwidth) means it always finds the path with the best available bandwidth — making it far superior to RIP for real-world networks with mixed link speeds.`,
    packetType: 'DELIVERED',
    packetLabel: null,
    animatedPackets: [],
    highlightLinks: path.slice(0, -1)
      .map((r, i) => { const l = findLink(r, path[i + 1]); return l ? l.id : null; })
      .filter(Boolean),
    highlightNodes: [dstRouter, dstHostId],
    tables: allTables,
    lsdb: { ...lsdb },
    calculation: `OSPF Summary:\n  Protocol: Link State\n  Metric: Cost (bandwidth-based)\n  Reference BW: 100 Mbps\n  Cost = 10^8 ÷ BW(bps)\n  Algorithm: Dijkstra's SPF\n  Convergence: FAST (<1 sec on changes)`,
    ospfPath: path,
  });

  return { steps, finalTables: allTables, lsdb, path };
}
