import React from 'react';

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function nodeDelta(prev, curr) {
  if (!prev) return { added: curr, removed: [] };
  const prevIds = new Set(prev.map((n) => n.id));
  const currIds = new Set(curr.map((n) => n.id));
  return {
    added: curr.filter((n) => !prevIds.has(n.id)),
    removed: prev.filter((n) => !currIds.has(n.id)),
  };
}

export default function HistoryModal({ versions, currentNodes, onLoad, onClose }) {
  // versions: array of { id, label, timestamp, nodeCount, rawNodes }
  // sorted newest-first (index 0 = current/latest)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box history-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>VERSION HISTORY</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {versions.length === 0 ? (
            <p className="modal-empty">No saved versions yet.</p>
          ) : (
            versions.map((v, i) => {
              const prev = versions[i + 1];
              const delta = nodeDelta(prev?.rawNodes, v.rawNodes);
              const isCurrent = i === 0;
              return (
                <div key={v.id} className={`history-row ${isCurrent ? 'history-row-current' : ''}`}>
                  <div className="history-timeline-col">
                    <div className={`history-dot ${isCurrent ? 'history-dot-current' : ''}`} />
                    {i < versions.length - 1 && <div className="history-line" />}
                  </div>
                  <div className="history-content">
                    <div className="history-meta-row">
                      <span className="history-timestamp">{formatDate(v.timestamp)}</span>
                      {isCurrent && (
                        <span className="history-current-badge">CURRENT</span>
                      )}
                    </div>
                    <div className="history-counts-row">
                      <span className="history-node-count">{v.nodeCount} nodes</span>
                      {prev && (
                        <>
                          {delta.added.length > 0 && (
                            <span className="history-delta added">+{delta.added.length}</span>
                          )}
                          {delta.removed.length > 0 && (
                            <span className="history-delta removed">−{delta.removed.length}</span>
                          )}
                        </>
                      )}
                      {!prev && (
                        <span className="history-delta origin">origin</span>
                      )}
                    </div>
                    {delta.added.length > 0 && i > 0 && (
                      <div className="history-added-labels">
                        {delta.added.slice(0, 4).map((n) => (
                          <span key={n.id} className="history-label-chip added-chip">
                            {n.data?.label}
                          </span>
                        ))}
                        {delta.added.length > 4 && (
                          <span className="history-label-chip muted-chip">
                            +{delta.added.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {!isCurrent && (
                    <button
                      className="btn btn-generate history-load-btn"
                      onClick={() => onLoad(v)}
                    >
                      ↩ RESTORE
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
