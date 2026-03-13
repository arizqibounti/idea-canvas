import React from 'react';

export default function NodeContextMenu({ x, y, nodeId, nodeData, onDrill, onToggleStar, onClose, sprintPhase, onExecuteAction, mode, hasProjectPath }) {
  const isStarred = nodeData?.starred;
  const showStar = sprintPhase === 'converge';
  const isCodeMode = mode === 'codebase';
  const isExecuting = nodeData?.executionStatus === 'in_progress';
  const isFixed = nodeData?.executionStatus === 'completed';

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
        {isCodeMode && (
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
        )}
      </div>
    </>
  );
}
