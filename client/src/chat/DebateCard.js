// ── Inline Debate Card for Chat ──────────────────────────────
// Renders debate/critique progress and rounds inline in the chat stream.
// Follows the same pattern as RefineCard/PortfolioCard.

import React, { useState } from 'react';

const CATEGORY_COLORS = {
  obsolescence: '#ff4757', market: '#ffa94d', moat: '#cc5de8', execution: '#ff922b',
  gtm: '#4dabf7', model: '#ffd43b', match: '#51cf66', gap: '#ff6b6b',
  clarity: '#ffa94d', impact: '#ffd43b', keywords: '#20c997', positioning: '#da77f2',
  security: '#ff4757', debt: '#fd7e14', scalability: '#4dabf7', coverage: '#69db7c',
  coupling: '#cc5de8', performance: '#20c997', bias: '#ff6b6b', tradeoff: '#ffa94d',
  alternative: '#51cf66', consequence: '#ff4757', assumption: '#ffd43b', blindspot: '#cc5de8',
  structure: '#51cf66', audience: '#ffd43b', argument: '#ffa94d', voice: '#cc5de8',
  evidence: '#4dabf7', timeline: '#ff4757', dependency: '#fd7e14', resource: '#ffd43b',
  scope: '#4dabf7', risk: '#ff6b6b', milestone: '#51cf66',
};

const CATEGORY_LABELS = {
  obsolescence: 'AI OBSOLESCENCE', market: 'MARKET', moat: 'MOAT', execution: 'EXECUTION',
  gtm: 'GO-TO-MARKET', model: 'BIZ MODEL', match: 'MATCH', gap: 'GAP',
  clarity: 'CLARITY', impact: 'IMPACT', keywords: 'KEYWORDS', positioning: 'POSITIONING',
  security: 'SECURITY', debt: 'TECH DEBT', scalability: 'SCALABILITY', coverage: 'COVERAGE',
  coupling: 'COUPLING', performance: 'PERFORMANCE', bias: 'BIAS', tradeoff: 'TRADEOFF',
  alternative: 'ALTERNATIVE', consequence: 'CONSEQUENCE', assumption: 'ASSUMPTION', blindspot: 'BLIND SPOT',
  structure: 'STRUCTURE', audience: 'AUDIENCE', argument: 'ARGUMENT', voice: 'VOICE',
  evidence: 'EVIDENCE', timeline: 'TIMELINE', dependency: 'DEPENDENCY', resource: 'RESOURCE',
  scope: 'SCOPE', risk: 'RISK', milestone: 'MILESTONE',
};

function CritiqueChip({ critique }) {
  const color = CATEGORY_COLORS[critique.category] || '#8888aa';
  const label = CATEGORY_LABELS[critique.category] || critique.category?.toUpperCase();
  return (
    <div className="debate-card-critique">
      <span className="debate-card-cat" style={{ color, borderColor: color }}>{label}</span>
      <span className="debate-card-target">↳ {critique.targetNodeLabel}</span>
      <div className="debate-card-challenge">{critique.challenge}</div>
    </div>
  );
}

function RoundSummary({ round, expanded, onToggle }) {
  const verdictColor = round.verdict === 'YES' ? '#51cf66' : '#ff4757';
  return (
    <div className="debate-card-round">
      <div className="debate-card-round-header" onClick={onToggle}>
        <span className="debate-card-round-num">R{round.round}</span>
        <span className="debate-card-round-verdict" style={{ color: verdictColor }}>
          {round.verdict === 'YES' ? '✓' : '✗'}
        </span>
        <span className="debate-card-round-summary">{round.summary}</span>
        <span className="debate-card-toggle">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="debate-card-round-body">
          {round.critiques?.length > 0 && (
            <div className="debate-card-section">
              <div className="debate-card-section-label">⚔ Critiques ({round.critiques.length})</div>
              {round.critiques.map((c, i) => <CritiqueChip key={i} critique={c} />)}
            </div>
          )}
          {round.rebutCount > 0 && (
            <div className="debate-card-section">
              <div className="debate-card-section-label">◆ Response — {round.rebutCount} nodes added</div>
            </div>
          )}
          {round.suggestions?.length > 0 && (
            <div className="debate-card-section">
              <div className="debate-card-section-label">💡 Suggestions</div>
              {round.suggestions.map((s, i) => (
                <div key={i} className="debate-card-suggestion">{s}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DebateCard({ state, onAction }) {
  const [expandedRound, setExpandedRound] = useState(null);

  if (!state) return null;

  const { status, round, maxRounds, modeConfig, rounds, finalizeCount, error } = state;

  const isActive = status === 'critiquing' || status === 'rebutting' || status === 'finalizing';
  const isDone = status === 'consensus' || status === 'done';
  const isStopped = status === 'stopped';
  const isError = status === 'error';
  const icon = modeConfig?.panelIcon || '⚔';
  const title = modeConfig?.panelTitle || 'DEBATE';

  return (
    <div className={`chat-debate-card ${isActive ? 'debate-card-active' : ''} ${isDone ? 'debate-card-done' : ''} ${isError ? 'debate-card-error' : ''}`}>
      <div className="debate-card-header">
        <span className="debate-card-icon">
          {isActive && <span className="debate-pulse-inline">●</span>}
          {isDone && '✓'}
          {isStopped && '⏸'}
          {isError && '✗'}
        </span>
        <span className="debate-card-title">
          {isActive && `${title} — Round ${round}/${maxRounds}`}
          {isDone && `${title} — Consensus${rounds?.length ? ` after ${rounds.length} round${rounds.length !== 1 ? 's' : ''}` : ''}`}
          {isStopped && `${title} — Paused after ${rounds?.length || 0} round${rounds?.length !== 1 ? 's' : ''}`}
          {isError && `${title} — Error`}
          {!isActive && !isDone && !isStopped && !isError && title}
        </span>
        {isActive && (
          <button className="debate-card-stop" onClick={() => onAction?.({ actionType: 'stopDebate' })}>⏹</button>
        )}
      </div>

      {/* Active status */}
      {isActive && (
        <div className="debate-card-status">
          {status === 'critiquing' && (modeConfig?.statusCritiquing || 'Critic analyzing...')}
          {status === 'rebutting' && (modeConfig?.statusRebutting || 'Responding to critiques...')}
          {status === 'finalizing' && `Synthesizing consensus into tree...${finalizeCount > 0 ? ` (${finalizeCount} nodes)` : ''}`}
        </div>
      )}

      {/* Rounds */}
      {rounds?.length > 0 && (
        <div className="debate-card-rounds">
          {rounds.map((r, i) => (
            <RoundSummary
              key={r.round}
              round={r}
              expanded={expandedRound === i || (i === rounds.length - 1 && isActive)}
              onToggle={() => setExpandedRound(expandedRound === i ? null : i)}
            />
          ))}
        </div>
      )}

      {/* Consensus */}
      {isDone && (
        <div className="debate-card-consensus">
          <span className="debate-card-consensus-icon">✦</span>
          <span>{modeConfig?.consensusDesc?.(rounds?.length || 0, finalizeCount || 0) || 'Consensus reached.'}</span>
        </div>
      )}

      {/* Stopped — resume action */}
      {isStopped && rounds?.length > 0 && rounds.length < maxRounds && (
        <div className="debate-card-actions">
          <button className="debate-card-btn" onClick={() => onAction?.({ actionType: 'resumeDebate' })}>
            ↺ Resume ({maxRounds - rounds.length} rounds left)
          </button>
        </div>
      )}

      {/* Error */}
      {isError && <div className="debate-card-error-msg">{error}</div>}
    </div>
  );
}
