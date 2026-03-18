// ── Video Modal ─────────────────────────────────────────────
// Modal for displaying mnemonic video generation progress and playback.

import React, { useEffect, useRef } from 'react';

export default function VideoModal({ isOpen, onClose, job, nodeLabel, onRetry }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (!isOpen && videoRef.current) {
      videoRef.current.pause();
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen || !job) return null;

  const { status, mnemonicStrategy, veoPrompt, briefDescription, videoUrl, error } = job;

  return (
    <div className="video-modal-overlay" onClick={onClose}>
      <div className="video-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="video-modal-header">
          <div className="video-modal-title">
            <span className="video-modal-icon">🎬</span>
            <span>Memory Mnemonic</span>
          </div>
          <button className="video-modal-close" onClick={onClose}>×</button>
        </div>

        {/* Node label */}
        <div className="video-modal-concept">{nodeLabel}</div>

        {/* Body — depends on status */}
        <div className="video-modal-body">
          {(status === 'generating' || status === 'polling') && (
            <div className="video-modal-generating">
              <div className="video-generating-pulse-container">
                <div className="video-generating-pulse" />
                <span className="video-generating-label">
                  {status === 'generating' ? 'Crafting visual metaphor...' : 'Generating video with Veo 3...'}
                </span>
              </div>
              {mnemonicStrategy && (
                <div className="video-modal-strategy">
                  <div className="video-modal-strategy-label">Mnemonic Strategy</div>
                  <div className="video-modal-strategy-text">{mnemonicStrategy}</div>
                </div>
              )}
              {veoPrompt && (
                <div className="video-modal-prompt">
                  <div className="video-modal-prompt-label">Scene Description</div>
                  <div className="video-modal-prompt-text">{veoPrompt}</div>
                </div>
              )}
              {briefDescription && (
                <div className="video-modal-brief">
                  <em>{briefDescription}</em>
                </div>
              )}
            </div>
          )}

          {status === 'complete' && videoUrl && (
            <div className="video-modal-player-container">
              <div className="video-modal-player">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="video-modal-video"
                />
              </div>
              {mnemonicStrategy && (
                <div className="video-modal-strategy">
                  <div className="video-modal-strategy-label">Mnemonic Strategy</div>
                  <div className="video-modal-strategy-text">{mnemonicStrategy}</div>
                </div>
              )}
              {briefDescription && (
                <div className="video-modal-brief">
                  <em>{briefDescription}</em>
                </div>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="video-modal-error">
              <div className="video-modal-error-icon">⚠</div>
              <div className="video-modal-error-text">{error || 'Video generation failed'}</div>
              {onRetry && (
                <button className="video-modal-retry-btn" onClick={onRetry}>
                  ↻ Retry
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
