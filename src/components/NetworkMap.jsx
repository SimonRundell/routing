/**
 * @fileoverview NetworkMap — SVG canvas visualisation of the network topology.
 *
 * Renders routers, hosts, switches, WAN links, animated packets, and
 * contextual overlays (cost/hop badges, slow-link warning, legend).
 *
 * All positions are defined in a 960×580 SVG viewport and scale responsively
 * via `viewBox` + CSS `width: 100%`.
 *
 * Highlights are driven by the `currentStep` prop:
 *  - `highlightLinks`  → active links glow in the protocol colour
 *  - `highlightNodes`  → active routers/hosts glow
 *  - `ripPath`/`ospfPath` → entire forwarding path is highlighted
 *
 * Packet positions are computed by linear interpolation between node centres:
 *   pos = from + (to - from) * progress
 */
import { ROUTERS, HOSTS, LINKS, SWITCHES } from '../data/topology.js';

const ROUTER_R = 28;
const HOST_W = 14;
const SW_W = 11;

// Packet type → colour (same in both themes — packets travel on highlighted paths)
const PACKET_COLORS = {
  HELLO:       '#a78bfa',
  DBD:         '#60a5fa',
  LSR:         '#34d399',
  LSU:         '#fbbf24',
  LSACK:       '#f87171',
  RIP_RESPONSE:'#fb923c',
  RIP_REQUEST: '#fdba74',
  TABLE_UPDATE:'#4ade80',
  DATA:        '#22d3ee',
  DELIVERED:   '#4ade80',
};

const PROTOCOL_COLORS = {
  rip:  { primary: '#f97316', active: '#fb923c', glow: 'rgba(249,115,22,0.4)' },
  ospf: { primary: '#06b6d4', active: '#22d3ee', glow: 'rgba(6,182,212,0.4)'  },
};

// SVG element colours for each theme
const SVG_DARK = {
  bgFill:        '#0f172a',
  gridStroke:    '#1e293b',
  linkStroke:    '#4a6484',
  linkOpacity:   0.85,
  hostBg:        '#0f2438',
  hostStroke:    '#1d4ed8',
  hostIcon:      '#1e40af',
  hostText:      '#64748b',
  hostActiveBg:  '#064e3b',
  hostActiveStr: '#4ade80',
  swBg:          '#132013',
  swStroke:      '#22c55e',
  swPort:        '#22c55e',
  swText:        '#4ade80',
  routerBg:      '#1e293b',
  routerStroke:  '#3b82f6',
  routerCyl1:    '#2563eb',
  routerCyl2:    '#1d4ed8',
  routerCyl3:    '#3b82f6',
  routerActiveBg:'#1e293b',
  routerLabel:   '#93c5fd',
  routerSubnet:  '#64748b',
  stubStroke:    '#3b82c8',
  uplinkStroke:  '#3b82c8',
  bwBg:          '#0f172a',
  bwText:        '#94a3b8',
  bwSlow:        '#f87171',
  satBg:         '#7f1d1d',
  satStroke:     '#f87171',
  satText:       '#fca5a5',
  legendBg:      '#1e293b',
  legendStroke:  '#334155',
  legendText:    '#94a3b8',
};

const SVG_LIGHT = {
  bgFill:        '#f0f4f8',
  gridStroke:    '#dce3ea',
  linkStroke:    '#475569',
  linkOpacity:   0.85,
  hostBg:        '#dbeafe',
  hostStroke:    '#1d4ed8',
  hostIcon:      '#1d4ed8',
  hostText:      '#334155',
  hostActiveBg:  '#dcfce7',
  hostActiveStr: '#15803d',
  swBg:          '#dcfce7',
  swStroke:      '#16a34a',
  swPort:        '#16a34a',
  swText:        '#15803d',
  routerBg:      '#dbeafe',
  routerStroke:  '#1d4ed8',
  routerCyl1:    '#2563eb',
  routerCyl2:    '#1d4ed8',
  routerCyl3:    '#3b82f6',
  routerActiveBg:'#bfdbfe',
  routerLabel:   '#1e3a8a',
  routerSubnet:  '#475569',
  stubStroke:    '#94a3b8',
  uplinkStroke:  '#64748b',
  bwBg:          '#f0f4f8',
  bwText:        '#475569',
  bwSlow:        '#dc2626',
  satBg:         '#fee2e2',
  satStroke:     '#dc2626',
  satText:       '#991b1b',
  legendBg:      '#ffffff',
  legendStroke:  '#cbd5e1',
  legendText:    '#475569',
};

// Interpolate position along a link by progress (0-1)
function interpolate(ax, ay, bx, by, t) {
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
}

function getNodePos(id) {
  if (ROUTERS[id]) return { x: ROUTERS[id].x, y: ROUTERS[id].y };
  if (HOSTS[id])   return { x: HOSTS[id].x,   y: HOSTS[id].y };
  return { x: 0, y: 0 };
}

/**
 * SVG network map component.
 *
 * @param {Object}           props
 * @param {'rip'|'ospf'}     props.protocol      - Active protocol (drives colour theme)
 * @param {SimStep|null}     props.currentStep   - Current simulation step (drives highlights)
 * @param {ActivePacket[]}   props.activePackets - Packets currently being animated
 * @param {'dark'|'light'}   props.theme         - UI theme
 * @returns {JSX.Element}
 */
export default function NetworkMap({ protocol, currentStep, activePackets, theme = 'dark' }) {
  const colors = PROTOCOL_COLORS[protocol];
  const sv = theme === 'light' ? SVG_LIGHT : SVG_DARK;

  // On the final delivered step, override all active/path colours to green
  const isDelivered = !!currentStep?.delivered;
  const activeColor = isDelivered ? '#4ade80' : colors.primary;
  const activeShade = isDelivered ? '#86efac' : colors.active;
  const activeGlow  = isDelivered ? 'rgba(74,222,128,0.4)' : colors.glow;

  const highlightLinks  = new Set(currentStep?.highlightLinks  || []);
  const highlightNodes  = new Set(currentStep?.highlightNodes  || []);

  // For the forwarding path, colour entire route
  const pathLinks = new Set();
  const pathKey = protocol === 'rip' ? 'ripPath' : 'ospfPath';
  const routePath = currentStep?.[pathKey];
  if (routePath) {
    for (let i = 0; i < routePath.length - 1; i++) {
      const a = routePath[i], b = routePath[i + 1];
      const link = LINKS.find(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
      if (link) pathLinks.add(link.id);
    }
  }

  return (
    <svg
      viewBox="0 0 960 580"
      className="network-map-svg"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Glow filters */}
        <filter id="glow-rip">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="glow-ospf">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        {/* Link glow uses userSpaceOnUse so horizontal lines (height=0 bounding box)
            are not clipped by the default objectBoundingBox filter region */}
        <filter id="glow-link" filterUnits="userSpaceOnUse" x="-20" y="-20" width="1000" height="620">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="glow-node">
          <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="glow-packet">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Background */}
      <rect width="960" height="580" fill={sv.bgFill} rx="12"/>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke={sv.gridStroke} strokeWidth="0.5"/>
      </pattern>
      <rect width="960" height="580" fill="url(#grid)" rx="12"/>

      {/* ── WAN LINKS ─────────────────────────────────── */}
      {LINKS.map(link => {
        const a = ROUTERS[link.from];
        const b = ROUTERS[link.to];
        const isActive  = highlightLinks.has(link.id);
        const isOnPath  = pathLinks.has(link.id);
        const isSlow    = link.isSlow;

        let stroke = sv.linkStroke;
        let strokeWidth = 2.5;
        let strokeDasharray = isSlow ? '8 4' : 'none';
        let opacity = sv.linkOpacity;
        let filter = '';

        if (isActive || isOnPath) {
          stroke = activeColor;
          strokeWidth = isSlow ? 3 : 4;
          opacity = 1;
          filter = 'url(#glow-link)';
        }

        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;

        return (
          <g key={link.id}>
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              opacity={opacity}
              filter={filter}
            />
            {/* Bandwidth label */}
            <g transform={`translate(${mx},${my})`}>
              <rect
                x={-28} y={-10} width={56} height={18}
                rx={4} fill={sv.bwBg} opacity={0.9}
              />
              <text
                textAnchor="middle" y={4}
                fontSize="10"
                fill={isSlow ? sv.bwSlow : sv.bwText}
                fontFamily="monospace"
                fontWeight={isSlow ? 'bold' : 'normal'}
              >
                {link.label}
              </text>
            </g>
            {/* OSPF cost / RIP hop badge */}
            {(isActive || isOnPath) && (
              <g transform={`translate(${mx + 30},${my - 14})`}>
                <rect x={-20} y={-9} width={40} height={16} rx={4}
                  fill={activeColor} opacity={0.9}/>
                <text textAnchor="middle" y={4} fontSize="10"
                  fill="#fff" fontFamily="monospace" fontWeight="bold">
                  {protocol === 'ospf' ? `c=${link.ospfCost}` : `1 hop`}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* ── SWITCH → ROUTER UPLINK LINES ─────────────── */}
      {Object.values(SWITCHES).map(sw => {
        const r = ROUTERS[sw.router];
        const swOnPath = isDelivered && highlightNodes.has(sw.id);
        return (
          <line key={`uplink-${sw.id}`}
            x1={sw.x} y1={sw.y} x2={r.x} y2={r.y}
            stroke={swOnPath ? activeColor : sv.uplinkStroke}
            strokeWidth={swOnPath ? 2.5 : 2}
            opacity={swOnPath ? 1 : 0.9}
          />
        );
      })}

      {/* ── HOST → SWITCH STUB LINES ──────────────────── */}
      {Object.values(HOSTS).map(h => {
        const sw = SWITCHES[h.switch];
        const isActive = highlightNodes.has(h.id);
        return (
          <line key={`stub-${h.id}`}
            x1={h.x} y1={h.y} x2={sw.x} y2={sw.y}
            stroke={isActive ? sv.hostActiveStr : sv.stubStroke}
            strokeWidth={isActive ? 2.5 : 1.5}
            strokeDasharray="4 3"
            opacity={0.85}
          />
        );
      })}

      {/* ── HOST NODES ────────────────────────────────── */}
      {Object.values(HOSTS).map(h => {
        const isActive = highlightNodes.has(h.id);
        return (
          <g key={h.id} transform={`translate(${h.x},${h.y})`}>
            <rect
              x={-HOST_W} y={-HOST_W} width={HOST_W * 2} height={HOST_W * 2}
              rx={3}
              fill={isActive ? sv.hostActiveBg : sv.hostBg}
              stroke={isActive ? sv.hostActiveStr : sv.hostStroke}
              strokeWidth={isActive ? 2 : 1}
              filter={isActive ? 'url(#glow-node)' : ''}
            />
            {/* PC icon */}
            <rect x={-6} y={-5} width={12} height={8} rx={1}
              fill={isActive ? sv.hostActiveStr : sv.hostIcon} opacity={0.8}/>
            <line x1={0} y1={3} x2={0} y2={6} stroke={isActive ? sv.hostActiveStr : sv.hostIcon}/>
            <line x1={-4} y1={6} x2={4} y2={6} stroke={isActive ? sv.hostActiveStr : sv.hostIcon}/>
            <text y={HOST_W + 11} textAnchor="middle"
              fontSize="8.5" fill={isActive ? sv.hostActiveStr : sv.hostText}
              fontFamily="monospace">
              {h.label}
            </text>
          </g>
        );
      })}

      {/* ── SWITCH NODES ──────────────────────────────── */}
      {Object.values(SWITCHES).map(sw => (
        <g key={sw.id} transform={`translate(${sw.x},${sw.y})`}>
          <rect
            x={-SW_W} y={-SW_W} width={SW_W * 2} height={SW_W * 2}
            rx={2}
            fill={sv.swBg}
            stroke={sv.swStroke}
            strokeWidth={1.5}
          />
          {/* Port indicators */}
          {[-6, -2, 2, 6].map(px => (
            <rect key={px} x={px - 1} y={-3} width={2} height={5}
              rx={0.5} fill={sv.swPort} opacity={0.8}/>
          ))}
          <text y={SW_W + 10} textAnchor="middle"
            fontSize="8" fill={sv.swText} fontFamily="monospace">
            {sw.label}
          </text>
        </g>
      ))}

      {/* ── ROUTER NODES ──────────────────────────────── */}
      {Object.values(ROUTERS).map(r => {
        const isActive = highlightNodes.has(r.id);
        const rActiveBg = isDelivered ? '#0a2e1a' : (protocol === 'rip' ? '#431407' : '#0c2540');
        return (
          <g key={r.id} transform={`translate(${r.x},${r.y})`}
            filter={isActive ? 'url(#glow-node)' : ''}>
            {/* Outer ring glow */}
            {isActive && (
              <circle r={ROUTER_R + 8} fill={activeGlow} opacity={0.5}/>
            )}
            {/* Router body */}
            <circle r={ROUTER_R}
              fill={isActive ? (theme === 'light' ? sv.routerActiveBg : rActiveBg) : sv.routerBg}
              stroke={isActive ? activeColor : sv.routerStroke}
              strokeWidth={isActive ? 3 : 2}
            />
            {/* Router icon - cylinder */}
            <ellipse cx={0} cy={-6} rx={11} ry={4}
              fill={isActive ? activeColor : sv.routerCyl1} opacity={0.9}/>
            <rect x={-11} y={-6} width={22} height={12}
              fill={isActive ? activeColor : sv.routerCyl2} opacity={0.8}/>
            <ellipse cx={0} cy={6} rx={11} ry={4}
              fill={isActive ? activeShade : sv.routerCyl3} opacity={0.9}/>
            {/* Label */}
            <text y={ROUTER_R + 14} textAnchor="middle"
              fontSize="13" fontWeight="bold"
              fill={isActive ? activeColor : sv.routerLabel}
              fontFamily="'Courier New', monospace">
              {r.label}
            </text>
            <text y={ROUTER_R + 26} textAnchor="middle"
              fontSize="9" fill={sv.routerSubnet} fontFamily="monospace">
              {r.subnet}
            </text>
          </g>
        );
      })}

      {/* ── ANIMATED PACKETS ──────────────────────────── */}
      {activePackets.map(pkt => {
        const aPos = getNodePos(pkt.from);
        const bPos = getNodePos(pkt.to);
        const pos  = interpolate(aPos.x, aPos.y, bPos.x, bPos.y, pkt.progress);
        const color = PACKET_COLORS[pkt.type] || '#fff';

        return (
          <g key={pkt.id} transform={`translate(${pos.x},${pos.y})`}
            filter="url(#glow-packet)">
            <circle r={10} fill={color} opacity={0.95}/>
            <circle r={13} fill={color} opacity={0.2}/>
            <text textAnchor="middle" y={4}
              fontSize="8" fontWeight="bold" fill="#000"
              fontFamily="monospace">
              {pkt.type === 'DATA' ? '►' : pkt.type.slice(0, 3)}
            </text>
          </g>
        );
      })}

      {/* ── SLOW LINK BADGE ───────────────────────────── */}
      {(() => {
        const slowLink = LINKS.find(l => l.isSlow);
        if (!slowLink) return null;
        const a = ROUTERS[slowLink.from];
        const b = ROUTERS[slowLink.to];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 + 26;
        return (
          <g transform={`translate(${mx},${my})`}>
            <rect x={-36} y={-12} width={72} height={20} rx={4}
              fill={sv.satBg} stroke={sv.satStroke} strokeWidth={1} opacity={0.9}/>
            <text textAnchor="middle" y={3} fontSize="9.5"
              fill={sv.satText} fontFamily="monospace" fontWeight="bold">
              ⚠ SATELLITE
            </text>
          </g>
        );
      })()}

      {/* ── LEGEND ────────────────────────────────────── */}
      <g transform="translate(18, 18)">
        <rect width={160} height={84} rx={6}
          fill={sv.legendBg} opacity={0.95} stroke={sv.legendStroke}/>
        <text x={8} y={16} fontSize="10" fill={sv.legendText}
          fontFamily="monospace" fontWeight="bold">
          LEGEND
        </text>
        {[
          { color: PACKET_COLORS.HELLO,        label: 'Hello / Hello' },
          { color: PACKET_COLORS.LSU,          label: 'LSU (OSPF)' },
          { color: PACKET_COLORS.RIP_RESPONSE, label: 'RIP Response' },
          { color: PACKET_COLORS.DATA,         label: 'Data Packet' },
        ].map((item, i) => (
          <g key={item.label} transform={`translate(8, ${28 + i * 14})`}>
            <circle r={5} fill={item.color}/>
            <text x={12} y={4} fontSize="9.5" fill={sv.legendText} fontFamily="monospace">
              {item.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
