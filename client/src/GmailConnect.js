// ── Gmail Thread Picker Modal ────────────────────────────────
// Renders the thread search + selection modal.
// All state is managed by useGmail hook; this is purely presentational.

import React, { useState } from 'react';

const SEARCH_TIPS = [
  { label: 'from:', example: 'from:john@company.com' },
  { label: 'to:', example: 'to:team@company.com' },
  { label: 'subject:', example: 'subject:quarterly report' },
  { label: 'has:attachment', example: 'has:attachment' },
  { label: 'newer_than:', example: 'newer_than:7d' },
  { label: 'older_than:', example: 'older_than:1m' },
  { label: 'is:starred', example: 'is:starred' },
];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'yesterday';
  if (diffD < 7) return `${diffD}d ago`;
  if (diffD < 30) return `${Math.floor(diffD / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function GmailPicker({
  showPicker, setShowPicker,
  searchQuery, setSearchQuery, searchThreads,
  threads, isSearching, isLoadingThread, selectThread,
  account, error,
}) {
  const [showTips, setShowTips] = useState(false);

  if (!showPicker) return null;

  return (
    <div className="gmail-picker-overlay" onClick={() => setShowPicker(false)}>
      <div className="gmail-picker" onClick={(e) => e.stopPropagation()}>
        <div className="gmail-picker-header">
          <span>Select Email Thread</span>
          <button className="gmail-picker-close" onClick={() => setShowPicker(false)}>✕</button>
        </div>

        <div className="gmail-picker-search">
          <input
            type="text"
            className="gmail-search-input"
            placeholder="Search by name, subject, keyword..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchThreads(searchQuery); }}
            autoFocus
          />
          <button
            className="gmail-search-tips-btn"
            onClick={() => setShowTips(v => !v)}
            title="Search tips"
          >
            ?
          </button>
          <button className="gmail-search-btn" onClick={() => searchThreads(searchQuery)} disabled={isSearching}>
            {isSearching ? '◌' : '⌕'}
          </button>
        </div>

        {/* Search tips dropdown */}
        {showTips && (
          <div className="gmail-search-tips">
            <div className="gmail-search-tips-title">Gmail search operators:</div>
            {SEARCH_TIPS.map(tip => (
              <button
                key={tip.label}
                className="gmail-search-tip"
                onClick={() => {
                  setSearchQuery(tip.example);
                  searchThreads(tip.example);
                  setShowTips(false);
                }}
              >
                <span className="gmail-tip-label">{tip.label}</span>
                <span className="gmail-tip-example">{tip.example}</span>
              </button>
            ))}
          </div>
        )}

        <div className="gmail-picker-threads">
          {threads.length === 0 && !isSearching && (
            <div className="gmail-picker-empty">
              {searchQuery ? 'No threads found — try different keywords or use search operators (click ?)' : 'Type to search or browse recent threads'}
            </div>
          )}
          {isSearching && (
            <div className="gmail-picker-loading">Searching...</div>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              className={`gmail-thread-item ${isLoadingThread === t.id ? 'loading' : ''}`}
              onClick={() => selectThread(t.id)}
            >
              <div className="gmail-thread-top-row">
                <span className="gmail-thread-from">{t.from?.split('<')[0]?.trim() || t.from}</span>
                <span className="gmail-thread-date">{formatDate(t.date)}</span>
              </div>
              <div className="gmail-thread-subject">{t.subject || '(no subject)'}</div>
              <div className="gmail-thread-bottom-row">
                <span className="gmail-thread-snippet">{t.snippet}</span>
                <span className="gmail-thread-count">{t.messageCount} msg{t.messageCount !== 1 ? 's' : ''}</span>
              </div>
            </div>
          ))}
        </div>

        {error && <div className="gmail-error" style={{ padding: '8px 16px' }}>{error}</div>}

        {account && (
          <div className="gmail-picker-footer">
            Connected as {account} · Showing up to 25 results
          </div>
        )}
      </div>
    </div>
  );
}
