/**
 * @fileoverview ControlPanel — all user-facing simulation controls.
 *
 * Renders in a single horizontal strip containing:
 *  - Protocol toggle (RIP / OSPF)
 *  - Source host selector
 *  - Destination host selector
 *  - Playback controls (reset, step back, play/pause, step forward)
 *  - Speed selector (Step-by-Step, 1×, 2×, 4×)
 *  - Progress bar and step counter
 */
import { ENDPOINTS } from '../data/topology.js';

const SPEED_LABELS = { 1: 'Step-by-Step', 2: 'Slow', 3: 'Medium', 4: 'Fast' };

/**
 * @param {Object}         props
 * @param {'rip'|'ospf'}   props.protocol        - Active protocol
 * @param {Function}       props.changeProtocol  - ('rip'|'ospf') => void
 * @param {string}         props.srcHost         - Source host ID
 * @param {string}         props.dstHost         - Destination host ID
 * @param {Function}       props.changeSrc       - (id: string) => void
 * @param {Function}       props.changeDst       - (id: string) => void
 * @param {number}         props.speed           - Speed level 1–4
 * @param {Function}       props.changeSpeed     - (level: number) => void
 * @param {boolean}        props.playing         - Whether auto-play is active
 * @param {Function}       props.play            - Start auto-play
 * @param {Function}       props.pause           - Pause auto-play
 * @param {Function}       props.stepBack        - Step one event back
 * @param {Function}       props.stepForward     - Step one event forward
 * @param {Function}       props.reset           - Reset to step 0
 * @param {number}         props.stepIndex       - Current step index (0-based)
 * @param {number}         props.totalSteps      - Total number of steps
 * @param {SimStep|null}   props.currentStep     - Current step object
 * @returns {JSX.Element}
 */
export default function ControlPanel({
  protocol, changeProtocol,
  srcHost, dstHost, changeSrc, changeDst,
  speed, changeSpeed,
  playing, play, pause, stepBack, stepForward, reset,
  stepIndex, totalSteps,
  currentStep,
}) {
  const progress = totalSteps > 1 ? (stepIndex / (totalSteps - 1)) * 100 : 0;

  return (
    <div className="control-panel">
      {/* ── PROTOCOL TOGGLE ─────────────────────── */}
      <div className="control-section protocol-toggle-section">
        <span className="control-label">Protocol</span>
        <div className="protocol-toggle">
          <button
            className={`proto-btn ${protocol === 'rip' ? 'proto-btn--active-rip' : ''}`}
            onClick={() => changeProtocol('rip')}
          >
            <span className="proto-icon">🔄</span> RIP
          </button>
          <button
            className={`proto-btn ${protocol === 'ospf' ? 'proto-btn--active-ospf' : ''}`}
            onClick={() => changeProtocol('ospf')}
          >
            <span className="proto-icon">⚡</span> OSPF
          </button>
        </div>
      </div>

      {/* ── ENDPOINTS ───────────────────────────── */}
      <div className="control-section">
        <span className="control-label">Source</span>
        <select
          className="endpoint-select"
          value={srcHost}
          onChange={e => changeSrc(e.target.value)}
        >
          {ENDPOINTS.filter(ep => ep.id !== dstHost).map(ep => (
            <option key={ep.id} value={ep.id}>{ep.label}</option>
          ))}
        </select>
      </div>

      <div className="control-section">
        <span className="control-label">Destination</span>
        <select
          className="endpoint-select"
          value={dstHost}
          onChange={e => changeDst(e.target.value)}
        >
          {ENDPOINTS.filter(ep => ep.id !== srcHost).map(ep => (
            <option key={ep.id} value={ep.id}>{ep.label}</option>
          ))}
        </select>
      </div>

      {/* ── PLAYBACK ────────────────────────────── */}
      <div className="control-section">
        <span className="control-label">Playback</span>
        <div className="playback-controls">
          <button className="ctrl-btn" onClick={reset} title="Reset">⏮</button>
          <button className="ctrl-btn" onClick={stepBack} disabled={stepIndex === 0} title="Step back">⏪</button>
          <button
            className={`ctrl-btn ctrl-btn--play ${playing ? 'ctrl-btn--pause' : ''}`}
            onClick={playing ? pause : play}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button className="ctrl-btn" onClick={stepForward} disabled={stepIndex >= totalSteps - 1} title="Step forward">⏩</button>
        </div>
      </div>

      {/* ── SPEED ───────────────────────────────── */}
      <div className="control-section">
        <span className="control-label">Speed: {SPEED_LABELS[speed]}</span>
        <div className="speed-buttons">
          {[1, 2, 3, 4].map(s => (
            <button
              key={s}
              className={`speed-btn ${speed === s ? 'speed-btn--active' : ''}`}
              onClick={() => changeSpeed(s)}
            >
              {s === 1 ? 'Step' : s === 2 ? '1×' : s === 3 ? '2×' : '4×'}
            </button>
          ))}
        </div>
      </div>

      {/* ── PROGRESS BAR ────────────────────────── */}
      <div className="control-section progress-section">
        <div className="progress-bar-wrap">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }}/>
        </div>
        <span className="step-counter">
          {currentStep?.phase === 'convergence' ? '📡' : '📦'}&nbsp;
          Step {stepIndex + 1} / {totalSteps}
          {currentStep?.phase ? ` — ${currentStep.phase}` : ''}
        </span>
      </div>
    </div>
  );
}
