// ── Preview Overlay ──────────────────────────────────────────
// Atomic preview/reject for AI-generated results.
// Shows a diff-style overlay: "Here's what AI produced — Accept or Reject?"
// Used for regeneration, split, merge results before committing.

import React, { useMemo } from 'react';

const TYPE_COLORS = {
  thesis: '#a78bfa', hypothesis: '#818cf8', antithesis: '#f472b6',
  synthesis: '#34d399', evidence: '#60a5fa', assumption: '#fbbf24',
  implication: '#f97316', question: '#e879f9', constraint: '#94a3b8',
  analogy: '#2dd4bf', experiment: '#a3e635', refinement: '#c084fc',
  component: '#38bdf8', risk: '#fb7185', default: '#888',
};

function getColor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.default;
}

export default function PreviewOverlay({
  previewNodes,   // array of nodes to preview
  removedNodeIds, // set of node IDs that would be removed
  onAccept,       // callback to accept the changes
  onReject,       // callback to reject the changes
  actionLabel,    // e.g., "Split", "Merge", "Regenerate"
}) {
  const stats = useMemo(() => {
    const added = previewNodes?.length || 0;
    const removed = removedNodeIds?.size || 0;
    return { added, removed };
  }, [previewNodes, removedNodeIds]);

  if (!previewNodes || previewNodes.length === 0) return null;

  return (
    <div className="preview-overlay">
      <div className="preview-overlay-backdrop" onClick={onReject} />
      <div className="preview-overlay-card">
        {/* Header */}
        <div className="preview-header">
          <span className="preview-action-badge">{actionLabel || 'AI Result'}</span>
          <span className="preview-stats">
            {stats.added > 0 && <span className="preview-stat-add">+{stats.added} new</span>}
            {stats.removed > 0 && <span className="preview-stat-remove">−{stats.removed} removed</span>}
          </span>
        </div>

        {/* Node cards */}
        <div className="preview-nodes-list">
          {previewNodes.map((node, i) => {
            const d = node.data || {};
            const color = getColor(d.type);
            return (
              <div key={node.id || i} className="preview-node-card" style={{ borderLeftColor: color }}>
                <div className="preview-node-type" style={{ color }}>
                  {(d.type || 'node').toUpperCase()}
                </div>
                <div className="preview-node-label">{d.label || 'Untitled'}</div>
                {d.reasoning && (
                  <div className="preview-node-reasoning">{d.reasoning}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="preview-actions">
          <button className="preview-btn preview-btn-reject" onClick={onReject}>
            ✕ Reject
          </button>
          <button className="preview-btn preview-btn-accept" onClick={onAccept}>
            ✓ Accept
          </button>
        </div>

        <div className="preview-hint">
          Press <kbd>Enter</kbd> to accept · <kbd>Esc</kbd> to reject
        </div>
      </div>
    </div>
  );
}
