// ── Velocity Meter ───────────────────────────────────────────
// Compact toolbar badge showing session context momentum.
// Score = nodes + (debates * 3) + (artifacts * 5) + (refineRounds * 2) + chatTurns
// Color tiers: gray (0-10) → blue (10-30) → purple (30-60) → gold (60+)

import React, { useMemo, useRef, useEffect } from 'react';

export default function VelocityMeter({ nodes = [], debates = [], artifacts = [], chatMessages = [], refineRounds = 0 }) {
  const prevScoreRef = useRef(0);

  const score = useMemo(() => {
    const nodeCount = nodes.filter(n => !n._meta && !n._progress).length;
    const debateCount = debates.length;
    const artifactCount = artifacts.length;
    const chatTurns = chatMessages.filter(m => m.role === 'user').length;
    return nodeCount + (debateCount * 3) + (artifactCount * 5) + (refineRounds * 2) + chatTurns;
  }, [nodes, debates, artifacts, chatMessages, refineRounds]);

  const increased = score > prevScoreRef.current;
  useEffect(() => {
    prevScoreRef.current = score;
  }, [score]);

  const tier = score >= 60 ? 'gold' : score >= 30 ? 'purple' : score >= 10 ? 'blue' : 'gray';

  if (score === 0) return null;

  return (
    <div className={`velocity-meter velocity-${tier}${increased ? ' velocity-pulse' : ''}`} title={`Session momentum: ${score} — Context compounds with every action`}>
      <span className="velocity-icon">&#9889;</span>
      <span className="velocity-score">{score}</span>
    </div>
  );
}
