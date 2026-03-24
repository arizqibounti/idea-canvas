// ── Session Files Bar ────────────────────────────────────────
// Shows attached files below the input bar. Supports upload, list, remove.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

const FILE_ICONS = {
  '.pdf': '📄', '.docx': '📝', '.doc': '📝',
  '.xlsx': '📊', '.xls': '📊', '.csv': '📊',
  '.pptx': '📑', '.txt': '📃', '.md': '📃',
  '.json': '{ }', '.yaml': '⚙', '.yml': '⚙',
  '.js': '⟨/⟩', '.ts': '⟨/⟩', '.jsx': '⟨/⟩', '.tsx': '⟨/⟩',
  '.py': '🐍', '.go': '⟨/⟩', '.rs': '⟨/⟩', '.java': '⟨/⟩',
  '.html': '⟨/⟩', '.css': '⟨/⟩', '.sql': '⟨/⟩',
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function SessionFilesBar({ sessionId, files, setFiles, onContextUpdate }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Load files when sessionId changes
  useEffect(() => {
    if (!sessionId) return;
    authFetch(`${API_URL}/api/sessions/${sessionId}/files`)
      .then(r => r.json())
      .then(data => {
        if (data.files) setFiles(data.files);
      })
      .catch(() => {});
  }, [sessionId, setFiles]);

  // Rebuild context whenever files change
  useEffect(() => {
    if (!sessionId || !files.length) {
      onContextUpdate?.(null);
      return;
    }
    authFetch(`${API_URL}/api/sessions/${sessionId}/files/context`)
      .then(r => r.json())
      .then(data => onContextUpdate?.(data.context))
      .catch(() => {});
  }, [sessionId, files, onContextUpdate]);

  const handleUpload = useCallback(async (fileList) => {
    if (!sessionId || !fileList?.length) return;
    setUploading(true);

    const formData = new FormData();
    for (const file of fileList) {
      formData.append('files', file);
    }

    try {
      const res = await authFetch(`${API_URL}/api/sessions/${sessionId}/files`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.files) {
        setFiles(prev => [...prev, ...data.files]);
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }
    setUploading(false);
  }, [sessionId, setFiles]);

  const handleRemove = useCallback(async (fileId) => {
    if (!sessionId) return;
    try {
      await authFetch(`${API_URL}/api/sessions/${sessionId}/files/${fileId}`, { method: 'DELETE' });
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch {}
  }, [sessionId, setFiles]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  if (!files.length && !uploading) return null;

  return (
    <div
      className={`session-files-bar ${dragOver ? 'session-files-bar--dragover' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="session-files-header">
        <span className="session-files-label">
          📎 Context Files ({files.length})
        </span>
        <button
          className="session-files-add-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '◌ Uploading...' : '+ Add'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.txt,.md,.json,.yaml,.yml,.js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.rb,.html,.css,.sql,.sh"
          onChange={(e) => handleUpload(e.target.files)}
          style={{ display: 'none' }}
        />
      </div>
      <div className="session-files-list">
        {files.map(f => (
          <div key={f.id} className="session-file-chip">
            <span className="session-file-icon">{FILE_ICONS[f.type] || '📄'}</span>
            <span className="session-file-name" title={f.name}>
              {f.name.length > 25 ? f.name.slice(0, 22) + '...' : f.name}
            </span>
            <span className="session-file-size">{formatSize(f.size)}</span>
            <button className="session-file-remove" onClick={() => handleRemove(f.id)} title="Remove">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
