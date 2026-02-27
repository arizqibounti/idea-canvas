import React, { useState, useEffect, useRef, useCallback } from 'react';

// Sprint phases (durations in seconds)
const PHASES = [
  { id: 'generate', label: 'GENERATE', duration: 600, color: '#6c63ff', icon: '▶', desc: 'Build your idea tree. Use steering to explore branches.' },
  { id: 'critique', label: 'CRITIQUE', duration: 300, color: '#ff4757', icon: '⚔', desc: 'Devil\'s advocate fires. Review the challenges.' },
  { id: 'converge', label: 'CONVERGE', duration: 300, color: '#51cf66', icon: '★', desc: 'Right-click nodes to star your top 3 focus areas.' },
];

function pad(n) { return String(n).padStart(2, '0'); }

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${pad(m)}:${pad(s)}`;
}

export function useSprintMode({ onPhaseChange, onCritiquePhase }) {
  const [active, setActive] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(PHASES[0].duration);
  const intervalRef = useRef(null);
  const phaseIndexRef = useRef(0);

  const stop = useCallback(() => {
    clearInterval(intervalRef.current);
    setActive(false);
    setPhaseIndex(0);
    setSecondsLeft(PHASES[0].duration);
    phaseIndexRef.current = 0;
    onPhaseChange?.(null);
  }, [onPhaseChange]);

  const advancePhase = useCallback(() => {
    const next = phaseIndexRef.current + 1;
    if (next >= PHASES.length) {
      stop();
      return;
    }
    phaseIndexRef.current = next;
    setPhaseIndex(next);
    setSecondsLeft(PHASES[next].duration);
    onPhaseChange?.(PHASES[next].id);
    if (PHASES[next].id === 'critique') {
      onCritiquePhase?.();
    }
  }, [stop, onPhaseChange, onCritiquePhase]);

  const start = useCallback(() => {
    phaseIndexRef.current = 0;
    setPhaseIndex(0);
    setSecondsLeft(PHASES[0].duration);
    setActive(true);
    onPhaseChange?.(PHASES[0].id);
  }, [onPhaseChange]);

  useEffect(() => {
    if (!active) return;
    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          advancePhase();
          return PHASES[Math.min(phaseIndexRef.current, PHASES.length - 1)].duration;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [active, advancePhase]);

  return { active, start, stop, phaseIndex, secondsLeft, currentPhase: PHASES[phaseIndex] };
}

export default function SprintTimer({ active, phaseIndex, secondsLeft, currentPhase, onStart, onStop }) {
  const phase = currentPhase || PHASES[0];
  const progress = 1 - secondsLeft / phase.duration;

  if (!active) {
    return (
      <button className="btn btn-sprint" onClick={onStart} title="Start a 20-minute focused sprint">
        ⏱ SPRINT
      </button>
    );
  }

  return (
    <div className="sprint-bar">
      {/* Phase tabs */}
      <div className="sprint-phases">
        {PHASES.map((p, i) => (
          <div
            key={p.id}
            className={`sprint-phase-tab ${i === phaseIndex ? 'active' : ''} ${i < phaseIndex ? 'done' : ''}`}
            style={{ '--phase-color': p.color }}
          >
            <span className="sprint-phase-icon">{p.icon}</span>
            <span className="sprint-phase-label">{p.label}</span>
          </div>
        ))}
      </div>

      {/* Timer */}
      <div className="sprint-timer" style={{ color: phase.color }}>
        {formatTime(secondsLeft)}
      </div>

      {/* Progress bar */}
      <div className="sprint-progress-track">
        <div
          className="sprint-progress-fill"
          style={{ width: `${progress * 100}%`, background: phase.color }}
        />
      </div>

      {/* Desc */}
      <span className="sprint-desc">{phase.desc}</span>

      {/* Stop */}
      <button className="btn btn-stop sprint-stop-btn" onClick={onStop} title="End sprint">
        ■
      </button>
    </div>
  );
}
