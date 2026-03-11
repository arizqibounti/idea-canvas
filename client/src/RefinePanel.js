// ── Auto-Refine Panel ────────────────────────────────────────
// Side panel for recursive critique → strengthen → score loop.

import React, { useState } from 'react';

const MODE_LABELS = {
  idea:     { icon: '◈', label: 'PRODUCT' },
  resume:   { icon: '◎', label: 'RESUME' },
  codebase: { icon: '⟨/⟩', label: 'CODE' },
  decision: { icon: '⚖', label: 'DECISION' },
  writing:  { icon: '✦', label: 'WRITING' },
  plan:     { icon: '◉', label: 'PLAN' },
};

function SeverityBadge({ severity }) {
  const color = severity >= 8 ? '#ef4444' : severity >= 5 ? '#f59e0b' : '#22c55e';
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>
      {severity}/10
    </span>
  );
}

function ApproachBadge({ approach }) {
  const labels = {
    expand: 'EXPAND',
    deepen: 'DEEPEN',
    rewrite: 'REWRITE',
    add_evidence: 'EVIDENCE',
  };
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      fontSize: 9, fontWeight: 600, fontFamily: 'monospace',
      background: '#6c63ff18', color: '#8b83ff', border: '1px solid #6c63ff33',
      letterSpacing: '0.04em',
    }}>
      {labels[approach] || approach}
    </span>
  );
}

function ScoreDelta({ oldScore, newScore }) {
  const delta = (newScore - oldScore).toFixed(1);
  const improved = newScore > oldScore;
  const color = improved ? '#22c55e' : newScore === oldScore ? '#888' : '#ef4444';
  return (
    <span style={{
      fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color,
    }}>
      {oldScore?.toFixed?.(1) || oldScore} → {newScore?.toFixed?.(1) || newScore}
      {' '}
      <span style={{ fontSize: 10 }}>
        ({improved ? '+' : ''}{delta}) {improved ? '↑' : newScore === oldScore ? '→' : '↓'}
      </span>
    </span>
  );
}

export default function RefinePanel({
  mode,
  isRefining,
  refineProgress,
  refineHistory,
  onStart,
  onStop,
  onGoDeeper,
  onClose,
  nodeCount,
}) {
  const [rounds, setRounds] = useState(3);
  const [expandedRound, setExpandedRound] = useState(null);
  const modeConfig = MODE_LABELS[mode] || MODE_LABELS.idea;

  const latestScore = refineHistory.length > 0
    ? refineHistory[refineHistory.length - 1].newScore
    : null;

  return (
    <div className="refine-panel">
      {/* Header */}
      <div className="refine-header">
        <span className="refine-title">
          <span style={{ marginRight: 6 }}>⟲</span>
          AUTO-REFINE
          <span className="refine-mode-badge">
            {modeConfig.icon} {modeConfig.label}
          </span>
        </span>
        <button className="panel-close-btn" onClick={onClose}>✕</button>
      </div>

      {/* Config (when idle) */}
      {!isRefining && refineHistory.length === 0 && (
        <div className="refine-config">
          <label className="refine-label">
            Rounds: <strong>{rounds}</strong>
          </label>
          <input
            type="range"
            min={1}
            max={5}
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
            className="refine-slider"
          />
          <div className="refine-desc">
            Each round: critique → identify weak nodes → strengthen → re-score.
            The system stops early if the tree is strong enough.
          </div>
          <button
            className="btn btn-generate"
            onClick={() => onStart(rounds)}
            disabled={nodeCount === 0}
            style={{ width: '100%', marginTop: 8 }}
          >
            ▶ START REFINING
          </button>
        </div>
      )}

      {/* Progress (when running) */}
      {isRefining && refineProgress && refineProgress.status !== 'done' && (
        <div className="refine-progress">
          <div className="refine-round-badge">
            Round {refineProgress.round}/{refineProgress.maxRounds}
          </div>
          <div className="refine-status">
            {refineProgress.status === 'critiquing' && (
              <><span className="refine-pulse">●</span> Evaluating tree quality...</>
            )}
            {refineProgress.status === 'strengthening' && (
              <><span className="refine-pulse" style={{ color: '#6c63ff' }}>●</span> Strengthening {refineProgress.weaknesses?.length || 0} weak areas...</>
            )}
            {refineProgress.status === 'scoring' && (
              <><span className="refine-pulse" style={{ color: '#22c55e' }}>●</span> Measuring improvement...</>
            )}
            {refineProgress.status === 'complete' && (
              <><span style={{ color: '#22c55e' }}>✓</span> Tree is strong — {refineProgress.stopReason}</>
            )}
            {refineProgress.status === 'round_complete' && (
              <>
                <ScoreDelta oldScore={refineProgress.oldScore} newScore={refineProgress.newScore} />
                {refineProgress.summary && (
                  <div className="refine-summary">{refineProgress.summary}</div>
                )}
              </>
            )}
          </div>
          {/* Substage detail from research/multi-agent pipeline */}
          {refineProgress.detail && refineProgress.status === 'strengthening' && refineProgress.detail !== `Fixing ${refineProgress.weaknesses?.length || 0} weak areas...` && (
            <div style={{
              fontSize: 10, color: '#a29bfe', padding: '4px 8px',
              background: '#6c63ff08', borderRadius: 6, marginTop: 2,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span className="refine-pulse" style={{ color: '#a29bfe', fontSize: 7 }}>●</span>
              {refineProgress.detail}
            </div>
          )}

          {/* Show current weaknesses being fixed */}
          {refineProgress.weaknesses?.length > 0 && refineProgress.status === 'strengthening' && (
            <div className="refine-weakness-list">
              {refineProgress.weaknesses.map((w, i) => (
                <div key={i} className="refine-weakness">
                  <div className="refine-weakness-header">
                    <SeverityBadge severity={w.severity} />
                    <ApproachBadge approach={w.approach} />
                  </div>
                  <div className="refine-weakness-label">"{w.nodeLabel}"</div>
                  <div className="refine-weakness-reason">{w.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History (completed rounds) */}
      {refineHistory.length > 0 && (
        <div className="refine-history">
          {refineHistory.map((entry, i) => (
            <div
              key={i}
              className={`refine-round-entry ${expandedRound === i ? 'expanded' : ''}`}
              onClick={() => setExpandedRound(expandedRound === i ? null : i)}
            >
              <div className="refine-round-header">
                <span className="refine-round-num">R{entry.round}</span>
                <ScoreDelta oldScore={entry.oldScore} newScore={entry.newScore} />
                {entry.newNodeCount > 0 && (
                  <span className="refine-node-count">+{entry.newNodeCount}</span>
                )}
              </div>
              {entry.summary && (
                <div className="refine-round-summary">{entry.summary}</div>
              )}
              {expandedRound === i && entry.weaknesses?.length > 0 && (
                <div className="refine-weakness-list" style={{ marginTop: 8 }}>
                  {entry.weaknesses.map((w, j) => (
                    <div key={j} className="refine-weakness">
                      <div className="refine-weakness-header">
                        <SeverityBadge severity={w.severity} />
                        <ApproachBadge approach={w.approach} />
                      </div>
                      <div className="refine-weakness-label">"{w.nodeLabel}"</div>
                      <div className="refine-weakness-reason">{w.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Controls (when running or after completing) */}
      {isRefining && (
        <button
          className="btn btn-stop"
          onClick={onStop}
          style={{ width: '100%', marginTop: 8 }}
        >
          ◼ STOP
        </button>
      )}
      {!isRefining && refineHistory.length > 0 && (
        <div className="refine-controls">
          <button
            className="btn btn-generate"
            onClick={() => onGoDeeper(2)}
            style={{ flex: 1 }}
          >
            ⟲ GO DEEPER (+2 rounds)
          </button>
          {latestScore && (
            <div className="refine-final-score">
              Score: <strong>{latestScore}</strong>/10
            </div>
          )}
        </div>
      )}
    </div>
  );
}
