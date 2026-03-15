// ── Gmail Thread Picker Modal ────────────────────────────────
// Renders the thread search + selection modal.
// All state is managed by useGmail hook; this is purely presentational.

import React from 'react';

export default function GmailPicker({
  showPicker, setShowPicker,
  searchQuery, setSearchQuery, searchThreads,
  threads, isSearching, isLoadingThread, selectThread,
  account, error,
}) {
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
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchThreads(searchQuery); }}
            autoFocus
          />
          <button className="gmail-search-btn" onClick={() => searchThreads(searchQuery)} disabled={isSearching}>
            {isSearching ? '...' : '⌕'}
          </button>
        </div>

        <div className="gmail-picker-threads">
          {threads.length === 0 && !isSearching && (
            <div className="gmail-picker-empty">
              {searchQuery ? 'No threads found' : 'Search your email or browse recent threads'}
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
              <div className="gmail-thread-subject">{t.subject || '(no subject)'}</div>
              <div className="gmail-thread-meta">
                <span className="gmail-thread-from">{t.from?.split('<')[0]?.trim() || t.from}</span>
                <span className="gmail-thread-count">{t.messageCount} msgs</span>
                {t.date && <span className="gmail-thread-date">{new Date(t.date).toLocaleDateString()}</span>}
              </div>
              <div className="gmail-thread-snippet">{t.snippet}</div>
            </div>
          ))}
        </div>

        {error && <div className="gmail-error" style={{ padding: '8px 16px' }}>{error}</div>}

        {account && (
          <div className="gmail-picker-footer">
            Connected as {account}
          </div>
        )}
      </div>
    </div>
  );
}
