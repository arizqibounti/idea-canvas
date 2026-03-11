// ── Share Modal ──────────────────────────────────────────────
// Modal for creating a shareable link with permissions and expiration.

import React, { useState, useCallback, useEffect } from 'react';
import { authFetch } from './api';
import { generateRoomId, buildRoomUrl } from './yjs/roomUtils';

const API_URL = process.env.REACT_APP_API_URL || '';

const EXPIRY_OPTIONS = [
  { value: 0, label: 'Never expires' },
  { value: 1, label: '1 hour' },
  { value: 24, label: '24 hours' },
  { value: 168, label: '7 days' },
  { value: 720, label: '30 days' },
];

export default function ShareModal({ isOpen, onClose, nodes, idea }) {
  const [stage, setStage] = useState('config'); // config | creating | success | error
  const [permission, setPermission] = useState('interact');
  const [expiresInHours, setExpiresInHours] = useState(168); // default 7 days
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setStage('config');
      setPermission('interact');
      setExpiresInHours(168);
      setShareUrl('');
      setCopied(false);
      setErrorMsg('');
    }
  }, [isOpen]);

  const handleCreate = useCallback(async () => {
    if (!nodes || nodes.length === 0) return;

    setStage('creating');
    try {
      const res = await authFetch(`${API_URL}/api/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea,
          nodes,
          permission,
          expiresInHours,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const share = await res.json();
      const url = `${window.location.origin}/share/${share.id}`;
      setShareUrl(url);
      setStage('success');
    } catch (err) {
      setErrorMsg(err.message);
      setStage('error');
    }
  }, [nodes, idea, permission, expiresInHours]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the input
      const input = document.querySelector('.share-url-input');
      if (input) { input.select(); document.execCommand('copy'); }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <span className="share-modal-title">Share Tree</span>
          <button className="share-modal-close" onClick={onClose}>×</button>
        </div>

        {stage === 'config' && (
          <div className="share-modal-body">
            {/* Live collaboration option */}
            <div className="share-field">
              <label className="share-label">Live Collaborate</label>
              <button
                className="share-collab-btn"
                onClick={() => {
                  const roomId = generateRoomId();
                  window.location.href = buildRoomUrl(roomId);
                }}
              >
                <span className="share-perm-icon">◉</span>
                <div>
                  <div className="share-perm-label">Start live session</div>
                  <div className="share-perm-hint">Edit together in real-time</div>
                </div>
              </button>
            </div>

            <div className="share-divider"><span>or share a snapshot</span></div>

            <div className="share-field">
              <label className="share-label">Permission</label>
              <div className="share-permission-group">
                <button
                  className={`share-perm-btn ${permission === 'view' ? 'active' : ''}`}
                  onClick={() => setPermission('view')}
                >
                  <span className="share-perm-icon">◎</span>
                  <div>
                    <div className="share-perm-label">View only</div>
                    <div className="share-perm-hint">Pan, zoom, inspect nodes</div>
                  </div>
                </button>
                <button
                  className={`share-perm-btn ${permission === 'interact' ? 'active' : ''}`}
                  onClick={() => setPermission('interact')}
                >
                  <span className="share-perm-icon">⟡</span>
                  <div>
                    <div className="share-perm-label">Interactive</div>
                    <div className="share-perm-hint">Full canvas interaction</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="share-field">
              <label className="share-label">Expiration</label>
              <select
                className="share-select"
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(Number(e.target.value))}
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="share-info">
              <span className="share-info-icon">ⓘ</span>
              <span>{nodes?.length || 0} nodes will be included in the snapshot</span>
            </div>

            <button className="share-create-btn" onClick={handleCreate}>
              ⊞ Generate Share Link
            </button>
          </div>
        )}

        {stage === 'creating' && (
          <div className="share-modal-body share-center">
            <div className="share-spinner" />
            <span className="share-creating-text">Creating share link...</span>
          </div>
        )}

        {stage === 'success' && (
          <div className="share-modal-body">
            <div className="share-success-icon">✓</div>
            <div className="share-field">
              <label className="share-label">Share Link</label>
              <div className="share-url-row">
                <input
                  className="share-url-input"
                  value={shareUrl}
                  readOnly
                  onClick={(e) => e.target.select()}
                />
                <button className="share-copy-btn" onClick={handleCopy}>
                  {copied ? '✓ Copied' : '⎘ Copy'}
                </button>
              </div>
            </div>
            <div className="share-meta">
              <span>Permission: {permission === 'view' ? 'View only' : 'Interactive'}</span>
              <span>Expires: {expiresInHours === 0 ? 'Never' : EXPIRY_OPTIONS.find(o => o.value === expiresInHours)?.label}</span>
            </div>
          </div>
        )}

        {stage === 'error' && (
          <div className="share-modal-body share-center">
            <div className="share-error-icon">✕</div>
            <span className="share-error-text">{errorMsg}</span>
            <button className="share-retry-btn" onClick={() => setStage('config')}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
