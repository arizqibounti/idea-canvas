// ── Inline Experiment Card for Chat ─────────────────────────
// Renders AutoIdea experiment loop progress in the chat stream.
// Follows the RefineCard.js pattern.

import React from 'react';

function StrategyBadge({ strategy }) {
  const colors = {
    pivot_market: '#f472b6',
    change_monetization: '#fbbf24',
    simplify: '#34d399',
    differentiate: '#818cf8',
    scale: '#f97316',
    wildcard: '#e879f9',
  };
  const color = colors[strategy] || '#888';
  const label = (strategy || 'unknown').replace(/_/g, ' ').toUpperCase();
  return (
    <span className="experiment-strategy-badge" style={{ background: `${color}18`, color, borderColor: `${color}40` }}>
      {label}
    </span>
  );
}

function ScoreBar({ label, score, compareScore }) {
  const isWinner = score > compareScore;
  const isTied = score === compareScore;
  const color = isWinner ? '#22c55e' : isTied ? '#888' : '#ef4444';
  return (
    <div className="experiment-score-dim">
      <span className="experiment-score-dim-label">{label.replace(/_/g, ' ')}</span>
      <span className="experiment-score-dim-value" style={{ color }}>
        {typeof score === 'object' ? score.score : score}/10
      </span>
    </div>
  );
}

export default function ExperimentCard({ state, onAction }) {
  if (!state) return null;

  const { status, iteration, maxIterations, strategy,
    baselineTotal, candidateTotal, candidateTitle, candidateThesis,
    baselineDims, candidateDims, analysis, bestTotal,
    detail, error, history } = state;

  const isActive = status === 'analyzing' || status === 'mutating' || status === 'scoring' || status === 'scoring_baseline';
  const isDone = status === 'done';
  const isResult = status === 'kept' || status === 'discarded';
  const isError = status === 'error';

  return (
    <div className={`chat-experiment-card ${isActive ? 'experiment-card-active' : ''} ${isDone ? 'experiment-card-done' : ''} ${isError ? 'experiment-card-error' : ''}`}>
      {/* Header */}
      <div className="experiment-card-header">
        <span className="experiment-card-icon">
          {isActive && <span className="experiment-pulse">●</span>}
          {status === 'kept' && '✓'}
          {status === 'discarded' && '✗'}
          {isDone && '★'}
          {isError && '✗'}
        </span>
        <span className="experiment-card-title">
          {status === 'scoring_baseline' && 'Scoring baseline...'}
          {status === 'analyzing' && `Experiment — Iteration ${iteration}/${maxIterations}`}
          {status === 'mutating' && `Experiment — Iteration ${iteration}/${maxIterations}`}
          {status === 'scoring' && `Experiment — Iteration ${iteration}/${maxIterations}`}
          {isResult && `Experiment — Iteration ${iteration}/${maxIterations}`}
          {isDone && `Experiment Complete${history?.length ? ` — ${history.length} iterations` : ''}`}
          {isError && 'Experiment Error'}
        </span>
        {bestTotal > 0 && !isDone && (
          <span className="experiment-best-score">Best: {bestTotal?.toFixed?.(1) || bestTotal}</span>
        )}
        {(isActive || isResult) && (
          <button className="experiment-card-stop" onClick={() => onAction?.({ actionType: 'stopExperiment' })}>Stop</button>
        )}
      </div>

      {/* Active status */}
      {isActive && (
        <div className="experiment-card-status">
          {status === 'analyzing' && 'Choosing mutation strategy...'}
          {status === 'mutating' && (
            <>
              <StrategyBadge strategy={strategy} />
              <span>{detail || `Generating ${(strategy || '').replace(/_/g, ' ')} variant...`}</span>
            </>
          )}
          {status === 'scoring' && (
            <>
              <StrategyBadge strategy={strategy} />
              <span>Scoring "{candidateTitle}"...</span>
            </>
          )}
          {status === 'scoring_baseline' && 'Establishing baseline scores...'}
        </div>
      )}

      {/* Result: kept or discarded */}
      {isResult && (
        <div className="experiment-card-result">
          <div className="experiment-result-header">
            <StrategyBadge strategy={strategy} />
            <span className={`experiment-result-badge ${status === 'kept' ? 'experiment-result-kept' : 'experiment-result-discarded'}`}>
              {status === 'kept' ? 'KEPT — New Best!' : 'DISCARDED'}
            </span>
          </div>
          {candidateTitle && (
            <div className="experiment-candidate-info">
              <strong>{candidateTitle}</strong>
              {candidateThesis && <span className="experiment-candidate-thesis">{candidateThesis}</span>}
            </div>
          )}
          <div className="experiment-score-comparison">
            <div className="experiment-score-col">
              <div className="experiment-score-col-header">Baseline ({baselineTotal?.toFixed?.(1) || baselineTotal})</div>
              {baselineDims && Object.entries(baselineDims).map(([dim, val]) => (
                <ScoreBar key={dim} label={dim} score={val} compareScore={candidateDims?.[dim]} />
              ))}
            </div>
            <div className="experiment-score-col">
              <div className="experiment-score-col-header">Candidate ({candidateTotal?.toFixed?.(1) || candidateTotal})</div>
              {candidateDims && Object.entries(candidateDims).map(([dim, val]) => (
                <ScoreBar key={dim} label={dim} score={val} compareScore={baselineDims?.[dim]} />
              ))}
            </div>
          </div>
          {analysis && <div className="experiment-analysis">{analysis}</div>}
        </div>
      )}

      {/* Done with history */}
      {isDone && history?.length > 0 && (
        <div className="experiment-card-complete">
          <div className="experiment-history">
            {history.map((h, i) => (
              <div key={i} className={`experiment-history-row ${h.kept ? 'experiment-history-kept' : ''}`}>
                <span className="experiment-history-iter">#{h.iteration}</span>
                <StrategyBadge strategy={h.strategy} />
                <span className="experiment-history-score">
                  {h.baselineTotal?.toFixed?.(1)} → {h.candidateTotal?.toFixed?.(1)}
                </span>
                <span className={`experiment-history-result ${h.kept ? 'kept' : 'discarded'}`}>
                  {h.kept ? '✓' : '✗'}
                </span>
              </div>
            ))}
          </div>
          <div className="experiment-card-actions">
            <button className="experiment-card-btn experiment-card-btn-primary" onClick={() => onAction?.({ actionType: 'experimentMore' })}>
              ⟳ Run More
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {isError && <div className="experiment-card-error-msg">{error}</div>}
    </div>
  );
}
