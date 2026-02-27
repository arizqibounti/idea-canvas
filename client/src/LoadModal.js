import React from 'react';

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function LoadModal({ sessions, onLoad, onDelete, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>SAVED SESSIONS</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {sessions.length === 0 ? (
            <p className="modal-empty">No saved sessions.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="session-row">
                <div className="session-meta">
                  <span className="session-idea">{s.idea}</span>
                  <span className="session-info">
                    {formatDate(s.timestamp)} · {s.nodeCount} nodes
                  </span>
                </div>
                <div className="session-actions">
                  <button
                    className="btn btn-generate session-load"
                    onClick={() => onLoad(s)}
                  >
                    ↩ LOAD
                  </button>
                  <button
                    className="session-delete"
                    onClick={() => onDelete(s.id)}
                    title="Delete session"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
