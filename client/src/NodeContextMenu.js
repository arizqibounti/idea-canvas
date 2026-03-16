import React from 'react';

export default function NodeContextMenu({
  x, y, nodeId, nodeData,
  onDrill, onToggleStar, onClose, sprintPhase,
  onExecuteAction, mode, hasProjectPath,
  onSplit, onMerge, onRippleDelete, onDeleteBranch,
  isSplitting, isMerging,
  onInspect,
}) {
  const isStarred = nodeData?.starred;
  const showStar = sprintPhase === 'converge';
  const isCodeMode = mode === 'codebase';
  const isExecuting = nodeData?.executionStatus === 'in_progress';
  const isFixed = nodeData?.executionStatus === 'completed';
  const isSeed = nodeData?.type === 'seed';

  return (
    <>
      <div className="ctx-overlay" onClick={onClose} />
      <div className="ctx-menu" style={{ left: x, top: y }}>
        <button
          className="ctx-item"
          onClick={() => { onDrill(nodeId); onClose(); }}
        >
          ⬇ DRILL DOWN
        </button>
        {showStar && (
          <button
            className="ctx-item ctx-item-star"
            onClick={() => { onToggleStar(nodeId); onClose(); }}
          >
            {isStarred ? '★ UNSTAR FOCUS' : '☆ MARK AS FOCUS'}
          </button>
        )}

        {/* ── Precision Editing Tools ── */}
        <div className="ctx-divider" />
        <button
          className={`ctx-item ${isSplitting ? 'ctx-item-disabled' : ''}`}
          onClick={() => { if (!isSplitting) { onSplit?.(); onClose(); } }}
          disabled={isSplitting}
          title="Split into two refined nodes (R)"
        >
          {isSplitting ? '⟳ SPLITTING…' : '✂ SPLIT (R)'}
        </button>
        <button
          className={`ctx-item ${isMerging ? 'ctx-item-active' : ''}`}
          onClick={() => { onMerge?.(); onClose(); }}
          title="Merge with another node — click this, then click target"
        >
          {isMerging ? '⊕ SELECT MERGE TARGET' : '⊕ MERGE WITH… (M)'}
        </button>
        {!isSeed && (
          <>
            <button
              className="ctx-item ctx-item-danger"
              onClick={() => { onRippleDelete?.(); onClose(); }}
              title="Remove node, re-parent children (Del)"
            >
              ✕ RIPPLE DELETE
            </button>
            <button
              className="ctx-item ctx-item-danger"
              onClick={() => { onDeleteBranch?.(); onClose(); }}
              title="Remove node and all descendants (Shift+Del)"
            >
              ✕ DELETE BRANCH
            </button>
          </>
        )}

        <div className="ctx-divider" />
        <button
          className="ctx-item"
          onClick={() => { onInspect?.(nodeId); onClose(); }}
          title="Open inspector panel (I)"
        >
          ⊞ INSPECT (I)
        </button>

        {isCodeMode && (
          <>
            <div className="ctx-divider" />
            <button
              className={`ctx-item ctx-item-execute ${isExecuting ? 'ctx-item-disabled' : ''} ${isFixed ? 'ctx-item-fixed' : ''}`}
              onClick={() => {
                if (!isExecuting) {
                  onExecuteAction?.(nodeId);
                  onClose();
                }
              }}
              disabled={isExecuting}
              title={!hasProjectPath ? 'Set local project path first' : isExecuting ? 'Already executing...' : isFixed ? 'Re-run fix' : 'Fix this issue with Claude Code'}
            >
              {isExecuting ? '⟳ FIXING…' : isFixed ? '⚡ RE-FIX' : '⚡ FIX THIS'}
            </button>
          </>
        )}
      </div>
    </>
  );
}
