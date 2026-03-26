// ── Generation Flow Card ─────────────────────────────────────
// Shows real-time chain-of-thought during tree generation.
// Each pipeline stage is a mini-node with live status updates.

import React from 'react';

const STATUS_ICONS = {
  pending: '○',
  active: '●',
  done: '✓',
  error: '✗',
};

function formatElapsed(startedAt, completedAt) {
  if (!startedAt) return '';
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - new Date(startedAt).getTime();
  if (ms < 1000) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function GenerationFlowCard({ stages, isComplete, totalTime, nodeCount }) {
  if (!stages?.length) return null;

  return (
    <div className={`gen-flow-card ${isComplete ? 'gen-flow-card--done' : ''}`}>
      <div className="gen-flow-header">
        <span className="gen-flow-icon">
          {isComplete ? '✓' : <span className="refine-pulse">●</span>}
        </span>
        <span className="gen-flow-title">
          {isComplete ? 'GENERATION COMPLETE' : 'GENERATING'}
        </span>
        {isComplete && totalTime && (
          <span className="gen-flow-total-time">{totalTime}</span>
        )}
        {isComplete && nodeCount > 0 && (
          <span className="gen-flow-node-count">{nodeCount} nodes</span>
        )}
      </div>

      <div className="gen-flow-stages">
        {stages.map((stage, i) => (
          <div key={stage.id} className={`gen-flow-stage gen-flow-stage--${stage.status}`}>
            {/* Connector line */}
            {i > 0 && <div className={`gen-flow-connector ${stage.status === 'done' ? 'gen-flow-connector--done' : ''}`} />}

            <div className="gen-flow-stage-row">
              <span className={`gen-flow-stage-icon gen-flow-stage-icon--${stage.status}`}>
                {stage.status === 'active' ? <span className="refine-pulse">●</span> : STATUS_ICONS[stage.status]}
              </span>
              <span className="gen-flow-stage-label">{stage.label}</span>
              {stage.nodeCount > 0 && (
                <span className="gen-flow-stage-badge">{stage.nodeCount}</span>
              )}
              {stage.detail && (
                <span className="gen-flow-stage-detail">{stage.detail}</span>
              )}
              <span className="gen-flow-stage-time">
                {formatElapsed(stage.startedAt, stage.completedAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
