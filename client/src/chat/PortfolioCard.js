// ── Inline Portfolio Card for Chat ───────────────────────────
// Renders portfolio alternatives directly in the chat stream.

import React, { useState } from 'react';

const DIMENSION_LABELS = {
  market_size: 'Market', defensibility: 'Moat', execution_feasibility: 'Execution',
  innovation: 'Innovation', match_strength: 'Match', story_quality: 'Stories',
  architecture_quality: 'Arch', maintainability: 'Maintain', scalability: 'Scale',
  team_fit: 'Team', user_value: 'User', market_differentiation: 'Diff',
  risk_reduction: 'Risk', developer_velocity: 'DevVel', feasibility: 'Feasible',
  confidence: 'Confidence', argument_strength: 'Argument', novelty: 'Novelty',
  speed_to_value: 'Speed',
};

function MiniDimensionBar({ name, score }) {
  const label = DIMENSION_LABELS[name] || name.replace(/_/g, ' ').slice(0, 8);
  const pct = (score / 10) * 100;
  const color = score >= 8 ? '#22c55e' : score >= 5 ? '#f59e0b' : '#ef4444';
  return (
    <div className="portfolio-inline-dim">
      <span className="portfolio-inline-dim-label">{label}</span>
      <div className="portfolio-inline-dim-track">
        <div className="portfolio-inline-dim-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="portfolio-inline-dim-score">{score}</span>
    </div>
  );
}

export default function PortfolioCard({ state, onAction }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!state) return null;

  const { status, stageDetail, alternatives, scores, recommendation, error } = state;

  const isGenerating = status === 'generating';
  const isDone = status === 'done' || status === 'complete';
  const isError = status === 'error';

  // Merge scores into alternatives
  const altsWithScores = (alternatives || []).map(alt => {
    const score = scores?.find(s => s.alternativeIndex === alt.index);
    return { ...alt, score };
  }).sort((a, b) => {
    if (a.score && b.score) return a.score.rank - b.score.rank;
    return a.index - b.index;
  });

  const activeAlt = altsWithScores[activeTab] || altsWithScores[0] || null;

  return (
    <div className={`chat-portfolio-card ${isGenerating ? 'portfolio-card-active' : ''} ${isDone ? 'portfolio-card-done' : ''} ${isError ? 'portfolio-card-error' : ''}`}>
      <div className="portfolio-card-hdr">
        <span className="portfolio-card-icon">
          {isGenerating && <span className="refine-pulse" style={{ color: '#a29bfe' }}>●</span>}
          {isDone && '◈'}
          {isError && '✗'}
        </span>
        <span className="portfolio-card-title">
          {isGenerating && 'Generating Portfolio...'}
          {isDone && `Portfolio — ${altsWithScores.length} alternatives`}
          {isError && 'Portfolio Error'}
        </span>
      </div>

      {/* Generating state */}
      {isGenerating && stageDetail && (
        <div className="portfolio-card-stage">{stageDetail}</div>
      )}

      {/* Alternatives tabs + content */}
      {altsWithScores.length > 0 && (
        <>
          <div className="portfolio-card-tabs">
            {altsWithScores.map((alt, i) => (
              <button
                key={alt.index}
                className={`portfolio-card-tab ${i === activeTab ? 'portfolio-card-tab-active' : ''}`}
                onClick={() => setActiveTab(i)}
                title={alt.title}
              >
                <span className="portfolio-card-tab-rank">
                  {alt.score?.rank === 1 ? '★' : `#${alt.score?.rank || alt.index + 1}`}
                </span>
                <span className="portfolio-card-tab-title">{alt.title?.slice(0, 20)}{alt.title?.length > 20 ? '…' : ''}</span>
                {alt.score?.composite && (
                  <span className="portfolio-card-tab-score">{alt.score.composite.toFixed(1)}</span>
                )}
              </button>
            ))}
          </div>

          {activeAlt && (
            <div className="portfolio-card-detail">
              <div className="portfolio-card-alt-title">{activeAlt.title}</div>
              <div className="portfolio-card-thesis">{activeAlt.thesis}</div>

              {activeAlt.score?.dimensions && (
                <div className="portfolio-card-dims">
                  {Object.entries(activeAlt.score.dimensions).slice(0, 6).map(([dim, val]) => (
                    <MiniDimensionBar key={dim} name={dim} score={val.score || val} />
                  ))}
                </div>
              )}

              {activeAlt.score?.recommendation && (
                <div className="portfolio-card-rec">{activeAlt.score.recommendation}</div>
              )}

              <div className="portfolio-card-actions">
                <button className="portfolio-card-btn" onClick={() => onAction?.({ actionType: 'exploreAlternative', altIndex: activeAlt.index })}>
                  Explore
                </button>
                <button className="portfolio-card-btn portfolio-card-btn-refine" onClick={() => onAction?.({ actionType: 'exploreAndRefine', altIndex: activeAlt.index })}>
                  Explore + Refine
                </button>
                <span className="portfolio-card-nodes">{activeAlt.nodes?.length || 0} nodes</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Recommendation */}
      {isDone && recommendation && (
        <div className="portfolio-card-recommendation">{recommendation}</div>
      )}

      {/* Footer actions */}
      {isDone && altsWithScores.length > 0 && (
        <div className="portfolio-card-footer">
          <button className="portfolio-card-btn" onClick={() => onAction?.({ actionType: 'generateMore' })}>
            + More
          </button>
        </div>
      )}

      {/* Error */}
      {isError && <div className="portfolio-card-error-msg">{error}</div>}
    </div>
  );
}
