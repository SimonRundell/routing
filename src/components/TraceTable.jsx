/**
 * @fileoverview TraceTable — scrollable chronological event log.
 *
 * Displays all simulation steps up to and including the current one.
 * The current step is highlighted with a left border in the active protocol colour.
 * Earlier steps are retained so teachers and students can review the full sequence.
 *
 * Columns: step number | phase | event title | description
 */

const PHASE_COLORS = {
  convergence: '#818cf8',
  forwarding:  '#4ade80',
};

const SUBTYPE_ICONS = {
  init:         '🔵',
  send:         '📤',
  receive:      '📥',
  converged:    '✅',
  route_decision:'🗺',
  hop:          '➡',
  delivered:    '🎉',
  hello:        '👋',
  dbd:          '📋',
  lsr:          '❓',
  lsu:          '📦',
  lsack:        '✓',
  lsdb_complete:'🗄',
  spf_start:    '⚙',
  spf_step:     '🔍',
  spf_done:     '🏁',
  ospf_converged:'✅',
  table_update: '📊',
};

/**
 * @param {Object}         props
 * @param {SimStep[]}      props.steps      - All steps for the current simulation run
 * @param {number}         props.stepIndex  - Index of the currently active step
 * @param {'rip'|'ospf'}   props.protocol   - Active protocol (drives accent colour)
 * @returns {JSX.Element}
 */
export default function TraceTable({ steps, stepIndex, protocol }) {
  const visibleSteps = steps.slice(0, stepIndex + 1);
  const color = protocol === 'rip' ? '#f97316' : '#06b6d4';

  return (
    <div className="trace-table-wrapper">
      <div className="trace-header">
        <span className="trace-title">📜 Event Trace Log</span>
        <span className="trace-count" style={{ color }}>
          {visibleSteps.length} / {steps.length} events
        </span>
      </div>
      <div className="trace-body">
        <table className="trace-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Phase</th>
              <th>Event</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {visibleSteps.map((step, idx) => {
              const isCurrent = idx === stepIndex;
              const phaseColor = PHASE_COLORS[step.phase] || '#94a3b8';
              const icon = SUBTYPE_ICONS[step.subtype] || '•';
              return (
                <tr key={step.id}
                  className={`trace-row ${isCurrent ? 'trace-row--current' : ''}`}
                  style={isCurrent ? { borderLeft: `3px solid ${color}` } : {}}
                >
                  <td className="trace-num mono">{idx + 1}</td>
                  <td>
                    <span className="trace-phase-badge" style={{ color: phaseColor }}>
                      {step.phase?.toUpperCase()}
                    </span>
                  </td>
                  <td className="trace-event">
                    <span className="trace-icon">{icon}</span>
                    <span className="trace-title-cell">{step.title}</span>
                  </td>
                  <td className="trace-desc">{step.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleSteps.length === 0 && (
          <div className="trace-empty">Press ▶ Play or ⏩ Step Forward to begin.</div>
        )}
      </div>
    </div>
  );
}
