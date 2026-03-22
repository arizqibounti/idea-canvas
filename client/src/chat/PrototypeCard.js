// ── Inline Prototype Build Card for Chat ──────────────────────
// Renders prototype build progress/results directly in the chat stream.

import React from 'react';

const STEPS = [
  { id: 'planning', label: 'Plan', icon: '◇' },
  { id: 'generating', label: 'Generate', icon: '◈' },
  { id: 'wiring', label: 'Wire', icon: '⟡' },
  { id: 'polishing', label: 'Polish', icon: '✦' },
];

function getStepStatus(stepId, currentStatus) {
  const order = ['planning', 'generating', 'wiring', 'polishing', 'done'];
  const currentIdx = order.indexOf(currentStatus);
  const stepIdx = order.indexOf(stepId);
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
}

export default function PrototypeCard({ state, onAction }) {
  if (!state) return null;

  const { status, stage, screensTotal, screensComplete, screenNames, error } = state;

  const isActive = status === 'planning' || status === 'generating' || status === 'wiring' || status === 'polishing';
  const isDone = status === 'done';
  const isError = status === 'error';

  const pct = screensTotal > 0 ? Math.round((screensComplete / screensTotal) * 100) : 0;

  return (
    <div className={`chat-prototype-card ${isActive ? 'chat-prototype-card--active' : ''} ${isDone ? 'chat-prototype-card--done' : ''} ${isError ? 'chat-prototype-card--error' : ''}`}>
      <div className="prototype-card-header">
        <span className="prototype-card-icon">
          {isActive && <span className="refine-pulse">●</span>}
          {isDone && '✓'}
          {isError && '✗'}
        </span>
        <span className="prototype-card-title">
          {isActive && 'BUILDING PROTOTYPE'}
          {isDone && 'PROTOTYPE READY'}
          {isError && 'BUILD FAILED'}
        </span>
        {isActive && (
          <button className="prototype-card-stop-btn" onClick={() => onAction?.({ actionType: 'stopPrototype' })}>
            ⏹ Stop
          </button>
        )}
      </div>

      {/* Step progress indicators */}
      {(isActive || isDone) && (
        <div className="prototype-card-steps">
          {STEPS.map((step, i) => {
            const stepStatus = isDone ? 'done' : getStepStatus(step.id, status);
            return (
              <React.Fragment key={step.id}>
                <div className={`prototype-step prototype-step--${stepStatus}`}>
                  <span className="prototype-step-icon">
                    {stepStatus === 'done' ? '✓' : stepStatus === 'active' ? <span className="refine-pulse">●</span> : step.icon}
                  </span>
                  <span className="prototype-step-label">{step.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`prototype-step-connector ${stepStatus === 'done' ? 'prototype-step-connector--done' : ''}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Current stage detail */}
      {isActive && stage && (
        <div className="prototype-card-stage">{stage}</div>
      )}

      {/* Progress bar during screen generation */}
      {status === 'generating' && screensTotal > 0 && (
        <div className="prototype-card-progress">
          <div className="prototype-card-bar-bg">
            <div className="prototype-card-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="prototype-card-screen-count">
            {screensComplete}/{screensTotal} screens
          </div>
          {screenNames?.length > 0 && (
            <div className="prototype-card-screens-list">
              {screenNames.map((name, i) => (
                <span key={i} className="prototype-screen-tag">{name}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Done state — view button */}
      {isDone && (
        <button className="prototype-card-view-btn" onClick={() => onAction?.({ actionType: 'viewPrototype' })}>
          VIEW PROTOTYPE
        </button>
      )}

      {/* Error state */}
      {isError && error && (
        <div className="prototype-card-error">{error}</div>
      )}
    </div>
  );
}
