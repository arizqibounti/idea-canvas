// ── Sync Status Bar ────────────────────────────────────────
// Shows collaboration status in the toolbar when in a room.
// Displays: sync status dot, collaborator avatars, copy link button.

import React, { useState, useCallback } from 'react';
import { buildRoomUrl } from './roomUtils';

const STATUS_CONFIG = {
  synced:     { color: '#22c55e', label: 'Synced' },
  connecting: { color: '#facc15', label: 'Syncing...' },
  offline:    { color: '#f87171', label: 'Offline' },
};

export default function SyncStatusBar({ syncStatus, collaborators, roomId }) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = useCallback(() => {
    if (!roomId) return;
    const url = buildRoomUrl(roomId);
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for non-secure contexts
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomId]);

  const cfg = STATUS_CONFIG[syncStatus] || STATUS_CONFIG.connecting;
  const onlineCount = (collaborators?.length || 0) + 1; // +1 for self

  return (
    <div className="collab-bar">
      {/* Status dot + label */}
      <div className="collab-status">
        <span className="collab-status-dot" style={{ background: cfg.color }} />
        <span className="collab-status-label">{cfg.label}</span>
      </div>

      {/* Collaborator avatars */}
      <div className="collab-avatars">
        {collaborators && collaborators.map((c) => (
          <div
            key={c.clientId}
            className={`collab-avatar ${c.isGenerating ? 'generating' : ''}`}
            style={{ background: c.color }}
            title={c.name + (c.isGenerating ? ' (generating...)' : '')}
          >
            {(c.name || '?')[0].toUpperCase()}
          </div>
        ))}
        <span className="collab-count">{onlineCount} online</span>
      </div>

      {/* Copy room link */}
      <button
        className="collab-copy-btn"
        onClick={handleCopyLink}
        title="Copy room link to clipboard"
      >
        {copied ? '✓ Copied!' : '📋 Copy Link'}
      </button>
    </div>
  );
}
