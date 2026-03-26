// ── Forest Tab Bar: Horizontal Canvas Navigation ─────────────────
// Shows canvas tabs with status, back button, and action buttons.

import React from 'react';
import { useForest } from './ForestContext';

const STATUS_ICONS = {
  pending: '○',
  generating: '◌',
  ready: '●',
  error: '✗',
};

const STATUS_COLORS = {
  pending: '#555',
  generating: '#6c63ff',
  ready: '#20c997',
  error: '#ff4757',
};

export default function ForestTabBar({ onExit }) {
  const ctx = useForest();
  if (!ctx?.plan) return null;

  const {
    plan,
    activeCanvasKey,
    setActiveCanvas,
    forestCanvases,
    isGenerating,
    generateAll,
    runCritique,
    stopGeneration,
    crossRefs,
  } = ctx;

  const allReady = forestCanvases.every(c => c.status === 'ready');
  const anyGenerating = forestCanvases.some(c => c.status === 'generating');
  const anyPending = forestCanvases.some(c => c.status === 'pending');
  const readyCount = forestCanvases.filter(c => c.status === 'ready').length;

  return (
    <div className="forest-tab-bar">
      {/* Header row: back button + title + actions */}
      <div className="forest-tab-bar-header">
        {onExit && (
          <button className="forest-back-btn" onClick={onExit} title="Back to sessions">
            ← Back
          </button>
        )}
        <div className="forest-tab-bar-title">
          <span className="forest-tab-bar-icon">◈</span>
          <span className="forest-tab-bar-idea">{plan.idea?.slice(0, 60) || 'Forest'}</span>
          <span className="forest-tab-bar-stats">{readyCount}/{forestCanvases.length} canvases</span>
        </div>
        <div className="forest-tab-bar-actions">
          {anyPending && !anyGenerating && (
            <button className="forest-action-btn forest-action-generate" onClick={generateAll}>
              ▶ Generate All
            </button>
          )}
          {(anyGenerating || isGenerating) && (
            <button className="forest-action-btn forest-action-stop" onClick={stopGeneration}>
              ■ Stop
            </button>
          )}
          {allReady && !isGenerating && (
            <button className="forest-action-btn forest-action-critique" onClick={runCritique}>
              ⚔ Critique
            </button>
          )}
        </div>
      </div>

      {/* Canvas tabs row */}
      <div className="forest-tab-bar-tabs">
        {/* Overview tab */}
        <div
          className={`forest-tab ${activeCanvasKey === '__meta__' ? 'active' : ''}`}
          onClick={() => setActiveCanvas('__meta__')}
        >
          <span className="forest-tab-status" style={{ color: '#6c63ff' }}>◉</span>
          <span className="forest-tab-label">Overview</span>
          {crossRefs?.length > 0 && (
            <span className="forest-tab-badge">{crossRefs.length}</span>
          )}
        </div>

        {/* Canvas tabs */}
        {forestCanvases.map((canvas) => {
          const status = canvas.status || 'pending';
          const isActive = activeCanvasKey === canvas.canvasKey;
          return (
            <div
              key={canvas.canvasKey}
              className={`forest-tab ${isActive ? 'active' : ''} ${status === 'generating' ? 'generating' : ''}`}
              onClick={() => setActiveCanvas(canvas.canvasKey)}
              title={canvas.description}
            >
              <span className="forest-tab-status" style={{ color: STATUS_COLORS[status] }}>
                {STATUS_ICONS[status]}
              </span>
              <span className="forest-tab-label">{canvas.title}</span>
              {canvas.nodes?.length > 0 && (
                <span className="forest-tab-count">{canvas.nodes.length}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
