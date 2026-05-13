/**
 * @fileoverview RIP Simulation Engine.
 *
 * Generates an ordered array of discrete simulation steps representing the
 * full RIP lifecycle for a given source/destination pair:
 *
 *   Phase 1 — Convergence
 *     - Initialisation: each router knows only its own subnet
 *     - Up to four Bellman-Ford update rounds (send + receive per round)
 *     - Convergence detection: stops early when no routes change
 *
 *   Phase 2 — Forwarding
 *     - Route decision: shows the path RIP selected (may traverse slow link)
 *     - Hop-by-hop: one step per router along the chosen path
 *     - Delivery confirmation
 *
 * Teaching note — the key RIP weakness illustrated here:
 *   RIP selects R1 → R3 → R5 (2 hops) even though the R1–R3 link is only
 *   512 Kbps. OSPF correctly avoids this by using cost-based routing.
 */

import { ROUTERS, LINKS, ADJACENCY } from '../data/topology.js';

/** @type {string[]} Ordered list of all router IDs in the topology. */
const ROUTER_IDS = Object.keys(ROUTERS);

/**
 * @typedef {Object} RipTableEntry
 * @property {string} network  - CIDR network address (e.g. '10.1.0.0/24')
 * @property {string} nextHop  - Next-hop router ID, or 'Direct' for connected networks
 * @property {number} metric   - Hop count to reach this network
 * @property {string} via      - Router ID this route was learned from
 * @property {number} age      - Seconds since last update (simulated as 0)
 */

/**
 * @typedef {Object.<string, RipTableEntry>} RipTable
 * A single router's routing table, keyed by network CIDR string.
 */

/**
 * @typedef {Object.<string, RipTable>} AllRipTables
 * Routing tables for all routers, keyed by router ID.
 */

/**
 * @typedef {Object} RouteChange
 * @property {string}        router     - Router ID whose table was updated
 * @property {string}        network    - Network CIDR that changed
 * @property {number|string} oldMetric  - Previous hop count, or '∞' if newly learned
 * @property {number}        newMetric  - Updated hop count
 * @property {string}        via        - Neighbour from whom the better route was learned
 */

/**
 * @typedef {Object} AnimatedPacket
 * @property {string} from  - Source node ID
 * @property {string} to    - Destination node ID
 * @property {string} type  - Packet type key (e.g. 'RIP_RESPONSE', 'DATA')
 * @property {string} label - Short display label shown on the animated bubble
 */

/**
 * @typedef {Object} SimStep
 * @property {string}           id               - Unique step identifier
 * @property {'convergence'|'forwarding'} phase  - Simulation phase
 * @property {number}           [round]          - Bellman-Ford round number (convergence only)
 * @property {string}           subtype          - Event sub-type (e.g. 'init', 'send', 'hop')
 * @property {string}           title            - Short heading for the Teaching Panel
 * @property {string}           description      - One-line summary for the Trace Table
 * @property {string}           teachingNote     - Detailed educational explanation
 * @property {string|null}      packetType       - Packet type shown in the Teaching Panel badge
 * @property {string|null}      packetLabel      - Short packet label
 * @property {AnimatedPacket[]} animatedPackets  - Packets to animate this step
 * @property {string[]}         highlightLinks   - Link IDs to highlight on the SVG map
 * @property {string[]}         highlightNodes   - Node IDs to highlight on the SVG map
 * @property {AllRipTables}     tables           - Snapshot of all routing tables at this step
 * @property {string|null}      calculation      - Bellman-Ford formula / worked calculation
 * @property {number}           convergenceRound - Which update round this step belongs to
 * @property {RouteChange[]}    [tableChanges]   - Changes applied during a receive step
 * @property {string[]}         [ripPath]        - Chosen forwarding path (forwarding steps only)
 * @property {boolean}          [hasSlowLink]    - True if the chosen path traverses the satellite link
 * @property {string}           [currentRouter]  - Router currently forwarding (hop steps)
 * @property {string}           [nextRouter]     - Next router on the path (hop steps)
 * @property {string|null}      [linkId]         - Link ID traversed this hop
 */

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the initial routing tables for all routers.
 * At startup each router knows only its directly connected subnet at metric 0.
 *
 * @returns {AllRipTables} Initial routing tables.
 */
function initialTables() {
  const tables = {};
  for (const id of ROUTER_IDS) {
    tables[id] = {
      [ROUTERS[id].subnet]: {
        network: ROUTERS[id].subnet, nextHop: 'Direct', metric: 0, via: id, age: 0,
      },
    };
  }
  return tables;
}

/**
 * Deep-clones a routing tables snapshot so that each simulation step
 * stores an independent copy rather than a reference to shared state.
 *
 * @param {AllRipTables} tables - Tables to clone.
 * @returns {AllRipTables} A deep copy.
 */
function cloneTables(tables) {
  return JSON.parse(JSON.stringify(tables));
}

/**
 * Executes one round of the distributed Bellman-Ford algorithm.
 *
 * Each router examines every entry in each neighbour's table. If a
 * neighbour knows a route at metric N, the local router can reach that
 * network at metric N+1 (one additional hop). If this is better than the
 * current best-known metric, the table is updated.
 *
 * Metric 16 is treated as infinity (unreachable) per RFC 2453.
 *
 * Bellman-Ford equation:
 *   D(x, y) = min over all neighbours n [ 1 + D(n, y) ]
 *
 * @param {AllRipTables} tables - Current routing tables (read-only).
 * @returns {{ updatedTables: AllRipTables, changes: RouteChange[] }}
 *   The new tables and a list of every entry that changed this round.
 */
function bellmanFordRound(tables) {
  const next = cloneTables(tables);
  const changes = [];

  for (const routerId of ROUTER_IDS) {
    for (const { neighbor } of ADJACENCY[routerId]) {
      const neighborTable = tables[neighbor];
      for (const [network, entry] of Object.entries(neighborTable)) {
        const newMetric = entry.metric + 1;
        if (newMetric >= 16) continue; // 16 = infinity in RIP

        const existing = next[routerId][network];
        if (!existing || newMetric < existing.metric) {
          changes.push({
            router: routerId, network,
            oldMetric: existing ? existing.metric : '∞',
            newMetric, via: neighbor,
          });
          next[routerId][network] = {
            network, nextHop: neighbor, metric: newMetric, via: neighbor, age: 0,
          };
        }
      }
    }
  }
  return { updatedTables: next, changes };
}

/**
 * Traces the forwarding path from `srcRouter` to `dstRouter` by following
 * next-hop entries in the converged routing tables.
 *
 * A visited-set prevents infinite loops in misconfigured tables.
 * If the destination is not reachable the function appends it directly
 * as a fallback so that the forwarding animation always has a valid path.
 *
 * @param {AllRipTables} tables    - Converged routing tables.
 * @param {string}       srcRouter - Starting router ID.
 * @param {string}       dstRouter - Destination router ID.
 * @returns {string[]} Ordered list of router IDs from source to destination.
 */
function ripPath(tables, srcRouter, dstRouter) {
  const dstSubnet = ROUTERS[dstRouter].subnet;
  const path = [srcRouter];
  let current = srcRouter;
  const visited = new Set([srcRouter]);

  for (let i = 0; i < 20; i++) {
    if (current === dstRouter) break;
    const entry = tables[current][dstSubnet];
    if (!entry || entry.nextHop === 'Direct') break;
    const next = entry.nextHop;
    if (visited.has(next)) break;
    visited.add(next);
    path.push(next);
    current = next;
  }
  if (current !== dstRouter) path.push(dstRouter);
  return path;
}

/**
 * Finds the {@link Link} object connecting two routers, regardless of direction.
 *
 * @param {string} a - Router ID.
 * @param {string} b - Router ID.
 * @returns {Link|undefined} The matching link, or undefined if not found.
 */
function findLink(a, b) {
  return LINKS.find(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the complete ordered array of simulation steps for a RIP run
 * between two hosts.
 *
 * The returned `steps` array is consumed directly by {@link useSimulation}.
 * `finalTables` and `path` are provided for potential external use but are
 * not required by the simulator itself.
 *
 * @param {string}   srcHostId - ID of the source host (e.g. 'H1A').
 * @param {string}   dstHostId - ID of the destination host (e.g. 'H5B').
 * @param {Object}   topology  - The topology module (passed in to allow testing with mocks).
 * @param {Object.<string, Host>} topology.HOSTS - All host definitions.
 * @returns {{ steps: SimStep[], finalTables: AllRipTables, path: string[] }}
 *
 * @example
 * const { steps } = generateRipSteps('H1A', 'H5B', topology);
 * // steps[0].title === 'Initial State'
 * // steps contains both convergence and forwarding phases
 */
export function generateRipSteps(srcHostId, dstHostId, topology) {
  const { HOSTS } = topology;
  const srcHost = HOSTS[srcHostId];
  const dstHost = HOSTS[dstHostId];
  const srcRouter = srcHost.parent;
  const dstRouter = dstHost.parent;

  const steps = [];
  let tables = initialTables();

  // ── PHASE 1: CONVERGENCE ──────────────────────────────────────────────────

  steps.push({
    id: 's0',
    phase: 'convergence',
    round: 0,
    subtype: 'init',
    title: 'Initial State',
    description: 'Each router knows only its own directly connected network.',
    teachingNote:
      'When a router first starts, its routing table contains only the networks directly attached to its own interfaces. It knows nothing about remote networks yet.',
    packetType: null,
    packetLabel: null,
    animatedPackets: [],
    highlightLinks: [],
    highlightNodes: ROUTER_IDS,
    tables: cloneTables(tables),
    calculation: null,
    advantage: null,
    convergenceRound: 0,
  });

  // Simulate up to 4 Bellman-Ford rounds
  for (let round = 1; round <= 4; round++) {
    // SEND phase — RIP Response packets travel on every link simultaneously
    const sendPackets = [];
    for (const link of LINKS) {
      sendPackets.push({ from: link.from, to: link.to, type: 'RIP_RESPONSE', label: 'RIP Update' });
      sendPackets.push({ from: link.to, to: link.from, type: 'RIP_RESPONSE', label: 'RIP Update' });
    }

    steps.push({
      id: `s_r${round}_send`,
      phase: 'convergence',
      round,
      subtype: 'send',
      title: `Round ${round} — Send Updates`,
      description: `Every router broadcasts its routing table to all neighbours (every 30 seconds).`,
      teachingNote:
        round === 1
          ? 'RIP uses UDP port 520. Every 30 seconds, each router sends its entire routing table to all directly connected neighbours. This is called a "full table update" — even unchanged entries are re-sent. This is bandwidth-inefficient for large networks.'
          : `Round ${round}: Routers share what they've learned so far. Each hop further from the origin adds 1 to the metric. Bellman-Ford equation: D(x,y) = min_n[ 1 + D(n,y) ] where n is each neighbour.`,
      packetType: 'RIP_RESPONSE',
      packetLabel: 'RIP Response',
      animatedPackets: sendPackets,
      highlightLinks: LINKS.map(l => l.id),
      highlightNodes: ROUTER_IDS,
      tables: cloneTables(tables),
      calculation: `Bellman-Ford: metric_to_X = min over all neighbours n of ( 1 + n's metric_to_X )`,
      convergenceRound: round,
    });

    // RECEIVE phase — apply Bellman-Ford and record what changed
    const { updatedTables, changes } = bellmanFordRound(tables);
    tables = updatedTables;

    const changeDesc = changes.length > 0
      ? changes.map(c => `${c.router}: ${c.network} via ${c.via} = ${c.newMetric} hop${c.newMetric !== 1 ? 's' : ''}`).join(' | ')
      : 'No new routes learned — convergence may be complete.';

    steps.push({
      id: `s_r${round}_recv`,
      phase: 'convergence',
      round,
      subtype: 'receive',
      title: `Round ${round} — Update Tables`,
      description: changeDesc || 'No changes this round.',
      teachingNote:
        `Routers apply Bellman-Ford: if a neighbour's route to a network is better (lower hop count) than the current best, update the table. The "better" metric is simply lower hop count — bandwidth is ignored completely. This is RIP's critical weakness.`,
      packetType: 'TABLE_UPDATE',
      packetLabel: 'Table Updated',
      animatedPackets: [],
      highlightLinks: [],
      highlightNodes: changes.map(c => c.router),
      tables: cloneTables(tables),
      calculation: changes.length > 0
        ? `Updated: ${changes.map(c => `${c.router}→${c.network}: ${c.oldMetric}→${c.newMetric} hops via ${c.via}`).join(', ')}`
        : 'No updates — network has converged.',
      convergenceRound: round,
      tableChanges: changes,
    });

    // Early exit once no routes change (convergence detected)
    if (changes.length === 0) {
      steps.push({
        id: `s_converged`,
        phase: 'convergence',
        round,
        subtype: 'converged',
        title: '✓ Network Converged',
        description: 'All routers now have a complete routing table. RIP has converged.',
        teachingNote:
          `RIP convergence is slow — it took ${round} update cycles (${round * 30} seconds simulated). In a real network this could mean minutes of incorrect routing. OSPF converges in seconds using link-state advertisements and triggered updates.`,
        packetType: null,
        packetLabel: null,
        animatedPackets: [],
        highlightLinks: [],
        highlightNodes: ROUTER_IDS,
        tables: cloneTables(tables),
        calculation: `Convergence time ≈ ${round} × 30 sec = ${round * 30} seconds`,
        convergenceRound: round,
      });
      break;
    }
  }

  // ── PHASE 2: FORWARDING ───────────────────────────────────────────────────

  const path = ripPath(tables, srcRouter, dstRouter);
  const dstSubnet = ROUTERS[dstRouter].subnet;

  // Detect whether the chosen path crosses the slow satellite link
  const hasSlowLink = path.some((r, i) => {
    if (i === path.length - 1) return false;
    const link = findLink(r, path[i + 1]);
    return link && link.isSlow;
  });

  const pathStr   = path.join(' → ');
  const totalHops = path.length - 1;

  steps.push({
    id: 'fwd_start',
    phase: 'forwarding',
    subtype: 'route_decision',
    title: 'Route Selected by RIP',
    description: `RIP chose: ${pathStr} (${totalHops} hop${totalHops !== 1 ? 's' : ''})`,
    teachingNote: hasSlowLink
      ? `⚠ WARNING: RIP selected a route through the 512 Kbps satellite link (R1↔R3) because it only counts HOPS, not bandwidth. This path has fewer hops but is actually SLOWER. OSPF would avoid this link by considering the cost (bandwidth). This is RIP's most significant weakness.`
      : `RIP selected the lowest hop-count path. In this case it avoids the slow satellite link — but only by coincidence. RIP has no awareness of link bandwidth.`,
    packetType: 'DATA',
    packetLabel: srcHost.ip,
    animatedPackets: [],
    highlightLinks: [],
    highlightNodes: path,
    tables: cloneTables(tables),
    calculation: `Path: ${pathStr}\nHop count: ${totalHops}\nRIP max: 15 hops (16 = unreachable)`,
    ripPath: path,
    hasSlowLink,
  });

  // One step per hop along the forwarding path
  for (let i = 0; i < path.length - 1; i++) {
    const fromR  = path[i];
    const toR    = path[i + 1];
    const link   = findLink(fromR, toR);
    const isLast = i === path.length - 2;
    const entry  = tables[fromR][dstSubnet];

    steps.push({
      id: `fwd_hop_${i}`,
      phase: 'forwarding',
      subtype: 'hop',
      hopIndex: i,
      hopCount: path.length - 1,
      title: `Hop ${i + 1}/${path.length - 1}: ${fromR} → ${toR}`,
      description: `${fromR} looks up ${dstSubnet} → next hop is ${toR} (metric ${entry ? entry.metric : '?'})${link && link.isSlow ? ' ⚠ SLOW LINK' : ''}`,
      teachingNote: isLast
        ? `Packet arrives at ${toR} (Site B). From here it is delivered to the destination host ${dstHost.ip} on the ${ROUTERS[toR].subnet} LAN.`
        : `${fromR} performs a routing table lookup for destination ${dstHost.ip}. It matches the ${dstSubnet} network entry (metric: ${entry ? entry.metric : '?'} hops, next hop: ${toR}). The packet is forwarded on to ${toR}. ${link && link.isSlow ? '⚠ This is the 512 Kbps satellite link — a bottleneck that RIP cannot detect.' : ''}`,
      packetType: 'DATA',
      packetLabel: `${srcHost.ip} → ${dstHost.ip}`,
      animatedPackets: [{ from: fromR, to: toR, type: 'DATA', label: 'DATA' }],
      highlightLinks: link ? [link.id] : [],
      highlightNodes: [fromR, toR],
      tables: cloneTables(tables),
      calculation: `Table lookup at ${fromR}:\n  Dest: ${dstHost.ip}\n  Match: ${dstSubnet}\n  Next hop: ${toR}\n  Metric: ${entry ? entry.metric : '?'} hops${link ? `\n  Link: ${link.bandwidth}` : ''}`,
      currentRouter: fromR,
      nextRouter: toR,
      linkId: link ? link.id : null,
    });
  }

  // Final delivery confirmation step
  steps.push({
    id: 'fwd_delivered',
    phase: 'forwarding',
    subtype: 'delivered',
    title: '✓ Packet Delivered',
    description: `Packet delivered to ${dstHost.ip} via RIP routing.`,
    teachingNote: `The packet has been delivered. RIP made the routing decision based purely on hop count. The total path was ${pathStr}. ${hasSlowLink ? 'However, performance was limited by the 512 Kbps satellite link — something RIP is blind to.' : 'In this case RIP happened to choose a reasonable path, but it cannot guarantee optimal performance.'}`,
    packetType: 'DELIVERED',
    packetLabel: null,
    animatedPackets: [],
    highlightLinks: path.slice(0, -1).map((r, i) => { const l = findLink(r, path[i+1]); return l ? l.id : null; }).filter(Boolean),
    highlightNodes: [dstRouter, dstHostId],
    tables: cloneTables(tables),
    calculation: `RIP Summary:\n  Protocol: Distance Vector\n  Metric: Hop Count\n  Max hops: 15\n  Update interval: 30 seconds\n  Convergence: SLOW`,
    ripPath: path,
  });

  return { steps, finalTables: tables, path };
}
