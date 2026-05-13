/**
 * useSimulation — central state machine for the routing simulation
 *
 * Controls:
 *  - protocol ('rip' | 'ospf')
 *  - source/destination host selection
 *  - play/pause, speed (1-4), step navigation
 *  - animated packet positions (progress 0→1 along links)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { generateRipSteps } from '../simulation/ripEngine.js';
import { generateOspfSteps } from '../simulation/ospfEngine.js';
import * as topology from '../data/topology.js';

// ms per step at each speed level
const SPEED_DELAYS = { 1: 3000, 2: 1500, 3: 700, 4: 200 };

const DEFAULT_SRC = 'H1A';
const DEFAULT_DST = 'H5B';

function buildSteps(protocol, srcId, dstId) {
  const engine = protocol === 'rip' ? generateRipSteps : generateOspfSteps;
  return engine(srcId, dstId, topology).steps;
}

export function useSimulation() {
  const [protocol, setProtocol] = useState('rip');
  const [srcHost, setSrcHost] = useState(DEFAULT_SRC);
  const [dstHost, setDstHost] = useState(DEFAULT_DST);
  const [speed, setSpeed] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [steps, setSteps] = useState(() => buildSteps('rip', DEFAULT_SRC, DEFAULT_DST));
  // Packet animations: [{id, from, to, progress, type, label}]
  const [activePackets, setActivePackets] = useState([]);

  const timerRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastPacketTimeRef = useRef(null);
  const packetIdCounter = useRef(0);

  // Rebuild steps when protocol / endpoints change
  useEffect(() => {
    const newSteps = buildSteps(protocol, srcHost, dstHost);
    setSteps(newSteps);
    setStepIndex(0);
    setPlaying(false);
    setActivePackets([]);
    clearTimeout(timerRef.current);
    cancelAnimationFrame(animFrameRef.current);
  }, [protocol, srcHost, dstHost]);

  const currentStep = steps[stepIndex] || null;

  // Launch packet animations for the current step
  const launchPackets = useCallback((step) => {
    if (!step || !step.animatedPackets || step.animatedPackets.length === 0) return;
    const newPackets = step.animatedPackets.map(p => ({
      id: `pkt_${packetIdCounter.current++}`,
      from: p.from,
      to: p.to,
      type: p.type,
      label: p.label,
      progress: 0,
    }));
    setActivePackets(newPackets);
    lastPacketTimeRef.current = performance.now();

    const duration = SPEED_DELAYS[speed] * 0.8;

    const animate = (now) => {
      const elapsed = now - lastPacketTimeRef.current;
      const t = Math.min(elapsed / duration, 1);
      // ease-in-out
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      setActivePackets(prev =>
        prev.map(pkt => ({ ...pkt, progress: eased }))
      );

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        setActivePackets([]);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
  }, [speed]);

  // Auto-advance when playing
  useEffect(() => {
    if (!playing) {
      clearTimeout(timerRef.current);
      return;
    }

    if (stepIndex >= steps.length - 1) {
      setPlaying(false);
      return;
    }

    const delay = SPEED_DELAYS[speed];

    timerRef.current = setTimeout(() => {
      setStepIndex(prev => {
        const next = Math.min(prev + 1, steps.length - 1);
        launchPackets(steps[next]);
        return next;
      });
    }, delay);

    return () => clearTimeout(timerRef.current);
  }, [playing, stepIndex, steps, speed, launchPackets]);

  // Launch packets for the current step on manual advance too
  useEffect(() => {
    if (currentStep) {
      cancelAnimationFrame(animFrameRef.current);
      setActivePackets([]);
      launchPackets(currentStep);
    }
  }, [stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback(() => {
    if (stepIndex >= steps.length - 1) {
      setStepIndex(0);
    }
    setPlaying(true);
  }, [stepIndex, steps.length]);

  const pause = useCallback(() => setPlaying(false), []);

  const stepForward = useCallback(() => {
    setPlaying(false);
    setStepIndex(prev => Math.min(prev + 1, steps.length - 1));
  }, [steps.length]);

  const stepBack = useCallback(() => {
    setPlaying(false);
    setStepIndex(prev => Math.max(prev - 1, 0));
  }, []);

  const reset = useCallback(() => {
    setPlaying(false);
    setStepIndex(0);
    setActivePackets([]);
    cancelAnimationFrame(animFrameRef.current);
    clearTimeout(timerRef.current);
  }, []);

  const changeProtocol = useCallback((p) => {
    setProtocol(p);
  }, []);

  const changeSpeed = useCallback((s) => setSpeed(s), []);

  const changeSrc = useCallback((id) => {
    if (id !== dstHost) setSrcHost(id);
  }, [dstHost]);

  const changeDst = useCallback((id) => {
    if (id !== srcHost) setDstHost(id);
  }, [srcHost]);

  return {
    protocol,
    srcHost,
    dstHost,
    speed,
    playing,
    stepIndex,
    steps,
    currentStep,
    activePackets,
    totalSteps: steps.length,
    changeProtocol,
    changeSrc,
    changeDst,
    changeSpeed,
    play,
    pause,
    stepForward,
    stepBack,
    reset,
  };
}
