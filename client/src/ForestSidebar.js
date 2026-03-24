// ── Forest Sidebar: Canvas Navigation ────────────────────────
// Narrow sidebar within forest mode showing canvas tabs and controls.

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

export default function ForestSidebar() {
  const ctx = useForest();
  if (!ctx?.plan) return null;

  const { plan, activeCanvasKey, setActiveCanvas, canvasStatuses, isGenerating, generateAll, runCritique, stopGeneration, crossRefs } = ctx;

  const allReady = plan.canvases.every(c => canvasStatuses[c.canvasKey] === 'ready');
  const anyGenerating = Object.values(canvasStatuses).some(s => s === 'generating');

  return (
    <div className="forest-sidebar">
      <div className="forest-sidebar-header">
        <div className="forest-sidebar-title">◈ FOREST</div>
        <div className="forest-sidebar-idea" title={ctx.forest?.idea}>
          {ctx.forest?.idea?.slice(0, 60)}{ctx.forest?.idea?.length > 60 ? '…' : ''}
        </div>
      </div>

      {/* Meta view toggle */}
      <div
        className={`forest-canvas-tab ${activeCanvasKey === '__meta__' ? 'active' : ''}`}
        onClick={() => setActiveCanvas('__meta__')}
      >
        <span className="forest-tab-icon" style={{ color: '#6c63ff' }}>◎</span>
        <span className="forest-tab-label">Overview</span>
        {crossRefs?.length > 0 && (
          <span className="forest-tab-badge">{crossRefs.length}</span>
        )}
      </div>

      <div className="forest-sidebar-divider" />

      {/* Canvas tabs */}
      <div className="forest-canvas-list">
        {plan.canvases.map((canvasDef, i) => {
          const status = canvasStatuses[canvasDef.canvasKey] || 'pending';
          const isActive = activeCanvasKey === canvasDef.canvasKey;
          return (
            <div
              key={canvasDef.canvasKey}
              className={`forest-canvas-tab ${isActive ? 'active' : ''} ${status === 'generating' ? 'generating' : ''}`}
              onClick={() => setActiveCanvas(canvasDef.canvasKey)}
              title={canvasDef.description}
            >
              <span className="forest-tab-status" style={{ color: STATUS_COLORS[status] }}>
                {STATUS_ICONS[status]}
              </span>
              <span className="forest-tab-label">{canvasDef.title}</span>
              {canvasDef.dependencies?.length > 0 && (
                <span className="forest-tab-deps" title={`Depends on: ${canvasDef.dependencies.join(', ')}`}>
                  ⟵{canvasDef.dependencies.length}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="forest-sidebar-divider" />

      {/* Actions */}
      <div className="forest-sidebar-actions">
        {!allReady && !anyGenerating && (
          <button className="forest-action-btn forest-action-generate" onClick={generateAll}>
            ▶ Generate All
          </button>
        )}
        {anyGenerating && (
          <button className="forest-action-btn forest-action-stop" onClick={stopGeneration}>
            ■ Stop
          </button>
        )}
        {allReady && (
          <button className="forest-action-btn forest-action-critique" onClick={runCritique}>
            ⚔ Cross-Canvas Critique
          </button>
        )}
      </div>
    </div>
  );
}
