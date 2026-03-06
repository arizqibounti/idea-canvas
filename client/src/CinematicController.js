// ── Cinematic Controller ─────────────────────────────────
// AI video-like replay: watches the tree build round by round
// with smooth camera movements, then guides through key nodes.
// Renders INSIDE ReactFlowProvider to access useReactFlow().

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { getNodeConfig } from './nodeConfig';

// ── Round labels ──────────────────────────────────────────
const ROUND_LABELS = {
  0: 'SEED', 1: 'GENERATING IDEAS', 2: 'ROUND 1 CRITIQUE', 3: 'ROUND 1 REBUTTAL',
  4: 'ROUND 2 CRITIQUE', 5: 'ROUND 2 REBUTTAL', 6: 'ROUND 3 CRITIQUE', 7: 'ROUND 3 REBUTTAL',
  8: 'ROUND 4 CRITIQUE', 9: 'ROUND 4 REBUTTAL', 10: 'ROUND 5 CRITIQUE', 11: 'ROUND 5 REBUTTAL',
  12: 'SYNTHESIS',
};

// ── Hold durations per round type (ms, at 1× speed) ──────
function getHoldDuration(round) {
  if (round === 0) return 2500;   // Seed
  if (round === 1) return 3000;   // Generate
  if (round === 12) return 3000;  // Synthesis
  return 2000;                     // Critique/Rebuttal rounds
}

// ── Select key nodes for walkthrough ──────────────────────
function selectKeyNodes(nodes, getRoundIndex) {
  if (!nodes || nodes.length === 0) return [];

  const seed = nodes.find(n => getRoundIndex(n) === 0);
  const synthesis = nodes.find(n => getRoundIndex(n) === 12);

  // Use scored nodes if available, otherwise all non-seed/synthesis nodes
  const withScores = nodes.filter(n => n.data?.score != null);
  const ranked = withScores.length > 0
    ? [...withScores].sort((a, b) => (b.data.score || 0) - (a.data.score || 0))
    : nodes.filter(n => getRoundIndex(n) !== 0 && getRoundIndex(n) !== 12);

  const topRanked = ranked.slice(0, 3);

  // Add variety — one node per unique type not already covered
  const coveredTypes = new Set(
    [seed, synthesis, ...topRanked].filter(Boolean).map(n => n.data?.type)
  );
  const typeVariety = [];
  const pool = withScores.length > 0 ? ranked : nodes;
  for (const n of pool) {
    if (!coveredTypes.has(n.data?.type)) {
      typeVariety.push(n);
      coveredTypes.add(n.data?.type);
      if (typeVariety.length >= 2) break;
    }
  }

  // Deduplicate & sort by depth
  const all = [
    ...new Map(
      [seed, ...topRanked, ...typeVariety, synthesis]
        .filter(Boolean)
        .map(n => [n.id, n])
    ).values(),
  ];
  return all.sort((a, b) => (a.data?.depth || 0) - (b.data?.depth || 0));
}

// ── Phases ────────────────────────────────────────────────
const PHASE = {
  IDLE: 'IDLE',
  BUILD_ROUND: 'BUILD_ROUND',
  BUILD_HOLD: 'BUILD_HOLD',
  WALKTHROUGH_FLY: 'WALKTHROUGH_FLY',
  WALKTHROUGH_HOLD: 'WALKTHROUGH_HOLD',
  COMPLETE: 'COMPLETE',
};

export default function CinematicController({
  nodes,
  maxRound,
  roundRange,
  setRoundRange,
  setIsolatedRound,
  onExit,
  getRoundIndex,
}) {
  const { fitView, setCenter, getNodes } = useReactFlow();

  const [phase, setPhase] = useState(PHASE.IDLE);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [currentBuildRound, setCurrentBuildRound] = useState(-1);
  const [walkthroughIndex, setWalkthroughIndex] = useState(0);
  const [chapterKey, setChapterKey] = useState(0); // for re-triggering animation

  const timerRef = useRef(null);
  const phaseRef = useRef(phase);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);

  // Keep refs in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // Compute distinct rounds present in the data
  const presentRounds = useMemo(() => {
    if (!nodes || nodes.length === 0) return [];
    const rounds = new Set(nodes.map(n => getRoundIndex(n)));
    return Array.from(rounds).sort((a, b) => a - b);
  }, [nodes, getRoundIndex]);

  const totalBuildSteps = presentRounds.length;

  // Key nodes for walkthrough
  const keyNodes = useMemo(() => selectKeyNodes(nodes, getRoundIndex), [nodes, getRoundIndex]);
  const totalWalkthroughSteps = keyNodes.length;
  const totalSteps = totalBuildSteps + totalWalkthroughSteps;

  // Current step (for progress bar)
  const currentStep = phase === PHASE.COMPLETE
    ? totalSteps
    : phase.startsWith('WALKTHROUGH')
      ? totalBuildSteps + walkthroughIndex
      : Math.max(0, presentRounds.indexOf(currentBuildRound) + 1);

  // ── Clear timer on unmount ──────────────────────────────
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // ── Auto-start on mount ────────────────────────────────
  useEffect(() => {
    setIsolatedRound(null);
    setRoundRange([0, -1]); // hide all
    const t = setTimeout(() => {
      setPhase(PHASE.BUILD_ROUND);
      setCurrentBuildRound(-1);
    }, 500);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── State machine driver ────────────────────────────────
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!playing) return;

    const ms = (base) => base / speed;

    if (phase === PHASE.BUILD_ROUND) {
      // Find next round to reveal
      const currentIdx = presentRounds.indexOf(currentBuildRound);
      const nextIdx = currentIdx + 1;

      if (nextIdx >= presentRounds.length) {
        // Build complete → start walkthrough
        timerRef.current = setTimeout(() => {
          if (keyNodes.length > 0) {
            setWalkthroughIndex(0);
            setPhase(PHASE.WALKTHROUGH_FLY);
          } else {
            setPhase(PHASE.COMPLETE);
          }
        }, ms(800));
        return;
      }

      const nextRound = presentRounds[nextIdx];
      setCurrentBuildRound(nextRound);
      setRoundRange([0, nextRound]);
      setChapterKey(k => k + 1);

      // Camera: fit visible nodes after a short delay for React to re-render
      timerRef.current = setTimeout(() => {
        try {
          const visibleNodes = getNodes().filter(n => n.data?.isInRange !== false);
          if (visibleNodes.length > 0) {
            fitView({ nodes: visibleNodes, padding: 0.3, duration: 800, maxZoom: 1.0 });
          }
        } catch { /* ignore if nodes not ready */ }

        // Transition to hold
        timerRef.current = setTimeout(() => {
          if (playingRef.current) setPhase(PHASE.BUILD_HOLD);
        }, ms(900));
      }, 150);

    } else if (phase === PHASE.BUILD_HOLD) {
      const holdMs = getHoldDuration(currentBuildRound);
      timerRef.current = setTimeout(() => {
        if (playingRef.current) setPhase(PHASE.BUILD_ROUND);
      }, ms(holdMs));

    } else if (phase === PHASE.WALKTHROUGH_FLY) {
      const node = keyNodes[walkthroughIndex];
      if (!node) {
        setPhase(PHASE.COMPLETE);
        return;
      }

      setChapterKey(k => k + 1);

      // Fly camera to node — get position from ReactFlow (rawNodes don't have layout positions)
      try {
        const rfNodes = getNodes();
        const rfNode = rfNodes.find(n => n.id === node.id);
        if (rfNode) {
          const posX = rfNode.position.x + 130;
          const posY = rfNode.position.y + 50;
          setCenter(posX, posY, { zoom: 0.85, duration: 1000 });
        }
      } catch { /* ignore */ }

      // After fly animation, hold
      timerRef.current = setTimeout(() => {
        if (playingRef.current) setPhase(PHASE.WALKTHROUGH_HOLD);
      }, ms(1200));

    } else if (phase === PHASE.WALKTHROUGH_HOLD) {
      const node = keyNodes[walkthroughIndex];
      const textLen = ((node?.data?.label || '') + (node?.data?.reasoning || '')).length;
      const holdMs = Math.max(3000, (textLen / 80) * 1000);

      timerRef.current = setTimeout(() => {
        if (!playingRef.current) return;
        const nextIdx = walkthroughIndex + 1;
        if (nextIdx >= keyNodes.length) {
          setPhase(PHASE.COMPLETE);
        } else {
          setWalkthroughIndex(nextIdx);
          setPhase(PHASE.WALKTHROUGH_FLY);
        }
      }, ms(holdMs));
    }
  }, [phase, playing, speed, currentBuildRound, walkthroughIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Controls handlers ──────────────────────────────────
  const handlePlayPause = useCallback(() => {
    setPlaying(p => {
      if (!p && phaseRef.current === PHASE.COMPLETE) {
        // Restart
        setRoundRange([0, -1]);
        setCurrentBuildRound(-1);
        setWalkthroughIndex(0);
        setPhase(PHASE.BUILD_ROUND);
        return true;
      }
      return !p;
    });
  }, [setRoundRange]);

  const handleReplay = useCallback(() => {
    setRoundRange([0, -1]);
    setCurrentBuildRound(-1);
    setWalkthroughIndex(0);
    setPlaying(true);
    setPhase(PHASE.BUILD_ROUND);
  }, [setRoundRange]);

  const handleProgressClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetStep = Math.round(pct * totalSteps);

    if (targetStep <= totalBuildSteps) {
      // Jump to build step
      const roundIdx = Math.min(targetStep, presentRounds.length - 1);
      const round = presentRounds[roundIdx] ?? presentRounds[presentRounds.length - 1];
      setCurrentBuildRound(round);
      setRoundRange([0, round]);
      setPhase(PHASE.BUILD_HOLD);
      // Fit visible
      setTimeout(() => {
        try {
          const visibleNodes = getNodes().filter(n => n.data?.isInRange !== false);
          if (visibleNodes.length > 0) fitView({ nodes: visibleNodes, padding: 0.3, duration: 400, maxZoom: 1.0 });
        } catch {}
      }, 100);
    } else {
      // Jump to walkthrough step
      const wtIdx = Math.min(targetStep - totalBuildSteps, keyNodes.length - 1);
      // Make sure all rounds are visible
      setRoundRange([0, maxRound]);
      setWalkthroughIndex(wtIdx);
      setPhase(PHASE.WALKTHROUGH_FLY);
    }
  }, [totalSteps, totalBuildSteps, presentRounds, keyNodes, maxRound, setRoundRange, fitView, getNodes]);

  // ── Render overlays ────────────────────────────────────
  const progressPct = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;

  // Chapter label for build phase
  const buildPhaseLabel = ROUND_LABELS[currentBuildRound] || `ROUND ${currentBuildRound}`;
  const buildStepNum = presentRounds.indexOf(currentBuildRound) + 1;

  // Current walkthrough node
  const wtNode = keyNodes[walkthroughIndex] || null;
  const wtType = wtNode?.data?.type || 'insight';
  const wtCfg = wtNode ? getNodeConfig(wtType, wtNode.data?.dynamicConfig) : null;

  // Phase break position on progress bar (where build ends, walkthrough begins)
  const phaseBreakPct = totalSteps > 0 ? (totalBuildSteps / totalSteps) * 100 : 50;

  return (
    <>
      {/* ── Chapter Label (BUILD phase) ── */}
      {(phase === PHASE.BUILD_ROUND || phase === PHASE.BUILD_HOLD) && currentBuildRound >= 0 && (
        <div className="cinematic-chapter" key={`ch-${chapterKey}`}>
          <div className="cinematic-chapter-label">{buildPhaseLabel}</div>
          <div className="cinematic-chapter-sub">
            Step {buildStepNum} of {totalBuildSteps}
          </div>
        </div>
      )}

      {/* ── Narration Card (WALKTHROUGH phase) ── */}
      {(phase === PHASE.WALKTHROUGH_FLY || phase === PHASE.WALKTHROUGH_HOLD) && wtNode && (
        <div className="cinematic-narration" key={`nr-${chapterKey}`}>
          <div className="cinematic-narration-header">
            <span
              className="cinematic-narration-badge"
              style={{ color: wtCfg.color, background: wtCfg.bg, borderColor: wtCfg.border }}
            >
              {wtCfg.icon} {wtCfg.label}
            </span>
            {wtNode.data?.score != null && (
              <span className="cinematic-narration-score">
                {typeof wtNode.data.score === 'number' ? wtNode.data.score.toFixed(1) : wtNode.data.score}
              </span>
            )}
          </div>
          <div className="cinematic-narration-label">{wtNode.data?.label || ''}</div>
          {wtNode.data?.reasoning && (
            <div className="cinematic-narration-reasoning">{wtNode.data.reasoning}</div>
          )}
          <div className="cinematic-narration-tag">
            Node {walkthroughIndex + 1} of {totalWalkthroughSteps}
          </div>
        </div>
      )}

      {/* ── Complete State ── */}
      {phase === PHASE.COMPLETE && (
        <div className="cinematic-complete">
          <div className="cinematic-complete-title">REPLAY COMPLETE</div>
          <button className="cinematic-complete-btn" onClick={handleReplay}>
            ↻ REPLAY
          </button>
        </div>
      )}

      {/* ── Video Controls Bar ── */}
      <div className="cinematic-controls">
        <button
          className={`cinematic-btn ${playing ? 'active' : ''}`}
          onClick={handlePlayPause}
          title={playing ? 'Pause' : phase === PHASE.COMPLETE ? 'Replay' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <select
          className="cinematic-speed"
          value={speed}
          onChange={e => setSpeed(Number(e.target.value))}
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
        </select>

        <div className="cinematic-progress-wrap" onClick={handleProgressClick}>
          <div className="cinematic-progress-fill" style={{ width: `${progressPct}%` }} />
          {/* Phase break dot */}
          <div
            className="cinematic-progress-dot phase-break"
            style={{ left: `${phaseBreakPct}%` }}
            title="Walkthrough begins"
          />
        </div>

        <span className="cinematic-step-label">
          {phase.startsWith('BUILD') && currentBuildRound >= 0
            ? `BUILD ${buildStepNum}/${totalBuildSteps}`
            : phase.startsWith('WALKTHROUGH')
              ? `WALKTHROUGH ${walkthroughIndex + 1}/${totalWalkthroughSteps}`
              : phase === PHASE.COMPLETE
                ? 'COMPLETE'
                : 'STARTING...'}
        </span>

        <button className="cinematic-exit" onClick={onExit} title="Exit cinematic mode">
          ✕ EXIT
        </button>
      </div>
    </>
  );
}
