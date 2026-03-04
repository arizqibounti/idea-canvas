// ── A2UI Canvas Panel ─────────────────────────────────────────
// Tabbed panel for viewing interactive canvas artifacts (landscapes,
// timelines, dashboards, mockups). Each artifact renders in an iframe.

import React, { useState, useCallback } from 'react';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

const ARTIFACT_TYPES = [
  { key: 'landscape', label: 'Landscape', icon: '◉' },
  { key: 'timeline', label: 'Timeline', icon: '⟶' },
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'mockup', label: 'Mockup', icon: '◱' },
];

export default function CanvasPanel({ onClose, artifacts, setArtifacts, nodes, idea, gateway }) {
  const [activeTab, setActiveTab] = useState(null);
  const [generating, setGenerating] = useState(null); // which artifact type is generating

  // Get artifact for a tab
  const getArtifact = (type) => artifacts.find(a => a.type === type);

  // Generate an artifact on demand
  const handleGenerate = useCallback(async (artifactType) => {
    if (generating) return;
    setGenerating(artifactType);
    setActiveTab(artifactType);

    try {
      const reqBody = {
        artifactType,
        nodes: nodes.map(n => n.data || n),
        idea,
      };

      let artifact = null;

      // Try WebSocket first
      if (gateway?.connected) {
        artifact = await new Promise((resolve) => {
          const reqId = gateway.send('canvas:generate', reqBody, {
            onResult: (data) => resolve(data),
            onDone: () => resolve(null),
            onError: () => resolve(null),
          });
          if (!reqId) resolve(null);
        });
      }

      // Fall back to REST if WS failed or unavailable
      if (!artifact) {
        const res = await authFetch(`${API_URL}/api/canvas/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        artifact = await res.json();
      }

      if (artifact?.html) {
        setArtifacts(prev => {
          // Replace existing artifact of same type, or add new
          const filtered = prev.filter(a => a.type !== artifactType);
          return [...filtered, artifact];
        });
      }
    } catch (err) {
      console.error('Canvas generate error:', err);
    } finally {
      setGenerating(null);
    }
  }, [generating, gateway, nodes, idea, setArtifacts]);

  const activeArtifact = activeTab ? getArtifact(activeTab) : null;

  return (
    <div className="canvas-panel">
      <div className="canvas-panel-header">
        <div className="canvas-panel-title">
          <span className="canvas-panel-icon">◈</span>
          <span>A2UI CANVAS</span>
        </div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      {/* Tab bar */}
      <div className="canvas-tabs">
        {ARTIFACT_TYPES.map(({ key, label, icon }) => {
          const hasArtifact = !!getArtifact(key);
          const isGenerating = generating === key;
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              className={`canvas-tab ${isActive ? 'active' : ''} ${hasArtifact ? 'has-artifact' : ''}`}
              onClick={() => hasArtifact ? setActiveTab(key) : handleGenerate(key)}
              disabled={isGenerating || (!hasArtifact && !nodes?.length)}
              title={hasArtifact ? `View ${label}` : `Generate ${label}`}
            >
              <span className="canvas-tab-icon">{isGenerating ? '◌' : icon}</span>
              <span className="canvas-tab-label">{label}</span>
              {!hasArtifact && nodes?.length > 0 && (
                <span className="canvas-tab-generate">+</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div className="canvas-content">
        {generating && (
          <div className="canvas-generating">
            <div className="canvas-generating-spinner">◌</div>
            <div className="canvas-generating-text">
              Generating {generating} artifact...
            </div>
          </div>
        )}

        {!generating && activeArtifact && (
          <iframe
            title={activeArtifact.title}
            srcDoc={activeArtifact.html}
            className="canvas-iframe"
            sandbox="allow-scripts"
          />
        )}

        {!generating && !activeArtifact && (
          <div className="canvas-empty">
            <div className="canvas-empty-icon">◈</div>
            <div className="canvas-empty-title">A2UI CANVAS</div>
            <div className="canvas-empty-desc">
              {nodes?.length > 0
                ? 'Click a tab above to generate an interactive visualization from your thinking tree.'
                : 'Generate a thinking tree first, then use the canvas to create visualizations.'}
            </div>
            {nodes?.length > 0 && (
              <div className="canvas-quick-generate">
                {ARTIFACT_TYPES.map(({ key, label, icon }) => (
                  <button
                    key={key}
                    className="canvas-quick-btn"
                    onClick={() => handleGenerate(key)}
                    disabled={generating != null}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
