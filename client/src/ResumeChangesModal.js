import React, { useState } from 'react';

const CATEGORY_COLORS = {
  impact:      '#ffd43b',
  keywords:    '#20c997',
  match:       '#51cf66',
  gap:         '#ff6b6b',
  clarity:     '#ffa94d',
  positioning: '#da77f2',
};

const CATEGORY_LABELS = {
  impact:      'IMPACT',
  keywords:    'KEYWORDS',
  match:       'MATCH',
  gap:         'GAP',
  clarity:     'CLARITY',
  positioning: 'POSITIONING',
};

const TYPE_LABELS = {
  strengthen_bullet: 'Strengthen bullet',
  add_keyword:       'Add keyword',
  update_summary:    'Update summary',
  add_bullet:        'Add bullet',
  reframe_role:      'Reframe role',
};

function ChangeCard({ change, index }) {
  const [copied, setCopied] = useState(false);
  const color = CATEGORY_COLORS[change.category] || '#8888aa';
  const label = CATEGORY_LABELS[change.category] || (change.category || '').toUpperCase();
  const typeLabel = TYPE_LABELS[change.type] || change.type;

  const handleCopy = () => {
    navigator.clipboard.writeText(change.replacement || '').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rcm-card">
      <div className="rcm-card-header">
        <span className="rcm-card-num">#{index + 1}</span>
        <span className="rcm-category-badge" style={{ color, borderColor: color }}>
          {label}
        </span>
        <span className="rcm-type-tag">{typeLabel}</span>
        <span className="rcm-section-tag">{change.section}</span>
      </div>

      {change.original && (
        <div className="rcm-diff-row original">
          <span className="rcm-diff-side-label before">FIND</span>
          <span className="rcm-diff-text">{change.original}</span>
        </div>
      )}

      <div className="rcm-diff-row replacement">
        <span className="rcm-diff-side-label after">REPLACE WITH</span>
        <span className="rcm-diff-text after">{change.replacement}</span>
        <button
          className={`rcm-copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title="Copy replacement text"
        >
          {copied ? '✓ COPIED' : '📋 COPY'}
        </button>
      </div>

      <div className="rcm-reason">{change.reason}</div>
    </div>
  );
}

function CategorySummary({ changes }) {
  const counts = {};
  changes.forEach(c => {
    counts[c.category] = (counts[c.category] || 0) + 1;
  });
  return (
    <div className="rcm-category-summary">
      {Object.entries(counts).map(([cat, n]) => {
        const color = CATEGORY_COLORS[cat] || '#8888aa';
        const label = CATEGORY_LABELS[cat] || cat.toUpperCase();
        return (
          <span key={cat} className="rcm-cat-pill" style={{ color, borderColor: `${color}40`, background: `${color}12` }}>
            {n} {label}
          </span>
        );
      })}
    </div>
  );
}

export default function ResumeChangesModal({ isOpen, onClose, changes, summary, isLoading, error }) {
  const [filter, setFilter] = useState('all');

  if (!isOpen) return null;

  const allChanges = changes || [];
  const filtered = filter === 'all' ? allChanges : allChanges.filter(c => c.category === filter);
  const categories = [...new Set(allChanges.map(c => c.category))];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="rcm-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="rcm-header">
          <div className="rcm-title">
            <span className="rcm-title-icon">✦</span>
            RESUME CHANGES
            {!isLoading && allChanges.length > 0 && (
              <span className="rcm-title-count">{allChanges.length} changes</span>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="rcm-loading-state">
            <div className="rcm-loading-pulse" />
            <div className="rcm-loading-text">Analysing resume + debate to generate changes…</div>
            <div className="rcm-loading-sub">Claude is cross-referencing the debate findings with your actual resume text</div>
          </div>
        ) : error ? (
          <div className="rcm-error-state">
            <div className="rcm-error-icon">⚠</div>
            <div className="rcm-error-text">{error}</div>
          </div>
        ) : allChanges.length === 0 ? (
          <div className="rcm-empty-state">
            <div>No changes generated. Try running the debate first.</div>
          </div>
        ) : (
          <>
            {/* Summary */}
            {summary && <div className="rcm-summary">{summary}</div>}

            {/* Category pills + filter */}
            <div className="rcm-filters">
              <CategorySummary changes={allChanges} />
              <div className="rcm-filter-row">
                <button
                  className={`rcm-filter-btn ${filter === 'all' ? 'active' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  ALL ({allChanges.length})
                </button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    className={`rcm-filter-btn ${filter === cat ? 'active' : ''}`}
                    style={filter === cat ? { color: CATEGORY_COLORS[cat], borderColor: CATEGORY_COLORS[cat] } : {}}
                    onClick={() => setFilter(f => f === cat ? 'all' : cat)}
                  >
                    {(CATEGORY_LABELS[cat] || cat).toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Change cards */}
            <div className="rcm-list">
              {filtered.map((change, i) => (
                <ChangeCard key={change.id || i} change={change} index={allChanges.indexOf(change)} />
              ))}
            </div>
          </>
        )}

        {/* Footer */}
        {!isLoading && !error && allChanges.length > 0 && (
          <div className="rcm-footer">
            <span className="rcm-footer-hint">
              Copy each replacement, find the original text in your resume, and paste in.
            </span>
            <button className="btn btn-generate" style={{ fontSize: 11 }} onClick={onClose}>
              DONE
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
