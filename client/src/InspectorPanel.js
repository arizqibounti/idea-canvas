// ── Inspector Panel ──────────────────────────────────────────
// Deep node editing panel with full metadata control.
// Slide-in from right, shows: editable label/reasoning, type selector,
// parent links, children list, scores, timestamps, and raw data view.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './InspectorPanel.css';

const TYPE_OPTIONS = [
  'thesis', 'hypothesis', 'antithesis', 'synthesis', 'evidence',
  'assumption', 'implication', 'question', 'constraint', 'analogy',
  'experiment', 'refinement', 'component', 'risk',
];

const TYPE_COLORS = {
  thesis: '#a78bfa', hypothesis: '#818cf8', antithesis: '#f472b6',
  synthesis: '#34d399', evidence: '#60a5fa', assumption: '#fbbf24',
  implication: '#f97316', question: '#e879f9', constraint: '#94a3b8',
  analogy: '#2dd4bf', experiment: '#a3e635', refinement: '#c084fc',
  component: '#38bdf8', risk: '#fb7185',
};

function getParentIds(n) {
  return n.data?.parentIds || (n.data?.parentId ? [n.data.parentId] : []);
}

export default function InspectorPanel({
  node,           // the full node object
  rawNodesRef,    // for parent/child lookups
  onSave,         // (nodeId, updates) => void
  onClose,        // close panel
  onNodeClick,    // navigate to a node
}) {
  const [editLabel, setEditLabel] = useState('');
  const [editReasoning, setEditReasoning] = useState('');
  const [editType, setEditType] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Populate fields when node changes
  useEffect(() => {
    if (!node) return;
    setEditLabel(node.data?.label || '');
    setEditReasoning(node.data?.reasoning || '');
    setEditType(node.data?.type || '');
    setDirty(false);
  }, [node]);

  const handleFieldChange = useCallback((setter) => (e) => {
    setter(e.target.value);
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!node || !dirty) return;
    onSave(node.id, {
      label: editLabel,
      reasoning: editReasoning,
      type: editType,
    });
    setDirty(false);
  }, [node, dirty, editLabel, editReasoning, editType, onSave]);

  // Parent and child info
  const { parents, children } = useMemo(() => {
    if (!node || !rawNodesRef?.current) return { parents: [], children: [] };
    const nodes = rawNodesRef.current;
    const parentIds = getParentIds(node);
    const parents = parentIds
      .map(pid => nodes.find(n => n.id === pid))
      .filter(Boolean);
    const children = nodes.filter(n => {
      const pids = getParentIds(n);
      return pids.includes(node.id);
    });
    return { parents, children };
  }, [node, rawNodesRef]);

  // Keyboard: Esc to close, Ctrl+S to save
  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape') { onClose(); return; }
      const mod = navigator.platform?.includes('Mac') ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, handleSave]);

  if (!node) return null;
  const d = node.data || {};
  const color = TYPE_COLORS[d.type] || '#888';

  return (
    <div className="inspector-panel">
      {/* Header */}
      <div className="inspector-header">
        <div className="inspector-title-row">
          <div className="inspector-dot" style={{ background: color }} />
          <span className="inspector-title">Inspector</span>
          <span className="inspector-node-id">{node.id?.slice(0, 8)}…</span>
        </div>
        <button className="inspector-close" onClick={onClose}>✕</button>
      </div>

      <div className="inspector-body">
        {/* Type selector */}
        <div className="inspector-section">
          <label className="inspector-label">Type</label>
          <div className="inspector-type-grid">
            {TYPE_OPTIONS.map(t => (
              <button
                key={t}
                className={`inspector-type-chip ${editType === t ? 'active' : ''}`}
                style={{
                  borderColor: editType === t ? (TYPE_COLORS[t] || '#888') : 'transparent',
                  color: editType === t ? (TYPE_COLORS[t] || '#888') : '#666',
                }}
                onClick={() => { setEditType(t); setDirty(true); }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Label */}
        <div className="inspector-section">
          <label className="inspector-label">Label</label>
          <textarea
            className="inspector-textarea"
            value={editLabel}
            onChange={handleFieldChange(setEditLabel)}
            rows={2}
            placeholder="Node label…"
          />
        </div>

        {/* Reasoning */}
        <div className="inspector-section">
          <label className="inspector-label">Reasoning</label>
          <textarea
            className="inspector-textarea inspector-reasoning"
            value={editReasoning}
            onChange={handleFieldChange(setEditReasoning)}
            rows={4}
            placeholder="Reasoning / notes…"
          />
        </div>

        {/* Metadata badges */}
        <div className="inspector-section">
          <label className="inspector-label">Metadata</label>
          <div className="inspector-meta-row">
            {d.starred && <span className="inspector-badge badge-star">★ Starred</span>}
            {d.score != null && (
              <span className={`inspector-badge ${d.score >= 8 ? 'badge-good' : d.score >= 5 ? 'badge-mid' : 'badge-low'}`}>
                Score: {d.score}/10
              </span>
            )}
            {d.lens && <span className="inspector-badge badge-lens">{d.lens}</span>}
            {d.depth > 0 && <span className="inspector-badge badge-depth">Depth {d.depth}</span>}
          </div>
        </div>

        {/* Parents */}
        {parents.length > 0 && (
          <div className="inspector-section">
            <label className="inspector-label">Parents ({parents.length})</label>
            <div className="inspector-node-list">
              {parents.map(p => (
                <button
                  key={p.id}
                  className="inspector-node-link"
                  onClick={() => onNodeClick?.(p)}
                >
                  <span className="inspector-link-dot" style={{ background: TYPE_COLORS[p.data?.type] || '#888' }} />
                  <span className="inspector-link-label">{p.data?.label?.slice(0, 40) || p.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Children */}
        {children.length > 0 && (
          <div className="inspector-section">
            <label className="inspector-label">Children ({children.length})</label>
            <div className="inspector-node-list">
              {children.slice(0, 10).map(c => (
                <button
                  key={c.id}
                  className="inspector-node-link"
                  onClick={() => onNodeClick?.(c)}
                >
                  <span className="inspector-link-dot" style={{ background: TYPE_COLORS[c.data?.type] || '#888' }} />
                  <span className="inspector-link-label">{c.data?.label?.slice(0, 40) || c.id}</span>
                </button>
              ))}
              {children.length > 10 && (
                <span className="inspector-more">+{children.length - 10} more</span>
              )}
            </div>
          </div>
        )}

        {/* Raw JSON toggle */}
        <div className="inspector-section">
          <button className="inspector-raw-toggle" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? '▾' : '▸'} Raw Data
          </button>
          {showRaw && (
            <pre className="inspector-raw-json">
              {JSON.stringify(d, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* Footer save bar */}
      {dirty && (
        <div className="inspector-footer">
          <button className="inspector-save-btn" onClick={handleSave}>
            Save Changes
          </button>
          <span className="inspector-save-hint">⌘S</span>
        </div>
      )}
    </div>
  );
}
