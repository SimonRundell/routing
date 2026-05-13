/**
 * @fileoverview Central simulation state machine for the routing simulator.
 *
 * Manages all runtime state for the active simulation:
 *  - Protocol selection ('rip' | 'ospf')
 *  - Source and destination host selection
 *  - Step-based playback (play, pause, step forward/back, reset)
 *  - Speed control (four levels from step-by-step to fast)
 *  - Packet animation via requestAnimationFrame with ease-in-out interpolation
 *
 * When the protocol, source, or destination changes, the engine is re-run
 * and the simulation resets to step 0.
 *
 * @module useSimulation
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { generateRipSteps  } from '../simulation/ripEngine.js';
import { generateOspfSteps } from '../simulation/ospfEngine.js';
import * as topology from '../data/topology.js';

/**
 * Milliseconds to wait before auto-advancing to the next step, per speed level.
 * Level 1 is not used for auto-advance (step-by-step is manual only).
 * @type {Object.<number, number>}
 */
const SPEED_DELAYS = { 1: 3000, 2: 1500, 3: 700, 4: 200 };

/** @type {string} Default source host ID. */
const DEFAULT_SRC = 'H1A';

/** @type {string} Default destination host ID. */
const DEFAULT_DST = 'H5B';

/**
 * @typedef {Object} ActivePacket
 * @property {string} id       - Unique instance ID for React key prop
 * @property {string} from     - Source node ID (router or host)
 * @property {string} to       - Destination node ID (router or host)
 * @property {string} type     - Packet type key (e.g. 'HELLO', 'DATA')
 * @property {string} label    - Short display label
 * @property {number} progress - Animation progress 0 → 1 (ease-in-out)
 */

/**
 * @typedef {Object} SimulationState
 * @property {'rip'|'ospf'}   protocol        - Currently active routing protocol
 * @property {string}          srcHost         - Source host ID
 * @property {string}          dstHost         - Destination host ID
 * @property {number}          speed           - Playback speed level (1–4)
 * @property {boolean}         playing         - Whether auto-play is active
 * @property {number}          stepIndex       - Zero-based index of the current step
 * @property {SimStep[]}       steps           - All steps for the current run
 * @property {SimStep|null}    currentStep     - steps[stepIndex], or null
 * @property {ActivePacket[]}  activePackets   - Packets currently being animated
 * @property {number}          totalSteps      - steps.length
 * @property {Function}        changeProtocol  - (protocol: string) => void
 * @property {Function}        changeSrc       - (hostId: string) => void
 * @property {Function}        changeDst       - (hostId: string) => void
 * @property {Function}        changeSpeed     - (level: number) => void
 * @property {Function}        play            - Start auto-play
 * @property {Function}        pause           - Pause auto-play
 * @property {Function}        stepForward     - Advance one step
 * @property {Function}        stepBack        - Rewind one step
 * @property {Function}        reset           - Return to step 0
 */

/**
 * Invokes the appropriate simulation engine and returns only the steps array.
 *
 * @param {'rip'|'ospf'} protocol - Routing protocol to simulate.
 * @param {string}        srcId   - Source host ID.
 * @param {string}        dstId   - Destination host ID.
 * @returns {SimStep[]} Ordered simulation steps.
 */
function buildSteps(protocol, srcId, dstId) {
  const engine = protocol === 'rip' ? generateRipSteps : generateOspfSteps;
  return engine(srcId, dstId, topology).steps;
}

/**
 * Custom React hook that encapsulates the entire simulation state machine.
 *
 * Packet animation uses `requestAnimationFrame` with an ease-in-out curve:
 *   t < 0.5  →  eased = 2t²
 *   t ≥ 0.5  →  eased = -1 + (4 - 2t)t
 *
 * Auto-play uses `setTimeout` to schedule each step advance. Both timers
 * are cleaned up on unmount and whenever the simulation is reset.
 *
 * @returns {SimulationState} All simulation state and control functions.
 */
export function useSimulation() {
  const [protocol,  setProtocol ] = useState('rip');
  const [srcHost,   setSrcHost  ] = useState(DEFAULT_SRC);
  const [dstHost,   setDstHost  ] = useState(DEFAULT_DST);
  const [speed,     setSpeed    ] = useState(2);
  const [playing,   setPlaying  ] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [steps,     setSteps    ] = useState(() => buildSteps('rip', DEFAULT_SRC, DEFAULT_DST));

  /** @type {React.MutableRefObject<ActivePacket[]>} */
  const [activePackets, setActivePackets] = useState([]);

  const timerRef          = useRef(null);
  const animFrameRef      = useRef(null);
  const lastPacketTimeRef = useRef(null);
  const packetIdCounter   = useRef(0);

  // Rebuild steps whenever protocol or endpoints change, reset to step 0
  useEffect(() => {
    const newSteps = buildSteps(protocol, srcHost, dstHost);
    setSteps(newSteps);
    setStepIndex(0);
    setPlaying(false);
    setActivePackets([]);
    clearTimeout(timerRef.current);
    cancelAnimationFrame(animFrameRef.current);
  }, [protocol, srcHost, dstHost]);

  /** The step object currently being displayed, or null before first render. */
  const currentStep = steps[stepIndex] || null;

  /**
   * Launches `requestAnimationFrame` animations for all packets in a step.
   * Packets travel from their source node to their destination node over
   * 80 % of the current step delay, then disappear.
   *
   * @param {SimStep|null} step - The step whose animatedPackets should be shown.
   */
  const launchPackets = useCallback((step) => {
    if (!step || !step.animatedPackets || step.animatedPackets.length === 0) return;

    const newPackets = step.animatedPackets.map(p => ({
      id:       `pkt_${packetIdCounter.current++}`,
      from:     p.from,
      to:       p.to,
      type:     p.type,
      label:    p.label,
      progress: 0,
    }));

    setActivePackets(newPackets);
    lastPacketTimeRef.current = performance.now();

    const duration = SPEED_DELAYS[speed] * 0.8;

    /**
     * Animation frame callback — updates packet progress each frame.
     * @param {DOMHighResTimeStamp} now
     */
    const animate = (now) => {
      const elapsed = now - lastPacketTimeRef.current;
      const t = Math.min(elapsed / duration, 1);
      // Ease-in-out: smooth acceleration and deceleration
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      setActivePackets(prev => prev.map(pkt => ({ ...pkt, progress: eased })));

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        setActivePackets([]);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
  }, [speed]);

  // Auto-advance timer — fires once per step while playing
  useEffect(() => {
    if (!playing) {
      clearTimeout(timerRef.current);
      return;
    }
    if (stepIndex >= steps.length - 1) {
      setPlaying(false);
      return;
    }

    timerRef.current = setTimeout(() => {
      setStepIndex(prev => {
        const next = Math.min(prev + 1, steps.length - 1);
        launchPackets(steps[next]);
        return next;
      });
    }, SPEED_DELAYS[speed]);

    return () => clearTimeout(timerRef.current);
  }, [playing, stepIndex, steps, speed, launchPackets]);

  // Launch packets on manual step changes as well
  useEffect(() => {
    if (currentStep) {
      cancelAnimationFrame(animFrameRef.current);
      setActivePackets([]);
      launchPackets(currentStep);
    }
  }, [stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Starts auto-play. If already at the final step, rewinds to 0 first.
   */
  const play = useCallback(() => {
    if (stepIndex >= steps.length - 1) setStepIndex(0);
    setPlaying(true);
  }, [stepIndex, steps.length]);

  /** Pauses auto-play without changing the current step. */
  const pause = useCallback(() => setPlaying(false), []);

  /** Stops auto-play and advances one step forward. */
  const stepForward = useCallback(() => {
    setPlaying(false);
    setStepIndex(prev => Math.min(prev + 1, steps.length - 1));
  }, [steps.length]);

  /** Stops auto-play and moves one step back. */
  const stepBack = useCallback(() => {
    setPlaying(false);
    setStepIndex(prev => Math.max(prev - 1, 0));
  }, []);

  /** Stops playback and returns to step 0. */
  const reset = useCallback(() => {
    setPlaying(false);
    setStepIndex(0);
    setActivePackets([]);
    cancelAnimationFrame(animFrameRef.current);
    clearTimeout(timerRef.current);
  }, []);

  /**
   * Switches the active routing protocol.
   * @param {'rip'|'ospf'} p - Protocol identifier.
   */
  const changeProtocol = useCallback((p) => setProtocol(p), []);

  /**
   * Updates the playback speed level.
   * @param {number} s - Speed level 1–4.
   */
  const changeSpeed = useCallback((s) => setSpeed(s), []);

  /**
   * Changes the source host, ignoring the request if it would match the destination.
   * @param {string} id - Host ID.
   */
  const changeSrc = useCallback((id) => {
    if (id !== dstHost) setSrcHost(id);
  }, [dstHost]);

  /**
   * Changes the destination host, ignoring the request if it would match the source.
   * @param {string} id - Host ID.
   */
  const changeDst = useCallback((id) => {
    if (id !== srcHost) setDstHost(id);
  }, [srcHost]);

  return {
    protocol, srcHost, dstHost, speed, playing,
    stepIndex, steps, currentStep, activePackets,
    totalSteps: steps.length,
    changeProtocol, changeSrc, changeDst, changeSpeed,
    play, pause, stepForward, stepBack, reset,
  };
}
