/**
 * RIP Simulation Engine
 * Generates a sequence of discrete steps representing:
 *  Phase 1 — Convergence (Bellman-Ford, 30-sec update cycles)
 *  Phase 2 — Forwarding  (hop-by-hop data packet)
 */

import { ROUTERS, LINKS, ADJACENCY } from '../data/topology.js';

const ROUTER_IDS = Object.keys(ROUTERS);

// Build initial routing tables: each router knows only its own subnet
function initialTables() {
  const tables = {};
  for (const id of ROUTER_IDS) {
    tables[id] = {
      [ROUTERS[id].subnet]: { network: ROUTERS[id].subnet, nextHop: 'Direct', metric: 0, via: id, age: 0 },
    };
  }
  return tables;
}

// Deep clone tables
function cloneTables(tables) {
  return JSON.parse(JSON.stringify(tables));
}

// Run one round of Bellman-Ford updates
// Returns { updatedTables, changes: [{router, network, oldMetric, newMetric, via}] }
function bellmanFordRound(tables) {
  const next = cloneTables(tables);
  const changes = [];

  for (const routerId of ROUTER_IDS) {
    for (const { neighbor } of ADJACENCY[routerId]) {
      // Router receives the neighbor's table
      const neighborTable = tables[neighbor];
      for (const [network, entry] of Object.entries(neighborTable)) {
        const newMetric = entry.metric + 1; // RIP: hop count + 1
        if (newMetric >= 16) continue; // 16 = infinity
        const existing = next[routerId][network];
        if (!existing || newMetric < existing.metric) {
          const old = existing ? existing.metric : '∞';
          changes.push({
            router: routerId, network, oldMetric: old,
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

// Find shortest hop-count path from srcRouter to dstRouter
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

// Find the link object between two routers
function findLink(a, b) {
  return LINKS.find(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

// ─────────────────────────────────────────────
// Main export: generate all simulation steps
// ─────────────────────────────────────────────
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

  // Simulate up to 4 rounds of updates
  for (let round = 1; round <= 4; round++) {
    // SEND phase: show RIP_RESPONSE packets on all links
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

    // RECEIVE phase: update tables
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

    // Check convergence
    const converged = changes.length === 0;
    if (converged) {
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

  // Show the chosen path and warn about the slow link
  const hasSlowLink = path.some((r, i) => {
    if (i === path.length - 1) return false;
    const link = findLink(r, path[i + 1]);
    return link && link.isSlow;
  });

  const pathStr = path.join(' → ');
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

  // Hop-by-hop forwarding steps
  for (let i = 0; i < path.length - 1; i++) {
    const fromR = path[i];
    const toR = path[i + 1];
    const link = findLink(fromR, toR);
    const isLast = i === path.length - 2;
    const entry = tables[fromR][dstSubnet];

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

  // Delivered
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
