/**
 * NetworkMap — SVG canvas showing routers, hosts, links, and animated packets
 */
import { ROUTERS, HOSTS, LINKS } from '../data/topology.js';

const ROUTER_R = 28;
const HOST_W = 14;

// Packet type → colour
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

// Interpolate position along a link by progress (0-1)
function interpolate(ax, ay, bx, by, t) {
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
}

function getNodePos(id) {
  if (ROUTERS[id]) return { x: ROUTERS[id].x, y: ROUTERS[id].y };
  if (HOSTS[id])   return { x: HOSTS[id].x,   y: HOSTS[id].y };
  return { x: 0, y: 0 };
}

export default function NetworkMap({ protocol, currentStep, activePackets }) {
  const colors = PROTOCOL_COLORS[protocol];
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
        <filter id="glow-node">
          <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="glow-packet">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#475569"/>
        </marker>
      </defs>

      {/* Background grid */}
      <rect width="960" height="580" fill="#0f172a" rx="12"/>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5"/>
      </pattern>
      <rect width="960" height="580" fill="url(#grid)" rx="12"/>

      {/* ── WAN LINKS ─────────────────────────────────── */}
      {LINKS.map(link => {
        const a = ROUTERS[link.from];
        const b = ROUTERS[link.to];
        const isActive  = highlightLinks.has(link.id);
        const isOnPath  = pathLinks.has(link.id);
        const isSlow    = link.isSlow;

        let stroke = '#334155';
        let strokeWidth = 2;
        let strokeDasharray = isSlow ? '8 4' : 'none';
        let opacity = 0.6;
        let filter = '';

        if (isActive || isOnPath) {
          stroke = colors.primary;
          strokeWidth = isSlow ? 3 : 4;
          opacity = 1;
          filter = `url(#glow-${protocol})`;
        }

        // Mid-point for label
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;

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
                rx={4} fill="#0f172a" opacity={0.85}
              />
              <text
                textAnchor="middle" y={4}
                fontSize="10"
                fill={isSlow ? '#f87171' : '#94a3b8'}
                fontFamily="monospace"
                fontWeight={isSlow ? 'bold' : 'normal'}
              >
                {link.label}
              </text>
            </g>
            {/* OSPF cost badge */}
            {(isActive || isOnPath) && (
              <g transform={`translate(${mx + 30},${my - 14})`}>
                <rect x={-20} y={-9} width={40} height={16} rx={4}
                  fill={colors.primary} opacity={0.9}/>
                <text textAnchor="middle" y={4} fontSize="10"
                  fill="#fff" fontFamily="monospace" fontWeight="bold">
                  {protocol === 'ospf' ? `c=${link.ospfCost}` : `1 hop`}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* ── HOST STUB LINES ───────────────────────────── */}
      {Object.values(HOSTS).map(h => {
        const r = ROUTERS[h.parent];
        const isActive = highlightNodes.has(h.id);
        return (
          <line key={`stub-${h.id}`}
            x1={h.x} y1={h.y} x2={r.x} y2={r.y}
            stroke={isActive ? '#4ade80' : '#1e3a5f'}
            strokeWidth={isActive ? 2 : 1}
            strokeDasharray="4 3"
            opacity={0.7}
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
              fill={isActive ? '#064e3b' : '#0f2438'}
              stroke={isActive ? '#4ade80' : '#1d4ed8'}
              strokeWidth={isActive ? 2 : 1}
              filter={isActive ? 'url(#glow-node)' : ''}
            />
            {/* PC icon */}
            <rect x={-6} y={-5} width={12} height={8} rx={1}
              fill={isActive ? '#4ade80' : '#1e40af'} opacity={0.8}/>
            <line x1={0} y1={3} x2={0} y2={6} stroke={isActive ? '#4ade80' : '#1e40af'}/>
            <line x1={-4} y1={6} x2={4} y2={6} stroke={isActive ? '#4ade80' : '#1e40af'}/>
            <text y={HOST_W + 11} textAnchor="middle"
              fontSize="8.5" fill={isActive ? '#4ade80' : '#64748b'}
              fontFamily="monospace">
              {h.label}
            </text>
          </g>
        );
      })}

      {/* ── ROUTER NODES ──────────────────────────────── */}
      {Object.values(ROUTERS).map(r => {
        const isActive = highlightNodes.has(r.id);
        return (
          <g key={r.id} transform={`translate(${r.x},${r.y})`}
            filter={isActive ? 'url(#glow-node)' : ''}>
            {/* Outer ring glow */}
            {isActive && (
              <circle r={ROUTER_R + 8} fill={colors.glow} opacity={0.5}/>
            )}
            {/* Router body */}
            <circle r={ROUTER_R}
              fill={isActive ? (protocol === 'rip' ? '#431407' : '#0c2540') : '#1e293b'}
              stroke={isActive ? colors.primary : '#3b82f6'}
              strokeWidth={isActive ? 3 : 2}
            />
            {/* Router icon - cylinder */}
            <ellipse cx={0} cy={-6} rx={11} ry={4}
              fill={isActive ? colors.primary : '#2563eb'} opacity={0.9}/>
            <rect x={-11} y={-6} width={22} height={12}
              fill={isActive ? colors.primary : '#1d4ed8'} opacity={0.8}/>
            <ellipse cx={0} cy={6} rx={11} ry={4}
              fill={isActive ? colors.active : '#3b82f6'} opacity={0.9}/>
            {/* Label */}
            <text y={ROUTER_R + 14} textAnchor="middle"
              fontSize="13" fontWeight="bold"
              fill={isActive ? colors.primary : '#93c5fd'}
              fontFamily="'Courier New', monospace">
              {r.label}
            </text>
            <text y={ROUTER_R + 26} textAnchor="middle"
              fontSize="9" fill="#64748b" fontFamily="monospace">
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
        const mx = (a.x + b.x) / 2 - 40;
        const my = (a.y + b.y) / 2 + 20;
        return (
          <g transform={`translate(${mx},${my})`}>
            <rect x={-32} y={-12} width={64} height={20} rx={4}
              fill="#7f1d1d" stroke="#f87171" strokeWidth={1} opacity={0.9}/>
            <text textAnchor="middle" y={3} fontSize="9.5"
              fill="#fca5a5" fontFamily="monospace" fontWeight="bold">
              ⚠ SATELLITE
            </text>
          </g>
        );
      })()}

      {/* ── LEGEND ────────────────────────────────────── */}
      <g transform="translate(18, 18)">
        <rect width={160} height={84} rx={6} fill="#1e293b" opacity={0.9} stroke="#334155"/>
        <text x={8} y={16} fontSize="10" fill="#94a3b8" fontFamily="monospace" fontWeight="bold">
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
            <text x={12} y={4} fontSize="9.5" fill="#94a3b8" fontFamily="monospace">
              {item.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
