/**
 * @fileoverview TeachingPanel — educational sidebar with four tabs.
 *
 * Tabs:
 *  📖 Step     — Current event explanation, teaching note, calculations,
 *                SPF cost table (OSPF), slow-link warning (RIP)
 *  📋 Table    — Live routing table for a user-selected router
 *  ℹ Protocol  — Packet types, key facts, formulae, pros/cons
 *  🗄 LSDB     — OSPF Link State Database viewer (OSPF only)
 *
 * Internal sub-components (not exported):
 *  - RoutingTable    renders a single router's IP routing table
 *  - LsdbPanel       renders the full LSDB as it builds up
 *  - SpfTable        renders the Dijkstra cost/prev table for OSPF SPF steps
 */
import { useState } from 'react';
import { ROUTERS } from '../data/topology.js';

const PACKET_INFO = {
  rip: {
    types: [
      { name: 'RIP Request',  color: '#fdba74', desc: 'Sent on startup to ask neighbours for their routing tables' },
      { name: 'RIP Response', color: '#fb923c', desc: 'Periodic full-table update sent every 30 seconds (UDP/520)' },
    ],
    pros: [
      'Very simple to configure',
      'Works on any hardware',
      'Suitable for small networks',
    ],
    cons: [
      'Max 15 hops — limits network size',
      'Ignores link bandwidth (only counts hops)',
      'Slow convergence (up to minutes)',
      'Sends full table every 30 s — wasteful',
      'Count-to-infinity problem',
    ],
    metric: 'Hop Count (max 15)',
    algorithm: 'Bellman-Ford (Distance Vector)',
    timer: '30 s updates, 180 s invalid, 240 s flush',
    rfc: 'RFC 1058 (v1), RFC 2453 (v2)',
    convergence: 'Slow — minutes after link failure',
  },
  ospf: {
    types: [
      { name: 'Hello',  color: '#a78bfa', desc: 'Discover/maintain neighbours (multicast 224.0.0.5, every 10 s)' },
      { name: 'DBD',    color: '#60a5fa', desc: 'Database Description — summarise LSDB for synchronisation' },
      { name: 'LSR',    color: '#34d399', desc: 'Link State Request — ask for specific missing LSAs' },
      { name: 'LSU',    color: '#fbbf24', desc: 'Link State Update — carries one or more full LSAs' },
      { name: 'LSAck',  color: '#f87171', desc: 'Link State Acknowledgement — reliable flooding guarantee' },
    ],
    pros: [
      'Cost metric based on bandwidth',
      'Fast convergence (< 1 second)',
      'No hop-count limit',
      'Hierarchical (Areas) — scalable',
      'Only sends changes (triggered updates)',
      'Supports VLSM / CIDR natively',
    ],
    cons: [
      'Complex to configure',
      'Higher CPU/memory usage',
      'Requires careful area design',
      'Dijkstra runs on every topology change',
    ],
    metric: 'Cost = 10⁸ ÷ Bandwidth (bps)',
    algorithm: "Dijkstra's SPF (Link State)",
    timer: 'Hello 10 s, Dead 40 s, triggered updates',
    rfc: 'RFC 2328 (OSPFv2), RFC 5340 (OSPFv3)',
    convergence: 'Fast — sub-second on topology change',
  },
};

/**
 * Renders a single router's routing table as an HTML table.
 *
 * @param {Object}            props
 * @param {AllRipTables|AllOspfTables|null} props.tables   - All routing tables snapshot
 * @param {string}            props.routerId  - Router whose table to display
 * @param {'rip'|'ospf'}      props.protocol  - Used to label the metric column
 * @returns {JSX.Element|null}
 */
function RoutingTable({ tables, routerId, protocol }) {
  if (!tables || !tables[routerId]) return null;
  const table = tables[routerId];
  const entries = Object.values(table).sort((a, b) => a.network.localeCompare(b.network));
  const color = protocol === 'rip' ? '#f97316' : '#06b6d4';

  return (
    <div className="routing-table-container">
      <div className="routing-table-header" style={{ borderColor: color }}>
        Routing Table — {routerId} ({ROUTERS[routerId]?.subnet})
      </div>
      <table className="routing-table">
        <thead>
          <tr>
            <th>Network</th>
            <th>Next Hop</th>
            <th>{protocol === 'rip' ? 'Hops' : 'Cost'}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => (
            <tr key={entry.network}
              className={entry.nextHop === 'Direct' ? 'table-row-direct' : 'table-row-learned'}>
              <td className="mono">{entry.network}</td>
              <td className="mono">{entry.nextHop === 'Direct' ? <span className="badge-direct">Direct</span> : entry.nextHop}</td>
              <td className="mono metric-cell" style={{ color }}>
                {protocol === 'rip' ? entry.metric : entry.cost}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders the OSPF Link State Database as it accumulates during LSA flooding.
 * Each router's LSA is shown as a card listing its links and their costs.
 *
 * @param {Object}   props
 * @param {Lsdb}     props.lsdb - Current LSDB snapshot (may be partial during flooding)
 * @returns {JSX.Element|null}
 */
function LsdbPanel({ lsdb }) {
  if (!lsdb || Object.keys(lsdb).length === 0) return null;
  return (
    <div className="lsdb-panel">
      <div className="lsdb-title">Link State Database (LSDB)</div>
      {Object.values(lsdb).map(lsa => (
        <div key={lsa.routerId} className="lsa-entry">
          <div className="lsa-router">Router {lsa.routerId} — {lsa.subnet}</div>
          <div className="lsa-links">
            {lsa.links.map(l => (
              <div key={l.neighbor} className="lsa-link-row">
                <span className="lsa-arrow">→</span>
                <span className="mono">{l.neighbor}</span>
                <span className="lsa-cost">cost {l.cost}</span>
                <span className="lsa-bw">({l.bandwidth})</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders the Dijkstra cost/prev table for OSPF SPF steps.
 * Highlights the currently visited node, already-visited nodes,
 * and nodes whose costs were improved ("relaxed") this iteration.
 *
 * @param {Object}         props
 * @param {SpfStepPayload} props.spfStep   - Dijkstra state snapshot for this step
 * @param {string}         props.srcRouter - SPF root router ID (shown as 'Self' in prev column)
 * @returns {JSX.Element|null}
 */
function SpfTable({ spfStep, srcRouter }) {
  if (!spfStep) return null;
  const { costs, prev, explorations, visitedNode, visited } = spfStep;

  return (
    <div className="spf-table-container">
      <div className="spf-title">Dijkstra Cost Table</div>
      <table className="routing-table">
        <thead>
          <tr>
            <th>Router</th>
            <th>Cost</th>
            <th>Via</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(ROUTERS).map(id => {
            const cost = costs?.[id];
            const via  = prev?.[id];
            const isVisited = visited?.includes(id);
            const isCurrent = visitedNode === id;
            const isImproved = explorations?.some(e => e.neighbor === id && e.improved);
            return (
              <tr key={id}
                className={isCurrent ? 'spf-current' : isVisited ? 'spf-visited' : isImproved ? 'spf-improved' : ''}>
                <td className="mono">{id}</td>
                <td className="mono" style={{ color: '#06b6d4' }}>
                  {cost === Infinity ? '∞' : cost}
                </td>
                <td className="mono">{via || (id === srcRouter ? 'Self' : '—')}</td>
                <td className="mono" style={{ fontSize: '10px' }}>
                  {isCurrent ? '👁 visiting' : isVisited ? '✓ done' : isImproved ? '↓ updated' : '…'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Main teaching panel component.
 *
 * @param {Object}       props
 * @param {'rip'|'ospf'} props.protocol    - Active routing protocol
 * @param {SimStep|null} props.currentStep - Current simulation step
 * @param {string}       props.srcHost     - Source host ID
 * @param {string}       props.dstHost     - Destination host ID
 * @returns {JSX.Element}
 */
export default function TeachingPanel({ protocol, currentStep, srcHost, dstHost }) {
  const [tab, setTab] = useState('current'); // 'current' | 'protocol' | 'table' | 'lsdb'
  const [selectedRouter, setSelectedRouter] = useState('R1');
  const info = PACKET_INFO[protocol];
  const color = protocol === 'rip' ? '#f97316' : '#06b6d4';

  // Auto-focus active router for the routing table view
  const autoRouter = currentStep?.currentRouter
    || (currentStep?.highlightNodes?.find(n => Object.keys(ROUTERS).includes(n)))
    || selectedRouter;
  const tableRouter = autoRouter;

  const phaseLabel = currentStep?.phase === 'convergence' ? 'CONVERGENCE' : 'FORWARDING';
  const phaseColor = currentStep?.phase === 'convergence' ? '#818cf8' : '#4ade80';

  return (
    <div className="teaching-panel">
      {/* ── HEADER ──────────────────────────────────── */}
      <div className="tp-header" style={{ borderColor: color }}>
        <div className="tp-protocol-badge" style={{ background: color }}>
          {protocol.toUpperCase()}
        </div>
        {currentStep && (
          <div className="tp-phase-badge" style={{ color: phaseColor }}>
            {phaseLabel}
          </div>
        )}
      </div>

      {/* ── TABS ────────────────────────────────────── */}
      <div className="tp-tabs">
        {[
          { key: 'current',  label: '📖 Step' },
          { key: 'table',    label: '📋 Table' },
          { key: 'protocol', label: 'ℹ Protocol' },
          ...(protocol === 'ospf' ? [{ key: 'lsdb', label: '🗄 LSDB' }] : []),
        ].map(t => (
          <button key={t.key}
            className={`tp-tab ${tab === t.key ? 'tp-tab--active' : ''}`}
            style={tab === t.key ? { borderColor: color, color } : {}}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tp-body">

        {/* ── CURRENT STEP TAB ──────────────────────── */}
        {tab === 'current' && currentStep && (
          <div className="tp-step-content">
            {/* Title */}
            <div className="step-title" style={{ color }}>
              {currentStep.title}
            </div>

            {/* Packet type badge */}
            {currentStep.packetType && (
              <div className="packet-badge">
                <span className="packet-badge-label">Packet type:</span>
                <span className="packet-badge-name" style={{ color }}>
                  {currentStep.packetType.replace(/_/g, ' ')}
                </span>
                {info.types.find(t => t.name.toUpperCase().replace(/ /g,'_') === currentStep.packetType) && (
                  <div className="packet-desc">
                    {info.types.find(t => t.name.toUpperCase().replace(/ /g,'_') === currentStep.packetType)?.desc}
                  </div>
                )}
              </div>
            )}

            {/* Short description */}
            <div className="step-description">{currentStep.description}</div>

            {/* Teaching note */}
            <div className="teaching-note">
              <div className="note-label">💡 Teaching Point</div>
              <div className="note-text">{currentStep.teachingNote}</div>
            </div>

            {/* Calculation */}
            {currentStep.calculation && (
              <div className="calculation-box">
                <div className="calc-label">🧮 Calculation</div>
                <pre className="calc-text">{currentStep.calculation}</pre>
              </div>
            )}

            {/* SPF step table */}
            {currentStep.spfStep && !currentStep.spfComplete && (
              <SpfTable spfStep={currentStep.spfStep} srcRouter={srcHost?.parent || 'R1'}/>
            )}

            {/* Warning for slow link */}
            {currentStep.hasSlowLink && (
              <div className="slow-link-warning">
                ⚠ RIP chose the 512 Kbps satellite link!<br/>
                OSPF would avoid this by using cost-based routing.
              </div>
            )}
          </div>
        )}

        {/* ── ROUTING TABLE TAB ─────────────────────── */}
        {tab === 'table' && (
          <div>
            <div className="table-router-select-row">
              <span className="control-label">View router:</span>
              <select
                className="endpoint-select"
                value={tableRouter}
                onChange={e => setSelectedRouter(e.target.value)}
              >
                {Object.keys(ROUTERS).map(id => (
                  <option key={id} value={id}>{id} — {ROUTERS[id].subnet}</option>
                ))}
              </select>
            </div>
            <RoutingTable
              tables={currentStep?.tables}
              routerId={tableRouter}
              protocol={protocol}
            />
            {currentStep?.tables && (
              <div className="all-tables-hint">
                All routers:
                {Object.keys(ROUTERS).map(id => (
                  <span key={id} className="router-chip">{id}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PROTOCOL INFO TAB ─────────────────────── */}
        {tab === 'protocol' && (
          <div className="protocol-info">
            <div className="info-section">
              <div className="info-title" style={{ color }}>Packet Types</div>
              {info.types.map(t => (
                <div key={t.name} className="packet-type-row">
                  <span className="packet-dot" style={{ background: t.color }}/>
                  <div>
                    <div className="packet-type-name">{t.name}</div>
                    <div className="packet-type-desc">{t.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="info-section">
              <div className="info-title" style={{ color }}>Key Facts</div>
              <table className="facts-table">
                <tbody>
                  <tr><td>Metric</td><td>{info.metric}</td></tr>
                  <tr><td>Algorithm</td><td>{info.algorithm}</td></tr>
                  <tr><td>Convergence</td><td>{info.convergence}</td></tr>
                  <tr><td>RFC</td><td>{info.rfc}</td></tr>
                  <tr><td>Timers</td><td>{info.timer}</td></tr>
                </tbody>
              </table>
            </div>

            <div className="info-section pros-cons">
              <div className="pros-box">
                <div className="pros-title">✓ Advantages</div>
                {info.pros.map(p => <div key={p} className="pro-item">• {p}</div>)}
              </div>
              <div className="cons-box">
                <div className="cons-title">✗ Disadvantages</div>
                {info.cons.map(c => <div key={c} className="con-item">• {c}</div>)}
              </div>
            </div>

            {protocol === 'ospf' && (
              <div className="info-section">
                <div className="info-title" style={{ color }}>OSPF Cost Formula</div>
                <div className="formula-box">
                  <div className="formula">Cost = 10⁸ ÷ Bandwidth (bps)</div>
                  <div className="formula-examples">
                    <div>100 Mbps → cost <strong>1</strong></div>
                    <div>10 Mbps → cost <strong>10</strong></div>
                    <div>512 Kbps → cost <strong>195</strong></div>
                    <div>56 Kbps → cost <strong>1785</strong></div>
                  </div>
                </div>
              </div>
            )}

            {protocol === 'rip' && (
              <div className="info-section">
                <div className="info-title" style={{ color }}>Bellman-Ford Formula</div>
                <div className="formula-box">
                  <div className="formula">D(x,y) = min_n [ 1 + D(n,y) ]</div>
                  <div className="formula-examples">
                    <div>where <em>n</em> = each neighbour of <em>x</em></div>
                    <div>Max metric = 15 (16 = unreachable)</div>
                    <div>Split horizon prevents count-to-infinity</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LSDB TAB (OSPF only) ──────────────────── */}
        {tab === 'lsdb' && protocol === 'ospf' && (
          <LsdbPanel lsdb={currentStep?.lsdb}/>
        )}
      </div>
    </div>
  );
}
