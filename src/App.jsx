import { useSimulation } from './hooks/useSimulation.js';
import NetworkMap     from './components/NetworkMap.jsx';
import ControlPanel   from './components/ControlPanel.jsx';
import TeachingPanel  from './components/TeachingPanel.jsx';
import TraceTable     from './components/TraceTable.jsx';
import CMFloatAd      from './components/cmFloatAd.jsx';
import './App.css';

export default function App() {
  const sim = useSimulation();

  const protocolColor = sim.protocol === 'rip' ? '#f97316' : '#06b6d4';

  return (
    <div className="app-root">
      {/* ── TOP BAR ─────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-left">
          <div className="app-logo">
            <span className="logo-icon">🌐</span>
            <span className="logo-title">Network Routing Simulator</span>
          </div>
          <div className="header-subtitle">
            Interactive RIP &amp; OSPF Protocol Demonstration
          </div>
        </div>
        <div className="header-right">
          <div className="active-protocol-badge" style={{ background: protocolColor }}>
            {sim.protocol.toUpperCase()} Active
          </div>
          <div className="phase-indicator">
            {sim.currentStep?.phase === 'convergence'
              ? '📡 Convergence Phase'
              : sim.currentStep?.phase === 'forwarding'
              ? '📦 Forwarding Phase'
              : '⏸ Ready'}
          </div>
        </div>
      </header>

      {/* ── CONTROL PANEL ───────────────────────────────── */}
      <ControlPanel
        protocol={sim.protocol}
        changeProtocol={sim.changeProtocol}
        srcHost={sim.srcHost}
        dstHost={sim.dstHost}
        changeSrc={sim.changeSrc}
        changeDst={sim.changeDst}
        speed={sim.speed}
        changeSpeed={sim.changeSpeed}
        playing={sim.playing}
        play={sim.play}
        pause={sim.pause}
        stepBack={sim.stepBack}
        stepForward={sim.stepForward}
        reset={sim.reset}
        stepIndex={sim.stepIndex}
        totalSteps={sim.totalSteps}
        currentStep={sim.currentStep}
      />

      {/* ── MAIN CONTENT ────────────────────────────────── */}
      <main className="app-main">
        {/* Network Map */}
        <section className="map-section">
          <div className="section-title" style={{ color: protocolColor }}>
            Network Topology
            {sim.currentStep?.phase === 'convergence' && (
              <span className="section-subtitle"> — Protocol Convergence</span>
            )}
            {sim.currentStep?.phase === 'forwarding' && (
              <span className="section-subtitle"> — Packet Forwarding</span>
            )}
          </div>
          <div className="map-container">
            <NetworkMap
              protocol={sim.protocol}
              currentStep={sim.currentStep}
              activePackets={sim.activePackets}
            />
          </div>
        </section>

        {/* Teaching Panel */}
        <aside className="teaching-section">
          <TeachingPanel
            protocol={sim.protocol}
            currentStep={sim.currentStep}
            srcHost={sim.srcHost}
            dstHost={sim.dstHost}
          />
        </aside>
        <CMFloatAd />
      </main>

      {/* ── TRACE TABLE ─────────────────────────────────── */}
      <footer className="app-footer">
        <TraceTable
          steps={sim.steps}
          stepIndex={sim.stepIndex}
          protocol={sim.protocol}
        />
      </footer>
    </div>
  );
}
