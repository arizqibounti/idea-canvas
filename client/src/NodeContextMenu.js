import React from 'react';

export default function NodeContextMenu({ x, y, nodeId, nodeData, onDrill, onToggleStar, onClose, sprintPhase }) {
  const isStarred = nodeData?.starred;
  const showStar = sprintPhase === 'converge';

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
      </div>
    </>
  );
}
