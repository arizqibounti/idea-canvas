// ── Export Dropdown ───────────────────────────────────────────
// Dropdown menu for all tree export options: PNG, SVG, clipboard,
// interactive HTML, and the existing GitHub markdown export.

import React, { useState, useRef, useEffect } from 'react';

const ITEMS = [
  { key: 'png',       icon: '⊞',  label: 'PNG Image',       hint: 'High-res screenshot' },
  { key: 'svg',       icon: '◇',  label: 'SVG Vector',      hint: 'Infinite quality' },
  { key: 'clipboard', icon: '⎘',  label: 'Copy to Clipboard', hint: 'Paste into Slack, docs' },
  { key: 'html',      icon: '⟨/⟩', label: 'Interactive HTML', hint: 'Self-contained, zoomable' },
  { key: 'divider' },
  { key: 'github',    icon: '⬆',  label: 'GitHub Repository', hint: 'Markdown spec files' },
];

export default function ExportDropdown({ onExport, isExporting }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn-icon btn-export-icon"
        onClick={() => setIsOpen((v) => !v)}
        title="Export tree"
        disabled={isExporting}
      >
        {isExporting ? '◌ EXPORTING...' : '⬆ EXPORT'}
      </button>
      {isOpen && (
        <div className="export-dropdown">
          {ITEMS.map((item) =>
            item.key === 'divider' ? (
              <div key="divider" className="export-dropdown-divider" />
            ) : (
              <button
                key={item.key}
                className="export-dropdown-item"
                onClick={() => {
                  setIsOpen(false);
                  onExport(item.key);
                }}
              >
                <div className="export-dd-row">
                  <span className="export-dd-icon">{item.icon}</span>
                  <span className="export-dd-label">{item.label}</span>
                </div>
                <span className="export-dd-hint">{item.hint}</span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
