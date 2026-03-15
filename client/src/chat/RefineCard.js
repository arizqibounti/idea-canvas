// ── Inline Refine Card for Chat ──────────────────────────────
// Renders refine progress/results directly in the chat stream.

import React, { useState } from 'react';

function SeverityBadge({ severity }) {
  const color = severity >= 8 ? '#ef4444' : severity >= 5 ? '#f59e0b' : '#22c55e';
  return (
    <span className="refine-inline-severity" style={{ background: `${color}22`, color, borderColor: `${color}44` }}>
      {severity}/10
    </span>
  );
}

function ScoreDelta({ oldScore, newScore }) {
  const delta = (newScore - oldScore).toFixed(1);
  const improved = newScore > oldScore;
  const color = improved ? '#22c55e' : newScore === oldScore ? '#888' : '#ef4444';
  return (
    <span className="refine-inline-score" style={{ color }}>
      {oldScore?.toFixed?.(1) || oldScore} → {newScore?.toFixed?.(1) || newScore}
      <span style={{ fontSize: 10, marginLeft: 4 }}>
        ({improved ? '+' : ''}{delta}) {improved ? '↑' : newScore === oldScore ? '→' : '↓'}
      </span>
    </span>
  );
}

export default function RefineCard({ state, onAction }) {
  const [expanded, setExpanded] = useState(false);

  if (!state) return null;

  const { status, round, maxRounds, weaknesses, overallScore, oldScore, newScore,
    summary, detail, stopReason, error, history } = state;

  const isActive = status === 'critiquing' || status === 'strengthening' || status === 'scoring';
  const isDone = status === 'done' || status === 'complete';
  const isRoundComplete = status === 'round_complete';
  const isError = status === 'error';

  return (
    <div className={`chat-refine-card ${isActive ? 'refine-card-active' : ''} ${isDone ? 'refine-card-done' : ''} ${isError ? 'refine-card-error' : ''}`}>
      <div className="refine-card-header">
        <span className="refine-card-icon">
          {isActive && <span className="refine-pulse">●</span>}
          {isDone && '✓'}
          {isRoundComplete && '⟲'}
          {isError && '✗'}
        </span>
        <span className="refine-card-title">
          {isActive && `Refining — Round ${round}/${maxRounds}`}
          {isRoundComplete && `Round ${round}/${maxRounds} Complete`}
          {status === 'complete' && 'Refine Complete'}
          {status === 'done' && `Refine Complete${history?.length ? ` — ${history.length} rounds` : ''}`}
          {isError && 'Refine Error'}
        </span>
        {(isActive || isRoundComplete) && (
          <button className="refine-card-stop" onClick={() => onAction?.({ actionType: 'stopRefine' })}>⏹</button>
        )}
      </div>

      {/* Active status */}
      {isActive && (
        <div className="refine-card-status">
          {status === 'critiquing' && 'Evaluating tree quality...'}
          {status === 'strengthening' && `Strengthening ${weaknesses?.length || 0} weak areas...`}
          {status === 'scoring' && 'Measuring improvement...'}
          {detail && status === 'strengthening' && detail !== `Fixing ${weaknesses?.length || 0} weak areas...` && (
            <div className="refine-card-detail">{detail}</div>
          )}
        </div>
      )}

      {/* Weaknesses during strengthening */}
      {isActive && status === 'strengthening' && weaknesses?.length > 0 && (
        <div className="refine-card-weaknesses">
          {weaknesses.slice(0, 3).map((w, i) => (
            <div key={i} className="refine-card-weakness">
              <SeverityBadge severity={w.severity} />
              <span className="refine-card-weakness-label">{w.nodeLabel}</span>
            </div>
          ))}
          {weaknesses.length > 3 && <span className="refine-card-more">+{weaknesses.length - 3} more</span>}
        </div>
      )}

      {/* Round complete */}
      {isRoundComplete && (
        <div className="refine-card-result">
          <ScoreDelta oldScore={oldScore} newScore={newScore} />
          {summary && <div className="refine-card-summary">{summary}</div>}
        </div>
      )}

      {/* Early stop complete */}
      {status === 'complete' && (
        <div className="refine-card-result">
          {overallScore && <span className="refine-card-final-score">Score: {overallScore}/10</span>}
          {stopReason && <div className="refine-card-summary">{stopReason}</div>}
        </div>
      )}

      {/* Done with history */}
      {status === 'done' && history?.length > 0 && (
        <div className="refine-card-result">
          <div className="refine-card-history-summary">
            {history.map((h, i) => (
              <div key={i} className="refine-card-history-row" onClick={() => setExpanded(expanded === i ? false : i)}>
                <span className="refine-card-round-num">R{h.round}</span>
                <ScoreDelta oldScore={h.oldScore} newScore={h.newScore} />
                {h.newNodeCount > 0 && <span className="refine-card-node-delta">+{h.newNodeCount}</span>}
              </div>
            ))}
          </div>
          <div className="refine-card-actions">
            <button className="refine-card-btn" onClick={() => onAction?.({ actionType: 'goDeeper' })}>
              ⟲ Go Deeper
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {isError && <div className="refine-card-error-msg">{error}</div>}
    </div>
  );
}
