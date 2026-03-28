// ── Export Dropdown ──────────────────────────────────────────
// Toolbar dropdown for exporting thinking trees to deliverables.
// AI-powered: calls /api/export/* with Claude tool_use to generate
// slide decks, documents, etc. Shows SSE progress and triggers download.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

const EXPORT_OPTIONS = [
  { id: 'deck', label: 'Pitch Deck', ext: '.pptx', icon: '◰', description: 'AI-generated slide presentation' },
  { id: 'doc', label: 'Document', ext: '.md', icon: '◱', description: 'Structured markdown document' },
  { id: 'gdoc', label: 'Google Doc', ext: '', icon: '◈', description: 'Create in your Google Drive' },
];

function base64ToBlob(base64, mimeType) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const MIME_TYPES = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown',
  json: 'application/json',
};

export default function ExportDropdown({ nodes, idea, disabled, sessionId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      // Close if click is outside both the button and the portal menu
      const inBtn = btnRef.current && btnRef.current.contains(e.target);
      const inMenu = e.target.closest && e.target.closest('.export-ai-menu');
      if (!inBtn && !inMenu) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Position the portal menu below the button
  useEffect(() => {
    if (isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
  }, [isOpen]);

  const handleExport = useCallback(async (type) => {
    setIsOpen(false);
    if (!nodes?.length) return;

    const serializedNodes = nodes.map(n => {
      const d = n.data || n;
      return {
        id: d.id || n.id,
        type: d.type || 'unknown',
        label: d.label || '',
        reasoning: d.reasoning || '',
        parentIds: d.parentIds || (d.parentId ? [d.parentId] : []),
      };
    });

    setExporting({ type, progress: [], slideCount: 0, sectionCount: 0 });

    try {
      // Google Doc: non-streaming JSON endpoint
      if (type === 'gdoc') {
        setExporting(prev => prev ? { ...prev, progress: [{ status: 'thinking', detail: 'Creating Google Doc...' }] } : null);
        const res = await authFetch(`${API_URL}/api/export/google-doc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodes: serializedNodes, idea: idea || 'Untitled', sessionId: sessionId || null }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || 'Export failed');
        }
        const result = await res.json();
        setExporting(prev => prev ? {
          ...prev, done: true, docUrl: result.docUrl,
          progress: [...prev.progress, { status: 'done', detail: `Created: ${result.title} (${result.sectionCount} sections)` }],
        } : null);
        // Open the doc in a new tab
        if (result.docUrl) window.open(result.docUrl, '_blank');
        setTimeout(() => setExporting(null), 4000);
        return;
      }

      const endpoint = type === 'deck' ? '/api/export/deck' : '/api/export/document';
      const body = { nodes: serializedNodes, idea: idea || 'Untitled', format: type === 'doc' ? 'md' : undefined, sessionId: sessionId || null };

      const res = await authFetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Export failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const data = JSON.parse(payload);

            if (data._progress) {
              setExporting(prev => {
                if (!prev) return null;
                const count = data.type === 'slide_added' ? { slideCount: prev.slideCount + 1 }
                  : data.type === 'section_added' ? { sectionCount: prev.sectionCount + 1 }
                  : {};
                return {
                  ...prev,
                  ...count,
                  progress: [...prev.progress.slice(-6), data],
                };
              });
            }

            if (data._file) {
              const mime = MIME_TYPES[data.format] || 'application/octet-stream';
              const blob = base64ToBlob(data.base64, mime);
              downloadBlob(blob, data.filename || `export.${data.format}`);
              setExporting(prev => prev ? {
                ...prev,
                done: true,
                progress: [...prev.progress, { status: 'done', detail: `Downloaded ${data.filename}` }],
              } : null);
            }

            if (data._error) {
              setExporting(prev => prev ? {
                ...prev,
                error: data._error,
                progress: [...prev.progress, { status: 'error', detail: data._error }],
              } : null);
            }
          } catch { /* skip */ }
        }
      }

      setTimeout(() => setExporting(null), 3500);
    } catch (err) {
      setExporting(prev => prev ? {
        ...prev, error: err.message,
        progress: [...(prev?.progress || []), { status: 'error', detail: err.message }],
      } : null);
      setTimeout(() => setExporting(null), 5000);
    }
  }, [nodes, idea]);

  const lastProgress = exporting?.progress?.[exporting.progress.length - 1];
  const statusLabel = exporting?.done ? 'Done!' : exporting?.error ? 'Error' :
    lastProgress?.type === 'slide_added' ? `${exporting.slideCount} slides...` :
    lastProgress?.type === 'section_added' ? `${exporting.sectionCount} sections...` :
    lastProgress?.detail || 'Preparing...';

  return (
    <div className="export-ai-container" ref={ref}>
      <button
        ref={btnRef}
        className={`btn btn-icon ${exporting ? 'active-icon' : ''}`}
        onClick={() => !exporting && setIsOpen(v => !v)}
        disabled={disabled || !nodes?.length || !!exporting}
        title="Export tree to pitch deck or document"
      >
        {exporting ? `↓ ${statusLabel}` : '↓ EXPORT'}
      </button>

      {isOpen && menuPos && ReactDOM.createPortal(
        <div className="export-ai-menu" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 10000 }}>
          <div className="export-ai-menu-header">Export with AI</div>
          {EXPORT_OPTIONS.map(opt => (
            <button
              key={opt.id}
              className="export-ai-menu-item"
              onClick={() => handleExport(opt.id)}
            >
              <span className="export-ai-menu-icon">{opt.icon}</span>
              <div className="export-ai-menu-text">
                <span className="export-ai-menu-label">{opt.label} <span className="export-ai-menu-ext">{opt.ext}</span></span>
                <span className="export-ai-menu-desc">{opt.description}</span>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}

      {exporting && !exporting.done && !exporting.error && ReactDOM.createPortal(
        <div className="export-ai-progress" style={{ position: 'fixed', top: menuPos?.top || 40, right: menuPos?.right || 0, zIndex: 10000 }}>
          <div className="export-ai-progress-bar">
            <div className="export-ai-progress-fill" style={{
              width: exporting.type === 'deck'
                ? `${Math.min(100, (exporting.slideCount / 12) * 100)}%`
                : `${Math.min(100, (exporting.sectionCount / 6) * 100)}%`
            }} />
          </div>
          <div className="export-ai-progress-items">
            {exporting.progress.filter(p => p.type === 'slide_added' || p.type === 'section_added').slice(-4).map((p, i) => (
              <div key={i} className="export-ai-progress-item">
                {p.type === 'slide_added' ? `◰ ${p.title}` : `◱ ${p.heading}`}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
