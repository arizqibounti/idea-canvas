// ── Claude Context Import ────────────────────────────────────
// Import conversation context from Claude Desktop / Claude.ai
// via paste or file upload, then inject into ThoughtClaw generation.

import React, { useState, useCallback, useRef } from 'react';

export default function ClaudeCodePicker({ onLoadContext, onClose }) {
  const [pastedText, setPastedText] = useState('');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  // Parse pasted or uploaded conversation text
  const parseConversation = useCallback((text) => {
    if (!text.trim()) return null;

    // Try JSON parse first (Claude.ai export format)
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data) || data.messages || data.chat_messages) {
        const msgs = Array.isArray(data) ? data : (data.messages || data.chat_messages || []);
        const exchanges = msgs.map(m => ({
          role: m.role || (m.sender === 'human' ? 'user' : 'assistant'),
          text: typeof m.content === 'string' ? m.content : m.content?.map(c => c.text).filter(Boolean).join('\n') || '',
        })).filter(m => m.text.trim());
        return { type: 'json', exchanges, messageCount: exchanges.length };
      }
    } catch {}

    // Otherwise treat as plain text conversation
    // Try to detect turn boundaries (Human:/Assistant:, User:/Claude:, etc.)
    const lines = text.split('\n');
    const exchanges = [];
    let currentRole = 'user';
    let currentText = '';

    for (const line of lines) {
      const lowerLine = line.toLowerCase().trim();
      if (lowerLine.startsWith('human:') || lowerLine.startsWith('user:') || lowerLine.startsWith('me:')) {
        if (currentText.trim()) exchanges.push({ role: currentRole, text: currentText.trim() });
        currentRole = 'user';
        currentText = line.replace(/^(human|user|me):\s*/i, '');
      } else if (lowerLine.startsWith('assistant:') || lowerLine.startsWith('claude:') || lowerLine.startsWith('ai:')) {
        if (currentText.trim()) exchanges.push({ role: currentRole, text: currentText.trim() });
        currentRole = 'assistant';
        currentText = line.replace(/^(assistant|claude|ai):\s*/i, '');
      } else {
        currentText += '\n' + line;
      }
    }
    if (currentText.trim()) exchanges.push({ role: currentRole, text: currentText.trim() });

    // If no turn boundaries detected, treat entire text as a single context block
    if (exchanges.length <= 1) {
      return { type: 'raw', exchanges: [{ role: 'context', text: text.trim() }], messageCount: 1 };
    }

    return { type: 'text', exchanges, messageCount: exchanges.length };
  }, []);

  const handleParse = useCallback(() => {
    const parsed = parseConversation(pastedText);
    if (parsed) setPreview(parsed);
  }, [pastedText, parseConversation]);

  const handleImport = useCallback(() => {
    if (!preview) return;
    setImporting(true);

    // Build context string
    const parts = ['CLAUDE CONVERSATION CONTEXT — The user has imported a prior Claude conversation for reference:\n'];

    for (const ex of preview.exchanges) {
      if (ex.role === 'context') {
        parts.push(ex.text);
      } else {
        const label = ex.role === 'user' ? 'User' : 'Claude';
        parts.push(`[${label}]: ${ex.text.slice(0, 1000)}`);
      }
    }

    parts.push('\nINSTRUCTION: Use this prior conversation to ground your thinking. Reference specific decisions, insights, and context from it. Avoid contradicting established conclusions.');

    const context = parts.join('\n');
    onLoadContext(context, preview.messageCount);
    onClose();
  }, [preview, onLoadContext, onClose]);

  const handleFileDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      setPastedText(text);
      const parsed = parseConversation(text);
      if (parsed) setPreview(parsed);
    };
    reader.readAsText(file);
  }, [parseConversation]);

  const tokenEstimate = preview
    ? Math.round(preview.exchanges.reduce((sum, ex) => sum + ex.text.length, 0) * 0.25)
    : 0;

  return (
    <div className="cc-picker-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cc-picker-modal">
        <div className="cc-picker-header">
          <span className="cc-picker-title">⬡ Import Claude Context</span>
          <button className="cc-picker-close" onClick={onClose}>✕</button>
        </div>

        <div className="cc-picker-instructions">
          Paste a conversation from Claude Desktop or Claude.ai, or upload an exported JSON file.
        </div>

        {/* Paste area */}
        <div
          className="cc-picker-paste-area"
          onDrop={handleFileDrop}
          onDragOver={e => e.preventDefault()}
        >
          <textarea
            className="cc-picker-textarea"
            value={pastedText}
            onChange={e => { setPastedText(e.target.value); setPreview(null); }}
            placeholder="Paste conversation here...&#10;&#10;Supports:&#10;• Plain text (Human:/Assistant: format)&#10;• Claude.ai JSON export&#10;• Any text context you want to inject"
            rows={8}
          />
          <div className="cc-picker-drop-hint">
            or <button className="cc-picker-file-btn" onClick={() => fileRef.current?.click()}>upload a file</button>
            <input ref={fileRef} type="file" accept=".json,.txt,.md" onChange={handleFileDrop} style={{ display: 'none' }} />
          </div>
        </div>

        {/* Preview */}
        {preview && (
          <div className="cc-picker-preview">
            <div className="cc-picker-preview-header">
              <span>{preview.messageCount} message{preview.messageCount !== 1 ? 's' : ''} detected</span>
              <span className="cc-picker-token-est">~{tokenEstimate.toLocaleString()} tokens</span>
            </div>
            <div className="cc-picker-preview-list">
              {preview.exchanges.slice(0, 4).map((ex, i) => (
                <div key={i} className={`cc-picker-preview-msg cc-picker-preview-msg--${ex.role}`}>
                  <span className="cc-picker-preview-role">{ex.role === 'user' ? 'User' : ex.role === 'assistant' ? 'Claude' : 'Context'}</span>
                  <span className="cc-picker-preview-text">{ex.text.slice(0, 120)}{ex.text.length > 120 ? '...' : ''}</span>
                </div>
              ))}
              {preview.exchanges.length > 4 && (
                <div className="cc-picker-preview-more">+ {preview.exchanges.length - 4} more messages</div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="cc-picker-footer">
          {!preview ? (
            <button
              className="cc-picker-load-btn"
              onClick={handleParse}
              disabled={!pastedText.trim()}
            >
              Parse
            </button>
          ) : (
            <button
              className="cc-picker-load-btn"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? '◌ Importing...' : '▶ Load as Context'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
