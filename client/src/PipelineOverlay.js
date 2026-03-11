// ── Pipeline Overlay ─────────────────────────────────────────
// Prominent banner showing the full Generate → Debate → Refine → Portfolio pipeline.
// Appears when auto-refine/portfolio checkboxes are active and generation starts.

import React, { useEffect, useRef } from 'react';

const STAGE_ICONS = {
  generate:  '◈',
  debate:    '⚔',
  refine:    '⟲',
  portfolio: '◆',
};

function StageNode({ stage, isLast }) {
  const statusClass =
    stage.status === 'done' ? 'pipe-stage-done' :
    stage.status === 'active' ? 'pipe-stage-active' :
    'pipe-stage-pending';

  return (
    <>
      <div className={`pipe-stage ${statusClass}`}>
        <div className="pipe-stage-icon">
          {stage.status === 'done' ? '✓' : STAGE_ICONS[stage.id] || '●'}
        </div>
        <div className="pipe-stage-label">{stage.label}</div>
        {stage.detail && stage.status === 'active' && (
          <div className="pipe-stage-detail">{stage.detail}</div>
        )}
      </div>
      {!isLast && (
        <div className={`pipe-connector ${stage.status === 'done' ? 'pipe-connector-done' : ''}`}>
          <div className="pipe-connector-line" />
          {stage.status === 'done' && <div className="pipe-connector-flow" />}
        </div>
      )}
    </>
  );
}

export default function PipelineOverlay({ stages, onClose }) {
  const scrollRef = useRef(null);

  // Find the currently active stage for the detail display
  const activeStage = stages?.find(s => s.status === 'active');
  const allDone = stages?.every(s => s.status === 'done');
  const completedCount = stages?.filter(s => s.status === 'done').length || 0;
  const totalCount = stages?.length || 0;

  // Auto-dismiss after all stages complete
  useEffect(() => {
    if (allDone) {
      const timer = setTimeout(() => onClose?.(), 4000);
      return () => clearTimeout(timer);
    }
  }, [allDone, onClose]);

  if (!stages?.length) return null;

  return (
    <div className={`pipeline-overlay ${allDone ? 'pipeline-complete' : ''}`}>
      {/* Header */}
      <div className="pipeline-header">
        <div className="pipeline-header-left">
          <span className="pipeline-icon">⟡</span>
          <span className="pipeline-title">
            {allDone ? 'PIPELINE COMPLETE' : 'PIPELINE ACTIVE'}
          </span>
          <span className="pipeline-counter">
            {completedCount}/{totalCount}
          </span>
        </div>
        <button className="pipeline-close" onClick={onClose}>✕</button>
      </div>

      {/* Stage stepper */}
      <div className="pipeline-stepper" ref={scrollRef}>
        {stages.map((stage, i) => (
          <StageNode key={stage.id} stage={stage} isLast={i === stages.length - 1} />
        ))}
      </div>

      {/* Active stage detail */}
      {activeStage && (
        <div className="pipeline-detail">
          <div className="pipeline-detail-header">
            <span className="pipeline-detail-icon">{STAGE_ICONS[activeStage.id]}</span>
            <span className="pipeline-detail-label">{activeStage.label}</span>
            {activeStage.round && (
              <span className="pipeline-detail-round">
                Round {activeStage.round}/{activeStage.maxRounds}
              </span>
            )}
          </div>
          {activeStage.detail && (
            <div className="pipeline-detail-text">
              <span className="pipeline-pulse">●</span>
              {activeStage.detail}
            </div>
          )}
          {activeStage.substages && (
            <div className="pipeline-substages">
              {activeStage.substages.map((sub, i) => (
                <span
                  key={i}
                  className={`pipeline-substage ${
                    sub.status === 'done' ? 'sub-done' :
                    sub.status === 'active' ? 'sub-active' : 'sub-pending'
                  }`}
                >
                  {sub.status === 'done' ? '✓' : sub.status === 'active' ? '●' : '○'} {sub.label}
                </span>
              ))}
            </div>
          )}
          {/* Progress bar */}
          {activeStage.progress != null && (
            <div className="pipeline-progress-track">
              <div
                className="pipeline-progress-fill"
                style={{ width: `${Math.min(100, activeStage.progress)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Completion message */}
      {allDone && (
        <div className="pipeline-done-msg">
          All stages complete — your thinking tree has been refined and diversified.
        </div>
      )}
    </div>
  );
}
