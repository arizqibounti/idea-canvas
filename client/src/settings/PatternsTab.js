// ── Patterns Tab (Admin UI) ───────────────────────────────────
// Two-pane pattern editor: list (left) + detail editor (right).
// Follows PromptsTab architecture.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from '../api';
import PatternGraphView from './PatternGraphView';

const API_URL = process.env.REACT_APP_API_URL || '';

const STAGE_TYPES = ['generate', 'transform', 'score', 'branch', 'loop', 'merge', 'filter', 'enrich', 'fan_out'];
const MODELS = ['claude:opus', 'claude:sonnet', 'gemini:pro', 'gemini:flash'];

export default function PatternsTab() {
  const [patterns, setPatterns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editDef, setEditDef] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [filter, setFilter] = useState('');
  const [activeStageEdit, setActiveStageEdit] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateInput, setGenerateInput] = useState('');
  const [showGenModal, setShowGenModal] = useState(false);

  // Test runner state
  const [testIdea, setTestIdea] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState([]);
  const abortRef = useRef(null);

  // ── Data loading ──────────────────────────────────────────

  const loadList = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/patterns`);
      const data = await res.json();
      setPatterns(Array.isArray(data) ? data : []);
    } catch { setPatterns([]); }
  }, []);

  const loadDetail = useCallback(async (id) => {
    try {
      const res = await authFetch(`${API_URL}/api/patterns/${id}`);
      const data = await res.json();
      setDetail(data);
      setEditDef(data.versions?.[0]?.definition || null);
      setActiveStageEdit(null);
    } catch { setDetail(null); setEditDef(null); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (selected) loadDetail(selected); }, [selected, loadDetail]);

  // ── Save ──────────────────────────────────────────────────

  const handleSave = async () => {
    if (!editDef || !selected) return;
    setSaving(true);
    try {
      await authFetch(`${API_URL}/api/patterns/${selected}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: editDef, note: saveNote || 'Updated via admin' }),
      });
      setSaved(true);
      setSaveNote('');
      setTimeout(() => setSaved(false), 2000);
      loadDetail(selected);
      loadList();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally { setSaving(false); }
  };

  const handleRevert = async (version) => {
    if (!selected) return;
    try {
      await authFetch(`${API_URL}/api/patterns/${selected}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      loadDetail(selected);
      loadList();
    } catch (err) { alert('Revert failed: ' + err.message); }
  };

  // ── Seed ──────────────────────────────────────────────────

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await authFetch(`${API_URL}/api/patterns/seed`, { method: 'POST' });
      const data = await res.json();
      alert(`Seeded ${data.seeded} patterns`);
      loadList();
    } catch (err) { alert('Seed failed: ' + err.message); }
    finally { setSeeding(false); }
  };

  // ── AI Generate ───────────────────────────────────────────

  const handleGenerate = async () => {
    if (!generateInput.trim()) return;
    setGenerating(true);
    try {
      const res = await authFetch(`${API_URL}/api/pattern/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: generateInput }),
      });
      const data = await res.json();
      if (data.pattern) {
        setEditDef(data.pattern);
        setSelected(data.pattern.id);
        setShowGenModal(false);
        setGenerateInput('');
        // Save as new pattern
        await authFetch(`${API_URL}/api/patterns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ definition: data.pattern }),
        });
        loadList();
      }
    } catch (err) { alert('Generation failed: ' + err.message); }
    finally { setGenerating(false); }
  };

  // ── AI Improve stage prompt ───────────────────────────────

  const handleImprovePrompt = async (stageName) => {
    const stage = editDef?.stages?.[stageName];
    if (!stage?.promptFallback) return;

    try {
      const res = await authFetch(`${API_URL}/api/prompt-improve/critique`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText: stage.promptFallback, promptKey: `pattern_${editDef.id}_${stageName}` }),
      });
      const data = await res.json();
      if (data.weaknesses?.length) {
        const summary = data.weaknesses.map(w => `[${w.severity}] ${w.area}: ${w.issue}`).join('\n');
        alert(`Prompt critique:\n\n${summary}\n\nScore: ${data.overallScore}/10`);
      }
    } catch (err) { alert('Improve failed: ' + err.message); }
  };

  // ── Test runner ───────────────────────────────────────────

  const handleRunTest = async () => {
    if (!selected || !testIdea.trim()) return;
    setTestRunning(true);
    setTestResults([]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await authFetch(`${API_URL}/api/pattern/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patternId: selected, idea: testIdea, nodes: [], mode: 'idea' }),
        signal: controller.signal,
      });

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
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            setTestResults(prev => [...prev, event]);
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setTestResults(prev => [...prev, { _error: true, error: err.message }]);
    } finally {
      setTestRunning(false);
      abortRef.current = null;
    }
  };

  // ── Edit helpers ──────────────────────────────────────────

  const updateStage = (stageName, field, value) => {
    setEditDef(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [stageName]: { ...prev.stages[stageName], [field]: value },
      },
    }));
  };

  const addStage = () => {
    const name = prompt('Stage name (snake_case):');
    if (!name) return;
    setEditDef(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [name]: { type: 'transform', model: 'claude:sonnet', promptFallback: '', outputFormat: 'json', stream: false },
      },
    }));
    setActiveStageEdit(name);
  };

  const removeStage = (stageName) => {
    if (!window.confirm(`Remove stage "${stageName}"?`)) return;
    setEditDef(prev => {
      const stages = { ...prev.stages };
      delete stages[stageName];
      const edges = (prev.graph?.edges || []).filter(e => e.from !== stageName && e.to !== stageName);
      return { ...prev, stages, graph: { ...prev.graph, edges } };
    });
    if (activeStageEdit === stageName) setActiveStageEdit(null);
  };

  const updateFramework = (field, value) => {
    setEditDef(prev => ({
      ...prev,
      framework: { ...prev.framework, [field]: value },
    }));
  };

  // ── Filter patterns ───────────────────────────────────────

  const filtered = patterns.filter(p =>
    !filter || p.name?.toLowerCase().includes(filter.toLowerCase()) || p.id?.includes(filter.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="patterns-tab">
      <div className="patterns-layout">
        {/* ── Left pane: Pattern list ──────────────────────── */}
        <div className="patterns-sidebar">
          <div className="patterns-sidebar-header">
            <input
              className="patterns-filter"
              placeholder="Filter patterns..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <div className="patterns-sidebar-actions">
              <button className="patterns-btn patterns-btn--sm" onClick={() => setShowGenModal(true)}>AI GENERATE</button>
              <button className="patterns-btn patterns-btn--sm" onClick={handleSeed} disabled={seeding}>
                {seeding ? 'SEEDING...' : 'SEED'}
              </button>
            </div>
          </div>

          {filtered.map(p => (
            <div
              key={p.id}
              className={`patterns-item ${selected === p.id ? 'patterns-item--active' : ''}`}
              onClick={() => setSelected(p.id)}
            >
              <span className="patterns-item-icon" style={{ color: p.color }}>{p.icon}</span>
              <div className="patterns-item-info">
                <span className="patterns-item-name">{p.name || p.id}</span>
                <span className="patterns-item-desc">{p.description?.slice(0, 60)}</span>
              </div>
              {p.builtIn && <span className="patterns-item-badge">BUILT-IN</span>}
              <span className="patterns-item-version">v{p.currentVersion}</span>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="patterns-empty">No patterns found. Click SEED to load built-ins.</div>
          )}
        </div>

        {/* ── Right pane: Pattern editor ───────────────────── */}
        <div className="patterns-editor">
          {!editDef ? (
            <div className="patterns-editor-empty">Select a pattern to edit</div>
          ) : (
            <>
              {/* Metadata */}
              <div className="patterns-section">
                <h3 className="patterns-section-title">METADATA</h3>
                <div className="patterns-meta-row">
                  <label>Name</label>
                  <input value={editDef.name || ''} onChange={e => setEditDef(prev => ({ ...prev, name: e.target.value }))} />
                </div>
                <div className="patterns-meta-row">
                  <label>Description</label>
                  <input value={editDef.description || ''} onChange={e => setEditDef(prev => ({ ...prev, description: e.target.value }))} />
                </div>
                <div className="patterns-meta-row">
                  <label>Icon</label>
                  <input value={editDef.icon || ''} onChange={e => setEditDef(prev => ({ ...prev, icon: e.target.value }))} style={{ width: 60 }} />
                  <label style={{ marginLeft: 16 }}>Color</label>
                  <input type="color" value={editDef.color || '#6c63ff'} onChange={e => setEditDef(prev => ({ ...prev, color: e.target.value }))} />
                </div>
                <div className="patterns-meta-row">
                  <label>Keywords</label>
                  <input
                    value={(editDef.autoSelect?.keywords || []).join(', ')}
                    onChange={e => setEditDef(prev => ({
                      ...prev,
                      autoSelect: { ...prev.autoSelect, keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) },
                    }))}
                    placeholder="comma-separated keywords for auto-detection"
                  />
                </div>
              </div>

              {/* Stage Graph */}
              <div className="patterns-section">
                <h3 className="patterns-section-title">STAGE GRAPH</h3>
                <PatternGraphView
                  stages={editDef.stages}
                  graph={editDef.graph}
                  activeStage={activeStageEdit}
                  onStageClick={setActiveStageEdit}
                />
              </div>

              {/* Stages */}
              <div className="patterns-section">
                <h3 className="patterns-section-title">
                  STAGES ({Object.keys(editDef.stages || {}).length})
                  <button className="patterns-btn patterns-btn--sm" onClick={addStage} style={{ marginLeft: 12 }}>+ ADD</button>
                </h3>
                {Object.entries(editDef.stages || {}).map(([name, stage]) => (
                  <div key={name} className={`patterns-stage-card ${activeStageEdit === name ? 'patterns-stage-card--open' : ''}`}>
                    <div className="patterns-stage-header" onClick={() => setActiveStageEdit(activeStageEdit === name ? null : name)}>
                      <span className="patterns-stage-type-badge" style={{ background: stageColor(stage.type) }}>
                        {stage.type}
                      </span>
                      <span className="patterns-stage-name">{name}</span>
                      {stage.model && <span className="patterns-stage-model">{stage.model}</span>}
                      {stage.terminal && <span className="patterns-stage-terminal">TERMINAL</span>}
                      <span className="patterns-stage-toggle">{activeStageEdit === name ? '−' : '+'}</span>
                    </div>
                    {activeStageEdit === name && (
                      <div className="patterns-stage-body">
                        <div className="patterns-stage-row">
                          <label>Type</label>
                          <select value={stage.type} onChange={e => updateStage(name, 'type', e.target.value)}>
                            {STAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="patterns-stage-row">
                          <label>Model</label>
                          <select value={stage.model || ''} onChange={e => updateStage(name, 'model', e.target.value)}>
                            <option value="">auto</option>
                            {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        {stage.type !== 'branch' && stage.type !== 'fan_out' && stage.type !== 'enrich' && (
                          <>
                            <div className="patterns-stage-row">
                              <label>Prompt Template</label>
                              <div className="patterns-stage-prompt-actions">
                                <button className="patterns-btn patterns-btn--xs" onClick={() => handleImprovePrompt(name)}>CRITIQUE</button>
                              </div>
                            </div>
                            <textarea
                              className="patterns-stage-textarea"
                              value={stage.promptFallback || ''}
                              onChange={e => updateStage(name, 'promptFallback', e.target.value)}
                              rows={8}
                              placeholder="Prompt template with {{slots}}..."
                            />
                          </>
                        )}
                        {stage.type === 'branch' && (
                          <>
                            <div className="patterns-stage-row">
                              <label>Condition</label>
                              <input value={stage.condition || ''} onChange={e => updateStage(name, 'condition', e.target.value)} placeholder="{{critique.satisfied}} === true" />
                            </div>
                            <div className="patterns-stage-row">
                              <label>On True →</label>
                              <select value={stage.onTrue || ''} onChange={e => updateStage(name, 'onTrue', e.target.value)}>
                                <option value="">—</option>
                                {Object.keys(editDef.stages).filter(s => s !== name).map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div className="patterns-stage-row">
                              <label>On False →</label>
                              <select value={stage.onFalse || ''} onChange={e => updateStage(name, 'onFalse', e.target.value)}>
                                <option value="">—</option>
                                {Object.keys(editDef.stages).filter(s => s !== name).map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                          </>
                        )}
                        <div className="patterns-stage-row">
                          <label>
                            <input type="checkbox" checked={stage.stream || false} onChange={e => updateStage(name, 'stream', e.target.checked)} /> Stream
                          </label>
                          <label style={{ marginLeft: 16 }}>
                            <input type="checkbox" checked={stage.terminal || false} onChange={e => updateStage(name, 'terminal', e.target.checked)} /> Terminal
                          </label>
                        </div>
                        <button className="patterns-btn patterns-btn--danger patterns-btn--sm" onClick={() => removeStage(name)}>REMOVE STAGE</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Framework */}
              <div className="patterns-section">
                <h3 className="patterns-section-title">FRAMEWORK</h3>
                <div className="patterns-meta-row">
                  <label>Critic Persona</label>
                  <textarea
                    className="patterns-textarea-sm"
                    value={editDef.framework?.criticPersonaTemplate || ''}
                    onChange={e => updateFramework('criticPersonaTemplate', e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="patterns-meta-row">
                  <label>Responder Persona</label>
                  <textarea
                    className="patterns-textarea-sm"
                    value={editDef.framework?.responderPersonaTemplate || ''}
                    onChange={e => updateFramework('responderPersonaTemplate', e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="patterns-meta-row">
                  <label>Chat Persona</label>
                  <textarea
                    className="patterns-textarea-sm"
                    value={editDef.framework?.chatPersonaTemplate || ''}
                    onChange={e => updateFramework('chatPersonaTemplate', e.target.value)}
                    rows={3}
                  />
                </div>
              </div>

              {/* Version History */}
              {detail?.versions?.length > 0 && (
                <div className="patterns-section">
                  <h3 className="patterns-section-title">VERSION HISTORY</h3>
                  <div className="patterns-versions">
                    {detail.versions.map(v => (
                      <div key={v.version} className="patterns-version-row">
                        <span className="patterns-version-num">v{v.version}</span>
                        <span className="patterns-version-date">{new Date(v.createdAt).toLocaleDateString()}</span>
                        <span className="patterns-version-note">{v.note || '—'}</span>
                        {v.version !== detail.currentVersion && (
                          <button className="patterns-btn patterns-btn--xs" onClick={() => handleRevert(v.version)}>REVERT</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Test Runner */}
              <div className="patterns-section">
                <h3 className="patterns-section-title">TEST RUNNER</h3>
                <div className="patterns-test-input">
                  <textarea
                    placeholder="Enter a test idea..."
                    value={testIdea}
                    onChange={e => setTestIdea(e.target.value)}
                    rows={2}
                  />
                  <button
                    className="patterns-btn"
                    onClick={testRunning ? () => abortRef.current?.abort() : handleRunTest}
                    disabled={!testIdea.trim() && !testRunning}
                  >
                    {testRunning ? 'STOP' : 'RUN TEST'}
                  </button>
                </div>
                {testResults.length > 0 && (
                  <div className="patterns-test-results">
                    {testResults.map((event, i) => (
                      <div key={i} className="patterns-test-event">
                        {event._patternProgress && <span className="patterns-test-progress">▶ {event.stage} ({event.type})</span>}
                        {event._patternStageResult && <span className="patterns-test-result">✓ {event.stage}: {JSON.stringify(event.data).slice(0, 120)}</span>}
                        {event._checkpoint && <span className="patterns-test-checkpoint">⑂ Checkpoint: {event.stage}</span>}
                        {event._patternComplete && <span className="patterns-test-complete">✓ Complete ({event.stagesExecuted} stages, {event.totalRounds} rounds)</span>}
                        {event._patternError && <span className="patterns-test-error">✗ {event.stage}: {event.error}</span>}
                        {event.id && event.type && !event._patternProgress && (
                          <span className="patterns-test-node">{event.type}: {event.label}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Save bar */}
              <div className="patterns-save-bar">
                <input
                  className="patterns-save-note"
                  placeholder="Change note..."
                  value={saveNote}
                  onChange={e => setSaveNote(e.target.value)}
                />
                <button className="patterns-btn patterns-btn--primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'SAVING...' : saved ? '✓ SAVED' : 'SAVE CHANGES'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Generate modal */}
      {showGenModal && (
        <div className="patterns-modal-overlay" onClick={() => setShowGenModal(false)}>
          <div className="patterns-modal" onClick={e => e.stopPropagation()}>
            <h3>Generate Thinking Pattern</h3>
            <p style={{ color: '#888', fontSize: 13 }}>Describe the thinking pattern you want. The AI will generate a complete pattern definition.</p>
            <textarea
              className="patterns-modal-textarea"
              value={generateInput}
              onChange={e => setGenerateInput(e.target.value)}
              rows={5}
              placeholder="e.g., A pattern that generates multiple hypotheses, tests each against evidence, prunes invalid ones, and deepens the survivors..."
            />
            <div className="patterns-modal-actions">
              <button className="patterns-btn" onClick={() => setShowGenModal(false)}>CANCEL</button>
              <button className="patterns-btn patterns-btn--primary" onClick={handleGenerate} disabled={generating || !generateInput.trim()}>
                {generating ? 'GENERATING...' : 'GENERATE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function stageColor(type) {
  const colors = {
    generate: '#6c63ff', transform: '#f59e0b', score: '#22c55e', branch: '#ff4757',
    loop: '#cc5de8', merge: '#0ea5e9', filter: '#f97316', enrich: '#14b8a6', fan_out: '#ec4899',
  };
  return colors[type] || '#888';
}
