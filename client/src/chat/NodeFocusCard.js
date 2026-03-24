// ── Node Focus Card for Chat ──────────────────────────────────
// Replaces NodeEditPanel + NodeContextMenu with a chat-first interaction.
// Renders as a sticky card in the ChatPanel with all node actions inline.

import React, { useState } from 'react';
import { getNodeConfig } from '../nodeConfig';

export default function NodeFocusCard({ node, surgicalExpanded, isSplitting, isMerging, mergeTarget, onAction, onDismiss, availablePatterns = [] }) {
  const [showSurgical, setShowSurgical] = useState(surgicalExpanded || false);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editReasoning, setEditReasoning] = useState('');
  const [showPatternPicker, setShowPatternPicker] = useState(false);

  if (!node) return null;

  const data = node.data || {};
  const config = getNodeConfig(data.type, data.dynamicConfig);
  const isSeed = data.type === 'seed';
  const nodeId = node.id;
  const currentPattern = data.pattern || null;
  const currentPatternMeta = currentPattern ? availablePatterns.find(p => p.id === currentPattern) : null;

  const handleStartEdit = () => {
    setEditLabel(data.label || '');
    setEditReasoning(data.reasoning || '');
    setEditing(true);
  };

  const handleSaveEdit = () => {
    onAction?.({ actionType: 'editNodeSave', nodeId, updates: { label: editLabel, reasoning: editReasoning } });
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditing(false);
  };

  const handleSelectPattern = (patternId) => {
    onAction?.({ actionType: 'assignPattern', nodeId, patternId });
    setShowPatternPicker(false);
  };

  return (
    <div className="chat-node-focus-card" style={{ borderLeftColor: config.color }}>
      {/* Header */}
      <div className="nfc-header">
        <span className="nfc-type-badge" style={{ background: `${config.color}22`, color: config.color, borderColor: `${config.color}44` }}>
          {config.icon} {config.label}
        </span>
        <span className="nfc-label" title={data.label}>{data.label}</span>
        <button className="nfc-dismiss" onClick={onDismiss} title="Dismiss">✕</button>
      </div>

      {/* Reasoning */}
      {data.reasoning && !editing && (
        <div className="nfc-reasoning">{data.reasoning}</div>
      )}

      {/* Edit mode */}
      {editing ? (
        <div className="nfc-edit">
          <textarea
            className="nfc-edit-input"
            value={editLabel}
            onChange={e => setEditLabel(e.target.value)}
            placeholder="Label"
            rows={1}
          />
          <textarea
            className="nfc-edit-input nfc-edit-reasoning"
            value={editReasoning}
            onChange={e => setEditReasoning(e.target.value)}
            placeholder="Reasoning"
            rows={2}
          />
          <div className="nfc-edit-actions">
            <button className="nfc-btn nfc-btn-primary" onClick={handleSaveEdit}>Save</button>
            <button className="nfc-btn" onClick={handleCancelEdit}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {/* Primary actions */}
          <div className="nfc-actions">
            <button className="nfc-btn" onClick={() => onAction?.({ actionType: 'expandNode', nodeId })} title="Expand this node">
              ⬇ Expand
            </button>
            <button className="nfc-btn" onClick={() => onAction?.({ actionType: 'drillDown', nodeId })} title="Drill into subtree">
              ⊞ Drill
            </button>
            <button className="nfc-btn" onClick={() => onAction?.({ actionType: 'regenerateNode', nodeId })} title="Regenerate subtree">
              ↻ Regen
            </button>
            <button className="nfc-btn" onClick={() => onAction?.({ actionType: 'toggleStar', nodeId })} title={data.starred ? 'Unstar' : 'Star'}>
              {data.starred ? '★' : '☆'} {data.starred ? 'Unstar' : 'Star'}
            </button>
            <button className="nfc-btn" onClick={handleStartEdit} title="Edit label & reasoning">
              ✎ Edit
            </button>
            {availablePatterns.length > 0 && (
              <div className="nfc-pattern-row">
                <button
                  className={`nfc-btn ${currentPattern ? 'nfc-btn-active' : ''}`}
                  onClick={() => setShowPatternPicker(!showPatternPicker)}
                  title={currentPattern ? `Pattern: ${currentPatternMeta?.name || currentPattern}` : 'Assign thinking pattern to this subtree'}
                  style={currentPatternMeta ? { borderColor: `${currentPatternMeta.color}66` } : undefined}
                >
                  {currentPatternMeta?.icon || '◈'} {currentPattern ? (currentPatternMeta?.name || currentPattern) : 'Pattern'}
                </button>
                {currentPattern && (
                  <button
                    className="nfc-btn nfc-btn-run"
                    onClick={() => onAction?.({ actionType: 'runPatternOnSubtree', nodeId, patternId: currentPattern })}
                    title={`Run ${currentPatternMeta?.name || currentPattern} on this subtree (${data.childCount || 0} children)`}
                    style={{ borderColor: `${currentPatternMeta?.color || '#6c63ff'}66` }}
                  >
                    ▶ Run on subtree
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Pattern picker dropdown */}
          {showPatternPicker && (
            <div className="nfc-pattern-picker">
              <button
                className={`nfc-pattern-option ${!currentPattern ? 'nfc-pattern-active' : ''}`}
                onClick={() => handleSelectPattern(null)}
              >
                <span className="nfc-pattern-icon">↩</span>
                <span className="nfc-pattern-name">Clear (inherit)</span>
                {!currentPattern && <span className="nfc-pattern-check">✓</span>}
              </button>
              {availablePatterns.map(p => (
                <button
                  key={p.id}
                  className={`nfc-pattern-option ${currentPattern === p.id ? 'nfc-pattern-active' : ''}`}
                  onClick={() => handleSelectPattern(p.id)}
                >
                  <span className="nfc-pattern-icon" style={{ color: p.color }}>{p.icon}</span>
                  <span className="nfc-pattern-name">{p.name}</span>
                  {currentPattern === p.id && <span className="nfc-pattern-check">✓</span>}
                </button>
              ))}
            </div>
          )}

          {/* Surgical tools toggle */}
          <button
            className="nfc-surgical-toggle"
            onClick={() => setShowSurgical(!showSurgical)}
          >
            {showSurgical ? '▾' : '▸'} Precision Tools
          </button>

          {/* Surgical tools */}
          {showSurgical && (
            <div className="nfc-surgical">
              <button
                className="nfc-btn"
                onClick={() => onAction?.({ actionType: 'splitNode', nodeId })}
                disabled={isSplitting}
                title="Split into two refined nodes"
              >
                {isSplitting ? '⏳' : '✂'} Split
              </button>
              <button
                className="nfc-btn"
                onClick={() => onAction?.({ actionType: isMerging ? 'cancelMerge' : 'mergeNode', nodeId })}
                disabled={isSplitting}
                title={isMerging ? 'Cancel merge' : 'Merge with another node'}
                style={isMerging ? { background: '#818cf822', borderColor: '#818cf8' } : undefined}
              >
                {isMerging ? '⊘ Cancel Merge' : '⊕ Merge With…'}
              </button>
              {!isSeed && (
                <>
                  <button
                    className="nfc-btn nfc-btn-danger"
                    onClick={() => onAction?.({ actionType: 'rippleDelete', nodeId })}
                    title="Remove node, re-parent children"
                  >
                    ✕ Ripple Delete
                  </button>
                  <button
                    className="nfc-btn nfc-btn-danger"
                    onClick={() => onAction?.({ actionType: 'deleteBranch', nodeId })}
                    title="Remove node + all descendants"
                  >
                    ✕ Delete Branch
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Merge target indicator */}
      {isMerging && mergeTarget && (
        <div className="nfc-merge-hint">
          Click another node on the canvas to merge with "{mergeTarget.data?.label || mergeTarget.id}"
        </div>
      )}

      {/* Meta info */}
      <div className="nfc-meta">
        {data.depth !== undefined && <span>depth {data.depth}</span>}
        {data.childCount > 0 && <span>{data.childCount} children</span>}
        {data.parentIds?.length > 1 && <span>convergence</span>}
        {data.patternMeta && <span style={{ color: data.patternMeta.color }}>{data.patternMeta.icon} {data.patternMeta.name}</span>}
      </div>
    </div>
  );
}
