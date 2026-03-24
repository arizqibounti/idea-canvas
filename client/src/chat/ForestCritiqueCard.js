// ── Forest Critique Card ─────────────────────────────────────
// Displays cross-canvas critique results in the chat panel.

import React from 'react';

const SEVERITY_COLORS = {
  critical: '#ff4757',
  major: '#f59e0b',
  minor: '#6c63ff',
};

const TYPE_ICONS = {
  contradiction: '⚡',
  missing_dependency: '◇',
  integration_gap: '⟡',
  redundancy: '◎',
  systemic_risk: '⚠',
};

export default function ForestCritiqueCard({ critique, onNavigate }) {
  if (!critique) return null;

  const { verdict, overallAssessment, critiques = [], suggestions = [] } = critique;

  return (
    <div className={`chat-forest-critique-card ${verdict === 'PASS' ? 'critique-pass' : 'critique-fail'}`}>
      <div className="forest-critique-header">
        <span className="forest-critique-icon">⚔</span>
        <span className="forest-critique-title">CROSS-CANVAS ANALYSIS</span>
        <span className={`forest-critique-verdict ${verdict === 'PASS' ? 'pass' : 'fail'}`}>
          {verdict}
        </span>
      </div>

      {overallAssessment && (
        <div className="forest-critique-assessment">{overallAssessment}</div>
      )}

      {critiques.length > 0 && (
        <div className="forest-critique-list">
          {critiques.map((c, i) => (
            <div key={c.id || i} className="forest-critique-item" style={{ borderLeftColor: SEVERITY_COLORS[c.severity] || '#666' }}>
              <div className="forest-critique-item-header">
                <span className="forest-critique-type-icon">{TYPE_ICONS[c.type] || '●'}</span>
                <span className="forest-critique-severity" style={{ color: SEVERITY_COLORS[c.severity] }}>
                  {c.severity?.toUpperCase()}
                </span>
                <span className="forest-critique-type">{c.type?.replace(/_/g, ' ')}</span>
              </div>
              <div className="forest-critique-challenge">{c.challenge}</div>
              <div className="forest-critique-reasoning">{c.reasoning}</div>
              <div className="forest-critique-refs">
                {c.sourceCanvasKey && (
                  <button
                    className="forest-critique-ref-btn"
                    onClick={() => onNavigate?.(c.sourceCanvasKey, c.sourceNodeId)}
                  >
                    → {c.sourceCanvasKey}
                  </button>
                )}
                {c.targetCanvasKey && c.targetCanvasKey !== c.sourceCanvasKey && (
                  <button
                    className="forest-critique-ref-btn"
                    onClick={() => onNavigate?.(c.targetCanvasKey, c.targetNodeId)}
                  >
                    → {c.targetCanvasKey}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="forest-critique-suggestions">
          <div className="forest-critique-suggestions-title">💡 SUGGESTIONS</div>
          {suggestions.map((s, i) => (
            <div key={i} className="forest-critique-suggestion">{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}
