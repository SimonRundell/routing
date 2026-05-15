# Network Routing Simulator

An interactive, browser-based teaching tool for demonstrating **RIP** (Routing Information Protocol) and **OSPF** (Open Shortest Path First) routing protocols across a simulated LAN/WAN network.

Built with **React + Vite + JavaScript**.

---

## Getting Started

```bash
npm install
npm run dev        # development server → http://localhost:5173
npm run build      # production build  → dist/
```

---

## Using the Simulator

### Controls

| Control | Purpose |
|---|---|
| **RIP / OSPF toggle** | Switch between the two protocols. Resets the simulation. |
| **Source / Destination** | Select any host on the network as packet endpoints. |
| **▶ Play** | Run the full simulation at the selected speed. |
| **⏩ Step Forward / ⏪ Step Back** | Advance or rewind one event at a time (ideal for classroom use). |
| **⏮ Reset** | Return to step 0. |
| **Speed** | Step-by-step (manual), 1×, 2×, 4×. |

### Tabs in the Teaching Panel

| Tab | Contents |
|---|---|
| **📖 Step** | Explanation of the current event, teaching note, and any formula or calculation. |
| **📋 Table** | Live routing table for any router — updates as convergence progresses. |
| **ℹ Protocol** | Packet types, key facts, formulae, advantages and disadvantages. |
| **🗄 LSDB** *(OSPF only)* | The Link State Database as it is built up during LSA flooding. |

### Trace Log

The scrollable event log at the bottom records every step so far with its phase, event type, and description — useful for students to review the sequence of events after a run.

---

## Network Topology

```
        10 Mbps         10 Mbps         10 Mbps         10 Mbps
[R1] ──────────── [R2] ──────────── [R3] ──────────── [R5] ──────────── [R4]
  └──────────────────── 512 Kbps SATELLITE ────────────┘
```

Each router has a LAN with two hosts connected via a switch:

```
LAN-1 (10.1.0.x)   LAN-2 (10.2.0.x)   LAN-3 (10.3.0.x)   LAN-5 (10.5.0.x)   LAN-4 (10.4.0.x)
H1A H1B            H2A H2B            H3A H3B            H5A H5B            H4A H4B
  \ /                \ /                \ /                \ /                \ /
 [SW1]─────────[R1]  [SW2]──────[R2]  [SW3]──────[R3]  [SW5]──────[R5]  [SW4]──────[R4]
```

### Routers

| Router | Subnet | Role |
|--------|--------|------|
| R1 | 10.1.0.0/24 | Site A gateway |
| R2 | 10.2.0.0/24 | Core router 1 |
| R3 | 10.3.0.0/24 | Core router 2 |
| R4 | 10.4.0.0/24 | Distribution router |
| R5 | 10.5.0.0/24 | Site B gateway |

### Links

| Link | Bandwidth | OSPF Cost | RIP Hops |
|------|-----------|-----------|----------|
| R1–R2 | 10 Mbps | 10 | 1 |
| **R1–R3** | **512 Kbps** | **195** | **1** |
| R2–R3 | 10 Mbps | 10 | 1 |
| R3–R5 | 10 Mbps | 10 | 1 |
| R4–R5 | 10 Mbps | 10 | 1 |

### The Key Teaching Scenario

**From LAN-1 (R1) → LAN-5 (R5):**

```
RIP  route:  R1 → R3 → R5          (2 hops — RIP prefers this)
                   ↑
              512 Kbps bottleneck!

OSPF route:  R1 → R2 → R3 → R5    (cost 30 — all 10 Mbps links)
```

RIP sees only hop count. It picks the two-hop path through the slow satellite link because **fewer hops looks better to RIP**. OSPF sees bandwidth-derived costs and correctly avoids the bottleneck. This divergence is the central teaching moment of the simulator.

---

## RIP — Routing Information Protocol

### Overview

RIP is a **Distance Vector** routing protocol. Each router knows only what its neighbours tell it. It does not have a map of the whole network; instead it maintains a table of distances (hop counts) to every known network, learned by exchanging those tables with adjacent routers.

- **RFC 1058** (RIPv1, 1988) — classful, broadcast updates
- **RFC 2453** (RIPv2, 1998) — classless, multicast 224.0.0.9, authentication

### Packet Types

| Packet | Description |
|--------|-------------|
| **Request** | Sent on startup (and optionally on demand) asking neighbours to send their routing tables. |
| **Response** | Contains the router's full routing table. Sent in reply to a Request and as a **periodic unsolicited update every 30 seconds**. |

Both packet types use **UDP port 520**.

### How RIP Converges — Bellman-Ford

RIP implements the distributed **Bellman-Ford** algorithm:

```
D(x, y) = min over all neighbours n [ 1 + D(n, y) ]
```

Where `D(x, y)` is the distance (hop count) from router `x` to network `y`.

**Step by step:**

1. **Initialisation** — Each router's table contains only directly connected networks at metric 0.
2. **Round 1** — Every router sends a RIP Response to all neighbours. Each router updates its table if a neighbour advertises a route at a lower hop count than currently known.
3. **Round 2** — Updated tables propagate one hop further.
4. **Convergence** — After *k* rounds, all routes up to *k* hops away are known. With 5 routers the default scenario converges in 2–3 rounds (60–90 simulated seconds).

**Infinity and the 15-hop limit:**

RIP defines metric 16 as infinity (unreachable). This limits network diameter to **15 hops**, making RIP unsuitable for large networks. It also bounds the count-to-infinity problem (see below).

### Timers

| Timer | Default | Purpose |
|-------|---------|---------|
| Update | 30 s | How often periodic Response messages are sent |
| Invalid | 180 s | Route becomes invalid if not refreshed |
| Hold-down | 180 s | Prevents premature route reinstatement after a failure |
| Flush | 240 s | Route removed from table entirely |

### Split Horizon

To prevent **count-to-infinity**, RIP uses **split horizon**: a route learned from a neighbour is never advertised back to that same neighbour. The stronger variant, **split horizon with poison reverse**, advertises the route back but with metric 16 (infinity), explicitly signalling the route is unreachable via this router.

### Count-to-Infinity Problem

When a link fails, routers can enter a slow convergence loop where each router raises the failing route's metric by 1 each round, incrementally counting up to 16. Split horizon mitigates but does not fully prevent this in topologies with more than two routers on a path.

### Advantages

- Simple to configure — no complex parameters required
- Works on virtually any router hardware
- Appropriate for small, stable, homogeneous networks
- Low CPU and memory overhead

### Disadvantages

- **Maximum 15 hops** — hard limit on network size
- **Bandwidth-unaware** — hop count ignores link speed entirely (the satellite link problem demonstrated in this simulator)
- **Slow convergence** — up to several minutes after a topology change
- **Full table broadcasts** — wastes bandwidth on every update, even if nothing changed
- **No VLSM support** in RIPv1 (fixed in RIPv2)
- **Count-to-infinity** — routing loops possible during convergence

---

## OSPF — Open Shortest Path First

### Overview

OSPF is a **Link-State** routing protocol. Rather than sharing distance tables with neighbours, each router floods a description of its own links (*Link State Advertisement*, LSA) to **every router in the network**. Every router builds an identical map of the entire topology (*Link State Database*, LSDB), then independently computes shortest paths using **Dijkstra's algorithm**.

- **RFC 2328** (OSPFv2 for IPv4, 1998)
- **RFC 5340** (OSPFv3 for IPv6, 2008)

### Packet Types

OSPF uses **IP protocol number 89** (not TCP or UDP). There are five OSPF packet types:

| Type | Name | Description |
|------|------|-------------|
| 1 | **Hello** | Sent every 10 s to discover and maintain neighbour adjacencies. Multicast to 224.0.0.5 (AllSPFRouters). Contains Router ID, Hello/Dead intervals, Area ID, DR/BDR. |
| 2 | **DBD** (Database Description) | Exchanged during adjacency formation to summarise each router's LSDB. Contains LSA headers only — not full LSA data. |
| 3 | **LSR** (Link State Request) | Requests specific LSAs that are missing after comparing DBD summaries. |
| 4 | **LSU** (Link State Update) | Carries one or more full LSAs. Used for both initial synchronisation and triggered updates when topology changes. |
| 5 | **LSAck** (Link State Acknowledgement) | Explicitly acknowledges receipt of an LSU, implementing **reliable flooding**. |

### OSPF Convergence — Five Phases

#### Phase 1 — Neighbour Discovery (Hello)

Routers multicast Hello packets on every interface. A **neighbour adjacency** is formed when two routers agree on Hello interval, Dead interval, Area ID, and authentication. Two-way communication is confirmed when each router sees its own Router ID in the other's Hello packet.

#### Phase 2 — Database Exchange (DBD)

Once adjacent, routers elect a **Master** (higher Router ID sends first) and exchange DBD packets. These contain LSA headers only — enough to identify which full LSAs each router is missing, without transmitting entire databases.

#### Phase 3 — Database Synchronisation (LSR / LSU / LSAck)

Each router sends LSR packets for the LSAs it is missing. The neighbour responds with LSU packets containing the complete LSA data. Every LSU is explicitly acknowledged with an LSAck, implementing **reliable flooding**.

#### Phase 4 — LSA Flooding

Each router originates a **Type 1 Router-LSA** describing all its interfaces and their costs. This LSA is flooded across the entire OSPF area: each receiving router re-floods it out all interfaces except the one it arrived on. When complete, every router holds an **identical copy of the LSDB** — a complete directed graph of the network with costs.

#### Phase 5 — SPF Calculation (Dijkstra)

Each router independently runs **Dijkstra's Shortest Path First** algorithm on its local LSDB to compute the lowest-cost path to every destination. The result is an SPF tree rooted at that router, from which the IP routing table is populated.

### Dijkstra's Algorithm — Step by Step

```
Input:  LSDB (directed graph of routers and link costs)
        Source router S

Initialise:
  cost[S] = 0
  cost[all others] = ∞
  prev[all] = null
  Unvisited = { all routers }

Repeat until Unvisited is empty:
  1. Pick u = unvisited node with smallest cost[u]
  2. If cost[u] = ∞, stop (remaining nodes unreachable)
  3. Remove u from Unvisited
  4. For each unvisited neighbour v of u:
       alt = cost[u] + link_cost(u, v)
       if alt < cost[v]:
         cost[v] = alt       ← "relax" the edge
         prev[v] = u

Result:
  cost[v] = minimum cumulative cost from S to v
  prev[v] = predecessor of v on the optimal path
  Reconstruct path: walk prev[] from destination back to source
```

**Time complexity:** O((V + E) log V) with a priority queue.

**Worked example (from R1, default scenario):**

```
Initialise: R1=0, R2=∞, R3=∞, R4=∞, R5=∞

Visit R1 (cost 0):
  Check R2: ∞   vs (0 + 10)  = 10  → UPDATE R2=10  via R1
  Check R3: ∞   vs (0 + 195) = 195 → UPDATE R3=195 via R1

Visit R2 (cost 10):                   ← lowest unvisited
  Check R3: 195 vs (10 + 10) = 20  → UPDATE R3=20  via R2

Visit R3 (cost 20):                   ← lowest unvisited
  Check R5: ∞   vs (20 + 10) = 30  → UPDATE R5=30  via R3

Visit R5 (cost 30):                   ← lowest unvisited
  Check R4: ∞   vs (30 + 10) = 40  → UPDATE R4=40  via R5

Visit R4 (cost 40): all nodes settled

Optimal path R1→R5: R1 → R2 → R3 → R5  (total cost 30)

Compare to RIP:     R1 → R3 → R5        (2 hops, OSPF cost 205)
```

OSPF routes through three fast 10 Mbps hops (cost 30) rather than two hops where one is a 512 Kbps satellite link (cost 195).

### OSPF Cost Formula

```
Cost = Reference Bandwidth ÷ Interface Bandwidth (bps)
     = 10^8 ÷ Bandwidth (bps)
```

| Link Speed | Cost |
|------------|------|
| 100 Mbps | 1 |
| 10 Mbps | **10** |
| 1 Mbps | 100 |
| 512 Kbps | **~195** |
| 56 Kbps | 1785 |

The **reference bandwidth** defaults to 100 Mbps (`auto-cost reference-bandwidth 100` on Cisco IOS). It must be raised consistently across all routers on networks using Gigabit or faster links, otherwise all high-speed links collapse to cost 1 and OSPF cannot distinguish between them.

### OSPF Areas

For scalability, OSPF supports **hierarchical routing** through areas:

- **Area 0** (backbone) — all other areas must connect to Area 0
- **Internal Router** — all interfaces within one area; runs SPF only for that area
- **ABR** (Area Border Router) — sits on the boundary between two or more areas; runs SPF per area
- **ASBR** (Autonomous System Boundary Router) — redistributes routes from external protocols (e.g. BGP, RIP)

This simulator uses a **single-area** design (all routers in Area 0) to focus on core protocol mechanics without the complexity of inter-area routing.

### Timers

| Timer | Default | Purpose |
|-------|---------|---------|
| Hello interval | 10 s | Neighbour keepalive frequency |
| Dead interval | 40 s | Declare neighbour down if no Hello received |
| LSA retransmit | 5 s | Resend unacknowledged LSU |
| LSA refresh | 30 min | Periodic re-flood of unchanged LSAs |
| MaxAge | 60 min | LSA expiry — removed from LSDB |

### Advantages

- **Bandwidth-aware metric** — cost derived from link speed; always selects the highest-bandwidth path
- **Fast convergence** — triggered updates on topology change, typically sub-second after initial startup
- **No hop-count limit** — scales to large enterprise networks
- **Hierarchical areas** — reduces LSDB size and SPF computation frequency
- **Efficient updates** — only changed LSAs are flooded, not full table dumps
- **Full VLSM/CIDR support** — carries subnet masks in all LSA types

### Disadvantages

- **Complex configuration** — areas, Router IDs, authentication, DR/BDR elections
- **Higher resource usage** — LSDB storage and Dijkstra computation require more CPU and RAM
- **SPF triggered by every topology change** — large or unstable networks can generate excessive computation
- **Requires careful area design** — poorly planned areas reduce, rather than improve, scalability

---

## RIP vs OSPF — Direct Comparison

| Feature | RIP | OSPF |
|---------|-----|------|
| Protocol type | Distance Vector | Link State |
| Algorithm | Bellman-Ford (distributed) | Dijkstra SPF (centralised per router) |
| Metric | Hop count | Cost (= 10⁸ ÷ bandwidth) |
| Maximum metric | 15 hops | No limit |
| Knowledge | Neighbours' distance tables | Full network topology (LSDB) |
| Update trigger | Periodic every 30 s | Triggered on change + 30-min refresh |
| Convergence speed | Slow (minutes) | Fast (sub-second after initial) |
| Bandwidth awareness | None | Full |
| Scalability | Small networks (&lt;15 hops) | Large enterprise |
| Configuration complexity | Simple | Complex |
| Transport | UDP/520 | IP protocol 89 |
| RFC | 1058 (v1), 2453 (v2) | 2328 (v2), 5340 (v3) |

---

## Codebase Architecture

```
src/
├── data/
│   └── topology.js          Static network graph: nodes, links, adjacency map
├── simulation/
│   ├── ripEngine.js          Generates ordered simulation steps for RIP
│   └── ospfEngine.js         Generates ordered simulation steps for OSPF + Dijkstra trace
├── hooks/
│   └── useSimulation.js      React state machine: playback, animation, step control
└── components/
    ├── NetworkMap.jsx         SVG canvas — routers, hosts, links, animated packets
    ├── ControlPanel.jsx       Protocol toggle, endpoint selectors, playback controls
    ├── TeachingPanel.jsx      4-tab sidebar: step info, routing table, protocol facts, LSDB
    └── TraceTable.jsx         Scrollable chronological event log
```

### Simulation Step Schema

Both engines produce an array of step objects consumed by `useSimulation`:

```js
{
  id:              string,      // unique step identifier
  phase:           'convergence' | 'forwarding',
  subtype:         string,      // e.g. 'init', 'send', 'receive', 'hop', 'delivered'
  title:           string,      // short heading shown in Teaching Panel
  description:     string,      // one-line summary shown in Trace Table
  teachingNote:    string,      // detailed educational explanation
  calculation:     string,      // formula or worked calculation (rendered in <pre>)
  packetType:      string,      // e.g. 'HELLO', 'RIP_RESPONSE', 'DATA'
  animatedPackets: Array,       // packets to animate this step: [{from, to, type, label}]
  highlightLinks:  string[],    // link IDs to highlight in the map
  highlightNodes:  string[],    // node IDs to highlight in the map
  tables:          Object,      // snapshot of all routing tables at this step
  lsdb:            Object,      // OSPF only — LSDB snapshot
  spfStep:         Object,      // OSPF only — Dijkstra state for cost-table display
  ripPath:         string[],    // RIP only — chosen forwarding path
  ospfPath:        string[],    // OSPF only — chosen forwarding path
  hasSlowLink:     boolean,     // RIP only — flags the satellite link warning
  delivered:       boolean,     // true on the final delivery step — triggers full-path green highlight
}
```

### Packet Animation

`useSimulation` uses `requestAnimationFrame` with an **ease-in-out** curve to animate packets along links. Each active packet carries a `progress` value (0 → 1) that `NetworkMap` converts to SVG coordinates via linear interpolation between the source and destination node positions:

```js
x = ax + (bx - ax) * progress
y = ay + (by - ay) * progress
```

---

## Changelog

### 0.1.6
- **Layout — R4 area**: SW4 and its hosts moved to the lower-left of R4 so the uplink line no longer overlaps the router label/subnet text.
- **Layout — SW3**: repositioned off the R3–R5 horizontal line to sit between R3 and H3A (10.3.0.10); H3B (10.3.0.11) moved to the clear space above R3 to avoid clashing with the R4–R5 link label.
- **Layout — SW5**: moved to align vertically between H5A and H5B, clearly separated from the R3–R5 link.
- **Visual clarity**: WAN link lines thickened and dark-mode link/stub/uplink colours brightened for better legibility.
- **Satellite badge**: centred on the R1–R3 midpoint and positioned directly below the 512 Kbps speed label.
- **Delivered-state highlight**: on the final step of both RIP and OSPF simulations the complete route — source host → source switch → all intermediate routers → destination switch → destination host — is now highlighted end-to-end in green.
- **SVG filter fix**: WAN links that are perfectly horizontal (R1–R3, R3–R5, both at y=290) were invisible when highlighted because the default `objectBoundingBox` SVG filter produces a zero-height filter region for zero-height bounding boxes. Replaced with a dedicated `glow-link` filter using `filterUnits="userSpaceOnUse"` and explicit canvas-sized bounds.
- **Docs**: corrected topology diagram, removed non-existent R2–R4 link from the links table, and updated the Dijkstra worked example accordingly (R4 is only reachable via R5).

---

## Licence

[![CC BY-NC-SA 4.0](https://licensebuttons.net/l/by-nc-sa/4.0/88x31.png)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

This work is licensed under [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)](https://creativecommons.org/licenses/by-nc-sa/4.0/).

**You are free to:**
- **Share** — copy and redistribute the material in any medium or format
- **Adapt** — remix, transform, and build upon the material

**Under the following terms:**
- **Attribution** — You must give appropriate credit and indicate if changes were made
- **NonCommercial** — You may not use the material for commercial purposes
- **ShareAlike** — If you remix or build upon the material, you must distribute your contributions under the same licence
