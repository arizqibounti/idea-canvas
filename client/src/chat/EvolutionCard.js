import React from 'react';
import { authFetch } from '../api';

const API_URL = process.env.REACT_APP_API_URL || '';

const STEP_ICONS = {
  refine: '⟳',
  debate: '⚔',
  experiment: '⧫',
  synthesize_export: '↓',
};

const STEP_LABELS = {
  refine: 'Refine',
  debate: 'Debate',
  experiment: 'Experiment',
  synthesize_export: 'Export',
};

export default function EvolutionCard({ taskId, plan, evolutionHistory, onUpdate }) {
  const steps = plan || ['refine', 'debate', 'experiment', 'refine', 'synthesize_export'];
  const history = evolutionHistory || [];
  const completedCount = history.length;
  const isComplete = completedCount >= steps.length;

  const handleRunNow = async () => {
    try {
      const res = await authFetch(`${API_URL}/api/tasks/${taskId}/run`, { method: 'POST' });
      if (res.ok) {
        const result = await res.json();
        onUpdate?.(result);
      }
    } catch (err) {
      console.error('Run now failed:', err);
    }
  };

  return (
    <div className="evolution-card">
      <div className="evolution-card-header">
        <span className="evolution-card-icon">⧬</span>
        <span className="evolution-card-title">Evolution Plan</span>
        {isComplete && <span className="evolution-card-badge complete">COMPLETE</span>}
        {!isComplete && <span className="evolution-card-badge active">ACTIVE</span>}
      </div>

      <div className="evolution-timeline">
        {steps.map((step, i) => {
          const stepHistory = history[i];
          const isCurrent = i === completedCount;
          const isDone = i < completedCount;
          const icon = STEP_ICONS[step] || '●';
          const label = STEP_LABELS[step] || step;

          return (
            <div key={i} className={`evolution-step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}>
              <div className="evolution-step-connector" />
              <div className="evolution-step-dot">{icon}</div>
              <div className="evolution-step-label">{label}</div>
              {stepHistory && (
                <div className="evolution-step-result">
                  {stepHistory.summary?.slice(0, 60)}
                  {stepHistory.docUrl && (
                    <a href={stepHistory.docUrl} target="_blank" rel="noopener noreferrer" className="evolution-doc-link">
                      Open Doc
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!isComplete && (
        <div className="evolution-card-actions">
          <button className="evolution-run-btn" onClick={handleRunNow}>
            Run Step {completedCount + 1} Now
          </button>
          <span className="evolution-schedule-info">
            Daily at 9:00 AM
          </span>
        </div>
      )}

      {history.length > 0 && history[history.length - 1]?.metaHint && (
        <div className="evolution-meta-hint">
          Meta-evolution suggests: <strong>{history[history.length - 1].metaHint.strategy}</strong>
          {' '}(avg delta: {history[history.length - 1].metaHint.avgDelta > 0 ? '+' : ''}{history[history.length - 1].metaHint.avgDelta})
        </div>
      )}
    </div>
  );
}
