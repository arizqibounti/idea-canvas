// ── Pipeline Checkpoint Card ─────────────────────────────────
// Shows the AI's recommendation for the next pipeline stage.
// User can Run, Skip, or Change the recommended pattern.

import React, { useState } from 'react';

export default function PipelineCheckpointCard({ state, onAction, availablePatterns }) {
  const [showAlternatives, setShowAlternatives] = useState(false);

  if (!state) return null;

  const { recommended, stageType, alternatives, reasoning, shouldSkip, skipReason } = state;
  const recName = recommended?.name || recommended?.id || stageType;

  return (
    <div className={`chat-checkpoint-card ${shouldSkip ? 'chat-checkpoint-card--skip' : ''}`}>
      <div className="checkpoint-header">
        <span className="checkpoint-icon">◈</span>
        <span className="checkpoint-title">NEXT STAGE</span>
      </div>

      <div className="checkpoint-body">
        {shouldSkip ? (
          <>
            <div className="checkpoint-skip-msg">Recommendation: <strong>skip this stage</strong></div>
            {skipReason && <div className="checkpoint-reasoning">{skipReason}</div>}
          </>
        ) : (
          <>
            <div className="checkpoint-rec">
              Recommended: <strong>{recName}</strong>
              {stageType === 'pattern' && <span className="checkpoint-badge">pattern</span>}
            </div>
            {reasoning && <div className="checkpoint-reasoning">{reasoning}</div>}
          </>
        )}
      </div>

      <div className="checkpoint-actions">
        {shouldSkip ? (
          <>
            <button className="checkpoint-btn checkpoint-btn--primary" onClick={() => onAction('skip')}>
              Skip →
            </button>
            <button className="checkpoint-btn" onClick={() => onAction('run', { patternId: typeof recommended === 'string' ? recommended : recommended?.id, stageType })}>
              Run anyway
            </button>
          </>
        ) : (
          <>
            <button className="checkpoint-btn checkpoint-btn--primary" onClick={() => onAction('run', { patternId: typeof recommended === 'string' ? recommended : recommended?.id, stageType })}>
              ▶ Run
            </button>
            <button className="checkpoint-btn" onClick={() => onAction('skip')}>
              Skip →
            </button>
            <button className="checkpoint-btn" onClick={() => setShowAlternatives(v => !v)}>
              Change {showAlternatives ? '▴' : '▾'}
            </button>
          </>
        )}
      </div>

      {showAlternatives && (
        <div className="checkpoint-alternatives">
          {(alternatives || []).map((alt, i) => (
            <button
              key={alt.id || i}
              className="checkpoint-alt-item"
              onClick={() => { onAction('run', { patternId: alt.id, stageType: 'pattern' }); setShowAlternatives(false); }}
            >
              <span className="checkpoint-alt-name">{alt.name || alt.id}</span>
              {alt.reasoning && <span className="checkpoint-alt-reason">{alt.reasoning}</span>}
            </button>
          ))}
          {/* Built-in stages */}
          {['debate', 'refine', 'portfolio'].map(stage => (
            <button
              key={stage}
              className="checkpoint-alt-item"
              onClick={() => { onAction('run', { patternId: null, stageType: stage }); setShowAlternatives(false); }}
            >
              <span className="checkpoint-alt-name">{stage.charAt(0).toUpperCase() + stage.slice(1)} (built-in)</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
