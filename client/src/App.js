import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import IdeaCanvas from './IdeaCanvas';
import NodeEditPanel from './NodeEditPanel';
import LoadModal from './LoadModal';
import NodeContextMenu from './NodeContextMenu';
import CodebaseUpload from './CodebaseUpload';
import ResumeInput from './ResumeInput';
import HistoryModal from './HistoryModal';
import MemoryInsights, { buildMemoryEntry, appendMemory, readMemory } from './MemoryLayer';

import DebatePanel from './DebatePanel';
import ResumeChangesModal from './ResumeChangesModal';
import ExportGitHubModal from './ExportGitHubModal';
import Graph3D from './Graph3D';
import { NODE_TYPES_CONFIG, buildDynamicConfig, getNodeConfig } from './nodeConfig';
import { MODES, detectMode } from './modeConfig';
import { useCanvasMode, buildFlowNode, readSSEStream, appendVersion, readVersions } from './useCanvasMode';
import './App.css';

const API_URL = 'http://localhost:5001';

const LEGEND_GROUPS = {
  Product: ['seed', 'problem', 'user_segment', 'job_to_be_done', 'feature', 'constraint', 'metric', 'insight'],
  Code: ['component', 'api_endpoint', 'data_model', 'tech_debt'],
  Resume: ['requirement', 'skill_match', 'skill_gap', 'achievement', 'keyword', 'story', 'positioning'],
  Critique: ['critique'],
};

// ── Round / temporal helpers (mirrors Graph3D) ────────────────────────────────
function getRoundIndex(node) {
  const id = node.id || '';
  const type = (node.data?.type || node.type || '').toLowerCase();
  if (type === 'seed') return 0;
  const crit = id.match(/crit_r(\d+)/);  if (crit)  return parseInt(crit[1]) * 2;
  const rebut = id.match(/rebut_r(\d+)/); if (rebut) return parseInt(rebut[1]) * 2 + 1;
  if (/^(fin_|syn_|finalize_|synthesis_)/.test(id)) return 12;
  return 1;
}

const ROUND_LABELS = {
  0: 'SEED', 1: 'GENERATE', 2: 'R1 CRITIQUE', 3: 'R1 REBUT',
  4: 'R2 CRITIQUE', 5: 'R2 REBUT', 6: 'R3 CRITIQUE', 7: 'R3 REBUT',
  8: 'R4 CRITIQUE', 9: 'R4 REBUT', 10: 'R5 CRITIQUE', 11: 'R5 REBUT', 12: 'SYNTHESIS',
};
const ROUND_SHORT = {
  0: 'SEED', 1: 'GEN', 2: 'C1', 3: 'B1', 4: 'C2', 5: 'B2',
  6: 'C3', 7: 'B3', 8: 'C4', 9: 'B4', 10: 'C5', 11: 'B5', 12: 'SYN',
};

// ── Timeline Bar (2D view) ────────────────────────────────────────────────────
function TimelineBar2D({ roundRange, onRoundRangeChange, isPlaying, onPlayToggle,
  playbackSpeed, onSpeedChange, isolatedRound, onIsolatedRoundChange, maxRound }) {

  const handleSliderMin = (e) => {
    const v = Number(e.target.value);
    onRoundRangeChange(prev => [Math.min(v, prev[1]), prev[1]]);
    onIsolatedRoundChange(null);
    if (isPlaying) onPlayToggle();
  };
  const handleSliderMax = (e) => {
    const v = Number(e.target.value);
    onRoundRangeChange(prev => [prev[0], Math.max(v, prev[0])]);
    onIsolatedRoundChange(null);
    if (isPlaying) onPlayToggle();
  };

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
      background: 'rgba(10,10,20,0.92)', borderTop: '1px solid #2a2a3a',
      padding: '8px 16px 10px', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <style>{`
        .tl2d-range { margin: 0; padding: 0; }
        .tl2d-range::-webkit-slider-thumb {
          pointer-events: all; -webkit-appearance: none;
          width: 14px; height: 14px; border-radius: 50%;
          background: #6c63ff; border: 2px solid #0a0a0f;
          cursor: pointer; position: relative; z-index: 5; margin-top: -5px;
        }
        .tl2d-range::-moz-range-thumb {
          pointer-events: all; width: 14px; height: 14px; border-radius: 50%;
          background: #6c63ff; border: 2px solid #0a0a0f; cursor: pointer;
        }
        .tl2d-range::-webkit-slider-runnable-track { height: 4px; background: transparent; }
        .tl2d-range::-moz-range-track { height: 4px; background: transparent; }
      `}</style>

      {/* Play / Pause */}
      <button onClick={onPlayToggle} style={{
        background: 'transparent', border: `1px solid ${isPlaying ? '#ff5f6d' : '#6c63ff'}`,
        color: isPlaying ? '#ff5f6d' : '#6c63ff', fontFamily: 'monospace',
        fontSize: 12, fontWeight: 700, padding: '3px 0', borderRadius: 5,
        cursor: 'pointer', width: 32, flexShrink: 0, lineHeight: 1,
      }}>
        {isPlaying ? '■' : '▶'}
      </button>

      {/* Speed */}
      <select value={playbackSpeed} onChange={e => onSpeedChange(Number(e.target.value))} style={{
        background: '#111118', border: '1px solid #2a2a3a', color: '#888',
        fontFamily: 'monospace', fontSize: 9, padding: '3px 2px', borderRadius: 4,
        cursor: 'pointer', width: 40, flexShrink: 0,
      }}>
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
      </select>

      {/* Dual range slider */}
      <div style={{ flex: 1, position: 'relative', height: 36, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, top: 10, background: '#1a1a2a', borderRadius: 2, pointerEvents: 'none' }} />
        <div style={{
          position: 'absolute', top: 10, height: 4, borderRadius: 2, pointerEvents: 'none',
          left: `${(roundRange[0] / (maxRound || 1)) * 100}%`,
          width: `${((roundRange[1] - roundRange[0]) / (maxRound || 1)) * 100}%`,
          background: isolatedRound !== null ? '#fbbf24' : '#6c63ff',
        }} />

        {Array.from({ length: (maxRound || 0) + 1 }, (_, i) => {
          const inRange = isolatedRound !== null ? i === isolatedRound : i >= roundRange[0] && i <= roundRange[1];
          return (
            <div key={i} style={{
              position: 'absolute', left: `${(i / (maxRound || 1)) * 100}%`, top: 0,
              transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column',
              alignItems: 'center', pointerEvents: 'none',
            }}>
              <div style={{ width: 1, height: 6, background: inRange ? '#6c63ff' : '#333', marginBottom: 1 }} />
              <div style={{ height: 8 }} />
              <span style={{
                fontSize: 7, marginTop: 2, color: inRange ? '#888' : '#383838',
                whiteSpace: 'nowrap', letterSpacing: '0.02em', fontFamily: 'monospace',
              }}>
                {ROUND_SHORT[i] || i}
              </span>
            </div>
          );
        })}

        <input type="range" className="tl2d-range" min={0} max={maxRound || 1} step={1}
          value={roundRange[0]} onChange={handleSliderMin}
          style={{ position: 'absolute', width: '100%', top: 4, appearance: 'none', WebkitAppearance: 'none', background: 'transparent', pointerEvents: 'none', zIndex: 3, height: 16 }}
        />
        <input type="range" className="tl2d-range" min={0} max={maxRound || 1} step={1}
          value={roundRange[1]} onChange={handleSliderMax}
          style={{ position: 'absolute', width: '100%', top: 4, appearance: 'none', WebkitAppearance: 'none', background: 'transparent', pointerEvents: 'none', zIndex: 4, height: 16 }}
        />
      </div>

      {/* Round label */}
      <span style={{
        color: '#888', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
        flexShrink: 0, minWidth: 90, textAlign: 'right', fontFamily: 'monospace',
      }}>
        {isolatedRound !== null
          ? `⦿ ${ROUND_LABELS[isolatedRound] || `R${isolatedRound}`}`
          : `${ROUND_LABELS[roundRange[0]] || roundRange[0]} — ${ROUND_LABELS[roundRange[1]] || roundRange[1]}`
        }
      </span>
    </div>
  );
}

export default function App() {
  // ── Mode ──────────────────────────────────────────────────
  const [manualMode, setManualMode]   = useState(null); // null = follow auto-detect
  const [detectedMode, setDetectedMode] = useState(null);
  const detectTimerRef = useRef(null);

  // ── Idea mode specific state ──────────────────────────────
  const [idea, setIdea] = useState('');
  const [redirectState, setRedirectState] = useState('idle');
  const [steeringText, setSteeringText] = useState('');
  const ideaRef = useRef(null);          // textarea ref for auto-resize
  const fileInputRef = useRef(null);     // hidden file input ref
  const [attachedFile, setAttachedFile] = useState(null); // { name, size }

  // ── Codebase mode specific state ──────────────────────────
  const [cbFolderName, setCbFolderName] = useState('');

  // ── Resume mode specific state ────────────────────────────
  const [resumeJobLabel, setResumeJobLabel] = useState('');
  const [resumePdf, setResumePdf]           = useState(null); // base64 PDF kept for changes API
  const [showResumeChanges, setShowResumeChanges] = useState(false);
  const [resumeChanges, setResumeChanges]   = useState(null); // { summary, changes[] }
  const [isGeneratingChanges, setIsGeneratingChanges] = useState(false);
  const [resumeChangesError, setResumeChangesError]   = useState(null);

  // ── Canvas hooks ──────────────────────────────────────────
  const idea$ = useCanvasMode({ storageKey: 'IDEA_CANVAS_SESSIONS', sessionLabel: 'idea' });
  const cb$ = useCanvasMode({ storageKey: 'CODEBASE_CANVAS_SESSIONS', sessionLabel: 'folderName' });

  // ── Dynamic type config for adaptive mode ────────────────
  const dynamicConfigRef = useRef(null);    // built color/icon map
  const dynamicTypesRef = useRef(null);     // raw _meta types array
  const [dynamicDomain, setDynamicDomain] = useState(null); // domain label for legend
  const [dynamicLegendTypes, setDynamicLegendTypes] = useState([]); // ordered types for legend
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);

  // ── Mode: derived ─────────────────────────────────────────
  // displayMode drives the tab highlight + placeholder + icon
  // activeMode collapses all non-codebase modes to 'idea' for canvas routing
  const displayMode = manualMode ?? detectedMode ?? 'idea';
  const activeMode  = displayMode === 'codebase' ? 'codebase' : 'idea';
  const active = activeMode === 'idea' ? idea$ : cb$;

  // ── Memory Layer ──────────────────────────────────────────
  const [showMemory, setShowMemory] = useState(false);
  const memorySessionCount = readMemory().length;

  // ── Version History ───────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [ideaVersions, setIdeaVersions] = useState([]);

  // ── Debate Panel ──────────────────────────────────────────
  const [showDebate, setShowDebate] = useState(false);
  const [debateAutoStart, setDebateAutoStart] = useState(false);
  const debateRoundsRef = useRef([]);

  // ── Export to GitHub ────────────────────────────────────────
  const [showExportModal, setShowExportModal] = useState(false);

  // ── 3D Canvas ─────────────────────────────────────────────
  const [is3D, setIs3D] = useState(false);

  // ── 2D Temporal Navigation ──────────────────────────────
  const [roundRange, setRoundRange]           = useState([0, 12]);
  const [isPlayingRounds, setIsPlayingRounds] = useState(false);
  const [playbackSpeed, setPlaybackSpeed]     = useState(1);
  const [isolatedRound, setIsolatedRound]     = useState(null);
  const playbackTimerRef = useRef(null);

  const [isCritiquing, setIsCritiquing] = useState(false);
  const [treeSearchQuery, setTreeSearchQuery] = useState('');

  // ── Auto-save ─────────────────────────────────────────────
  useEffect(() => {
    if (activeMode === 'idea') idea$.triggerAutoSave(idea);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea$.nodeCount, idea, activeMode]);

  useEffect(() => {
    if (activeMode === 'codebase') cb$.triggerAutoSave(cbFolderName);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cb$.nodeCount, cbFolderName, activeMode]);

  // ── Save version + memory after generation ────────────────
  const saveVersionAndMemory = useCallback((ideaText, rawNodes) => {
    if (!ideaText?.trim() || !rawNodes?.length) return;
    appendVersion(ideaText.trim(), rawNodes);
    appendMemory(buildMemoryEntry(ideaText.trim(), rawNodes));
  }, []);

  // ── Idea mode: generate ───────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!idea.trim() || idea$.isGenerating || idea$.isRegenerating) return;
    idea$.resetCanvas();
    idea$.setIsGenerating(true);
    setRedirectState('idle');
    setDebateAutoStart(false);
    // Reset dynamic config for new generation
    dynamicConfigRef.current = null;
    dynamicTypesRef.current = null;
    setDynamicDomain(null);
    setDynamicLegendTypes([]);

    if (idea$.abortRef.current) idea$.abortRef.current.abort();
    const controller = new AbortController();
    idea$.abortRef.current = controller;

    try {
      // ── URL detection & fetching ────────────────────────────
      let fetchedUrlContent = null;
      const urlRegex = /https?:\/\/[^\s"'<>]+/g;
      const urls = idea.trim().match(urlRegex);
      if (urls?.length) {
        setIsFetchingUrl(true);
        try {
          const fetches = urls.map(async (url) => {
            try {
              const r = await fetch(`${API_URL}/api/fetch-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
                signal: controller.signal,
              });
              if (!r.ok) return null;
              const { text } = await r.json();
              return text ? { url, text } : null;
            } catch { return null; }
          });
          const results = await Promise.all(fetches);
          fetchedUrlContent = results.filter(Boolean);
          if (!fetchedUrlContent.length) fetchedUrlContent = null;
        } finally {
          setIsFetchingUrl(false);
        }
      }

      const res = await fetch(`${API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: idea.trim(), mode: displayMode, fetchedUrlContent }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const seenTypes = [];
      const result = await readSSEStream(res, (nodeData) => {
        // Intercept _meta line
        if (nodeData._meta) {
          const config = buildDynamicConfig(nodeData.types || []);
          dynamicConfigRef.current = config;
          dynamicTypesRef.current = nodeData.types || [];
          idea$.dynamicTypesRef.current = nodeData.types || [];
          setDynamicDomain(nodeData.domain || 'Canvas');
          return; // don't add _meta as a node
        }
        const flowNode = buildFlowNode(nodeData);
        // Attach dynamic config to node data for rendering
        if (dynamicConfigRef.current) {
          flowNode.data.dynamicConfig = dynamicConfigRef.current;
        }
        idea$.rawNodesRef.current = [...idea$.rawNodesRef.current, flowNode];
        idea$.applyLayout(idea$.rawNodesRef.current, []);
        idea$.setNodeCount(idea$.rawNodesRef.current.length);
        // Track seen types for legend
        if (nodeData.type && !seenTypes.includes(nodeData.type)) {
          seenTypes.push(nodeData.type);
          setDynamicLegendTypes([...seenTypes]);
        }
      });
      if (result.error) idea$.setError(result.error);
      saveVersionAndMemory(idea, idea$.rawNodesRef.current);
    } catch (err) {
      if (err.name !== 'AbortError') idea$.setError(err.message);
    } finally {
      idea$.setIsGenerating(false);
      setIsFetchingUrl(false);
      // Auto-open debate panel and kick off the loop if generation completed successfully
      if (!controller.signal.aborted && idea$.rawNodesRef.current.length > 0) {
        setShowDebate(true);
        setDebateAutoStart(true);
      }
    }
  }, [idea, idea$, displayMode, saveVersionAndMemory]);

  const handleStop = useCallback(() => {
    active.handleStop();
    setRedirectState('idle');
    setIsCritiquing(false);
  }, [active]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
  }, [handleGenerate]);

  // ── Textarea auto-resize ────────────────────────────────
  const autoResize = useCallback(() => {
    const el = ideaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, []);

  const handleIdeaChange = useCallback((e) => {
    const val = e.target.value;
    setIdea(val);
    setAttachedFile(null);              // clear file badge on manual edit
    setTimeout(autoResize, 0);
    // Auto-detect mode from input text (debounced 400 ms).
    // Detection always runs; manualMode takes precedence in displayMode expression.
    if (detectTimerRef.current) clearTimeout(detectTimerRef.current);
    detectTimerRef.current = setTimeout(() => {
      setDetectedMode(val.trim().length >= 8 ? detectMode(val) : null);
    }, 400);
  }, [autoResize]);

  // ── File upload ─────────────────────────────────────────
  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name;
    const ext = name.split('.').pop().toLowerCase();

    if (!['txt', 'md', 'text', 'csv', 'json', 'html', 'rtf'].includes(ext)) {
      alert('Please upload a plain-text file (.txt, .md, .csv, .json). PDF and Word are not supported yet.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result || '';
      setIdea(content.slice(0, 50000));   // generous limit
      setAttachedFile({ name: file.name, size: file.size });
      setTimeout(autoResize, 0);
    };
    reader.readAsText(file);
    e.target.value = '';                  // allow re-uploading same file
  }, [autoResize]);

  // ── Redirect / steering ───────────────────────────────────
  const handleRedirect = useCallback(() => {
    if (idea$.abortRef.current) idea$.abortRef.current.abort();
    idea$.setIsGenerating(false);
    setRedirectState('prompting');
    setSteeringText('');
  }, [idea$]);

  const handleCancelRedirect = useCallback(() => {
    setRedirectState('idle');
    setSteeringText('');
  }, []);

  // ── Mode selection ────────────────────────────────────────
  // Clicking the already-active manual mode releases it back to auto-detect
  const handleModeSelect = useCallback((modeId) => {
    setManualMode(prev => prev === modeId ? null : modeId);
  }, []);

  const handleSteeringSubmit = useCallback(async () => {
    if (!steeringText.trim()) return;
    setRedirectState('resuming');
    idea$.setIsGenerating(true);

    const controller = new AbortController();
    idea$.abortRef.current = controller;

    const existingNodes = idea$.rawNodesRef.current.map((n) => ({
      id: n.id, type: n.data.type, label: n.data.label,
      reasoning: n.data.reasoning, parentId: n.data.parentId,
    }));

    try {
      const res = await fetch(`${API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: idea.trim(), steeringInstruction: steeringText.trim(), existingNodes }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const result = await readSSEStream(res, (nodeData) => {
        const flowNode = buildFlowNode(nodeData);
        idea$.rawNodesRef.current = [...idea$.rawNodesRef.current, flowNode];
        idea$.applyLayout(idea$.rawNodesRef.current, idea$.drillStackRef.current);
        idea$.setNodeCount(idea$.rawNodesRef.current.length);
      });
      if (result.error) idea$.setError(result.error);
      saveVersionAndMemory(idea, idea$.rawNodesRef.current);
    } catch (err) {
      if (err.name !== 'AbortError') idea$.setError(err.message);
    } finally {
      idea$.setIsGenerating(false);
      setRedirectState('idle');
    }
  }, [idea, steeringText, idea$, saveVersionAndMemory]);

  const handleSteeringKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleSteeringSubmit();
    if (e.key === 'Escape') handleCancelRedirect();
  }, [handleSteeringSubmit, handleCancelRedirect]);

  // ── Codebase mode ─────────────────────────────────────────
  const handleAnalysisReady = useCallback((payload) => {
    setCbFolderName(payload.folderName || 'project');
    handleAnalyzeCodebase(payload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnalyzeCodebase = useCallback(async (payload) => {
    if (!payload || cb$.isGenerating) return;
    cb$.resetCanvas();
    cb$.setIsGenerating(true);

    if (cb$.abortRef.current) cb$.abortRef.current.abort();
    const controller = new AbortController();
    cb$.abortRef.current = controller;

    try {
      const res = await fetch(`${API_URL}/api/analyze-codebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const result = await readSSEStream(res, (nodeData) => {
        const flowNode = buildFlowNode(nodeData);
        cb$.rawNodesRef.current = [...cb$.rawNodesRef.current, flowNode];
        cb$.applyLayout(cb$.rawNodesRef.current, cb$.drillStackRef.current);
        cb$.setNodeCount(cb$.rawNodesRef.current.length);
      });
      if (result.error) cb$.setError(result.error);
    } catch (err) {
      if (err.name !== 'AbortError') cb$.setError(err.message);
    } finally {
      cb$.setIsGenerating(false);
    }
  }, [cb$]);

  const handleNewCbAnalysis = useCallback(() => {
    cb$.resetCanvas();
    setCbFolderName('');
  }, [cb$]);

  // ── Resume mode: analyse JD + PDF ─────────────────────────
  const handleResumeAnalyze = useCallback(async ({ jdText, pdfBase64, jdUrl }) => {
    if (idea$.isGenerating) return;
    const label = jdUrl || (jdText ? jdText.slice(0, 60) + '…' : 'Resume Analysis');
    setResumeJobLabel(label);
    setResumePdf(pdfBase64 || null);  // lift PDF so changes modal can use it later
    setResumeChanges(null);           // clear any prior changes
    idea$.resetCanvas();
    idea$.setIsGenerating(true);
    setDebateAutoStart(false);

    if (idea$.abortRef.current) idea$.abortRef.current.abort();
    const controller = new AbortController();
    idea$.abortRef.current = controller;

    try {
      const res = await fetch(`${API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: jdText || jdUrl || '',
          mode: 'resume',
          jdText: jdText || '',
          resumePdf: pdfBase64 || null,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const result = await readSSEStream(res, (nodeData) => {
        const flowNode = buildFlowNode(nodeData);
        idea$.rawNodesRef.current = [...idea$.rawNodesRef.current, flowNode];
        idea$.applyLayout(idea$.rawNodesRef.current, []);
        idea$.setNodeCount(idea$.rawNodesRef.current.length);
      });
      if (result.error) idea$.setError(result.error);
      saveVersionAndMemory(label, idea$.rawNodesRef.current);
    } catch (err) {
      if (err.name !== 'AbortError') idea$.setError(err.message);
    } finally {
      idea$.setIsGenerating(false);
      if (!controller.signal.aborted && idea$.rawNodesRef.current.length > 0) {
        setShowDebate(true);
        setDebateAutoStart(true);
      }
    }
  }, [idea$, saveVersionAndMemory]);

  const handleNewResumeAnalysis = useCallback(() => {
    idea$.resetCanvas();
    setResumeJobLabel('');
    setResumePdf(null);
    setResumeChanges(null);
    setShowResumeChanges(false);
  }, [idea$]);

  // ── Resume: generate change manifest after debate ─────────
  const handleApplyToResume = useCallback(async () => {
    setResumeChanges(null);
    setResumeChangesError(null);
    setIsGeneratingChanges(true);
    setShowResumeChanges(true);

    try {
      const res = await fetch(`${API_URL}/api/resume/changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumePdf: resumePdf || null,
          nodes: idea$.rawNodesRef.current.map(n => ({
            id: n.id,
            type: n.data?.type || n.type,
            label: n.data?.label || n.label,
            reasoning: n.data?.reasoning || n.reasoning,
          })),
          debateHistory: debateRoundsRef.current,
          idea: resumeJobLabel,
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setResumeChanges(data);
    } catch (err) {
      console.error('Resume changes error:', err);
      setResumeChangesError(err.message);
    } finally {
      setIsGeneratingChanges(false);
    }
  }, [resumePdf, idea$, debateRoundsRef, resumeJobLabel]);

  // ── Load session handlers ─────────────────────────────────
  const handleLoadIdeaSession = useCallback((session) => {
    idea$.handleLoadSession(session, setIdea);
  }, [idea$]);

  const handleLoadCbSession = useCallback((session) => {
    cb$.handleLoadSession(session, setCbFolderName);
  }, [cb$]);

  // ── Version History ───────────────────────────────────────
  const handleShowHistory = useCallback(() => {
    setIdeaVersions(readVersions(idea.trim()));
    setShowHistory(true);
  }, [idea]);

  const handleLoadVersion = useCallback((version) => {
    idea$.rawNodesRef.current = version.rawNodes;
    idea$.drillStackRef.current = [];
    idea$.setDrillStack([]);
    idea$.setNodeCount(version.rawNodes.length);
    idea$.setSelectedNode(null);
    idea$.applyLayout(version.rawNodes, []);
    setIdea(version.label);
    setShowHistory(false);
  }, [idea$]);

  // ── Debate: add nodes to canvas from debate loop ─────────
  const handleDebateNodesAdded = useCallback((newNodes) => {
    newNodes.forEach((flowNode) => {
      idea$.rawNodesRef.current = [...idea$.rawNodesRef.current, flowNode];
    });
    idea$.applyLayout(idea$.rawNodesRef.current, idea$.drillStackRef.current);
    idea$.setNodeCount(idea$.rawNodesRef.current.length);
  }, [idea$]);

  // ── Debate: update existing nodes in-place after consensus ─
  const handleDebateNodeUpdate = useCallback((updatedNode) => {
    idea$.rawNodesRef.current = idea$.rawNodesRef.current.map((n) =>
      n.id === updatedNode.id
        ? { ...n, data: { ...n.data, label: updatedNode.label, reasoning: updatedNode.reasoning } }
        : n
    );
    idea$.applyLayout(idea$.rawNodesRef.current, idea$.drillStackRef.current);
  }, [idea$]);

  // ── 2D Temporal: maxRound ─────────────────────────────────
  const maxRound = useMemo(() => {
    if (!active.nodes.length) return 0;
    return Math.max(0, ...active.nodes.map(n => getRoundIndex(n)));
  }, [active.nodes]);

  // Sync roundRange when maxRound changes
  useEffect(() => {
    setRoundRange(prev => [prev[0], Math.max(prev[1], maxRound) > maxRound ? maxRound : Math.max(prev[1], maxRound)]);
  }, [maxRound]);

  // Reset temporal state on mode switch
  useEffect(() => {
    setRoundRange([0, 12]);
    setIsolatedRound(null);
    setIsPlayingRounds(false);
  }, [activeMode]);

  // ── 2D Playback engine ──────────────────────────────────
  useEffect(() => {
    if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    if (!isPlayingRounds || is3D) return;
    const intervalMs = 1200 / playbackSpeed;
    playbackTimerRef.current = setInterval(() => {
      setRoundRange(prev => {
        const next = Math.min(prev[1] + 1, maxRound);
        if (next >= maxRound) setIsPlayingRounds(false);
        return [0, next];
      });
    }, intervalMs);
    return () => { if (playbackTimerRef.current) clearInterval(playbackTimerRef.current); };
  }, [isPlayingRounds, playbackSpeed, maxRound, is3D]);

  // ── Tree search: match label or reasoning (case-insensitive) ──
  const treeSearchTrim = (treeSearchQuery || '').trim();
  const displayNodes = active.nodes.map((n) => {
    const roundIdx = getRoundIndex(n);
    const inRange = is3D ? true : (isolatedRound !== null
      ? roundIdx === isolatedRound
      : roundIdx >= roundRange[0] && roundIdx <= roundRange[1]);
    const searchActive = treeSearchTrim.length > 0;
    const searchMatch = !searchActive || (() => {
      const label = (n.data?.label || n.label || '').toLowerCase();
      const reasoning = (n.data?.reasoning || n.reasoning || '').toLowerCase();
      return label.includes(treeSearchTrim.toLowerCase()) || reasoning.includes(treeSearchTrim.toLowerCase());
    })();
    return {
      ...n,
      data: {
        ...n.data,
        isSelected: n.id === active.selectedNode?.id,
        roundIndex: roundIdx,
        isInRange: inRange,
        searchActive,
        searchMatch,
      },
    };
  });

  const activeEdges = activeMode === 'idea' ? idea$.edges : cb$.edges;
  const displayEdges = is3D ? activeEdges : activeEdges.map(e => {
    const srcNode = displayNodes.find(n => n.id === e.source);
    const tgtNode = displayNodes.find(n => n.id === e.target);
    const srcIn = srcNode?.data.isInRange !== false;
    const tgtIn = tgtNode?.data.isInRange !== false;
    if (srcIn && tgtIn) return e;
    const bothOut = !srcIn && !tgtIn;
    return {
      ...e,
      style: {
        ...e.style,
        stroke: bothOut ? '#111118' : '#1a1a2a',
        strokeWidth: bothOut ? 0.5 : 1,
        opacity: bothOut ? 0.15 : 0.35,
      },
      animated: false,
    };
  });

  const isBusy = active.isGenerating || active.isRegenerating || isCritiquing;
  const panelOpen = !!active.selectedNode;
  const cbShowUpload = activeMode === 'codebase' && cb$.nodes.length === 0 && !cb$.isGenerating;
  const hasVersions = activeMode === 'idea' && idea.trim() && readVersions(idea.trim()).length > 1;

  const handlePlayToggle = useCallback(() => {
    if (isolatedRound !== null) setIsolatedRound(null);
    if (!isPlayingRounds && roundRange[1] >= maxRound) {
      setRoundRange([0, 0]);
    }
    setIsPlayingRounds(p => !p);
  }, [isolatedRound, isPlayingRounds, roundRange, maxRound]);

  return (
    <div className="app-shell">
      {/* ── Top bar ── */}
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="logo-mark">◈</span>
          <span className="app-title">IDEA CANVAS</span>
        </div>

        {/* Idea mode input row — hidden when resume mode is showing its own full-panel input */}
        {activeMode === 'idea' && !(displayMode === 'resume' && idea$.nodes.length === 0 && !idea$.isGenerating) && (
          <div className="input-row">
            {displayMode === 'resume' ? (
              /* Resume mode: readonly label + NEW ANALYSIS / STOP */
              <>
                <div className="input-wrapper" style={{ opacity: 0.65, pointerEvents: 'none', flex: 1 }}>
                  <span className="input-prefix" style={{ color: '#74c0fc' }}>◎</span>
                  <span className="idea-input" style={{ padding: '0 0 0 4px', display: 'flex', alignItems: 'center' }}>
                    {resumeJobLabel || 'Resume Analysis'}
                  </span>
                </div>
                {idea$.isGenerating || isCritiquing ? (
                  <button className="btn btn-stop" onClick={handleStop}>■ STOP</button>
                ) : (
                  <button className="btn btn-generate" onClick={handleNewResumeAnalysis}>↺ NEW ANALYSIS</button>
                )}
              </>
            ) : redirectState === 'prompting' ? (
              <>
                <div className="input-wrapper steering-active">
                  <span className="input-prefix" style={{ color: '#ffa94d' }}>⟳</span>
                  <input
                    className="idea-input" type="text"
                    placeholder="steer the agent: what should it focus on next?"
                    value={steeringText}
                    onChange={(e) => setSteeringText(e.target.value)}
                    onKeyDown={handleSteeringKeyDown}
                    autoFocus
                  />
                </div>
                <button className="btn btn-redirect-submit" onClick={handleSteeringSubmit} disabled={!steeringText.trim()}>↵ RESUME</button>
                <button className="btn btn-stop" onClick={handleCancelRedirect}>✕ CANCEL</button>
              </>
            ) : (
              <>
                <div className="input-wrapper input-wrapper--multi">
                  <span className="input-prefix" style={{ color: MODES.find(m => m.id === displayMode)?.color ?? '#6c63ff' }}>›</span>
                  <textarea
                    ref={ideaRef}
                    className="idea-input"
                    rows={1}
                    placeholder={MODES.find(m => m.id === displayMode)?.placeholder ?? 'describe your idea, paste a doc, or upload a file...'}
                    value={idea}
                    onChange={handleIdeaChange}
                    onKeyDown={handleKeyDown}
                    disabled={isBusy}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.text,.csv,.json,.html,.rtf"
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                  />
                  <button
                    className="btn-upload"
                    title="Upload a text file"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isBusy}
                  >
                    📎
                  </button>
                  {attachedFile && (
                    <span className="file-badge" title={attachedFile.name}>
                      {attachedFile.name.length > 18 ? attachedFile.name.slice(0, 15) + '...' : attachedFile.name}
                      <button className="file-badge-x" onClick={() => { setAttachedFile(null); setIdea(''); setTimeout(autoResize, 0); }}>×</button>
                    </span>
                  )}
                </div>
                {(idea$.isGenerating || isCritiquing) ? (
                  <>
                    <button className="btn btn-redirect" onClick={handleRedirect} disabled={isCritiquing}>⟳ REDIRECT</button>
                    <button className="btn btn-stop" onClick={handleStop}>■ STOP</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-generate" onClick={handleGenerate} disabled={!idea.trim() || idea$.isRegenerating || isFetchingUrl}>
                      {isFetchingUrl ? '◌ FETCHING URL...' : '▶ GENERATE'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Codebase mode input row */}
        {activeMode === 'codebase' && !cbShowUpload && (
          <div className="input-row">
            <div className="input-wrapper" style={{ opacity: 0.65, pointerEvents: 'none', flex: 1 }}>
              <span className="input-prefix">⟨/⟩</span>
              <span className="idea-input" style={{ padding: '0 0 0 4px', display: 'flex', alignItems: 'center' }}>{cbFolderName}</span>
            </div>
            {cb$.isGenerating ? (
              <button className="btn btn-stop" onClick={handleStop}>■ STOP</button>
            ) : (
              <button className="btn btn-generate" onClick={handleNewCbAnalysis}>↺ NEW ANALYSIS</button>
            )}
          </div>
        )}

        {/* Right section */}
        <div className="top-bar-right">
          {active.nodeCount > 0 && <span className="node-counter">{active.nodeCount} nodes</span>}
          {memorySessionCount >= 2 && activeMode === 'idea' && (
            <button className="btn btn-icon" onClick={() => setShowMemory((v) => !v)} title="Your thinking patterns">
              ◈ MEMORY
            </button>
          )}
          {hasVersions && (
            <button className="btn btn-icon" onClick={handleShowHistory} title="Version history">
              ⎇ HISTORY
            </button>
          )}
          {active.nodeCount > 0 && (
            <button className="btn btn-icon" onClick={() => active.handleManualSave(activeMode === 'idea' ? idea : cbFolderName)} title="Save session">
              ⬛ SAVE
            </button>
          )}
          {/* Debate button — shown when canvas has nodes in idea mode */}
          {activeMode === 'idea' && idea$.rawNodesRef.current.length > 0 && (
            <button
              className={`btn btn-icon btn-debate-icon ${showDebate ? 'active-icon' : ''}`}
              onClick={() => setShowDebate((v) => !v)}
              title="Autonomous Devil's Advocate debate"
            >
              ⚔ DEBATE
            </button>
          )}
          {/* Export — shown when canvas has nodes in idea mode */}
          {activeMode === 'idea' && idea$.rawNodesRef.current.length > 0 && (
            <button
              className="btn btn-icon btn-export-icon"
              onClick={() => setShowExportModal(true)}
              title="Export to GitHub"
            >
              ⬆ EXPORT
            </button>
          )}
          {/* 3D toggle — shown when canvas has nodes in idea mode */}
          {activeMode === 'idea' && idea$.rawNodesRef.current.length > 0 && (
            <button
              className={`btn btn-icon ${is3D ? 'active-icon' : ''}`}
              onClick={() => setIs3D((v) => !v)}
              title={is3D ? 'Switch to 2D canvas' : 'Switch to 3D canvas'}
            >
              ◈ {is3D ? '2D' : '3D'}
            </button>
          )}
          {active.savedSessions.length > 0 && (
            <button className="btn btn-icon" onClick={() => active.setShowLoadModal(true)}>▤ LOAD</button>
          )}
        </div>
      </header>

      {/* ── Mode bar ── */}
      <nav className="mode-bar">
        {MODES.map(mode => {
          const isActive   = displayMode === mode.id;
          const isDetected = detectedMode === mode.id && !manualMode && !isActive;
          const isManual   = manualMode === mode.id;
          return (
            <button
              key={mode.id}
              className={`mode-tab${isActive ? ' active' : ''}${isDetected ? ' detected' : ''}`}
              style={isActive ? { color: mode.color } : {}}
              onClick={() => handleModeSelect(mode.id)}
              title={
                isManual   ? `${mode.label} — locked · click to release` :
                isDetected ? `${mode.label} — auto-detected` :
                mode.label
              }
            >
              <span className="mode-tab-icon">{mode.icon}</span>
              <span>{mode.label}</span>
              {isDetected && <span className="mode-detect-dot" style={{ background: mode.color }} />}
              {isManual   && <span className="mode-locked-dot">⊕</span>}
            </button>
          );
        })}
        {/* Auto label — shows when detection is active */}
        {detectedMode && !manualMode && (
          <span className="mode-auto-label">auto</span>
        )}
        {/* Lock release hint */}
        {manualMode && (
          <span className="mode-auto-label mode-locked-hint">
            locked · click tab to release
          </span>
        )}
      </nav>

      {active.error && (
        <div className="error-banner">
          <span>⚠ {active.error}</span>
          <button onClick={() => active.setError(null)}>✕</button>
        </div>
      )}

      {/* ── Canvas area ── */}
      <main className="canvas-area" style={{ marginRight: panelOpen ? '300px' : '0', transition: 'margin-right 0.25s ease' }}>

        {activeMode === 'idea' && (
          /* Resume mode with empty canvas — show the resume input panel */
          displayMode === 'resume' && idea$.nodes.length === 0 && !idea$.isGenerating ? (
            <ResumeInput onAnalyzeReady={handleResumeAnalyze} />
          ) : idea$.nodes.length === 0 && !idea$.isGenerating ? (
            <>
              {idea$.showResumeBanner && (
                <div className="resume-banner">
                  <span>◈ Resume: <strong>{(() => { const s = idea$.savedSessions[0]?.idea || ''; return s.length > 55 ? s.slice(0, 55) + '…' : s; })()}</strong> &nbsp;({idea$.savedSessions[0]?.nodeCount} nodes)</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-generate" style={{ padding: '6px 12px', fontSize: '10px' }} onClick={() => handleLoadIdeaSession(idea$.savedSessions[0])}>↩ RESUME</button>
                    <button className="btn btn-stop" style={{ padding: '6px 12px', fontSize: '10px' }} onClick={() => idea$.setShowResumeBanner(false)}>DISMISS</button>
                  </div>
                </div>
              )}
              {showMemory && (
                <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 25 }}>
                  <MemoryInsights onDismiss={() => setShowMemory(false)} />
                </div>
              )}
              <IdeaEmptyState onMemoryClick={memorySessionCount >= 2 ? () => setShowMemory(true) : null} mode={displayMode} />
            </>
          ) : is3D ? (
            <Graph3D
              nodes={idea$.rawNodesRef.current}
              onNodeClick={(node3d) => {
                const raw = idea$.rawNodesRef.current.find(n => n.id === node3d.id);
                if (raw) idea$.handleNodeClick({ id: raw.id, data: raw.data || raw });
              }}
            />
          ) : (
            <ReactFlowProvider>
              {showMemory && (
                <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 25 }}>
                  <MemoryInsights onDismiss={() => setShowMemory(false)} />
                </div>
              )}
              <IdeaCanvas
                nodes={displayNodes}
                edges={displayEdges}
                isGenerating={isBusy}
                onNodeClick={idea$.handleNodeClick}
                onNodeContextMenu={idea$.handleNodeContextMenu}
                onCloseContextMenu={idea$.handleCloseContextMenu}
                drillStack={idea$.drillStack}
                onExitDrill={idea$.handleExitDrill}
                onJumpToBreadcrumb={idea$.handleJumpToBreadcrumb}
                searchQuery={treeSearchQuery}
                onSearchChange={setTreeSearchQuery}
              />
            </ReactFlowProvider>
          )
        )}

        {activeMode === 'codebase' && (
          cbShowUpload ? (
            <>
              {cb$.showResumeBanner && (
                <div className="resume-banner">
                  <span>⟨/⟩ Resume: <strong>{cb$.savedSessions[0]?.folderName || cb$.savedSessions[0]?.label}</strong> &nbsp;({cb$.savedSessions[0]?.nodeCount} nodes)</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-generate" style={{ padding: '6px 12px', fontSize: '10px' }} onClick={() => handleLoadCbSession(cb$.savedSessions[0])}>↩ RESUME</button>
                    <button className="btn btn-stop" style={{ padding: '6px 12px', fontSize: '10px' }} onClick={() => cb$.setShowResumeBanner(false)}>DISMISS</button>
                  </div>
                </div>
              )}
              <CodebaseUpload onAnalysisReady={handleAnalysisReady} isAnalyzing={cb$.isGenerating} />
            </>
          ) : (
            <ReactFlowProvider>
              <IdeaCanvas
                nodes={displayNodes}
                edges={displayEdges}
                isGenerating={cb$.isGenerating || cb$.isRegenerating}
                onNodeClick={cb$.handleNodeClick}
                onNodeContextMenu={cb$.handleNodeContextMenu}
                onCloseContextMenu={cb$.handleCloseContextMenu}
                drillStack={cb$.drillStack}
                onExitDrill={cb$.handleExitDrill}
                onJumpToBreadcrumb={cb$.handleJumpToBreadcrumb}
                searchQuery={treeSearchQuery}
                onSearchChange={setTreeSearchQuery}
              />
            </ReactFlowProvider>
          )
        )}

        {/* ── 2D Timeline Bar ── */}
        {!is3D && active.nodes.length > 0 && maxRound > 0 && (
          <TimelineBar2D
            roundRange={roundRange}
            onRoundRangeChange={setRoundRange}
            isPlaying={isPlayingRounds}
            onPlayToggle={handlePlayToggle}
            playbackSpeed={playbackSpeed}
            onSpeedChange={setPlaybackSpeed}
            isolatedRound={isolatedRound}
            onIsolatedRoundChange={setIsolatedRound}
            maxRound={maxRound}
          />
        )}
      </main>

      <NodeEditPanel
        node={active.selectedNode}
        onClose={() => active.setSelectedNode(null)}
        onSave={active.handleSaveNodeEdit}
        onRegenerate={active.handleRegenerate}
        isDisabled={isBusy}
        onGetAncestors={active.handleGetAncestors}
        allowRegenerate={activeMode === 'idea'}
      />

      {active.contextMenu && (
        <NodeContextMenu
          x={active.contextMenu.x}
          y={active.contextMenu.y}
          nodeId={active.contextMenu.nodeId}
          nodeData={active.nodes.find((n) => n.id === active.contextMenu.nodeId)?.data}
          onDrill={active.handleDrill}
          onToggleStar={active.handleToggleStar}
          onClose={active.handleCloseContextMenu}
          sprintPhase={null}
        />
      )}

      {active.showLoadModal && (
        <LoadModal
          sessions={active.savedSessions}
          onLoad={activeMode === 'idea' ? handleLoadIdeaSession : handleLoadCbSession}
          onDelete={active.handleDeleteSession}
          onClose={() => active.setShowLoadModal(false)}
        />
      )}

      {showHistory && (
        <HistoryModal
          versions={ideaVersions}
          currentNodes={idea$.rawNodesRef.current}
          onLoad={handleLoadVersion}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* ── Debate Panel ── */}
      <DebatePanel
        isOpen={showDebate && activeMode === 'idea'}
        onClose={() => { setShowDebate(false); setDebateAutoStart(false); }}
        nodes={idea$.rawNodesRef.current}
        idea={displayMode === 'resume' ? resumeJobLabel : idea}
        mode={displayMode}
        onNodesAdded={handleDebateNodesAdded}
        onNodeUpdate={handleDebateNodeUpdate}
        autoStart={debateAutoStart}
        debateRoundsRef={debateRoundsRef}
        onApplyToResume={displayMode === 'resume' ? handleApplyToResume : undefined}
      />

      {/* ── Resume Changes Modal ── */}
      <ResumeChangesModal
        isOpen={showResumeChanges}
        onClose={() => setShowResumeChanges(false)}
        changes={resumeChanges?.changes}
        summary={resumeChanges?.summary}
        isLoading={isGeneratingChanges}
        error={resumeChangesError}
      />

      {/* ── Export to GitHub Modal ── */}
      <ExportGitHubModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        nodes={idea$.rawNodesRef.current}
        idea={idea}
        debateRounds={debateRoundsRef.current}
      />

      <footer className="legend">
        {dynamicDomain && dynamicLegendTypes.length > 0 ? (
          <div className="legend-group">
            <span className="legend-group-label">{dynamicDomain}</span>
            {dynamicLegendTypes.map((type) => {
              const cfg = getNodeConfig(type, dynamicConfigRef.current);
              return (
                <div key={type} className="legend-item">
                  <span className="legend-dot" style={{ background: cfg.color }} />
                  <span className="legend-label" style={{ color: cfg.color }}>{cfg.label}</span>
                </div>
              );
            })}
          </div>
        ) : (
          Object.entries(LEGEND_GROUPS).map(([groupLabel, types]) => (
            <div key={groupLabel} className="legend-group">
              <span className="legend-group-label">{groupLabel}</span>
              {types.map((type) => {
                const cfg = NODE_TYPES_CONFIG[type];
                if (!cfg) return null;
                return (
                  <div key={type} className="legend-item">
                    <span className="legend-dot" style={{ background: cfg.color }} />
                    <span className="legend-label" style={{ color: cfg.color }}>{cfg.label}</span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </footer>
    </div>
  );
}

const EMPTY_STATE_CONFIG = {
  idea: {
    icon: '◈',
    title: 'IDEA CANVAS',
    desc: (<>Type an idea above and hit <kbd>Enter</kbd> or <kbd>GENERATE</kbd> to let the agent build your product thinking tree.</>),
    examples: ['"AI code review tool"', '"grocery delivery for seniors"', '"multiplayer design app"'],
  },
  decision: {
    icon: '⚖',
    title: 'DECISION CANVAS',
    desc: (<>Describe the decision you're weighing above and hit <kbd>Enter</kbd> or <kbd>GENERATE</kbd> to map out trade-offs, risks, and alternatives.</>),
    examples: ['"Leave my job to start a company"', '"React vs Vue for our frontend"', '"Raise a Series A or stay bootstrapped"'],
  },
  writing: {
    icon: '✦',
    title: 'WRITING CANVAS',
    desc: (<>Describe what you want to write above and hit <kbd>Enter</kbd> or <kbd>GENERATE</kbd> to build a structured argument tree.</>),
    examples: ['"Essay on remote work productivity"', '"Technical blog post on AI agents"', '"Pitch deck for Series A raise"'],
  },
  plan: {
    icon: '◉',
    title: 'PLAN CANVAS',
    desc: (<>Describe your project or goal above and hit <kbd>Enter</kbd> or <kbd>GENERATE</kbd> to build a milestone and dependency tree.</>),
    examples: ['"Launch a mobile app in 3 months"', '"Migrate monolith to microservices"', '"Q1 go-to-market roadmap"'],
  },
};

function IdeaEmptyState({ onMemoryClick, mode }) {
  const cfg = EMPTY_STATE_CONFIG[mode] || EMPTY_STATE_CONFIG.idea;
  return (
    <div className="empty-state">
      <div className="empty-icon">{cfg.icon}</div>
      <div className="empty-title">{cfg.title}</div>
      <div className="empty-desc">{cfg.desc}</div>
      <div className="empty-examples">
        <span className="examples-label">try:</span>
        {cfg.examples.map((ex) => (
          <span key={ex} className="example-chip">{ex}</span>
        ))}
      </div>
      {onMemoryClick && (
        <button className="btn btn-icon" style={{ marginTop: 16 }} onClick={onMemoryClick}>
          ◈ VIEW YOUR THINKING PATTERNS
        </button>
      )}
    </div>
  );
}
