/**
 * ControlPanel — protocol toggle, source/dest selectors, playback controls, speed
 */
import { ENDPOINTS } from '../data/topology.js';

const SPEED_LABELS = { 1: 'Step-by-Step', 2: 'Slow', 3: 'Medium', 4: 'Fast' };

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
