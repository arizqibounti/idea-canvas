// ── Prompts Admin Tab ────────────────────────────────────────
// Manage, version, A/B test, and AI-improve all system prompts.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from '../api';

const API_URL = process.env.REACT_APP_API_URL || '';

const CATEGORY_COLORS = {
  generate: '#6c63ff', debate: '#ff4757', refine: '#f59e0b', portfolio: '#20c997',
  learn: '#4dabf7', chat: '#cc5de8', 'multi-agent': '#ffa94d', experiment: '#51cf66',
  fractal: '#fd7e14', resume: '#69db7c', codebase: '#4dabf7', decision: '#ffd43b',
  writing: '#da77f2', plan: '#ff922b',
};

const SEVERITY_COLORS = { high: '#ff4757', medium: '#f59e0b', low: '#4dabf7' };

// ── SSE reader helper ──────────────────────────────────────
async function readSSE(res, onEvent, signal) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') return;
          try { onEvent(JSON.parse(payload)); } catch {}
        }
      }
    }
  } finally { reader.releaseLock(); }
}

export default function PromptsTab() {
  const [prompts, setPrompts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editText, setEditText] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAB, setShowAB] = useState(false);
  const [abVariant, setAbVariant] = useState('');
  const [abSplit, setAbSplit] = useState(50);
  const [filter, setFilter] = useState('');
  const [seeding, setSeeding] = useState(false);

  // ── Improve state ──
  const [improveMode, setImproveMode] = useState(null); // 'critique' | 'refine' | 'experiment' | 'chat'
  const [improving, setImproving] = useState(false);
  const [improveResult, setImproveResult] = useState(null);
  const [improveProgress, setImproveProgress] = useState('');
  // Chat-specific
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatEndRef = useRef(null);
  const abortRef = useRef(null);

  // Load prompt list
  const loadList = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/prompts`);
      const data = await res.json();
      setPrompts(Array.isArray(data) ? data : []);
    } catch { setPrompts([]); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // Load full prompt detail
  const loadDetail = useCallback(async (key) => {
    setSelected(key);
    setDetail(null);
    setSaveNote('');
    setShowAB(false);
    clearImprove();
    try {
      const res = await authFetch(`${API_URL}/api/prompts/${encodeURIComponent(key)}`);
      const data = await res.json();
      setDetail(data);
      setEditText(data.versions?.[0]?.text || '');
      if (data.abTest?.enabled) {
        setShowAB(true);
        setAbVariant(data.abTest.variantText || '');
        setAbSplit(data.abTest.splitPct ?? 50);
      } else {
        setAbVariant('');
        setAbSplit(50);
      }
    } catch { setDetail(null); }
  }, []);

  // Save new version
  const handleSave = async () => {
    if (!selected || !editText.trim()) return;
    setSaving(true);
    try {
      await authFetch(`${API_URL}/api/prompts/${encodeURIComponent(selected)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText, note: saveNote }),
      });
      setSaveNote('');
      await loadDetail(selected);
      await loadList();
    } catch (err) { console.error('Save error:', err); }
    setSaving(false);
  };

  // Revert to version
  const handleRevert = async (version) => {
    if (!selected) return;
    try {
      await authFetch(`${API_URL}/api/prompts/${encodeURIComponent(selected)}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      await loadDetail(selected);
      await loadList();
    } catch (err) { console.error('Revert error:', err); }
  };

  // A/B test
  const handleABSave = async () => {
    if (!selected) return;
    try {
      await authFetch(`${API_URL}/api/prompts/${encodeURIComponent(selected)}/ab`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: showAB, variantText: abVariant, splitPct: abSplit }),
      });
      await loadDetail(selected);
    } catch (err) { console.error('A/B save error:', err); }
  };

  const handlePromote = async () => {
    if (!selected || !detail?.abTest?.variantText) return;
    await authFetch(`${API_URL}/api/prompts/${encodeURIComponent(selected)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: detail.abTest.variantText, note: 'Promoted A/B variant' }),
    });
    await authFetch(`${API_URL}/api/prompts/${encodeURIComponent(selected)}/ab`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    await loadDetail(selected);
    await loadList();
  };

  // Seed from legacy
  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await authFetch(`${API_URL}/api/prompts/seed`, { method: 'POST' });
      const data = await res.json();
      console.log('Seeded:', data.seeded);
      await loadList();
    } catch (err) { console.error('Seed error:', err); }
    setSeeding(false);
  };

  // ── Improve helpers ──────────────────────────────────────
  function clearImprove() {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setImproveMode(null);
    setImproving(false);
    setImproveResult(null);
    setImproveProgress('');
    setChatMessages([]);
    setChatInput('');
    setChatStreaming(false);
  }

  function startImproveMode(mode) {
    if (abortRef.current) abortRef.current.abort();
    setImproveMode(mode);
    setImproveResult(null);
    setImproveProgress('');
    if (mode === 'chat') {
      setChatMessages([]);
      setChatInput('');
    }
  }

  // ── Critique ──
  const runCritique = async () => {
    startImproveMode('critique');
    setImproving(true);
    setImproveProgress('Analyzing prompt...');
    try {
      const res = await authFetch(`${API_URL}/api/prompt-improve/critique`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptKey: selected, promptText: editText }),
      });
      const data = await res.json();
      setImproveResult(data);
    } catch (err) { setImproveResult({ error: err.message }); }
    setImproving(false);
    setImproveProgress('');
  };

  // ── Refine (SSE) ──
  const runRefine = async () => {
    startImproveMode('refine');
    setImproving(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await authFetch(`${API_URL}/api/prompt-improve/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptKey: selected, promptText: editText }),
        signal: controller.signal,
      });
      await readSSE(res, (event) => {
        if (event._progress) setImproveProgress(event.stage);
        if (event._result) setImproveResult(event);
        if (event.error) setImproveResult({ error: event.error });
      }, controller.signal);
    } catch (err) {
      if (err.name !== 'AbortError') setImproveResult({ error: err.message });
    }
    setImproving(false);
    setImproveProgress('');
  };

  // ── Experiment (SSE) ──
  const runExperiment = async () => {
    startImproveMode('experiment');
    setImproving(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const variants = [];
    try {
      const res = await authFetch(`${API_URL}/api/prompt-improve/experiment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptKey: selected, promptText: editText }),
        signal: controller.signal,
      });
      await readSSE(res, (event) => {
        if (event._progress) setImproveProgress(event.stage);
        if (event._variant) {
          variants.push(event);
          setImproveResult(prev => ({ ...prev, variants: [...variants] }));
        }
        if (event._scores) setImproveResult(prev => ({ ...prev, scores: event.scores, winner: event.winner, analysis: event.analysis }));
        if (event.error) setImproveResult({ error: event.error });
      }, controller.signal);
    } catch (err) {
      if (err.name !== 'AbortError') setImproveResult({ error: err.message });
    }
    setImproving(false);
    setImproveProgress('');
  };

  // ── Chat (SSE) ──
  const sendChatMessage = async (text) => {
    if (!text?.trim() || chatStreaming) return;
    const userMsg = { role: 'user', content: text.trim() };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput('');
    setChatStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = '';

    try {
      const res = await authFetch(`${API_URL}/api/prompt-improve/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptKey: selected, promptText: editText, messages: newMessages }),
        signal: controller.signal,
      });
      await readSSE(res, (event) => {
        if (event._text) {
          assistantText += event.text;
          setChatMessages([...newMessages, { role: 'assistant', content: assistantText }]);
        }
        if (event.error) {
          assistantText += `\n\n[Error: ${event.error}]`;
          setChatMessages([...newMessages, { role: 'assistant', content: assistantText }]);
        }
      }, controller.signal);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setChatMessages([...newMessages, { role: 'assistant', content: `[Error: ${err.message}]` }]);
      }
    }
    setChatStreaming(false);
  };

  // Scroll chat to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Extract improved prompt from chat message
  function extractImproved(text) {
    const match = text.match(/<<<IMPROVED>>>([\s\S]*?)<<<END>>>/);
    return match ? match[1].trim() : null;
  }

  // ── Group prompts by category ──
  const grouped = {};
  const lowerFilter = filter.toLowerCase();
  for (const p of prompts) {
    if (lowerFilter && !p.key.toLowerCase().includes(lowerFilter) && !(p.category || '').toLowerCase().includes(lowerFilter)) continue;
    const cat = p.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  }

  const metrics = detail?.abTest?.metrics;

  return (
    <div className="prompts-tab">
      <div className="prompts-layout">
        {/* ── Left: Prompt List ── */}
        <div className="prompts-sidebar">
          <div className="prompts-sidebar-header">
            <input
              className="prompts-filter"
              placeholder="Filter prompts..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            {prompts.length === 0 && (
              <button className="prompts-seed-btn" onClick={handleSeed} disabled={seeding}>
                {seeding ? 'Seeding...' : 'Seed from legacy'}
              </button>
            )}
          </div>
          <div className="prompts-list">
            {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
              <div key={cat} className="prompts-category">
                <div className="prompts-category-label" style={{ color: CATEGORY_COLORS[cat] || '#888' }}>
                  {cat.toUpperCase()} ({items.length})
                </div>
                {items.map(p => (
                  <div
                    key={p.key}
                    className={`prompts-item ${selected === p.key ? 'prompts-item--active' : ''}`}
                    onClick={() => loadDetail(p.key)}
                  >
                    <span className="prompts-item-key">{p.key}</span>
                    <span className="prompts-item-meta">
                      v{p.currentVersion}
                      {p.abTestActive && <span className="prompts-ab-dot" title="A/B test active" />}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: Editor ── */}
        <div className="prompts-editor">
          {!selected && (
            <div className="prompts-empty">Select a prompt to edit</div>
          )}
          {selected && detail && (
            <>
              <div className="prompts-editor-header">
                <h3 className="prompts-editor-title">{selected}</h3>
                <div className="prompts-editor-badges">
                  {detail.category && <span className="prompts-badge" style={{ borderColor: CATEGORY_COLORS[detail.category] || '#888' }}>{detail.category}</span>}
                  {detail.mode && <span className="prompts-badge prompts-badge-mode">{detail.mode}</span>}
                  <span className="prompts-badge prompts-badge-ver">v{detail.currentVersion}</span>
                </div>
              </div>

              <textarea
                className="prompts-textarea"
                value={editText}
                onChange={e => setEditText(e.target.value)}
                spellCheck={false}
              />

              {/* ── AI Improve Toolbar ── */}
              <div className="prompts-improve-toolbar">
                <span className="prompts-improve-label">AI Tools</span>
                <button
                  className={`prompts-improve-btn ${improveMode === 'critique' ? 'prompts-improve-btn--active' : ''}`}
                  onClick={runCritique}
                  disabled={improving}
                >Critique</button>
                <button
                  className={`prompts-improve-btn ${improveMode === 'refine' ? 'prompts-improve-btn--active' : ''}`}
                  onClick={runRefine}
                  disabled={improving}
                >Refine</button>
                <button
                  className={`prompts-improve-btn ${improveMode === 'experiment' ? 'prompts-improve-btn--active' : ''}`}
                  onClick={runExperiment}
                  disabled={improving}
                >Experiment</button>
                <button
                  className={`prompts-improve-btn ${improveMode === 'chat' ? 'prompts-improve-btn--active' : ''}`}
                  onClick={() => startImproveMode('chat')}
                  disabled={improving && improveMode !== 'chat'}
                >Chat</button>
                {improveMode && (
                  <button className="prompts-improve-btn prompts-improve-btn--cancel" onClick={clearImprove}>
                    Close
                  </button>
                )}
              </div>

              {/* ── Progress indicator ── */}
              {improving && improveProgress && (
                <div className="prompts-improve-progress">{improveProgress}</div>
              )}

              {/* ── Critique Results ── */}
              {improveMode === 'critique' && improveResult && !improveResult.error && (
                <div className="prompts-improve-panel">
                  <div className="prompts-improve-panel-header">
                    <span>Score: {improveResult.overallScore}/10</span>
                    <span className="prompts-improve-summary">{improveResult.summary}</span>
                  </div>
                  {improveResult.strengths?.length > 0 && (
                    <div className="prompts-improve-strengths">
                      {improveResult.strengths.map((s, i) => <span key={i} className="prompts-improve-strength-tag">{s}</span>)}
                    </div>
                  )}
                  <div className="prompts-improve-weaknesses">
                    {improveResult.weaknesses?.map((w, i) => (
                      <div key={i} className="prompts-improve-weakness">
                        <div className="prompts-improve-weakness-header">
                          <span className="prompts-improve-severity" style={{ color: SEVERITY_COLORS[w.severity] }}>{w.severity.toUpperCase()}</span>
                          <span className="prompts-improve-area">{w.area}</span>
                        </div>
                        <div className="prompts-improve-issue">{w.issue}</div>
                        <div className="prompts-improve-suggestion">{w.suggestion}</div>
                      </div>
                    ))}
                  </div>
                  <button className="prompts-improve-apply-btn" onClick={() => runRefine()}>
                    Auto-Refine Based on Critique
                  </button>
                </div>
              )}

              {/* ── Refine Results ── */}
              {improveMode === 'refine' && improveResult && !improveResult.error && improveResult.improvedText && (
                <div className="prompts-improve-panel">
                  <div className="prompts-improve-panel-header">Refined Prompt</div>
                  {improveResult.changesSummary?.map((c, i) => (
                    <div key={i} className="prompts-improve-change">
                      <span className="prompts-improve-change-area">{c.area}</span>
                      <span>{c.description}</span>
                    </div>
                  ))}
                  <textarea
                    className="prompts-textarea prompts-textarea--preview"
                    value={improveResult.improvedText}
                    readOnly
                  />
                  <button className="prompts-improve-apply-btn" onClick={() => setEditText(improveResult.improvedText)}>
                    Apply to Editor
                  </button>
                </div>
              )}

              {/* ── Experiment Results ── */}
              {improveMode === 'experiment' && improveResult && !improveResult.error && (
                <div className="prompts-improve-panel">
                  <div className="prompts-improve-panel-header">Prompt Variants</div>
                  {improveResult.analysis && <div className="prompts-improve-summary">{improveResult.analysis}</div>}
                  <div className="prompts-improve-variants">
                    {improveResult.variants?.map((v, i) => {
                      const scoreObj = improveResult.scores?.find(s => s.index === v.index);
                      return (
                        <div key={i} className={`prompts-improve-variant ${improveResult.winner === v.index ? 'prompts-improve-variant--winner' : ''}`}>
                          <div className="prompts-improve-variant-header">
                            <span className="prompts-improve-variant-label">{v.label}</span>
                            {scoreObj && <span className="prompts-improve-variant-score">Score: {scoreObj.composite}/10</span>}
                            {improveResult.winner === v.index && <span className="prompts-improve-variant-badge">WINNER</span>}
                          </div>
                          <div className="prompts-improve-variant-rationale">{v.rationale}</div>
                          <details className="prompts-improve-variant-details">
                            <summary>View full prompt</summary>
                            <pre className="prompts-improve-variant-text">{v.text}</pre>
                          </details>
                          {scoreObj && (
                            <div className="prompts-improve-variant-scores">
                              {['clarity', 'specificity', 'coverage', 'conciseness', 'safety'].map(dim => (
                                <span key={dim} className="prompts-improve-dim">{dim}: {scoreObj[dim]}</span>
                              ))}
                            </div>
                          )}
                          <button className="prompts-improve-apply-btn" onClick={() => setEditText(v.text)}>Apply</button>
                        </div>
                      );
                    })}
                  </div>
                  {/* Show original score for comparison */}
                  {improveResult.scores?.[0] && (
                    <div className="prompts-improve-original-score">
                      Original score: {improveResult.scores[0].composite}/10
                      <span className="prompts-improve-dim-row">
                        {['clarity', 'specificity', 'coverage', 'conciseness', 'safety'].map(dim => (
                          <span key={dim} className="prompts-improve-dim">{dim}: {improveResult.scores[0][dim]}</span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Chat Panel ── */}
              {improveMode === 'chat' && (
                <div className="prompts-improve-panel prompts-improve-chat">
                  <div className="prompts-improve-chat-messages">
                    {chatMessages.length === 0 && (
                      <div className="prompts-improve-chat-hint">Ask the AI to improve this prompt. It can see the full prompt text.</div>
                    )}
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`prompts-improve-chat-msg prompts-improve-chat-msg--${msg.role}`}>
                        <div className="prompts-improve-chat-msg-role">{msg.role === 'user' ? 'You' : 'AI'}</div>
                        <div className="prompts-improve-chat-msg-text">
                          {msg.content}
                          {msg.role === 'assistant' && extractImproved(msg.content) && (
                            <button
                              className="prompts-improve-apply-btn"
                              onClick={() => setEditText(extractImproved(msg.content))}
                            >Apply Suggested Prompt</button>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="prompts-improve-chat-input-row">
                    <input
                      className="prompts-improve-chat-input"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(chatInput); } }}
                      placeholder="Ask about this prompt..."
                      disabled={chatStreaming}
                    />
                    <button
                      className="prompts-improve-btn"
                      onClick={() => sendChatMessage(chatInput)}
                      disabled={chatStreaming || !chatInput.trim()}
                    >{chatStreaming ? '...' : 'Send'}</button>
                  </div>
                </div>
              )}

              {/* ── Error display ── */}
              {improveResult?.error && (
                <div className="prompts-improve-error">Error: {improveResult.error}</div>
              )}

              <div className="prompts-save-row">
                <input
                  className="prompts-note-input"
                  placeholder="Change note (optional)"
                  value={saveNote}
                  onChange={e => setSaveNote(e.target.value)}
                />
                <button className="prompts-save-btn" onClick={handleSave} disabled={saving || editText === detail.versions?.[0]?.text}>
                  {saving ? 'Saving...' : 'Save New Version'}
                </button>
              </div>

              {/* ── Version History ── */}
              <div className="prompts-section">
                <div className="prompts-section-title">Version History</div>
                <div className="prompts-versions">
                  {detail.versions?.map(v => (
                    <div key={v.version} className="prompts-version-row">
                      <span className="prompts-version-num">v{v.version}</span>
                      <span className="prompts-version-date">{new Date(v.createdAt).toLocaleString()}</span>
                      <span className="prompts-version-note">{v.note || ''}</span>
                      <span className="prompts-version-by">{v.createdBy}</span>
                      {v.version !== detail.currentVersion && (
                        <button className="prompts-revert-btn" onClick={() => handleRevert(v.version)}>Revert</button>
                      )}
                      <button className="prompts-view-btn" onClick={() => setEditText(v.text)}>View</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── A/B Testing ── */}
              <div className="prompts-section">
                <div className="prompts-section-title" style={{ cursor: 'pointer' }} onClick={() => setShowAB(!showAB)}>
                  A/B Testing {showAB ? '▲' : '▼'} {detail.abTest?.enabled && <span className="prompts-ab-active">ACTIVE</span>}
                </div>
                {showAB && (
                  <div className="prompts-ab-panel">
                    <div className="prompts-ab-label">Variant prompt:</div>
                    <textarea
                      className="prompts-textarea prompts-textarea--variant"
                      value={abVariant}
                      onChange={e => setAbVariant(e.target.value)}
                      placeholder="Paste variant prompt text here..."
                      spellCheck={false}
                    />
                    <div className="prompts-ab-controls">
                      <label className="prompts-ab-split-label">
                        Traffic split: {abSplit}% variant
                        <input type="range" min={0} max={100} value={abSplit}
                          onChange={e => setAbSplit(Number(e.target.value))} className="prompts-ab-slider" />
                      </label>
                      <button className="prompts-save-btn" onClick={handleABSave}>
                        {detail.abTest?.enabled ? 'Update A/B Test' : 'Start A/B Test'}
                      </button>
                      {detail.abTest?.enabled && (
                        <>
                          <button className="prompts-promote-btn" onClick={handlePromote}>Promote Variant</button>
                          <button className="prompts-discard-btn" onClick={async () => {
                            await authFetch(`${API_URL}/api/prompts/${encodeURIComponent(selected)}/ab`, {
                              method: 'PUT', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ enabled: false }),
                            });
                            await loadDetail(selected);
                          }}>Discard Test</button>
                        </>
                      )}
                    </div>
                    {metrics && detail.abTest?.enabled && (
                      <div className="prompts-ab-metrics">
                        <div className="prompts-ab-metrics-title">Metrics</div>
                        <table className="prompts-metrics-table">
                          <thead><tr><th></th><th>Calls</th><th>Avg Latency</th><th>+</th><th>-</th></tr></thead>
                          <tbody>
                            <tr>
                              <td>Control</td>
                              <td>{metrics.control.calls}</td>
                              <td>{metrics.control.calls ? Math.round(metrics.control.totalLatencyMs / metrics.control.calls) + 'ms' : '-'}</td>
                              <td>{metrics.control.thumbsUp}</td>
                              <td>{metrics.control.thumbsDown}</td>
                            </tr>
                            <tr>
                              <td>Variant</td>
                              <td>{metrics.variant.calls}</td>
                              <td>{metrics.variant.calls ? Math.round(metrics.variant.totalLatencyMs / metrics.variant.calls) + 'ms' : '-'}</td>
                              <td>{metrics.variant.thumbsUp}</td>
                              <td>{metrics.variant.thumbsDown}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
