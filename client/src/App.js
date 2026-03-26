import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import IdeaCanvas from './IdeaCanvas';
import CodebaseUpload from './CodebaseUpload';
import ResumeInput from './ResumeInput';
import HistoryModal from './HistoryModal';
import MemoryInsights, { buildMemoryEntry, appendMemory, readMemory } from './MemoryLayer';

import ChatPanel from './ChatPanel';
import ResumeChangesModal from './ResumeChangesModal';

import Graph3D from './Graph3D';


import { NODE_TYPES_CONFIG, buildDynamicConfig, getNodeConfig } from './nodeConfig';
import { MODES, detectMode } from './modeConfig';
import { useCanvasMode, buildFlowNode, readSSEStream, appendVersion, readVersions, resolveNodePattern } from './useCanvasMode';
import { getSubtreeNodeIds } from './treeUtils';
import { readTemplates, saveTemplate } from './TemplateStore';
import { useGateway } from './gateway/useGateway';

import ShareModal from './ShareModal';
import ShareViewer from './ShareViewer';
import { useAuth } from './AuthContext';
import { setTokenGetter, authFetch } from './api';
import LandingPage from './LandingPage';
import BlogPage from './BlogPage';
import Sidebar from './Sidebar';
import SettingsPage from './settings/SettingsPage';
import KnowledgeGraph from './KnowledgeGraph';
import { useAutoRefine } from './useAutoRefine';
import { usePortfolio } from './usePortfolio';
import { useLearnLoop } from './useLearnLoop';
import { useExperimentLoop } from './useExperimentLoop';
import { usePatternExecutor } from './usePatternExecutor';
import { useMnemonicVideo } from './useMnemonicVideo';
import PipelineOverlay from './PipelineOverlay';
import VideoModal from './VideoModal';
import FlowchartView from './FlowchartView';
import LearnJourneyView from './LearnJourneyView';
import GmailPicker from './GmailConnect';
import useGmail from './useGmail';
import InviteAccept from './InviteAccept';
import { useTimelineNav } from './useTimelineNav';
import { useNodeTools } from './useNodeTools';
import TimelineFilmstrip from './TimelineFilmstrip';
import { useUndoStack } from './useUndoStack';
import { useGhostNodes } from './useGhostNodes';
import { useHoverPreview } from './useHoverPreview';
import PreviewOverlay from './PreviewOverlay';
import { usePrototypeBuilder } from './usePrototypeBuilder';
import FullPrototypePlayer from './FullPrototypePlayer';
import InspectorPanel from './InspectorPanel';
import { YjsProvider, useYjs } from './yjs/YjsContext';
import { generateRoomId, buildRoomUrl } from './yjs/roomUtils';
import SyncStatusBar from './yjs/SyncStatusBar';
import { ForestProvider, useForest } from './ForestContext';
import ClaudeCodePicker from './ClaudeCodePicker';
import SessionFilesBar from './SessionFilesBar';
import ForestTabBar from './ForestTabBar';
import ForestMetaCanvas from './ForestMetaCanvas';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || '';
const WS_URL = API_URL
  ? API_URL.replace(/^http/, 'ws') + '/ws'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

// Mode-specific toolbar button labels & tooltips
const DEBATE_LABELS = {
  idea:     { icon: '⚔', label: 'CRITIQUE',  tooltip: 'Auto-critique of your idea' },
  resume:   { icon: '◎', label: 'REVIEW',    tooltip: 'Hiring manager review of resume strategy' },
  codebase: { icon: '⟨/⟩', label: 'AUDIT',  tooltip: 'Security audit of codebase architecture' },
  decision: { icon: '⚖', label: 'ADVOCATE',  tooltip: "Devil's advocate analysis of your decision" },
  writing:  { icon: '✦', label: 'EDITORIAL', tooltip: 'Senior editor review of your writing' },
  plan:     { icon: '◉', label: 'RISK',      tooltip: 'Risk analyst review of your plan' },
  learn:    { icon: '⧫', label: 'CHALLENGE', tooltip: 'Socratic challenge of your understanding' },
};

const CHAT_LABELS = {
  idea:     { title: 'STRATEGIST', tooltip: 'Product strategist companion' },
  resume:   { title: 'COACH',     tooltip: 'Career coach companion' },
  codebase: { title: 'ADVISOR',   tooltip: 'Tech advisor companion' },
  decision: { title: 'ANALYST',   tooltip: 'Decision analyst companion' },
  writing:  { title: 'EDITOR',    tooltip: 'Writing editor companion' },
  plan:     { title: 'PLANNER',   tooltip: 'Project advisor companion' },
  learn:    { title: 'TUTOR',     tooltip: 'AI learning tutor' },
};

// Helper: stream generation via WebSocket, with same callback pattern as readSSEStream
// Returns null if WS send fails (caller should fall back to REST)
// Stores activeReqId for stop/cancel support
let activeWsReqId = null;
function streamViaGateway(gateway, type, params, onNode) {
  return new Promise((resolve) => {
    const reqId = gateway.send(type, params, {
      onNode: (data) => onNode(data),
      onMeta: (data) => onNode({ ...data, _meta: true }),
      onProgress: (stage) => onNode({ _progress: true, stage }),
      onText: (data) => onNode(data),
      onResult: (data) => { activeWsReqId = null; resolve({ done: true, result: data }); },
      onCanvasArtifact: (data) => onNode({ _canvas: true, ...data }),
      onDone: () => { activeWsReqId = null; resolve({ done: true }); },
      onError: (message) => { activeWsReqId = null; resolve({ error: message }); },
    });
    if (!reqId) { resolve(null); return; }
    activeWsReqId = reqId;
  });
}


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

// ── Access Denied screen (403 — email not in allowlist) ──
function AccessDenied({ email, onLogout }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0a0a0f', color: '#e8e8f0', fontFamily: 'var(--font-mono, monospace)' }}>
      <div style={{ textAlign: 'center', maxWidth: 420, padding: '0 24px' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontSize: 16, marginBottom: 8, letterSpacing: '0.08em', color: '#f87171' }}>ACCESS DENIED</h2>
        <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 24, lineHeight: 1.6 }}>
          <strong style={{ color: '#e8e8f0' }}>{email}</strong> is not authorized to use ThoughtClaw.
          <br />Contact the administrator for access.
        </p>
        <button
          onClick={onLogout}
          style={{
            background: 'transparent', border: '1px solid #2a2a3a', borderRadius: 8,
            color: '#8888aa', padding: '10px 24px', cursor: 'pointer', fontSize: 12,
            letterSpacing: '0.06em', fontFamily: 'inherit',
          }}
        >
          SIGN OUT
        </button>
      </div>
    </div>
  );
}

// ── Loading screen ──
function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0a0a0f', color: '#6c63ff', fontFamily: 'var(--font-mono, monospace)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
        <div style={{ fontSize: 12, letterSpacing: '0.1em', opacity: 0.7 }}>LOADING...</div>
      </div>
    </div>
  );
}

// ── Empty state shown when no session is selected ──
function EmptyState({ onNewSession }) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">What are you building?</div>
      <div className="empty-state-sub">
        Start a new session or pick one from the sidebar.
      </div>
      <div className="empty-state-modes">
        {MODES.filter(m => !m.hidden).map(m => (
          <button
            key={m.id}
            className="empty-state-chip"
            onClick={() => onNewSession(m.id)}
          >
            <span className="empty-state-chip-icon" style={{ color: m.color }}>{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Route wrapper: /share/:id → ShareViewer, landing page if not logged in, else → main app ──
function AppRouter() {
  const { user, loading, logout, isConfigured } = useAuth();
  const [activeSession, setActiveSession] = useState(null);
  const [activeForest, setActiveForest] = useState(null);
  const [showSettings, setShowSettings] = useState(() => window.location.pathname.startsWith('/settings'));
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar_collapsed');
      if (saved !== null) return saved === 'true';
      return window.innerWidth <= 768; // default collapsed on mobile
    } catch { return false; }
  });
  const sidebarRef = useRef(null);

  // Persist sidebar collapsed state
  useEffect(() => {
    try { localStorage.setItem('sidebar_collapsed', sidebarCollapsed); }
    catch { /* ignore */ }
  }, [sidebarCollapsed]);

  // Check access on first authenticated API call
  useEffect(() => {
    if (!user || !isConfigured) return;
    authFetch(`${API_URL}/api/usage`)
      .then(res => {
        if (res.status === 403) setAccessDenied(true);
      })
      .catch(() => { /* ignore network errors */ });
  }, [user, isConfigured]);

  // Share links require auth (standalone, no sidebar)
  const shareMatch = window.location.pathname.match(/^\/share\/([a-zA-Z0-9_-]+)$/);
  if (shareMatch) {
    if (loading) return <LoadingScreen />;
    if (isConfigured && !user) return <LandingPage shareId={shareMatch[1]} />;
    if (accessDenied) return <AccessDenied email={user?.email} onLogout={logout} />;
    return <ShareViewer shareId={shareMatch[1]} />;
  }

  // Room links — collaborative sessions via Yjs (standalone, no sidebar)
  const roomMatch = window.location.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
  if (roomMatch) {
    if (loading) return <LoadingScreen />;
    if (isConfigured && !user) return <LandingPage roomId={roomMatch[1]} />;
    if (accessDenied) return <AccessDenied email={user?.email} onLogout={logout} />;
    return (
      <YjsProvider roomId={roomMatch[1]}>
        <App
          initialSession={{ isNew: true, roomId: roomMatch[1] }}
          onBackToDashboard={() => {
            window.history.pushState({}, '', '/');
            setActiveSession(null);
          }}
        />
      </YjsProvider>
    );
  }

  // Invite links — accept workspace invitations
  const inviteMatch = window.location.pathname.match(/^\/invite\/([a-f0-9]+)$/);
  if (inviteMatch) {
    if (loading) return <LoadingScreen />;
    if (isConfigured && !user) return <LandingPage />;
    return <InviteAccept token={inviteMatch[1]} />;
  }

  // Blog page (public, no auth required)
  if (window.location.pathname === '/blog') {
    return <BlogPage />;
  }

  // Show loading while Firebase checks auth state
  if (loading) return <LoadingScreen />;

  // If Firebase is configured and user not signed in, show landing page
  if (isConfigured && !user) {
    return <LandingPage />;
  }

  // If user is signed in but not authorized (403 from server)
  if (accessDenied) {
    return <AccessDenied email={user?.email} onLogout={logout} />;
  }

  // Refresh sidebar after session auto-save
  const handleSessionSaved = () => {
    sidebarRef.current?.refresh();
  };

  // Close sidebar on mobile when a session is opened
  const handleOpenSession = (session) => {
    setActiveSession(session);
    if (window.innerWidth <= 768) setSidebarCollapsed(true);
  };

  // Authenticated (or auth not configured = local dev)
  return (
    <div className="app-layout">
      {/* Mobile: backdrop when sidebar is open */}
      {!sidebarCollapsed && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}
      <Sidebar
        ref={sidebarRef}
        activeSessionId={activeSession?.id || null}
        onOpenSession={handleOpenSession}
        onNewSession={() => { setActiveSession({ isNew: true }); setShowSettings(false); setShowKnowledge(false); if (window.innerWidth <= 768) setSidebarCollapsed(true); }}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
        onOpenSettings={() => { setShowSettings(true); setShowKnowledge(false); setActiveSession(null); setActiveForest(null); if (window.innerWidth <= 768) setSidebarCollapsed(true); }}
        onOpenKnowledge={() => { setShowKnowledge(true); setShowSettings(false); setActiveSession(null); setActiveForest(null); if (window.innerWidth <= 768) setSidebarCollapsed(true); }}
        onOpenForest={(forest) => { setActiveForest(forest); setActiveSession(null); setShowSettings(false); setShowKnowledge(false); if (window.innerWidth <= 768) setSidebarCollapsed(true); }}
      />
      <div className="app-main">
        {/* Mobile: floating toggle to reopen sidebar */}
        {sidebarCollapsed && (
          <button
            className="sidebar-mobile-toggle"
            onClick={() => setSidebarCollapsed(false)}
          >
            ☰
          </button>
        )}
        {showKnowledge ? (
          <KnowledgeGraph onClose={() => setShowKnowledge(false)} />
        ) : showSettings ? (
          <SettingsPage onClose={() => { setShowSettings(false); window.history.pushState({}, '', '/'); }} />
        ) : activeForest ? (
          <ForestProvider forest={activeForest}>
            <ForestCanvasArea
              forest={activeForest}
              onSessionSaved={handleSessionSaved}
              onExit={() => setActiveForest(null)}
            />
          </ForestProvider>
        ) : !activeSession ? (
          <EmptyState onNewSession={(modeId) => setActiveSession({ isNew: true, mode: modeId })} />
        ) : (
          <App
            key={activeSession.id || 'new-' + (activeSession.mode || 'default')}
            initialSession={activeSession}
            onBackToDashboard={null}
            onSessionSaved={handleSessionSaved}
            onOpenForest={(forest) => { setActiveForest(forest); setActiveSession(null); }}
          />
        )}
      </div>
    </div>
  );
}

// ── Forest Canvas Area: tab bar + meta view or inline canvas nodes ──
function ForestCanvasArea({ forest, onSessionSaved, onExit }) {
  const ctx = useForest();

  const activeCanvasKey = ctx?.activeCanvasKey ?? '__meta__';
  const forestCanvases = ctx?.forestCanvases ?? [];

  // Build a synthetic session for the active canvas tab.
  // The key on <App> forces React to remount when switching canvases,
  // which resets the internal useCanvasMode state cleanly.
  const canvasSession = React.useMemo(() => {
    if (activeCanvasKey === '__meta__') return null;
    const canvas = forestCanvases.find(c => c.canvasKey === activeCanvasKey);
    if (!canvas) return null;
    return {
      id: `forest-canvas-${activeCanvasKey}`,
      label: canvas.title || activeCanvasKey,
      rawNodes: canvas.nodes || [],
      mode: 'idea',
      source: 'forest',
      _forestCanvasKey: activeCanvasKey,
    };
  }, [activeCanvasKey, forestCanvases]);

  if (!ctx) return null;

  return (
    <div className="forest-canvas-area" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ForestTabBar onExit={onExit} />
      {activeCanvasKey === '__meta__' ? (
        <ForestMetaCanvas />
      ) : canvasSession ? (
        <App
          key={activeCanvasKey}
          initialSession={canvasSession}
          onBackToDashboard={onExit}
          onSessionSaved={onSessionSaved}
        />
      ) : (
        <div className="forest-meta-empty">Select a canvas tab to view it.</div>
      )}
    </div>
  );
}

export { AppRouter };
export default function App({ initialSession, onBackToDashboard, onSessionSaved, onOpenForest }) {
  // ── Toolbar scroll ──────────────────────────────────────────
  const toolbarScrollRef = useRef(null);
  const [toolbarCanScrollLeft, setToolbarCanScrollLeft] = useState(false);
  const [toolbarCanScrollRight, setToolbarCanScrollRight] = useState(false);

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
  const sessionFileInputRef = useRef(null); // hidden file input for session context files
  const [attachedFile, setAttachedFile] = useState(null); // { name, size }

  // ── Codebase mode specific state ──────────────────────────
  const [cbFolderName, setCbFolderName] = useState('');
  const [cbProjectPath, setCbProjectPath] = useState('');
  const executionAbortRef = useRef(null);

  // ── Resume mode specific state ────────────────────────────
  const [resumeJobLabel, setResumeJobLabel] = useState('');
  const [resumePdf, setResumePdf]           = useState(null); // base64 PDF kept for changes API
  const [showResumeChanges, setShowResumeChanges] = useState(false);
  const [resumeChanges, setResumeChanges]   = useState(null); // { summary, changes[] }
  const [isGeneratingChanges, setIsGeneratingChanges] = useState(false);
  const [resumeChangesError, setResumeChangesError]   = useState(null);

  // ── Auth ────────────────────────────────────────────────
  const { user: authUser, getToken, logout: authLogout } = useAuth();
  const [upgradePrompt, setUpgradePrompt] = useState(null); // { limit, plan }

  // Wire up the API fetch wrapper with the auth token on mount
  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);

  // ── Gateway (WebSocket) ─────────────────────────────────
  const gateway = useGateway(WS_URL, getToken);
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;

  // ── Yjs collaborative context ───────────────────────────
  const yjs = useYjs(); // null when not in a /room/ URL
  const yjsSyncRef = useRef(null);
  yjsSyncRef.current = yjs;

  // ── Node focus for chat-first interactions ─────────────────
  const handleNodeFocus = useCallback((node, opts = {}) => {
    if (!node) {
      setFocusedNode(null);
      return;
    }
    setFocusedNode({ node, surgicalExpanded: opts.surgicalExpanded || false });
    setShowChat(true);
  }, []);

  // ── Canvas hooks ──────────────────────────────────────────
  const idea$ = useCanvasMode({ storageKey: 'IDEA_CANVAS_SESSIONS', sessionLabel: 'idea', yjsSyncRef, onNodeFocus: handleNodeFocus });
  const cb$ = useCanvasMode({ storageKey: 'CODEBASE_CANVAS_SESSIONS', sessionLabel: 'folderName', onNodeFocus: handleNodeFocus });

  // ── Auto-Refine hooks (one per canvas) ─────────────────────
  const refineIdea$ = useAutoRefine({
    rawNodesRef: idea$.rawNodesRef,
    applyLayout: idea$.applyLayout,
    drillStackRef: idea$.drillStackRef,
    dynamicTypesRef: idea$.dynamicTypesRef,
    yjsSyncRef,
    setNodeCount: idea$.setNodeCount,
  });
  const refineCb$ = useAutoRefine({
    rawNodesRef: cb$.rawNodesRef,
    applyLayout: cb$.applyLayout,
    drillStackRef: cb$.drillStackRef,
    dynamicTypesRef: cb$.dynamicTypesRef,
    yjsSyncRef: { current: null },
    setNodeCount: cb$.setNodeCount,
  });

  // ── Portfolio hooks (one per canvas) ────────────────────
  const portfolioIdea$ = usePortfolio({
    rawNodesRef: idea$.rawNodesRef,
    applyLayout: idea$.applyLayout,
    drillStackRef: idea$.drillStackRef,
    setNodeCount: idea$.setNodeCount,
    yjsSyncRef,
  });
  const portfolioCb$ = usePortfolio({
    rawNodesRef: cb$.rawNodesRef,
    applyLayout: cb$.applyLayout,
    drillStackRef: cb$.drillStackRef,
    setNodeCount: cb$.setNodeCount,
    yjsSyncRef: { current: null },
  });

  // ── Learn Loop hook (idea canvas only) ──────────────────────
  const learn$ = useLearnLoop({
    rawNodesRef: idea$.rawNodesRef,
    applyLayout: idea$.applyLayout,
    drillStackRef: idea$.drillStackRef,
    dynamicTypesRef: idea$.dynamicTypesRef,
    yjsSyncRef,
    setNodeCount: idea$.setNodeCount,
  });

  const experiment$ = useExperimentLoop({
    rawNodesRef: idea$.rawNodesRef,
    applyLayout: idea$.applyLayout,
    drillStackRef: idea$.drillStackRef,
    dynamicTypesRef: idea$.dynamicTypesRef,
    yjsSyncRef,
    setNodeCount: idea$.setNodeCount,
  });

  const mnemonic$ = useMnemonicVideo();
  const proto$ = usePrototypeBuilder();
  const [videoModalNodeId, setVideoModalNodeId] = useState(null);

  // ── Load initial session from dashboard ───────────────────
  const initialSessionLoaded = useRef(false);
  const [sessionLoading, setSessionLoading] = useState(
    !!(initialSession && !initialSession.isNew && initialSession.source === 'cloud' && initialSession.id)
  );
  useEffect(() => {
    if (initialSessionLoaded.current || !initialSession || initialSession.isNew) return;
    initialSessionLoaded.current = true;

    const loadSession = (session) => {
      const sessionMode = session.mode || 'idea';
      // Normalize cloud session nodes field to rawNodes
      const normalized = { ...session };
      if (!normalized.rawNodes && normalized.nodes?.length) {
        normalized.rawNodes = normalized.nodes.map(n => n.id && n.data ? n : buildFlowNode(n));
      }
      // Ensure all rawNodes have the data wrapper (forest canvas nodes may be raw)
      if (normalized.rawNodes?.length && normalized.rawNodes[0] && !normalized.rawNodes[0].data) {
        normalized.rawNodes = normalized.rawNodes.map(n => n.data ? n : buildFlowNode(n));
      }

      if (sessionMode === 'codebase') {
        if (normalized.rawNodes?.length) {
          cb$.handleLoadSession(normalized, (label) => setCbFolderName(label));
        }
        setManualMode('codebase');
      } else {
        if (normalized.rawNodes?.length) {
          idea$.handleLoadSession(normalized, (label) => setIdea(label));
        } else if (normalized.idea) {
          setIdea(normalized.idea);
        }
        if (sessionMode !== 'idea') {
          setManualMode(sessionMode);
        }
      }

      // Restore saved prototype if present
      if (normalized.prototype) {
        proto$.setPrototype(normalized.prototype);
      }
      setSessionLoading(false);
    };

    // If session already has rawNodes (local), load immediately
    if (initialSession.rawNodes?.length) {
      loadSession(initialSession);
    } else if (initialSession.source === 'cloud' && initialSession.id) {
      // Fetch full session data from server for cloud sessions
      setSessionLoading(true);
      authFetch(`${API_URL}/api/sessions/${initialSession.id}`)
        .then(r => r.ok ? r.json() : null)
        .then(fullSession => {
          if (fullSession) loadSession(fullSession);
          else loadSession(initialSession);
        })
        .catch(() => loadSession(initialSession));
    } else {
      loadSession(initialSession);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Yjs sync bridge: load remote nodes & subscribe to changes ──
  useEffect(() => {
    if (!yjs || !yjs.synced) return;

    // On initial sync, load any remote nodes into canvas
    const remoteNodes = yjs.readNodesFromYjs();
    if (remoteNodes.length > 0 && idea$.rawNodesRef.current.length === 0) {
      idea$.rawNodesRef.current = remoteNodes;
      idea$.applyLayout(remoteNodes, []);
      idea$.setNodeCount(remoteNodes.length);
    } else if (idea$.rawNodesRef.current.length > 0 && remoteNodes.length === 0) {
      // Migrate existing local nodes into the Yjs doc (one-time)
      yjs.writeNodesToYjs(idea$.rawNodesRef.current);
      yjs.writeMetaToYjs({ idea, mode: 'idea' });
    }

    // Load meta (idea text)
    const meta = yjs.readMetaFromYjs();
    if (meta.idea && !idea) setIdea(meta.idea);

    // Subscribe to remote node changes
    return yjs.onNodesChanged((allNodes) => {
      idea$.rawNodesRef.current = allNodes;
      idea$.applyLayout(allNodes, idea$.drillStackRef.current);
      idea$.setNodeCount(allNodes.length);
    });
  }, [yjs?.synced]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dynamic type config for adaptive mode ────────────────
  const dynamicConfigRef = useRef(null);    // built color/icon map
  const dynamicTypesRef = useRef(null);     // raw _meta types array
  const [dynamicDomain, setDynamicDomain] = useState(null); // domain label for legend
  const [dynamicLegendTypes, setDynamicLegendTypes] = useState([]); // ordered types for legend
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isDecomposing, setIsDecomposing] = useState(false);

  // ── Thinking Patterns ──────────────────────────────────────
  const [activePattern, setActivePattern] = useState(null);        // pattern definition (from _meta)
  const [patternFramework, setPatternFramework] = useState(null);  // resolved framework metadata
  const [availablePatterns, setAvailablePatterns] = useState([]);   // all patterns for node-level picker

  // Fetch available patterns on mount
  useEffect(() => {
    authFetch(`${API_URL}/api/patterns`).then(r => r.ok ? r.json() : []).then(list => {
      if (Array.isArray(list)) setAvailablePatterns(list);
    }).catch(() => {});
  }, []);

  // ── Pattern Executor hook (must be after dynamicConfigRef declaration) ──
  const patternExec$ = usePatternExecutor({
    rawNodesRef: idea$.rawNodesRef,
    applyLayout: idea$.applyLayout,
    drillStackRef: idea$.drillStackRef,
    dynamicTypesRef: idea$.dynamicTypesRef,
    dynamicConfigRef,
    setNodeCount: idea$.setNodeCount,
    buildDynamicConfigFn: buildDynamicConfig,
  });

  // ── Mode: derived ─────────────────────────────────────────
  // displayMode drives the tab highlight + placeholder + icon
  // activeMode collapses all non-codebase modes to 'idea' for canvas routing
  const displayMode = manualMode ?? detectedMode ?? 'idea';
  const activeMode  = displayMode === 'codebase' ? 'codebase' : 'idea';
  const active = activeMode === 'idea' ? idea$ : cb$;
  const refine$ = activeMode === 'idea' ? refineIdea$ : refineCb$;
  const portfolio$ = activeMode === 'idea' ? portfolioIdea$ : portfolioCb$;
  // ── Timeline filmstrip navigation ──────────────────────────
  const timeline = useTimelineNav({
    rawNodesRef: active.rawNodesRef,
    selectedNode: active.selectedNode,
    handleNodeClick: active.handleNodeClick,
    nodeCount: active.nodeCount,
  });
  const ideaText = useMemo(() => {
    if (activeMode === 'codebase') return cbFolderName;
    if (displayMode === 'resume') return resumeJobLabel;
    return idea;
  }, [activeMode, cbFolderName, displayMode, resumeJobLabel, idea]);
  // ── Node precision tools ────────────────────────────────────
  const nodeTools = useNodeTools({
    rawNodesRef: active.rawNodesRef,
    applyLayout: active.applyLayout,
    drillStackRef: active.drillStackRef,
    setNodeCount: active.setNodeCount,
    yjsSyncRef,
    selectedNode: active.selectedNode,
    handleNodeClick: active.handleNodeClick,
    deleteNodeBranch: active.deleteNodeBranch,
    handleSaveNodeEdit: active.handleSaveNodeEdit,
    idea: ideaText,
    mode: displayMode,
  });

  // ── F4: Undo Stack ──────────────────────────────────────────
  const undoStack = useUndoStack({
    rawNodesRef: active.rawNodesRef,
    applyLayout: active.applyLayout,
    drillStackRef: active.drillStackRef,
    setNodeCount: active.setNodeCount,
    yjsSyncRef,
  });

  // ── F4: Ghost Nodes ───────────────────────────────────────
  const ghostNodes = useGhostNodes({
    rawNodesRef: active.rawNodesRef,
    applyLayout: active.applyLayout,
    drillStackRef: active.drillStackRef,
    setNodeCount: active.setNodeCount,
  });

  // ── F4: Preview Overlay ───────────────────────────────────
  const [previewState, setPreviewState] = useState(null);
  // shape: { nodes, removedIds, label, onAccept, onReject } | null

  // ── F5: Hover Preview ─────────────────────────────────────
  const hoverPreview = useHoverPreview({ rawNodesRef: active.rawNodesRef });

  // ── F5: Inspector Panel ───────────────────────────────────
  const [inspectorNode, setInspectorNode] = useState(null);

  // ── Memory Layer ──────────────────────────────────────────
  const [showMemory, setShowMemory] = useState(false);
  const memorySessionCount = readMemory().length;

  // ── Version History ───────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [ideaVersions, setIdeaVersions] = useState([]);

  // ── Debate (inline chat card) ─────────────────────────────
  const debateRoundsRef = useRef([]);
  const [debateStream, setDebateStream] = useState(null);
  const debateAbortRef = useRef(null);
  const debateLoopRef = useRef(false);
  const startDebateInChatRef = useRef(null);
  const startRefineInChatRef = useRef(null);
  const startPortfolioInChatRef = useRef(null);
  const startPrototypeBuildRef = useRef(null);
  const handleConsensusReachedRef = useRef(null);

  // ── Chat Companion ────────────────────────────────────────
  const [showChat, setShowChat] = useState(false);
  const [chatFilter, setChatFilter] = useState(null);
  // shape: { types?: string[], nodeIds?: string[] } | null
  const [pendingChatCards, setPendingChatCards] = useState([]);
  const [executionStream, setExecutionStream] = useState(null); // { nodeLabel, text, done, error }
  const [refineStream, setRefineStream] = useState(null); // live refine progress for inline chat card
  const [portfolioStream, setPortfolioStream] = useState(null); // live portfolio progress for inline chat card
  const [learnStream, setLearnStream] = useState(null); // live learn loop progress for inline chat card
  const [experimentStream, setExperimentStream] = useState(null); // live experiment loop progress
  const [prototypeStream, setPrototypeStream] = useState(null); // live prototype build progress
  const [showPrototypeViewer, setShowPrototypeViewer] = useState(false);
  const [focusedNode, setFocusedNode] = useState(null); // { node, surgicalExpanded } for chat-first node interactions

  // ── Share ────────────────────────────────────────────────────
  const [showShareModal, setShowShareModal] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const reactFlowRef = useRef(null);

  // ── User profile & usage ───────────────────────────────────
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [usageData, setUsageData] = useState(null);

  // Fetch usage data on mount and close user menu on outside click
  useEffect(() => {
    authFetch(`${API_URL}/api/usage`).then(r => r.ok ? r.json() : null).then(d => d && setUsageData(d)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showUserMenu) return;
    const close = () => setShowUserMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showUserMenu]);

  // ── Auto-Fractal (∞ EXPLORE) ────────────────────────────
  const [showAutoFractal, setShowAutoFractal] = useState(false);
  const [autoFractalRounds, setAutoFractalRounds] = useState(5);
  const [autoFractalRunning, setAutoFractalRunning] = useState(false);
  const [autoFractalProgress, setAutoFractalProgress] = useState(null);

  // ── Post-generation automation options ───────────────────
  const [autoRefineOnGen, setAutoRefineOnGen] = useState(false);
  const [autoPortfolioOnGen, setAutoPortfolioOnGen] = useState(false);
  const [autoPrototypeOnGen, setAutoPrototypeOnGen] = useState(false);
  const [portfolioFocus, setPortfolioFocus] = useState(null); // dynamic focus context from chat (types/nodeIds/userIntent)
  const [pipelineStages, setPipelineStages] = useState(null); // pipeline overlay stages
  const [pipelineCheckpoint, setPipelineCheckpoint] = useState(null); // { recommended, stageType, alternatives, reasoning, shouldSkip }
  const [autonomousMode, setAutonomousMode] = useState(false); // skip checkpoints when true
  const advancePipelineRef = useRef(null); // ref to break circular hook dependency
  const [emailContext, setEmailContext] = useState(null); // { id, subject, messageCount, formatted }
  const [showPlusMenu, setShowPlusMenu] = useState(false); // + attachments popover
  const plusMenuBtnRef = useRef(null);
  const [claudeCodeContext, setClaudeCodeContext] = useState(null); // { context: string, sessionCount: number }
  const [showClaudeCodePicker, setShowClaudeCodePicker] = useState(false);
  const [sessionFiles, setSessionFiles] = useState([]); // attached files for this session
  const [sessionFileContext, setSessionFileContext] = useState(null); // extracted text context

  const gmail = useGmail({
    onThreadSelected: (ctx) => setEmailContext(ctx),
    onClearEmail: () => setEmailContext(null),
    mode: displayMode,
  });

  // ── View Mode ──────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('flowchart'); // 'flowchart' | 'tree' | '3d'
  const is3D = viewMode === '3d'; // backward compat

  // ── 2D Temporal Navigation ──────────────────────────────
  const [roundRange, setRoundRange]           = useState([0, 12]);
  const [isPlayingRounds, setIsPlayingRounds] = useState(false);
  const [playbackSpeed, setPlaybackSpeed]     = useState(1);
  const [isolatedRound, setIsolatedRound]     = useState(null);
  const playbackTimerRef = useRef(null);

  const [isCritiquing, setIsCritiquing] = useState(false);
  const [treeSearchQuery, setTreeSearchQuery] = useState('');

  // ── Cross-links toggle ───────────────────────────────────
  const [showCrossLinks, setShowCrossLinks] = useState(false);

  // ── Node scoring ─────────────────────────────────────────
  const [isScoring, setIsScoring] = useState(false);

  // ── Generation mode: single | multi | research ───────────
  const [multiAgentProgress, setMultiAgentProgress] = useState(null);

  // ── Auto-save (skip when Yjs handles persistence or in forest canvas) ────────
  useEffect(() => {
    if (yjs) return; // Yjs handles persistence via y-indexeddb
    if (initialSession?.source === 'forest') return; // Forest canvases save via ForestContext
    if (activeMode === 'idea') idea$.triggerAutoSave(idea, displayMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea$.nodeCount, idea, activeMode]);

  useEffect(() => {
    if (initialSession?.source === 'forest') return;
    if (activeMode === 'codebase') cb$.triggerAutoSave(cbFolderName, 'codebase');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cb$.nodeCount, cbFolderName, activeMode]);

  // Notify parent (sidebar) after auto-save completes
  useEffect(() => {
    if (!onSessionSaved) return;
    const nodeCount = activeMode === 'codebase' ? cb$.nodeCount : idea$.nodeCount;
    if (nodeCount === 0) return;
    const t = setTimeout(() => onSessionSaved(), 1200); // after auto-save debounce
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea$.nodeCount, cb$.nodeCount]);

  // ── Sync cross-links toggle to canvas mode ref ───────────
  useEffect(() => {
    active.showCrossLinksRef.current = showCrossLinks;
    if (active.rawNodesRef.current.length > 0) {
      active.applyLayout(active.rawNodesRef.current, active.drillStackRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCrossLinks]);

  // ── Scoring: trigger after generation ────────────────────
  const triggerScoring = useCallback(async (rawNodes, ideaText) => {
    if (!rawNodes?.length || !ideaText?.trim()) return;
    setIsScoring(true);
    try {
      const res = await authFetch(`${API_URL}/api/score-nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: ideaText.trim(),
          nodes: rawNodes.map(n => ({
            id: n.id, type: n.data?.type, label: n.data?.label,
            reasoning: n.data?.reasoning, parentId: n.data?.parentId,
          })),
        }),
      });
      if (!res.ok) throw new Error(`Score error: ${res.status}`);
      const { scores } = await res.json();
      active.setNodeScores(scores);
    } catch (err) {
      console.error('Scoring failed:', err);
    } finally {
      setIsScoring(false);
    }
  }, [idea$]);

  // ── Save version + memory after generation ────────────────
  const saveVersionAndMemory = useCallback((ideaText, rawNodes) => {
    if (!ideaText?.trim() || !rawNodes?.length) return;
    appendVersion(ideaText.trim(), rawNodes);
    appendMemory(buildMemoryEntry(ideaText.trim(), rawNodes));
  }, []);

  // ── 429 upgrade check helper ────────────────────────────
  const checkUpgradable = useCallback(async (res) => {
    if (res.status === 429) {
      try {
        const data = await res.json();
        if (data.upgradable) {
          setUpgradePrompt({ limit: data.limit, plan: data.plan });
          throw new Error('Daily generation limit reached. Upgrade to Pro for more.');
        }
        throw new Error(data.error || 'Rate limit exceeded');
      } catch (e) {
        if (e.message.includes('limit')) throw e;
        throw new Error('Rate limit exceeded');
      }
    }
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
  }, []);

  // ── Shared: run learn loop inline in chat ──────────────────
  const startLearnInChat = useCallback((targetMastery = 7, { startConceptId } = {}) => {
    setLearnStream({ status: 'generating_probe', detail: 'Starting comprehension loop...' });
    setShowChat(true);
    learn$.handleStartLearn(ideaText, targetMastery, (progress) => {
      if (progress.status === 'done' || progress.status === 'complete') {
        setLearnStream(null);
        setPendingChatCards(prev => [...prev, {
          type: 'learn_card',
          state: { status: 'complete', masteryMap: progress.masteryMap || {}, totalConcepts: progress.totalConcepts },
        }]);
      } else {
        setLearnStream(progress);
      }
    }, { startConceptId });
  }, [learn$, ideaText]);

  // ── Idea mode: generate ───────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!idea.trim() || idea$.isGenerating || idea$.isRegenerating) return;
    undoStack.pushSnapshot('before-generate');
    idea$.resetCanvas();
    idea$.setIsGenerating(true);
    setShowChat(true);
    setRedirectState('idle');

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
              // Detect if this is a root domain (no meaningful path) → crawl the whole site
              const parsed = new URL(url);
              const path = parsed.pathname.replace(/\/+$/, '');
              const isRootDomain = !path || path === '';

              if (isRootDomain) {
                // Crawl the full site — fetches homepage + key subpages
                const r = await authFetch(`${API_URL}/api/crawl-site`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url }),
                  signal: controller.signal,
                });
                if (!r.ok) return null;
                const { pages } = await r.json();
                // Return each page as a separate content entry
                return (pages || []).filter(p => p.text).map(p => ({ url: p.url, text: p.text }));
              } else {
                // Specific page — fetch just that URL
                const r = await authFetch(`${API_URL}/api/fetch-url`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url }),
                  signal: controller.signal,
                });
                if (!r.ok) return null;
                const { text } = await r.json();
                return text ? [{ url, text }] : null;
              }
            } catch { return null; }
          });
          const results = await Promise.all(fetches);
          // Flatten: each URL fetch may return multiple pages (from crawl)
          fetchedUrlContent = results.filter(Boolean).flat();
          if (!fetchedUrlContent.length) fetchedUrlContent = null;
        } finally {
          setIsFetchingUrl(false);
        }
      }

      // Look up matching templates for structural guidance
      const allTemplates = readTemplates();
      const templateGuidance = allTemplates.length > 0
        ? allTemplates.slice(0, 3).map(t => ({ domain: t.domain, idea_summary: t.idea_summary, structure: t.structure }))
        : undefined;

      const genParams = { idea: idea.trim(), mode: displayMode, fetchedUrlContent, templateGuidance, emailThread: emailContext?.formatted || null, claudeCodeContext: claudeCodeContext?.context || null, sessionFileContext: sessionFileContext || null };
      const seenTypes = [];
      if (yjs) yjs.setLocalGenerating(true);
      const onNodeData = (nodeData) => {
        if (nodeData._meta) {
          const config = buildDynamicConfig(nodeData.types || []);
          dynamicConfigRef.current = config;
          dynamicTypesRef.current = nodeData.types || [];
          idea$.dynamicTypesRef.current = nodeData.types || [];
          setDynamicDomain(nodeData.domainLabel || nodeData.domain || 'Canvas');
          if (yjs) yjs.writeMetaToYjs({ types: nodeData.types, domain: nodeData.domain, idea: idea.trim(), mode: displayMode });
          // Extended _meta: store thinking pattern + resolved framework
          if (nodeData.pattern) {
            setActivePattern(nodeData.pattern);
          }
          if (nodeData.framework) {
            setPatternFramework(nodeData.framework);
          } else if (nodeData.frameworkSkeleton) {
            // Minimal skeleton — could resolve server-side later
            setPatternFramework(nodeData.frameworkSkeleton);
          }
          return;
        }
        const flowNode = buildFlowNode(nodeData);
        if (dynamicConfigRef.current) flowNode.data.dynamicConfig = dynamicConfigRef.current;
        if (yjs) {
          yjs.addNodeToYjs(flowNode);
          // Yjs observer will update rawNodesRef + applyLayout for all clients
        } else {
          idea$.rawNodesRef.current = [...idea$.rawNodesRef.current, flowNode];
          idea$.applyLayout(idea$.rawNodesRef.current, []);
        }
        idea$.setNodeCount((idea$.rawNodesRef.current || []).length + 1);
        if (nodeData.type && !seenTypes.includes(nodeData.type)) {
          seenTypes.push(nodeData.type);
          setDynamicLegendTypes([...seenTypes]);
        }
      };

      let result;
      if (gatewayRef.current.connected) {
        result = await streamViaGateway(gatewayRef.current, 'generate', genParams, onNodeData);
      }
      if (!result) {
        // WS not available or send failed — fall back to REST+SSE
        const res = await authFetch(`${API_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(genParams),
          signal: controller.signal,
        });
        await checkUpgradable(res);
        result = await readSSEStream(res, onNodeData);
      }
      if (result.error) idea$.setError(result.error);
      saveVersionAndMemory(idea, idea$.rawNodesRef.current);
    } catch (err) {
      if (err.name !== 'AbortError') idea$.setError(err.message);
    } finally {
      idea$.setIsGenerating(false);
      setIsFetchingUrl(false);
      if (yjs) yjs.setLocalGenerating(false);
      // Auto-collapse deep branches for large trees
      if (!controller.signal.aborted && idea$.rawNodesRef.current.length > 15) {
        idea$.autoCollapseDeep();
      }
      // After generation: advance pipeline or start learn mode
      if (!controller.signal.aborted && idea$.rawNodesRef.current.length > 0) {
        if (displayMode === 'learn') {
          startLearnInChat(7);
        } else {
          // Use dynamic pipeline orchestrator
          advancePipelineRef.current?.({ priorStage: 'generate', priorOutcome: { nodeCount: idea$.rawNodesRef.current.length, activePattern } });
        }
        triggerScoring(idea$.rawNodesRef.current, idea.trim());
      }
    }
  }, [idea, idea$, displayMode, saveVersionAndMemory, triggerScoring, yjs, checkUpgradable, emailContext, startLearnInChat]);

  // ── Multi-agent generation (3 lenses + merge) ─────────────
  const handleGenerateMulti = useCallback(async () => {
    if (!idea.trim() || idea$.isGenerating || idea$.isRegenerating) return;
    idea$.resetCanvas();
    idea$.setIsGenerating(true);
    setShowChat(true);
    setMultiAgentProgress('Starting multi-agent analysis...');
    setRedirectState('idle');

    dynamicConfigRef.current = null;
    dynamicTypesRef.current = null;
    setDynamicDomain(null);
    setDynamicLegendTypes([]);

    if (idea$.abortRef.current) idea$.abortRef.current.abort();
    const controller = new AbortController();
    idea$.abortRef.current = controller;

    try {
      // URL detection (same as handleGenerate)
      let fetchedUrlContent = null;
      const urlRegex = /https?:\/\/[^\s"'<>]+/g;
      const urls = idea.trim().match(urlRegex);
      if (urls?.length) {
        setIsFetchingUrl(true);
        try {
          const fetches = urls.map(async (url) => {
            try {
              const parsed = new URL(url);
              const path = parsed.pathname.replace(/\/+$/, '');
              const isRootDomain = !path || path === '';
              if (isRootDomain) {
                const r = await authFetch(`${API_URL}/api/crawl-site`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: controller.signal });
                if (!r.ok) return null;
                const { pages } = await r.json();
                return (pages || []).filter(p => p.text).map(p => ({ url: p.url, text: p.text }));
              } else {
                const r = await authFetch(`${API_URL}/api/fetch-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: controller.signal });
                if (!r.ok) return null;
                const { text } = await r.json();
                return text ? [{ url, text }] : null;
              }
            } catch { return null; }
          });
          const results = await Promise.all(fetches);
          fetchedUrlContent = results.filter(Boolean).flat();
          if (!fetchedUrlContent.length) fetchedUrlContent = null;
        } finally {
          setIsFetchingUrl(false);
        }
      }

      const allTemplates = readTemplates();
      const templateGuidance = allTemplates.length > 0
        ? allTemplates.slice(0, 3).map(t => ({ domain: t.domain, idea_summary: t.idea_summary, structure: t.structure }))
        : undefined;

      const genParams = { idea: idea.trim(), mode: displayMode, fetchedUrlContent, templateGuidance, emailThread: emailContext?.formatted || null, claudeCodeContext: claudeCodeContext?.context || null, sessionFileContext: sessionFileContext || null };
      const seenTypes = [];
      if (yjs) yjs.setLocalGenerating(true);
      const onNodeData = (nodeData) => {
        if (nodeData._progress) {
          setMultiAgentProgress(nodeData.stage);
          return;
        }
        if (nodeData._meta) {
          const config = buildDynamicConfig(nodeData.types || []);
          dynamicConfigRef.current = config;
          dynamicTypesRef.current = nodeData.types || [];
          idea$.dynamicTypesRef.current = nodeData.types || [];
          setDynamicDomain(nodeData.domain || 'Canvas');
          setMultiAgentProgress(null);
          if (yjs) yjs.writeMetaToYjs({ types: nodeData.types, domain: nodeData.domain, idea: idea.trim(), mode: displayMode });
          return;
        }
        const flowNode = buildFlowNode(nodeData);
        if (dynamicConfigRef.current) flowNode.data.dynamicConfig = dynamicConfigRef.current;
        if (yjs) {
          yjs.addNodeToYjs(flowNode);
        } else {
          idea$.rawNodesRef.current = [...idea$.rawNodesRef.current, flowNode];
          idea$.applyLayout(idea$.rawNodesRef.current, []);
        }
        idea$.setNodeCount((idea$.rawNodesRef.current || []).length + 1);
        if (nodeData.type && !seenTypes.includes(nodeData.type)) {
          seenTypes.push(nodeData.type);
          setDynamicLegendTypes([...seenTypes]);
        }
      };

      let result;
      if (gatewayRef.current.connected) {
        result = await streamViaGateway(gatewayRef.current, 'generate-multi', genParams, onNodeData);
      }
      if (!result) {
        const res = await authFetch(`${API_URL}/api/generate-multi`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(genParams),
          signal: controller.signal,
        });
        await checkUpgradable(res);
        result = await readSSEStream(res, onNodeData);
      }
      if (result.error) idea$.setError(result.error);
      saveVersionAndMemory(idea, idea$.rawNodesRef.current);
    } catch (err) {
      if (err.name !== 'AbortError') idea$.setError(err.message);
    } finally {
      idea$.setIsGenerating(false);
      setMultiAgentProgress(null);
      setIsFetchingUrl(false);
      if (yjs) yjs.setLocalGenerating(false);
      if (!controller.signal.aborted && idea$.rawNodesRef.current.length > 15) idea$.autoCollapseDeep();
      if (!controller.signal.aborted && idea$.rawNodesRef.current.length > 0) {
        if (displayMode === 'learn') {
          startLearnInChat(7);
        } else {
          startDebateInChatRef.current?.();
        }
        triggerScoring(idea$.rawNodesRef.current, idea.trim());
      }
    }
  }, [idea, idea$, displayMode, saveVersionAndMemory, triggerScoring, yjs, checkUpgradable, emailContext, startLearnInChat]);

  const handleGenerateResearch = useCallback(async () => {
    if (!idea.trim() || idea$.isGenerating || idea$.isRegenerating) return;
    idea$.resetCanvas();
    idea$.setIsGenerating(true);
    setShowChat(true);
    setMultiAgentProgress('Planning research strategy...');
    setRedirectState('idle');

    dynamicConfigRef.current = null;
    dynamicTypesRef.current = null;
    setDynamicDomain(null);
    setDynamicLegendTypes([]);

    // Initialise pipeline overlay when automation checkboxes are active
    if (autoRefineOnGen || autoPortfolioOnGen || autoPrototypeOnGen) {
      const stages = [
        { id: 'generate', label: 'Generate', status: 'active', detail: 'Research & multi-agent thinking...' },
        { id: 'debate', label: 'Debate', status: 'pending', detail: null },
        ...(autoRefineOnGen ? [{ id: 'refine', label: 'Refine', status: 'pending', detail: null }] : []),
        ...(autoPortfolioOnGen ? [{ id: 'portfolio', label: 'Portfolio', status: 'pending', detail: null }] : []),
        ...(autoPrototypeOnGen ? [{ id: 'prototype', label: 'Prototype', status: 'pending', detail: null }] : []),
      ];
      setPipelineStages(stages);
      setShowChat(true);  // open chat to show pipeline progress
    }

    if (idea$.abortRef.current) idea$.abortRef.current.abort();
    const controller = new AbortController();
    idea$.abortRef.current = controller;

    try {
      // URL detection (same as handleGenerate)
      let fetchedUrlContent = null;
      const urlRegex = /https?:\/\/[^\s"'<>]+/g;
      const urls = idea.trim().match(urlRegex);
      if (urls?.length) {
        setIsFetchingUrl(true);
        try {
          const fetches = urls.map(async (url) => {
            try {
              const parsed = new URL(url);
              const path = parsed.pathname.replace(/\/+$/, '');
              const isRootDomain = !path || path === '';
              if (isRootDomain) {
                const r = await authFetch(`${API_URL}/api/crawl-site`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: controller.signal });
                if (!r.ok) return null;
                const { pages } = await r.json();
                return (pages || []).filter(p => p.text).map(p => ({ url: p.url, text: p.text }));
              } else {
                const r = await authFetch(`${API_URL}/api/fetch-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: controller.signal });
                if (!r.ok) return null;
                const { text } = await r.json();
                return text ? [{ url, text }] : null;
              }
            } catch { return null; }
          });
          const results = await Promise.all(fetches);
          fetchedUrlContent = results.filter(Boolean).flat();
          if (!fetchedUrlContent.length) fetchedUrlContent = null;
        } finally {
          setIsFetchingUrl(false);
        }
      }

      const allTemplates = readTemplates();
      const templateGuidance = allTemplates.length > 0
        ? allTemplates.slice(0, 3).map(t => ({ domain: t.domain, idea_summary: t.idea_summary, structure: t.structure }))
        : undefined;

      const genParams = { idea: idea.trim(), mode: displayMode, fetchedUrlContent, templateGuidance, emailThread: emailContext?.formatted || null, claudeCodeContext: claudeCodeContext?.context || null, sessionFileContext: sessionFileContext || null };
      const seenTypes = [];
      if (yjs) yjs.setLocalGenerating(true);
      const onNodeData = (nodeData) => {
        if (nodeData._progress) {
          setMultiAgentProgress(nodeData.stage);
          return;
        }
        if (nodeData._meta) {
          const config = buildDynamicConfig(nodeData.types || []);
          dynamicConfigRef.current = config;
          dynamicTypesRef.current = nodeData.types || [];
          idea$.dynamicTypesRef.current = nodeData.types || [];
          setDynamicDomain(nodeData.domain || 'Canvas');
          setMultiAgentProgress(null);
          if (yjs) yjs.writeMetaToYjs({ types: nodeData.types, domain: nodeData.domain, idea: idea.trim(), mode: displayMode });
          return;
        }
        const flowNode = buildFlowNode(nodeData);
        if (dynamicConfigRef.current) flowNode.data.dynamicConfig = dynamicConfigRef.current;
        if (yjs) {
          yjs.addNodeToYjs(flowNode);
        } else {
          idea$.rawNodesRef.current = [...idea$.rawNodesRef.current, flowNode];
          idea$.applyLayout(idea$.rawNodesRef.current, []);
        }
        idea$.setNodeCount((idea$.rawNodesRef.current || []).length + 1);
        if (nodeData.type && !seenTypes.includes(nodeData.type)) {
          seenTypes.push(nodeData.type);
          setDynamicLegendTypes([...seenTypes]);
        }
      };

      let result;
      if (gatewayRef.current.connected) {
        result = await streamViaGateway(gatewayRef.current, 'generate-research', genParams, onNodeData);
      }
      if (!result) {
        const res = await authFetch(`${API_URL}/api/generate-research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(genParams),
          signal: controller.signal,
        });
        await checkUpgradable(res);
        result = await readSSEStream(res, onNodeData);
      }
      if (result.error) idea$.setError(result.error);
      saveVersionAndMemory(idea, idea$.rawNodesRef.current);
    } catch (err) {
      if (err.name !== 'AbortError') idea$.setError(err.message);
    } finally {
      idea$.setIsGenerating(false);
      setMultiAgentProgress(null);
      setIsFetchingUrl(false);
      if (yjs) yjs.setLocalGenerating(false);
      if (!controller.signal.aborted && idea$.rawNodesRef.current.length > 0) {
        if (displayMode === 'learn') {
          startLearnInChat(7);
        } else {
          // Use dynamic pipeline orchestrator
          advancePipelineRef.current?.({ priorStage: 'generate', priorOutcome: { nodeCount: idea$.rawNodesRef.current.length } });
        }
        triggerScoring(idea$.rawNodesRef.current, idea.trim());
      }
    }
  }, [idea, idea$, displayMode, saveVersionAndMemory, triggerScoring, yjs, checkUpgradable, emailContext, startLearnInChat]);

  const handleStop = useCallback(() => {
    active.handleStop();
    // Also stop any in-flight WebSocket stream
    if (activeWsReqId && gatewayRef.current?.stop) {
      gatewayRef.current.stop(activeWsReqId);
      activeWsReqId = null;
    }
    setRedirectState('idle');
    setIsCritiquing(false);
    setMultiAgentProgress(null);
    setPipelineCheckpoint(null);
  }, [active]);

  // ── Pipeline Orchestrator: Dynamic Pattern Selection ─────
  const advancePipeline = useCallback(async ({ priorStage, priorOutcome }) => {
    // Determine which stages are still available based on pipeline order
    const stageOrder = ['generate', 'debate', 'refine', 'portfolio', 'prototype'];
    const completedStages = new Set();
    // Mark prior stages as completed
    const priorIdx = stageOrder.indexOf(priorStage);
    if (priorIdx >= 0) {
      for (let i = 0; i <= priorIdx; i++) completedStages.add(stageOrder[i]);
    }
    // If prior was a pattern, treat it as completing the debate slot
    if (priorStage === 'pattern') completedStages.add('generate').add('debate');

    const availableStages = stageOrder.filter(s => !completedStages.has(s) && s !== 'generate');

    // If no stages remain, pipeline is done
    if (availableStages.length === 0) {
      setPipelineStages(prev => prev?.map(s => ({ ...s, status: s.status === 'pending' ? 'done' : s.status })));
      return;
    }

    // Ask the server for optimal next stage
    try {
      const nodes = (active.rawNodesRef.current || []).map(n => ({
        id: n.id, type: n.data?.type, label: n.data?.label, reasoning: n.data?.reasoning?.slice(0, 100),
      }));
      const res = await authFetch(`${API_URL}/api/pattern/recommend-next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: ideaText, mode: displayMode, nodes,
          priorStage, priorOutcome,
          pipelinePosition: priorStage === 'generate' ? 0 : priorStage === 'debate' ? 1 : 2,
          availableStages,
        }),
      });
      const recommendation = await res.json();

      if (autonomousMode) {
        // Auto-dispatch without checkpoint
        dispatchPipelineStage(recommendation.stageType, recommendation.recommended?.id || recommendation.recommended, priorStage);
      } else {
        // Show checkpoint card for user decision
        setPipelineCheckpoint(recommendation);
        setShowChat(true);
      }
    } catch (err) {
      // Fallback: dispatch the first available stage
      const fallback = availableStages[0];
      if (autonomousMode) {
        dispatchPipelineStage(fallback, null, priorStage);
      } else {
        setPipelineCheckpoint({
          recommended: fallback, stageType: fallback,
          alternatives: [], reasoning: 'Default sequence', shouldSkip: false,
        });
        setShowChat(true);
      }
    }
  }, [active, ideaText, displayMode, autoRefineOnGen, autoPortfolioOnGen, autoPrototypeOnGen, autonomousMode]);
  advancePipelineRef.current = advancePipeline;

  // Dispatch a pipeline stage (shared by advancePipeline and handlePipelineCheckpointDecision)
  const dispatchPipelineStage = useCallback((stageType, patternId, priorStage) => {
    setPipelineCheckpoint(null);

    // Update pipeline overlay
    setPipelineStages(prev => prev?.map(s =>
      s.id === priorStage ? { ...s, status: 'done' } :
      s.id === stageType || s.id === 'pattern' ? { ...s, status: 'active', detail: `Running ${stageType}...` } : s
    ));

    const pipelineCallback = (progress) => {
      if (progress.status === 'complete' || progress.done) {
        // Stage finished — advance to next
        advancePipeline({ priorStage: stageType, priorOutcome: progress });
      }
    };

    // Map pattern IDs that correspond to built-in rich UIs
    const PATTERN_TO_BUILTIN = {
      'adversarial': 'debate', 'adversarial-critique': 'debate', 'expert-committee': 'debate',
      'progressive-refine': 'refine', 'progressive-refinement': 'refine',
      'portfolio-explore': 'portfolio', 'portfolio-exploration': 'portfolio',
    };
    const builtins = ['debate', 'refine', 'portfolio', 'prototype'];
    const resolvedStage = PATTERN_TO_BUILTIN[patternId] || (builtins.includes(patternId) ? patternId : builtins.includes(stageType) ? stageType : null);

    if (resolvedStage === 'debate') {
      startDebateInChatRef.current?.(pipelineCallback);
    } else if (resolvedStage === 'refine') {
      startRefineInChatRef.current?.(3, pipelineCallback);
    } else if (resolvedStage === 'portfolio') {
      startPortfolioInChatRef.current?.(pipelineCallback);
    } else if (resolvedStage === 'prototype') {
      startPrototypeBuildRef.current?.();
    } else if (patternId) {
      // Execute a custom thinking pattern (no rich UI — generic executor)
      patternExec$.execute(patternId, ideaText, active.rawNodesRef.current, displayMode, { domain: dynamicDomain }, pipelineCallback);
      setShowChat(true);
    } else {
      // Fallback: start debate with rich UI
      startDebateInChatRef.current?.(pipelineCallback);
    }
  }, [patternExec$, ideaText, active, displayMode, dynamicDomain, advancePipeline]);

  const handlePipelineCheckpointDecision = useCallback((action, payload) => {
    setPipelineCheckpoint(null);
    if (action === 'skip') {
      // Skip this stage, advance to next
      const skippedStage = pipelineCheckpoint?.stageType || 'unknown';
      setPipelineStages(prev => prev?.map(s => s.id === skippedStage ? { ...s, status: 'done', detail: 'Skipped' } : s));
      advancePipeline({ priorStage: skippedStage, priorOutcome: { skipped: true } });
    } else if (action === 'run') {
      dispatchPipelineStage(payload?.stageType || pipelineCheckpoint?.stageType, payload?.patternId, pipelineCheckpoint?.stageType);
    }
  }, [pipelineCheckpoint, advancePipeline, dispatchPipelineStage]);

  // ── Forest decomposition ────────────────────────────────
  const handleForestDecompose = useCallback(async () => {
    if (!idea.trim() || !onOpenForest || isDecomposing) return;
    setIsDecomposing(true);
    try {
      const res = await authFetch(`${API_URL}/api/forest/decompose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: idea.trim(), mode: displayMode }),
      });
      // Read SSE stream for result
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') break;
            try {
              const event = JSON.parse(payload);
              if (event._forestResult) {
                // Load the full forest and open it
                const forestRes = await authFetch(`${API_URL}/api/forests/${event.forestId}`);
                if (forestRes.ok) {
                  const forest = await forestRes.json();
                  onOpenForest(forest);
                }
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error('Forest decompose error:', err);
    } finally {
      setIsDecomposing(false);
    }
  }, [idea, displayMode, onOpenForest, isDecomposing]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerateResearch();
    }
  }, [handleGenerateResearch]);

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
      const res = await authFetch(`${API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: idea.trim(), steeringInstruction: steeringText.trim(), existingNodes, emailThread: emailContext?.formatted || null }),
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
  }, [idea, steeringText, idea$, saveVersionAndMemory, emailContext]);

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
      const res = await authFetch(`${API_URL}/api/analyze-codebase`, {
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


    if (idea$.abortRef.current) idea$.abortRef.current.abort();
    const controller = new AbortController();
    idea$.abortRef.current = controller;

    try {
      const res = await authFetch(`${API_URL}/api/generate`, {
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
        if (displayMode === 'learn') {
          startLearnInChat(7);
        } else {
          startDebateInChatRef.current?.();
        }
      }
    }
  }, [idea$, displayMode, saveVersionAndMemory, startLearnInChat]);

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
      const res = await authFetch(`${API_URL}/api/resume/changes`, {
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

  // ── Auto-Fractal handler ────────────────────────────────
  const handleStartAutoFractal = useCallback(async () => {
    setAutoFractalRunning(true);
    setAutoFractalProgress(null);
    await active.handleAutoFractal(ideaText, autoFractalRounds, (progress) => {
      setAutoFractalProgress(progress);
      if (progress.status === 'done') {
        setAutoFractalRunning(false);
      }
    });
    setAutoFractalRunning(false);
  }, [active, autoFractalRounds, ideaText]);

  const handleStopAutoFractal = useCallback(() => {
    active.handleStopAutoFractal();
    setAutoFractalRunning(false);
  }, [active]);

  // ── Auto-Refine handlers ──────────────────────────────────
  const handleStartRefine = useCallback(async (rounds = 3, onProgress) => {
    await refine$.handleStartRefine(ideaText, displayMode, rounds, onProgress);
  }, [refine$, ideaText, displayMode]);

  const handleStopRefine = useCallback(() => {
    refine$.handleStopRefine();
    setRefineStream(null);
  }, [refine$]);

  const handleGoDeeper = useCallback(async (additionalRounds = 2, onProgress) => {
    await refine$.handleGoDeeper(ideaText, displayMode, additionalRounds, onProgress);
  }, [refine$, ideaText, displayMode]);

  // ── Shared: run refine inline in chat ────────────────────
  const startRefineInChat = useCallback((rounds = 3, pipelineCallback) => {
    setRefineStream({ status: 'critiquing', round: 1, maxRounds: rounds });
    setShowChat(true);
    const refineHistory = [];
    handleStartRefine(rounds, (progress) => {
      // Forward to pipeline overlay if provided
      pipelineCallback?.(progress);
      if (progress.status === 'round_complete') {
        refineHistory.push({
          round: progress.round, oldScore: progress.oldScore, newScore: progress.newScore,
          newNodeCount: progress.newNodeCount, summary: progress.summary,
        });
      }
      if (progress.status === 'done' || progress.status === 'complete') {
        setRefineStream(null);
        setPendingChatCards(prev => [...prev, { type: 'refine_card', state: { status: 'done', history: refineHistory } }]);
      } else {
        setRefineStream({ ...progress, history: refineHistory });
      }
    });
  }, [handleStartRefine]);
  startRefineInChatRef.current = startRefineInChat;

  // ── Shared: run prototype build inline in chat ────────────
  const startPrototypeBuild = useCallback(() => {
    setPrototypeStream({ status: 'planning', stage: 'Analyzing tree...', screensTotal: 0, screensComplete: 0, screenNames: [] });
    setShowChat(true);

    proto$.handleBuildPrototype(active.rawNodesRef.current, ideaText, displayMode, (event) => {
      if (event._progress) {
        let status = 'planning';
        if (event.plan) status = 'generating';
        if (event.stage?.includes('Wiring')) status = 'wiring';
        if (event.stage?.includes('Polish')) status = 'polishing';
        setPrototypeStream(prev => ({
          ...prev,
          status,
          stage: event.stage,
          plan: event.plan || prev?.plan,
          screensTotal: event.plan?.screens?.length || prev?.screensTotal,
        }));
        // Update pipeline stages if running in pipeline
        setPipelineStages(prev => prev?.map(s =>
          s.id === 'prototype' ? { ...s, status: 'active', detail: event.stage } : s
        ));
      }
      if (event._screen) {
        setPrototypeStream(prev => ({
          ...prev,
          screensComplete: (prev?.screensComplete || 0) + 1,
          screenNames: [...(prev?.screenNames || []), event.name],
        }));
      }
      if (event._result) {
        setPrototypeStream(prev => ({ ...prev, status: 'done' }));
        setPipelineStages(prev => prev?.map(s =>
          s.id === 'prototype' ? { ...s, status: 'done', detail: 'Prototype built' } : s
        ));
      }
      if (event.error) {
        setPrototypeStream(prev => ({ ...prev, status: 'error', error: event.error }));
        setPipelineStages(prev => prev?.map(s =>
          s.id === 'prototype' ? { ...s, status: 'error', detail: event.error } : s
        ));
      }
    }, gateway.sessionId || initialSession?.id);
  }, [proto$, active.rawNodesRef, ideaText, displayMode, gateway.sessionId, initialSession?.id]);
  startPrototypeBuildRef.current = startPrototypeBuild;

  // ── Debate mode config for inline card ────────────────
  const DEBATE_MODE_CONFIG = useMemo(() => ({
    idea:     { panelIcon: '⚔', panelTitle: 'AUTO-CRITIQUE', statusCritiquing: 'Critic researching and analyzing...', statusRebutting: 'Architect researching and responding...', consensusDesc: (r, fc) => `After ${r} round${r!==1?'s':''}, the critic is satisfied.${fc>0?` ${fc} nodes updated.`:''}` },
    resume:   { panelIcon: '◎', panelTitle: 'HIRING REVIEW', statusCritiquing: 'Hiring manager reviewing strategy...', statusRebutting: 'Career coach building responses...', consensusDesc: (r, fc) => `After ${r} round${r!==1?'s':''}, the hiring manager would advance this candidate.${fc>0?` ${fc} nodes updated.`:''}` },
    codebase: { panelIcon: '⟨/⟩', panelTitle: 'CODE AUDIT', statusCritiquing: 'Security auditor reviewing code...', statusRebutting: 'Tech lead proposing solutions...', consensusDesc: (r, fc) => `After ${r} round${r!==1?'s':''}, the auditor is satisfied.${fc>0?` ${fc} nodes updated.`:''}` },
    decision: { panelIcon: '⚖', panelTitle: "DEVIL'S ADVOCATE", statusCritiquing: "Devil's advocate analyzing...", statusRebutting: 'Strategic advisor responding...', consensusDesc: (r, fc) => `After ${r} round${r!==1?'s':''}, the decision is validated.${fc>0?` ${fc} nodes updated.`:''}` },
    writing:  { panelIcon: '✦', panelTitle: 'EDITORIAL REVIEW', statusCritiquing: 'Senior editor reviewing...', statusRebutting: 'Writer addressing critiques...', consensusDesc: (r, fc) => `After ${r} round${r!==1?'s':''}, the editor approves.${fc>0?` ${fc} nodes updated.`:''}` },
    plan:     { panelIcon: '◉', panelTitle: 'RISK ANALYSIS', statusCritiquing: 'Risk analyst reviewing...', statusRebutting: 'Project manager mitigating...', consensusDesc: (r, fc) => `After ${r} round${r!==1?'s':''}, the plan is approved.${fc>0?` ${fc} nodes updated.`:''}` },
  }), []);

  // ── Debate: add nodes to canvas from debate loop ─────────
  const handleDebateNodesAdded = useCallback((newNodes) => {
    const existingIds = new Set(active.rawNodesRef.current.map(n => n.id));
    newNodes.forEach((flowNode) => {
      // Prevent duplicate IDs from debate rounds
      if (existingIds.has(flowNode.id)) {
        flowNode = { ...flowNode, id: flowNode.id + '_' + Date.now().toString(36).slice(-4) };
      }
      existingIds.add(flowNode.id);
      active.rawNodesRef.current = [...active.rawNodesRef.current, flowNode];
    });
    active.applyLayout(active.rawNodesRef.current, active.drillStackRef.current);
    active.setNodeCount(active.rawNodesRef.current.length);
  }, [active]);

  // ── Debate: update existing nodes in-place after consensus ─
  const handleDebateNodeUpdate = useCallback((updatedNode) => {
    active.rawNodesRef.current = active.rawNodesRef.current.map((n) =>
      n.id === updatedNode.id
        ? { ...n, data: { ...n.data, label: updatedNode.label, reasoning: updatedNode.reasoning } }
        : n
    );
    active.applyLayout(active.rawNodesRef.current, active.drillStackRef.current);
  }, [active]);

  // ── Shared: run debate inline in chat ────────────────
  const startDebateInChat = useCallback(async (pipelineCallback) => {
    const maxRounds = 5;
    const modeConfig = DEBATE_MODE_CONFIG[displayMode] || DEBATE_MODE_CONFIG.idea;
    const debateRounds = [];
    const allRoundsHistory = [];
    let currentNodes = [...active.rawNodesRef.current];

    setDebateStream({ status: 'critiquing', round: 1, maxRounds, modeConfig, rounds: [], finalizeCount: 0 });
    setShowChat(true);
    debateLoopRef.current = true;

    const updateStream = (patch) => {
      setDebateStream(prev => prev ? { ...prev, ...patch } : null);
    };

    const serializeNodes = (nodes) => nodes.map(n => ({
      id: n.id, type: n.data?.type || n.type, label: n.data?.label || n.label,
      reasoning: n.data?.reasoning || n.reasoning, parentId: n.data?.parentId || n.parentId,
    }));

    try {
      for (let round = 1; round <= maxRounds && debateLoopRef.current; round++) {
        // ── Step 1: Critique ──
        updateStream({ status: 'critiquing', round });
        pipelineCallback?.({ status: 'critiquing', round });

        const controller = new AbortController();
        debateAbortRef.current = controller;

        const critiqueRes = await authFetch(`${API_URL}/api/debate/critique`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: serializeNodes(currentNodes), idea: ideaText, round,
            priorCritiques: allRoundsHistory.flatMap(r => r.blockers || []), mode: displayMode,
          }),
          signal: controller.signal,
        });

        if (!critiqueRes.ok) throw new Error(`Server error: ${critiqueRes.status}`);
        const critiqueResult = await critiqueRes.json();

        if (!debateLoopRef.current) break;

        const { verdict, round_summary, critiques, consensus_blockers, suggestions } = critiqueResult;
        const blockers = suggestions || consensus_blockers || [];

        // Add critique nodes to canvas
        const critiqueFlowNodes = (critiques || []).map(c => buildFlowNode({
          id: `crit_r${round}_${c.id}`, parentId: c.targetNodeId,
          type: 'critique', label: c.challenge, reasoning: c.reasoning,
        }));
        if (critiqueFlowNodes.length) {
          currentNodes = [...currentNodes, ...critiqueFlowNodes];
          handleDebateNodesAdded(critiqueFlowNodes);
        }

        const roundEntry = {
          round, verdict, summary: round_summary,
          critiques: critiques || [], suggestions: blockers,
          rebutCount: 0,
        };
        debateRounds.push(roundEntry);
        updateStream({ rounds: [...debateRounds] });

        // Consensus → finalize
        if (verdict === 'YES') {
          allRoundsHistory.push({ ...roundEntry, blockers });
          updateStream({ status: 'finalizing' });
          pipelineCallback?.({ status: 'finalizing' });

          let fc = 0;
          const finController = new AbortController();
          debateAbortRef.current = finController;

          const finRes = await authFetch(`${API_URL}/api/debate/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nodes: serializeNodes(currentNodes), idea: ideaText,
              debateHistory: allRoundsHistory, mode: displayMode,
            }),
            signal: finController.signal,
          });
          if (finRes.ok) {
            await readSSEStream(finRes, (nodeData) => {
              if (nodeData._update) {
                handleDebateNodeUpdate(nodeData);
              } else {
                const flowNode = buildFlowNode(nodeData);
                handleDebateNodesAdded([flowNode]);
                currentNodes = [...currentNodes, flowNode];
              }
              fc++;
              updateStream({ finalizeCount: fc });
            });
          }
          handleConsensusReachedRef.current?.();
          debateRoundsRef.current = debateRounds;

          setDebateStream(null);
          setPendingChatCards(prev => [...prev, {
            type: 'debate_card',
            state: { status: 'done', rounds: debateRounds, maxRounds, modeConfig, finalizeCount: fc },
          }]);
          pipelineCallback?.({ status: 'done' });
          debateLoopRef.current = false;
          return;
        }

        if (round >= maxRounds) {
          allRoundsHistory.push({ ...roundEntry, blockers });
          // Max rounds — finalize anyway
          updateStream({ status: 'finalizing' });
          let fc = 0;
          const finController = new AbortController();
          debateAbortRef.current = finController;
          const finRes = await authFetch(`${API_URL}/api/debate/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nodes: serializeNodes(currentNodes), idea: ideaText,
              debateHistory: allRoundsHistory, mode: displayMode,
            }),
            signal: finController.signal,
          });
          if (finRes.ok) {
            await readSSEStream(finRes, (nodeData) => {
              if (nodeData._update) {
                handleDebateNodeUpdate(nodeData);
              } else {
                const flowNode = buildFlowNode(nodeData);
                handleDebateNodesAdded([flowNode]);
                currentNodes = [...currentNodes, flowNode];
              }
              fc++;
              updateStream({ finalizeCount: fc });
            });
          }
          debateRoundsRef.current = debateRounds;
          setDebateStream(null);
          setPendingChatCards(prev => [...prev, {
            type: 'debate_card',
            state: { status: 'done', rounds: debateRounds, maxRounds, modeConfig, finalizeCount: fc },
          }]);
          pipelineCallback?.({ status: 'done' });
          debateLoopRef.current = false;
          return;
        }

        // ── Step 2: Rebut ──
        if (!debateLoopRef.current) break;
        updateStream({ status: 'rebutting', round });
        pipelineCallback?.({ status: 'rebutting', round });

        const rebutController = new AbortController();
        debateAbortRef.current = rebutController;

        const rebutRes = await authFetch(`${API_URL}/api/debate/rebut`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: serializeNodes(currentNodes), idea: ideaText,
            round, critiques: critiques || [], mode: displayMode,
          }),
          signal: rebutController.signal,
        });

        if (!rebutRes.ok) throw new Error(`Server error: ${rebutRes.status}`);

        let rebutCount = 0;
        await readSSEStream(rebutRes, (nodeData) => {
          const flowNode = buildFlowNode(nodeData);
          currentNodes = [...currentNodes, flowNode];
          handleDebateNodesAdded([flowNode]);
          rebutCount++;
        });

        roundEntry.rebutCount = rebutCount;
        debateRounds[debateRounds.length - 1] = roundEntry;
        allRoundsHistory.push({ ...roundEntry, blockers });
        updateStream({ rounds: [...debateRounds] });
      }

      // Loop ended normally
      debateLoopRef.current = false;
      debateRoundsRef.current = debateRounds;
      setDebateStream(null);
      setPendingChatCards(prev => [...prev, {
        type: 'debate_card',
        state: { status: 'done', rounds: debateRounds, maxRounds, modeConfig, finalizeCount: 0 },
      }]);
    } catch (err) {
      if (err.name === 'AbortError') {
        // User stopped
        debateRoundsRef.current = debateRounds;
        setDebateStream(null);
        setPendingChatCards(prev => [...prev, {
          type: 'debate_card',
          state: { status: 'stopped', rounds: debateRounds, maxRounds, modeConfig, finalizeCount: 0 },
        }]);
      } else {
        console.error('Debate error:', err);
        updateStream({ status: 'error', error: err.message });
      }
      debateLoopRef.current = false;
    }
  }, [active, ideaText, displayMode, handleDebateNodesAdded, handleDebateNodeUpdate, DEBATE_MODE_CONFIG]);
  startDebateInChatRef.current = startDebateInChat;

  const handleStopDebateInChat = useCallback(() => {
    debateLoopRef.current = false;
    if (debateAbortRef.current) debateAbortRef.current.abort();
  }, []);

  // ── Shared: run portfolio inline in chat ────────────────
  const startPortfolioInChat = useCallback((pipelineCallback) => {
    setPortfolioStream({ status: 'generating', stageDetail: 'Starting...', alternatives: [], scores: [] });
    setShowChat(true);
    portfolio$.generate({
      idea: ideaText,
      mode: displayMode,
      focus: portfolioFocus,
      count: 3,
      existingTitles: portfolio$.alternatives.map(a => a.title),
      onProgress: (progress) => {
        // Forward to pipeline overlay if provided
        pipelineCallback?.(progress);
        if (progress.status === 'done') {
          setPortfolioStream(null);
          setPendingChatCards(prev => [...prev, {
            type: 'portfolio_card',
            state: {
              status: 'done',
              alternatives: progress.alternatives || [],
              scores: progress.scores || [],
              recommendation: progress.recommendation || '',
            },
          }]);
        } else {
          setPortfolioStream(prev => ({
            ...(prev || {}),
            status: 'generating',
            stageDetail: progress.stageDetail || '',
            alternatives: progress.alternatives || prev?.alternatives || [],
            scores: progress.scores || prev?.scores || [],
          }));
        }
      },
    });
  }, [portfolio$, ideaText, displayMode, portfolioFocus]);
  startPortfolioInChatRef.current = startPortfolioInChat;

  const startExperimentInChat = useCallback((iterations = 5) => {
    setExperimentStream({ status: 'scoring_baseline', iteration: 0, maxIterations: iterations, detail: 'Starting experiment loop...' });
    setShowChat(true);
    experiment$.handleStartExperiment(ideaText, displayMode, iterations, (progress) => {
      if (progress.status === 'done') {
        setExperimentStream(null);
        setPendingChatCards(prev => [...prev, {
          type: 'experiment_card',
          state: { status: 'done', history: progress.history || [], bestTree: progress.bestTree },
        }]);
      } else {
        setExperimentStream(progress);
      }
    });
  }, [experiment$, ideaText, displayMode]);

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

  // ── Template extraction: after debate consensus ──────────
  const handleConsensusReached = useCallback(async () => {
    try {
      const rawNodes = active.rawNodesRef.current;
      if (!rawNodes?.length) return;
      const res = await authFetch(`${API_URL}/api/extract-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: ideaText.trim(),
          nodes: rawNodes.map(n => ({
            id: n.id, type: n.data?.type, label: n.data?.label,
            reasoning: n.data?.reasoning, parentId: n.data?.parentId,
          })),
        }),
      });
      if (!res.ok) return;
      const template = await res.json();
      if (template.structure?.length) saveTemplate(template);
    } catch (err) {
      console.error('Template extraction failed:', err);
    }

    // Pipeline: debate done — use dynamic pipeline orchestrator for next stage
    setPipelineStages(prev => prev?.map(s =>
      s.id === 'debate' ? { ...s, status: 'done', detail: 'Consensus reached' } : s
    ));

    // Advance pipeline to next stage (dynamic pattern selection)
    advancePipelineRef.current?.({ priorStage: 'debate', priorOutcome: { consensus: true, nodeCount: active.rawNodesRef.current?.length } });
  }, [idea, idea$, displayMode, resumeJobLabel, active]);
  handleConsensusReachedRef.current = handleConsensusReached;

  // ── Suggestion expand: add suggestion node + children to tree ─
  const handleSuggestionExpand = useCallback(async (suggestionText) => {
    const rawNodes = active.rawNodesRef.current;
    if (!rawNodes?.length) return;

    const res = await authFetch(`${API_URL}/api/expand-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suggestion: suggestionText,
        idea: ideaText,
        nodes: rawNodes.map(n => ({
          id: n.id, type: n.data?.type, label: n.data?.label,
          reasoning: n.data?.reasoning, parentId: n.data?.parentId,
        })),
        mode: displayMode,
        dynamicTypes: active.dynamicTypesRef?.current || undefined,
      }),
    });
    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const existingDynConfig = rawNodes[0]?.data?.dynamicConfig || null;
    await readSSEStream(res, (nodeData) => {
      const flowNode = buildFlowNode(nodeData);
      if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
      active.rawNodesRef.current = [...active.rawNodesRef.current, flowNode];
      active.applyLayout(active.rawNodesRef.current, active.drillStackRef.current);
      active.setNodeCount(active.rawNodesRef.current.length);
    });
  }, [ideaText, active, displayMode]);

  // ── Chat → Graph actions ───────────────────────────────────
  const handleChatAction = useCallback((actions) => {
    if (!actions) return;
    const cards = [];
    const pushCard = (action, label, detail, buttons) => {
      cards.push({ type: 'action_card', action, label, detail, buttons, timestamp: Date.now() });
    };
    // Filter: highlight specific types or node IDs
    if (actions.filter) {
      const { types, nodeIds } = actions.filter;
      setChatFilter({
        types: types?.length ? types : undefined,
        nodeIds: nodeIds?.length ? nodeIds : undefined,
      });
    }
    // Clear: remove all filters
    if (actions.clear) {
      setChatFilter(null);
    }
    // Add nodes: brainstorm new nodes onto the canvas
    if (actions.addNodes?.length) {
      const existingDynConfig = active.rawNodesRef.current[0]?.data?.dynamicConfig || null;
      for (const nd of actions.addNodes) {
        const flowNode = buildFlowNode({
          id: nd.id || `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: nd.type || 'feature',
          label: nd.label,
          reasoning: nd.reasoning || '',
          parentId: nd.parentId || 'seed',
        });
        if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
        active.rawNodesRef.current = [...active.rawNodesRef.current, flowNode];
      }
      active.applyLayout(active.rawNodesRef.current, active.drillStackRef.current);
      active.setNodeCount(active.rawNodesRef.current.length);
      pushCard('addNodes', `Added ${actions.addNodes.length} Nodes`, 'New nodes brainstormed onto canvas', []);
    }
    // Helper: apply scope filter if action has types/nodeIds
    const applyScope = (actionVal) => {
      if (actionVal && typeof actionVal === 'object' && !Array.isArray(actionVal)) {
        const { types, nodeIds } = actionVal;
        if (types?.length || nodeIds?.length) {
          setChatFilter({
            types: types?.length ? types : undefined,
            nodeIds: nodeIds?.length ? nodeIds : undefined,
          });
        }
      }
    };
    // Helper: get scoped nodes (or all if no scope)
    const getScopedNodes = (actionVal) => {
      const allNodes = active.rawNodesRef.current;
      if (!actionVal || typeof actionVal !== 'object' || actionVal === true) return allNodes;
      const { types, nodeIds } = actionVal;
      if (!types?.length && !nodeIds?.length) return allNodes;
      return allNodes.filter(n => {
        const t = n.data?.type || n.type;
        const matchType = types?.length ? types.includes(t) : true;
        const matchId = nodeIds?.length ? nodeIds.includes(n.id) : true;
        return (types?.length && nodeIds?.length) ? (matchType || matchId) : (matchType && matchId);
      });
    };
    // Debate: run inline in chat
    if (actions.debate) {
      applyScope(actions.debate);
      startDebateInChat();
    }
    // Refine: run inline in chat
    if (actions.refine) {
      applyScope(actions.refine);
      startRefineInChat(3);
    }
    // Refine more: continue refining
    if (actions.refineMore) {
      setRefineStream({ status: 'critiquing', round: 1, maxRounds: 2 });
      setShowChat(true);
      const refineHistory = [];
      handleGoDeeper(2, (progress) => {
        if (progress.status === 'round_complete') {
          refineHistory.push({
            round: progress.round, oldScore: progress.oldScore, newScore: progress.newScore,
            newNodeCount: progress.newNodeCount, summary: progress.summary,
          });
        }
        if (progress.status === 'done') {
          setRefineStream(null);
          setPendingChatCards(prev => [...prev, { type: 'refine_card', state: { status: 'done', history: refineHistory } }]);
        } else {
          setRefineStream({ ...progress, history: refineHistory });
        }
      });
    }
    // Portfolio: run inline in chat
    if (actions.portfolio) {
      applyScope(actions.portfolio);
      const actionVal = actions.portfolio;
      if (actionVal && typeof actionVal === 'object' && actionVal !== true) {
        const scopedNodes = getScopedNodes(actionVal);
        const nodeSummaries = scopedNodes.slice(0, 20).map(n => {
          const d = n.data || n;
          return `[${d.type}] ${d.label}: ${(d.reasoning || '').slice(0, 100)}`;
        });
        setPortfolioFocus({ types: actionVal.types || null, nodeIds: actionVal.nodeIds || null, nodeSummaries });
      } else {
        setPortfolioFocus(null);
      }
      startPortfolioInChat();
    }
    // Portfolio more: generate more alternatives
    if (actions.portfolioMore) {
      startPortfolioInChat();
    }
    // Fractal expand: open panel and start
    if (actions.fractalExpand) {
      const rounds = actions.fractalExpand.rounds || 3;
      setAutoFractalRounds(rounds);
      setShowAutoFractal(true);
      setTimeout(() => handleStartAutoFractal(), 100);
      pushCard('fractalExpand', 'Fractal Expanding', `Recursively exploring ${rounds} rounds...`, [
        { label: 'Open Panel', actionType: 'openPanel', panel: 'fractalExpand' },
      ]);
    }
    // Score nodes (supports scoping)
    if (actions.scoreNodes) {
      const scopedNodes = getScopedNodes(actions.scoreNodes);
      triggerScoring(scopedNodes, ideaText);
      pushCard('scoreNodes', 'Scoring Nodes', `Evaluating ${scopedNodes.length} nodes...`, []);
    }
    // Drill into a specific node
    if (actions.drill?.nodeId) {
      const targetNode = active.rawNodesRef.current.find(n => n.id === actions.drill.nodeId);
      if (targetNode) {
        active.handleDrill?.({ id: targetNode.id, data: targetNode.data || targetNode });
      }
    }
    // Expand Node: fractal expand a specific node
    if (actions.expandNode?.nodeId) {
      const targetNode = active.rawNodesRef.current.find(n => n.id === actions.expandNode.nodeId);
      if (targetNode) {
        active.handleFractalExpand?.(actions.expandNode.nodeId);
        pushCard('expandNode', 'Expanding Node', `Expanding "${(targetNode.data?.label || targetNode.id).slice(0, 40)}"...`, []);
      }
    }
    // Edit Node: update label, reasoning, or type
    if (actions.editNode?.nodeId) {
      const { nodeId, label, reasoning, type } = actions.editNode;
      const updates = {};
      if (label !== undefined) updates.label = label;
      if (reasoning !== undefined) updates.reasoning = reasoning;
      if (type !== undefined) updates.type = type;
      if (Object.keys(updates).length > 0) {
        active.handleSaveNodeEdit?.(nodeId, updates);
        pushCard('editNode', 'Edited Node', `Updated ${Object.keys(updates).join(', ')}`, []);
      }
    }
    // Regenerate Node
    if (actions.regenerateNode?.nodeId) {
      const targetNode = active.rawNodesRef.current.find(n => n.id === actions.regenerateNode.nodeId);
      if (targetNode) {
        active.handleRegenerate?.(targetNode.id);
        pushCard('regenerateNode', 'Regenerating', `Re-generating "${(targetNode.data?.label || targetNode.id).slice(0, 40)}"`, []);
      }
    }
    // Star/Favorite Node
    if (actions.starNode?.nodeId) {
      const targetNode = active.rawNodesRef.current.find(n => n.id === actions.starNode.nodeId);
      if (targetNode) {
        active.handleToggleStar?.(actions.starNode.nodeId);
        pushCard('starNode', 'Toggled Star', `${(targetNode.data?.label || targetNode.id).slice(0, 40)}`, []);
      }
    }
    // Delete Node (reparent children)
    if (actions.deleteNode?.nodeId) {
      const targetNode = active.rawNodesRef.current.find(n => n.id === actions.deleteNode.nodeId);
      if (targetNode) {
        nodeTools.handleRippleDelete(targetNode);
        pushCard('deleteNode', 'Deleted Node', `Removed node and reparented children`, []);
      }
    }
    // Delete Branch (node + all descendants)
    if (actions.deleteBranch?.nodeId) {
      const targetNode = active.rawNodesRef.current.find(n => n.id === actions.deleteBranch.nodeId);
      if (targetNode) {
        nodeTools.handleDeleteBranch(targetNode);
        pushCard('deleteBranch', 'Deleted Branch', `Removed node and all descendants`, []);
      }
    }
    // Execute Thinking Pattern
    if (actions.executePattern?.patternId) {
      const { patternId, nodeId } = actions.executePattern;
      const scopedNodes = nodeId
        ? active.rawNodesRef.current.filter(n => {
            // Get the subtree rooted at nodeId
            const subtreeIds = new Set([nodeId]);
            const queue = [nodeId];
            while (queue.length) {
              const id = queue.shift();
              for (const node of active.rawNodesRef.current) {
                const d = node.data || node;
                const parentIds = d.parentIds || (d.parentId ? [d.parentId] : []);
                if (parentIds.includes(id) && !subtreeIds.has(node.id)) {
                  subtreeIds.add(node.id);
                  queue.push(node.id);
                }
              }
            }
            return subtreeIds.has(n.id);
          })
        : active.rawNodesRef.current;
      patternExec$.execute(patternId, ideaText, scopedNodes, displayMode, { domain: dynamicDomain });
      setShowChat(true);
      pushCard('executePattern', `Running ${patternId}`, `Executing on ${scopedNodes.length} nodes`, []);
    }
    // Build Prototype
    if (actions.buildPrototype) {
      startPrototypeBuild();
      pushCard('buildPrototype', 'Building Prototype', 'Generating interactive prototype from tree...', []);
    }
    // Feed to Idea: bridge CODE tree into IDEA mode as seed context
    if (actions.feedToIdea) {
      const scopedNodes = getScopedNodes(actions.feedToIdea);
      const grouped = {};
      for (const n of scopedNodes) {
        const d = n.data || n;
        const type = d.type || 'node';
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(`- ${d.label || n.id}${d.reasoning ? ': ' + d.reasoning : ''}`);
      }
      const summary = Object.entries(grouped)
        .map(([type, items]) => `## ${type.replace(/_/g, ' ').toUpperCase()} (${items.length})\n${items.join('\n')}`)
        .join('\n\n');
      const seedText = `[Codebase Analysis Summary — ${scopedNodes.length} nodes]\n\n${summary}\n\nBuild on this analysis: generate new ideas, features, and refinements grounded in what actually exists in the code.`;
      setManualMode('idea');
      setIdea(seedText);
      pushCard('feedToIdea', 'Bridged to Idea Mode', `${scopedNodes.length} nodes fed into idea mode`, []);
    }
    // Inject action cards into chat
    if (cards.length > 0) {
      setPendingChatCards(prev => [...prev, ...cards]);
    }
  }, [active, startRefineInChat, startPortfolioInChat, handleGoDeeper, handleStartAutoFractal, ideaText, triggerScoring, setManualMode, setIdea, patternExec$, displayMode, dynamicDomain, startPrototypeBuild, nodeTools]);

  const handleClearChatFilter = useCallback(() => setChatFilter(null), []);

  // ── Execute action on a node (e.g., "Fix this" via Claude Code) ──
  const handleExecuteAction = useCallback(async (nodeId) => {
    const targetNode = active.rawNodesRef.current.find(n => n.id === nodeId);
    if (!targetNode) return;
    if (!cbProjectPath) {
      setPendingChatCards(prev => [...prev, {
        label: '⚠ No project path set',
        detail: 'Enter your local project path in the CODE mode header to enable "Fix this".',
        buttons: [],
      }]);
      setShowChat(true);
      return;
    }

    // Set node to in_progress
    active.updateNodeStatus(nodeId, 'in_progress', null);

    // Initialize live execution stream in chat
    const nodeLabel = targetNode.data.label;
    setExecutionStream({ nodeLabel, text: '', done: false, error: null, nodeId });
    setShowChat(true);

    // Create abort controller
    const abortController = new AbortController();
    executionAbortRef.current = abortController;

    let streamAccum = '';

    try {
      const res = await authFetch(`${API_URL}/api/execute-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId,
          nodeData: targetNode.data,
          mode: 'codebase',
          projectPath: cbProjectPath,
        }),
        signal: abortController.signal,
      });

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const evt = JSON.parse(payload);
            if (evt._text) {
              streamAccum += evt.text;
              setExecutionStream(prev => prev ? { ...prev, text: streamAccum } : prev);
            } else if (evt._progress) {
              streamAccum += `\n── ${evt.stage} ──\n`;
              setExecutionStream(prev => prev ? { ...prev, text: streamAccum } : prev);
            } else if (evt._result) {
              active.updateNodeStatus(nodeId, 'completed', evt);
              streamAccum += `\n✓ ${evt.summary || 'Fix completed successfully.'}`;
              setExecutionStream(prev => prev ? { ...prev, text: streamAccum, done: true } : prev);
            } else if (evt._error) {
              active.updateNodeStatus(nodeId, 'failed', { error: evt.error });
              streamAccum += `\n✗ Error: ${evt.error || 'An error occurred.'}`;
              setExecutionStream(prev => prev ? { ...prev, text: streamAccum, done: true, error: evt.error } : prev);
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        active.updateNodeStatus(nodeId, 'failed', { error: 'Aborted by user' });
        setExecutionStream(prev => prev ? { ...prev, text: streamAccum + '\n⏹ Execution stopped by user.', done: true, error: 'Aborted' } : prev);
      } else {
        active.updateNodeStatus(nodeId, 'failed', { error: err.message });
        setExecutionStream(prev => prev ? { ...prev, text: streamAccum + `\n✗ ${err.message || 'Network error.'}`, done: true, error: err.message } : prev);
      }
    } finally {
      executionAbortRef.current = null;
    }
  }, [active, cbProjectPath]);

  const handleCardButtonClick = useCallback((btn) => {
    if (btn.actionType === 'openPanel') {
      if (btn.panel === 'debate') startDebateInChat();
      else if (btn.panel === 'refine') startRefineInChat(3);
      else if (btn.panel === 'portfolio') startPortfolioInChat();
      else if (btn.panel === 'fractalExpand') setShowAutoFractal(true);
      else if (btn.panel === 'learn') startLearnInChat(7);
    } else if (btn.actionType === 'stopExecution') {
      if (executionAbortRef.current) {
        executionAbortRef.current.abort();
        executionAbortRef.current = null;
      }
      authFetch(`${API_URL}/api/stop-execution`, { method: 'POST' }).catch(() => {});
    } else if (btn.actionType === 'stopDebate') {
      handleStopDebateInChat();
    } else if (btn.actionType === 'resumeDebate') {
      startDebateInChat();
    } else if (btn.actionType === 'stopRefine') {
      handleStopRefine();
    } else if (btn.actionType === 'goDeeper') {
      // Trigger another refine round inline
      setRefineStream({ status: 'critiquing', round: 1, maxRounds: 2 });
      const refineHistory = [];
      handleGoDeeper(2, (progress) => {
        if (progress.status === 'round_complete') {
          refineHistory.push({
            round: progress.round, oldScore: progress.oldScore, newScore: progress.newScore,
            newNodeCount: progress.newNodeCount, summary: progress.summary,
          });
        }
        if (progress.status === 'done') {
          setRefineStream(null);
          setPendingChatCards(prev => [...prev, { type: 'refine_card', state: { status: 'done', history: refineHistory } }]);
        } else {
          setRefineStream({ ...progress, history: refineHistory });
        }
      });
    } else if (btn.actionType === 'exploreAlternative') {
      // Explore a portfolio alternative on the canvas
      portfolio$.handleExplore(btn.altIndex);
    } else if (btn.actionType === 'exploreAndRefine') {
      // Explore then start refine
      portfolio$.handleExplore(btn.altIndex);
      startRefineInChat(3);
    } else if (btn.actionType === 'generateMore') {
      startPortfolioInChat();
    }
    // ── Node Focus Card actions ──────────────────────────────
    else if (btn.actionType === 'drillDown') {
      const node = active.rawNodesRef.current.find(n => n.id === btn.nodeId);
      active.handleDrill(btn.nodeId);
      setFocusedNode(null);
      setPendingChatCards(prev => [...prev, { label: `Drilled into "${node?.data?.label || btn.nodeId}"`, detail: null, buttons: [] }]);
    } else if (btn.actionType === 'toggleStar') {
      active.handleToggleStar(btn.nodeId);
      const node = active.rawNodesRef.current.find(n => n.id === btn.nodeId);
      const nowStarred = node?.data?.starred;
      // Refresh focusedNode to show updated star state
      if (node) setFocusedNode(prev => prev ? { ...prev, node: { ...node } } : null);
    } else if (btn.actionType === 'expandNode') {
      active.handleFractalExpand(btn.nodeId);
      setPendingChatCards(prev => [...prev, { label: `Expanding "${active.rawNodesRef.current.find(n => n.id === btn.nodeId)?.data?.label || ''}"`, detail: 'Generating child nodes...', buttons: [] }]);
    } else if (btn.actionType === 'regenerateNode') {
      active.handleRegenerate(btn.nodeId);
      setPendingChatCards(prev => [...prev, { label: 'Regenerating subtree', detail: 'AI is regenerating this branch...', buttons: [] }]);
    } else if (btn.actionType === 'editNodeSave') {
      active.handleSaveNodeEdit(btn.nodeId, btn.updates);
      const updated = active.rawNodesRef.current.find(n => n.id === btn.nodeId);
      if (updated) setFocusedNode(prev => prev ? { ...prev, node: { ...updated } } : null);
    } else if (btn.actionType === 'splitNode') {
      const node = active.rawNodesRef.current.find(n => n.id === btn.nodeId);
      if (node) nodeTools.handleRazor(node);
    } else if (btn.actionType === 'mergeNode') {
      const node = active.rawNodesRef.current.find(n => n.id === btn.nodeId);
      if (node) nodeTools.handleStartMerge(node);
    } else if (btn.actionType === 'cancelMerge') {
      nodeTools.cancelMerge();
    } else if (btn.actionType === 'rippleDelete') {
      const node = active.rawNodesRef.current.find(n => n.id === btn.nodeId);
      if (node) {
        nodeTools.handleRippleDelete(node);
        setFocusedNode(null);
        setPendingChatCards(prev => [...prev, { label: `Deleted "${node.data?.label || ''}"`, detail: 'Children re-parented', buttons: [] }]);
      }
    } else if (btn.actionType === 'deleteBranch') {
      const node = active.rawNodesRef.current.find(n => n.id === btn.nodeId);
      if (node) {
        nodeTools.handleDeleteBranch(node);
        setFocusedNode(null);
        setPendingChatCards(prev => [...prev, { label: `Deleted branch "${node.data?.label || ''}"`, detail: 'Node and all descendants removed', buttons: [] }]);
      }
    } else if (btn.actionType === 'assignPattern') {
      const nodes = active.rawNodesRef.current;
      const idx = nodes.findIndex(n => n.id === btn.nodeId);
      if (idx >= 0) {
        const updated = { ...nodes[idx], data: { ...nodes[idx].data, pattern: btn.patternId } };
        const newNodes = [...nodes];
        newNodes[idx] = updated;
        active.rawNodesRef.current = newNodes;
        active.applyLayout(newNodes, active.drillStackRef.current);
        setFocusedNode(prev => prev ? { ...prev, node: updated } : null);
      }
    } else if (btn.actionType === 'runPatternOnSubtree') {
      // Direct "Run on subtree" from NodeFocusCard
      const allNodes = active.rawNodesRef.current;
      const subtreeIds = getSubtreeNodeIds(btn.nodeId, allNodes);
      const scopedNodes = allNodes.filter(n => subtreeIds.has(n.id));
      patternExec$.execute(btn.patternId, ideaText, scopedNodes, displayMode, { domain: dynamicDomain });
      setShowChat(true);
    } else if (btn.actionType === 'fixThis') {
      handleExecuteAction(btn.nodeId);
    } else if (btn.actionType === 'dismissNodeFocus') {
      setFocusedNode(null);
      active.setSelectedNode(null);
    }
    // ── Learn mode actions ──────────────────────────────────
    else if (btn.actionType === 'submitLearnAnswer') {
      learn$.submitAnswer(btn.answer);
    } else if (btn.actionType === 'learnContinue') {
      learn$.continueLoop();
    } else if (btn.actionType === 'learnExplainDifferently') {
      learn$.requestExplainDifferently();
    } else if (btn.actionType === 'learnSkip') {
      learn$.skipConcept(btn.conceptId);
    } else if (btn.actionType === 'learnHint') {
      learn$.requestHint();
    } else if (btn.actionType === 'stopLearn') {
      learn$.handleStopLearn();
      setLearnStream(null);
    } else if (btn.actionType === 'stopExperiment') {
      experiment$.handleStopExperiment();
      setExperimentStream(null);
    } else if (btn.actionType === 'experimentMore') {
      startExperimentInChat(3);
    } else if (btn.panel === 'experiment') {
      startExperimentInChat(5);
    } else if (btn.actionType === 'expandSuggestion') {
      handleSuggestionExpand(btn.suggestion).catch(err => console.error('Suggestion expand error:', err));
    } else if (btn.actionType === 'viewPrototype') {
      setShowPrototypeViewer(true);
    } else if (btn.actionType === 'stopPrototype') {
      proto$.handleStopBuild();
      setPrototypeStream(null);
    }
  }, [handleStopRefine, handleGoDeeper, handleStartRefine, active, portfolio$, startRefineInChat, startPortfolioInChat, nodeTools, handleExecuteAction, learn$, experiment$, startExperimentInChat, proto$, handleSuggestionExpand]);

  // ── Toolbar scroll arrows ────────────────────────────────
  const updateToolbarScroll = useCallback(() => {
    const el = toolbarScrollRef.current;
    if (!el) return;
    setToolbarCanScrollLeft(el.scrollLeft > 2);
    setToolbarCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    const el = toolbarScrollRef.current;
    if (!el) return;
    updateToolbarScroll();
    el.addEventListener('scroll', updateToolbarScroll, { passive: true });
    const ro = new ResizeObserver(updateToolbarScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', updateToolbarScroll); ro.disconnect(); };
  }, [updateToolbarScroll]);
  const scrollToolbar = useCallback((dir) => {
    const el = toolbarScrollRef.current;
    if (el) el.scrollBy({ left: dir * 150, behavior: 'smooth' });
  }, []);

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
    setChatFilter(null);
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

  // ── Child count map (for badge on parent nodes) ──
  // Use raw nodes (not filtered/visible) so collapsed parents still show correct counts
  const childCountMap = useMemo(() => {
    const map = {};
    const raw = active.rawNodesRef.current;
    (raw || []).forEach((n) => {
      const pid = n.data?.parentId;
      if (pid) map[pid] = (map[pid] || 0) + 1;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.nodes, activeMode]);

  // ── Tree search: match label or reasoning (case-insensitive) ──
  const treeSearchTrim = (treeSearchQuery || '').trim();
  const chatFilterActive = chatFilter !== null;
  const selectedNodeId = active.selectedNode?.id;
  const displayNodes = useMemo(() => active.nodes.map((n) => {
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
    // Chat filter: match by type and/or specific node IDs
    let chatFilterMatch = true;
    if (chatFilterActive) {
      const matchesType = chatFilter.types?.length ? chatFilter.types.includes(n.data?.type) : true;
      const matchesId = chatFilter.nodeIds?.length ? chatFilter.nodeIds.includes(n.id) : true;
      // If both type and ID filters are set, match either
      chatFilterMatch = chatFilter.types?.length && chatFilter.nodeIds?.length
        ? matchesType || matchesId
        : matchesType && matchesId;
    }
    return {
      ...n,
      data: {
        ...n.data,
        isSelected: n.id === selectedNodeId,
        roundIndex: roundIdx,
        isInRange: inRange,
        searchActive,
        searchMatch,
        chatFilterActive,
        chatFilterMatch,
        childCount: childCountMap[n.id] || 0,
        // Pattern metadata for badge rendering
        patternMeta: n.data?.pattern ? availablePatterns.find(p => p.id === n.data.pattern) || null : null,
        // Fractal callbacks
        onFractalExpand: active.handleFractalExpand,
        onToggleCollapse: active.handleToggleCollapse,
        // Learn mode mastery
        ...(displayMode === 'learn' && learn$.masteryMap[n.id] ? { mastery: learn$.masteryMap[n.id].score } : {}),
        // Mnemonic video (learn mode only)
        ...(displayMode === 'learn' ? {
          onGenerateMnemonic: (nodeId) => {
            const serialized = active.nodes.map(nd => nd.data);
            mnemonic$.generateMnemonic(nodeId, ideaText, serialized);
            setVideoModalNodeId(nodeId);
          },
          onPlayMnemonic: (nodeId) => setVideoModalNodeId(nodeId),
          mnemonicStatus: mnemonic$.mnemonicJobs[n.id]?.status || null,
        } : {}),
      },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [active.nodes, selectedNodeId, is3D, isolatedRound, roundRange, treeSearchTrim, chatFilterActive, chatFilter, childCountMap, displayMode, learn$.masteryMap, mnemonic$.mnemonicJobs]);

  const activeEdges = active.edges;
  const displayEdges = useMemo(() => is3D ? activeEdges : activeEdges.map(e => {
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
  }), [activeEdges, displayNodes, is3D]);

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
          {onBackToDashboard && (
            <button className="btn btn-icon btn-back" onClick={onBackToDashboard} title="Back to dashboard">
              ← BACK
            </button>
          )}
          <span className="logo-mark">◈</span>
          <span className="app-title">THOUGHTCLAW</span>
        </div>

        {/* Right section */}
        <div className="top-bar-right-wrapper">
          <button className={`top-bar-scroll-btn scroll-left${toolbarCanScrollLeft ? ' visible' : ''}`} onClick={() => scrollToolbar(-1)} aria-label="Scroll toolbar left">‹</button>
          <button className={`top-bar-scroll-btn scroll-right${toolbarCanScrollRight ? ' visible' : ''}`} onClick={() => scrollToolbar(1)} aria-label="Scroll toolbar right">›</button>
        <div className="top-bar-right" ref={toolbarScrollRef}>
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
          {/* Panels group — debate, chat */}
          {active.nodeCount > 0 && (
            <>
              <div className="toolbar-sep" />
              <button
                className={`btn btn-icon btn-debate-icon ${debateStream ? 'active-icon' : ''}`}
                onClick={() => {
                  if (debateStream || patternExec$.isExecuting) {
                    // Already running — just open chat to show it
                    setShowChat(true);
                  } else {
                    // Determine pattern and scope based on focused node
                    const allNodes = active.rawNodesRef.current;
                    const focusNode = focusedNode?.node;
                    let patternId = null;
                    let scopedNodes = allNodes;

                    if (focusNode) {
                      // Resolve node-level pattern (walk up ancestors), fall back to tree-level
                      patternId = resolveNodePattern(focusNode.id, allNodes) || activePattern;
                      // Scope to focused subtree
                      const subtreeIds = getSubtreeNodeIds(focusNode.id, allNodes);
                      scopedNodes = allNodes.filter(n => subtreeIds.has(n.id));
                    } else {
                      patternId = activePattern;
                    }

                    if (patternId) {
                      patternExec$.execute(patternId, ideaText, scopedNodes, displayMode, { domain: dynamicDomain });
                      setShowChat(true);
                    } else {
                      startDebateInChat();
                    }
                  }
                }}
                title={patternFramework?.debateLabels?.startLabel || (DEBATE_LABELS[displayMode] || DEBATE_LABELS.idea).tooltip}
              >
                {patternFramework?.debateLabels?.panelIcon || (DEBATE_LABELS[displayMode] || DEBATE_LABELS.idea).icon} {patternFramework?.debateLabels?.startLabel || (DEBATE_LABELS[displayMode] || DEBATE_LABELS.idea).label}
              </button>
              <button
                className={`btn btn-icon btn-chat-icon ${showChat ? 'active-icon' : ''}`}
                onClick={() => setShowChat((v) => !v)}
                title={(CHAT_LABELS[displayMode] || CHAT_LABELS.idea).tooltip}
              >
                ✦ {(CHAT_LABELS[displayMode] || CHAT_LABELS.idea).title}
              </button>
              <button
                className={`btn btn-icon ${showAutoFractal ? 'active-icon' : ''}`}
                onClick={() => setShowAutoFractal((v) => !v)}
                title="Autonomous fractal exploration — AI recursively expands ideas"
              >
                ∞ EXPLORE
              </button>
              <button
                className={`btn btn-icon ${refine$.isRefining ? 'active-icon' : ''}`}
                onClick={() => startRefineInChat(3)}
                title="Auto-refine — recursive critique and strengthen loop"
                disabled={refine$.isRefining}
              >
                ⟲ REFINE
              </button>
              <button
                className={`btn btn-icon ${portfolio$.isGenerating ? 'active-icon' : ''}`}
                onClick={() => startPortfolioInChat()}
                title="Generate and compare alternative approaches"
                disabled={portfolio$.isGenerating}
              >
                ◈ PORTFOLIO
              </button>
              {displayMode === 'learn' && (
                <button
                  className={`btn btn-icon ${learn$.isLearning ? 'active-icon' : ''}`}
                  onClick={() => startLearnInChat(7)}
                  title="Start comprehension loop — quiz yourself on concepts"
                  disabled={learn$.isLearning}
                >
                  ⧫ LEARN
                </button>
              )}
              {active.nodes.length > 0 && (
                <button
                  className={`btn btn-icon ${experiment$.isExperimenting ? 'active-icon' : ''}`}
                  onClick={() => startExperimentInChat(5)}
                  title="AutoIdea — autonomous idea experimentation loop"
                  disabled={experiment$.isExperimenting}
                >
                  ⟳ EXPERIMENT
                </button>
              )}
              <button
                className={`btn btn-icon btn-prototype-icon ${proto$.isBuilding ? 'active-icon' : ''}`}
                onClick={() => {
                  if (proto$.prototype && !proto$.isBuilding) {
                    setShowPrototypeViewer(true);
                  } else if (!proto$.isBuilding) {
                    startPrototypeBuild();
                  }
                }}
                disabled={proto$.isBuilding || (active.rawNodesRef.current?.length || 0) < 5}
                title="Build full interactive prototype from tree"
              >
                ◰ {proto$.prototype ? 'VIEW PROTOTYPE' : 'PROTOTYPE'}
              </button>
              <div className="toolbar-sep" />
              <button
                className="btn btn-icon btn-share-icon"
                onClick={() => setShowShareModal(true)}
                title="Share or collaborate"
              >
                ⊞ SHARE
              </button>
            </>
          )}
          {/* Yjs collaboration status bar */}
          {yjs && (
            <SyncStatusBar
              syncStatus={yjs.syncStatus}
              collaborators={yjs.collaborators}
              roomId={initialSession?.roomId}
            />
          )}
          {/* Undo / Redo */}
          {active.rawNodesRef.current.length > 0 && (
            <div className="undo-redo-bar">
              <button
                className="undo-btn"
                onClick={undoStack.undo}
                disabled={!undoStack.canUndo}
                title="Undo (Ctrl+Z)"
              >↩</button>
              <button
                className="redo-btn"
                onClick={undoStack.redo}
                disabled={!undoStack.canRedo}
                title="Redo (Ctrl+Shift+Z)"
              >↪</button>
            </div>
          )}
          {/* View mode toggles — shown when canvas has nodes */}
          {active.rawNodesRef.current.length > 0 && (
            <>
              <button
                className={`btn btn-icon ${viewMode === 'tree' ? 'active-icon' : ''}`}
                onClick={() => setViewMode(v => v === 'tree' ? 'flowchart' : 'tree')}
                title="Radial tree view"
              >
                ◎ RADIAL
              </button>
              <button
                className={`btn btn-icon ${viewMode === '3d' ? 'active-icon' : ''}`}
                onClick={() => setViewMode(v => v === '3d' ? 'flowchart' : '3d')}
                title="Toggle 3D view"
              >
                ◈ 3D
              </button>
            </>
          )}
          {/* Cross-links toggle — in tree or flowchart view */}
          {active.rawNodesRef.current.length > 0 && (viewMode === 'tree' || viewMode === 'flowchart') && (
            <button
              className={`btn btn-icon ${showCrossLinks ? 'active-icon' : ''}`}
              onClick={() => setShowCrossLinks((v) => !v)}
              title={showCrossLinks ? 'Hide cross-links' : 'Show cross-links'}
            >
              ⇌ LINKS
            </button>
          )}
          {/* Usage indicator + User profile */}
          {usageData && (
            <div className={`usage-indicator${usageData.remaining <= 3 ? (usageData.remaining === 0 ? ' exhausted' : ' warning') : ''}`}>
              {usageData.remaining === 0 ? '⊘' : '◈'} {usageData.generationsToday}/{usageData.limit}
            </div>
          )}
          {authUser && (
            <div className="user-profile" onClick={() => setShowUserMenu(v => !v)}>
              {authUser.photoURL
                ? <img src={authUser.photoURL} alt="" className="user-avatar" referrerPolicy="no-referrer" />
                : <div className="user-avatar-fallback">{(authUser.displayName || authUser.email || '?')[0].toUpperCase()}</div>
              }
              {showUserMenu && (
                <div className="user-dropdown">
                  <div className="user-dropdown-email">{authUser.email}</div>
                  <button className="user-dropdown-item" onClick={(e) => { e.stopPropagation(); authLogout(); }}>Sign out</button>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </header>

      {/* ── Mode bar ── */}
      <nav className="mode-bar">
        {MODES.filter(m => !m.hidden).map(mode => {
          const isActive   = displayMode === mode.id;
          const isDetected = detectedMode === mode.id && !manualMode && !isActive;
          const isManual   = manualMode === mode.id;
          const hasNodes   = idea$.nodes.length > 0 || cb$.nodes.length > 0;
          const isLocked   = hasNodes && !isActive;
          return (
            <button
              key={mode.id}
              className={`mode-tab${isActive ? ' active' : ''}${isDetected ? ' detected' : ''}${isLocked ? ' disabled' : ''}`}
              style={isActive ? { color: mode.color } : isLocked ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
              onClick={() => !isLocked && handleModeSelect(mode.id)}
              title={
                isLocked   ? `${mode.label} — start a new session to switch modes` :
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

      {upgradePrompt && (
        <div className="upgrade-banner">
          <span>You've hit {upgradePrompt.limit} generations/day on the {upgradePrompt.plan} plan.</span>
          <button className="upgrade-banner-btn" onClick={() => { setUpgradePrompt(null); window.history.pushState({}, '', '/settings'); window.location.reload(); }}>
            Upgrade to Pro
          </button>
          <button className="upgrade-banner-close" onClick={() => setUpgradePrompt(null)}>✕</button>
        </div>
      )}

      {active.error && (
        <div className="error-banner">
          <span>⚠ {active.error}</span>
          <button onClick={() => active.setError(null)}>✕</button>
        </div>
      )}

      {/* ── Content row: canvas + chat drawer ── */}
      <div className="app-content-row">
      <div className="canvas-column">
      {/* ── Canvas area ── */}
      <main className="canvas-area" style={{}}>

        {/* Portfolio navigation breadcrumb */}
        {portfolio$.navStack.length > 0 && (
          <div className="portfolio-breadcrumb-bar">
            <button className="portfolio-crumb portfolio-crumb--root" onClick={() => portfolio$.handleNavigateBack(0)}>
              ⬆ Original Tree
            </button>
            {portfolio$.navStack.map((entry, i) => (
              <span key={i} className="portfolio-crumb-segment">
                <span className="portfolio-crumb-sep">›</span>
                <button
                  className={`portfolio-crumb ${i === portfolio$.navStack.length - 1 ? 'portfolio-crumb--active' : ''}`}
                  onClick={() => portfolio$.handleNavigateBack(i + 1)}
                >
                  {entry.title}
                </button>
              </span>
            ))}
          </div>
        )}

        {activeMode === 'idea' && (
          /* Resume mode with empty canvas — show the resume input panel */
          displayMode === 'resume' && idea$.nodes.length === 0 && !idea$.isGenerating ? (
            <ResumeInput onAnalyzeReady={handleResumeAnalyze} />
          ) : idea$.nodes.length === 0 && !idea$.isGenerating ? (
            <>
              {showMemory && (
                <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 25 }}>
                  <MemoryInsights onDismiss={() => setShowMemory(false)} />
                </div>
              )}
              <IdeaEmptyState mode={displayMode} onExampleClick={(text) => { setIdea(text); }} />
            </>
          ) : sessionLoading ? (
            <div className="generating-indicator">
              <div className="generating-spinner" />
              <div className="generating-text">Loading session...</div>
            </div>
          ) : idea$.nodes.length === 0 && idea$.isGenerating ? (
            <div className="generating-indicator">
              <div className="generating-spinner" />
              <div className="generating-text">Research & multi-agent thinking...</div>
              <div className="generating-sub">Building your thinking tree from multiple perspectives</div>
            </div>
          ) : displayMode === 'learn' && idea$.nodes.length > 0 ? (
            <LearnJourneyView
              displayNodes={displayNodes}
              learnStream={learnStream}
              masteryMap={learn$.masteryMap}
              isLearning={learn$.isLearning}
              onConceptClick={(conceptId) => {
                const node = idea$.rawNodesRef.current.find(n => n.id === conceptId);
                if (node) idea$.handleNodeClick(node);
              }}
              onStartLearn={(conceptId) => {
                if (learn$.isLearning) learn$.handleStopLearn();
                setTimeout(() => startLearnInChat(7, { startConceptId: conceptId }), 100);
              }}
              onAction={handleCardButtonClick}
              mnemonicJobs={mnemonic$.mnemonicJobs}
              onGenerateVideo={(nodeId, opts) => {
                const serialized = active.nodes.map(nd => nd.data);
                mnemonic$.generateMnemonic(nodeId, ideaText, serialized, opts);
                setVideoModalNodeId(nodeId);
              }}
              onPlayVideo={(nodeId) => setVideoModalNodeId(nodeId)}
            />
          ) : viewMode === '3d' ? (
            <Graph3D
              nodes={idea$.rawNodesRef.current}
              onNodeClick={(node3d) => {
                const raw = idea$.rawNodesRef.current.find(n => n.id === node3d.id);
                if (raw) {
                  idea$.handleNodeClick({ id: raw.id, data: raw.data || raw });
                  if (displayMode === 'learn' && raw.data?.type && ['concept', 'prerequisite'].includes(raw.data.type)) {
                    if (learn$.isLearning) learn$.handleStopLearn();
                    setTimeout(() => startLearnInChat(7, { startConceptId: raw.id }), 100);
                  }
                }
              }}
            />
          ) : viewMode === 'flowchart' ? (
            <ReactFlowProvider>
              <FlowchartView
                displayNodes={displayNodes}
                onNodeClick={(node) => {
                  idea$.handleNodeClick(node);
                  if (displayMode === 'learn' && node?.data?.type && ['concept', 'prerequisite'].includes(node.data.type)) {
                    if (learn$.isLearning) learn$.handleStopLearn();
                    setTimeout(() => startLearnInChat(7, { startConceptId: node.id }), 100);
                  }
                }}
                onNodeDoubleClick={idea$.handleDrill}
                onNodeContextMenu={idea$.handleNodeContextMenu}
                onCloseContextMenu={idea$.handleCloseContextMenu}
                drillStack={idea$.drillStack}
                onExitDrill={idea$.handleExitDrill}
                onJumpToBreadcrumb={idea$.handleJumpToBreadcrumb}
                searchQuery={treeSearchQuery}
                onSearchChange={setTreeSearchQuery}
                onCollapseAll={idea$.handleCollapseAll}
                onExpandAll={idea$.handleExpandAll}
                hasCollapsed={displayNodes.some(n => n.data?.isCollapsed)}
                onReactFlowReady={(instance) => { reactFlowRef.current = instance; }}
              />
            </ReactFlowProvider>
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
                isScoring={isScoring}
                progressText={multiAgentProgress}
                onNodeClick={(node) => {
                  idea$.handleNodeClick(node);
                  if (displayMode === 'learn' && node?.data?.type && ['concept', 'prerequisite'].includes(node.data.type)) {
                    if (learn$.isLearning) learn$.handleStopLearn();
                    setTimeout(() => startLearnInChat(7, { startConceptId: node.id }), 100);
                  }
                }}
                onNodeDoubleClick={idea$.handleDrill}
                onNodeContextMenu={idea$.handleNodeContextMenu}
                onCloseContextMenu={idea$.handleCloseContextMenu}
                drillStack={idea$.drillStack}
                onExitDrill={idea$.handleExitDrill}
                onJumpToBreadcrumb={idea$.handleJumpToBreadcrumb}
                searchQuery={treeSearchQuery}
                onSearchChange={setTreeSearchQuery}
                onReactFlowReady={(instance) => { reactFlowRef.current = instance; }}
                onCollapseAll={idea$.handleCollapseAll}
                onExpandAll={idea$.handleExpandAll}
                hasCollapsed={displayNodes.some(n => n.data?.isCollapsed)}
              />
            </ReactFlowProvider>
          )
        )}

        {activeMode === 'codebase' && (
          cbShowUpload ? (
            <>
              <CodebaseUpload onAnalysisReady={handleAnalysisReady} isAnalyzing={cb$.isGenerating} />
            </>
          ) : viewMode === '3d' ? (
            <Graph3D
              nodes={cb$.rawNodesRef.current}
              onNodeClick={(node3d) => {
                const raw = cb$.rawNodesRef.current.find(n => n.id === node3d.id);
                if (raw) cb$.handleNodeClick({ id: raw.id, data: raw.data || raw });
              }}
            />
          ) : viewMode === 'flowchart' ? (
            <ReactFlowProvider>
              <FlowchartView
                displayNodes={displayNodes}
                onNodeClick={cb$.handleNodeClick}
                onNodeDoubleClick={cb$.handleDrill}
                onNodeContextMenu={cb$.handleNodeContextMenu}
                onCloseContextMenu={cb$.handleCloseContextMenu}
                drillStack={cb$.drillStack}
                onExitDrill={cb$.handleExitDrill}
                onJumpToBreadcrumb={cb$.handleJumpToBreadcrumb}
                searchQuery={treeSearchQuery}
                onSearchChange={setTreeSearchQuery}
                onCollapseAll={cb$.handleCollapseAll}
                onExpandAll={cb$.handleExpandAll}
                hasCollapsed={displayNodes.some(n => n.data?.isCollapsed)}
                onReactFlowReady={(instance) => { reactFlowRef.current = instance; }}
              />
            </ReactFlowProvider>
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
                onCollapseAll={cb$.handleCollapseAll}
                onExpandAll={cb$.handleExpandAll}
                hasCollapsed={displayNodes.some(n => n.data?.isCollapsed)}
              />
            </ReactFlowProvider>
          )
        )}

        {/* TimelineBar2D removed — not useful for users */}
      </main>

      {/* ── Timeline Filmstrip ── */}
      {(active.rawNodesRef.current?.length || 0) > 1 && (
        <div style={{}}>
        <TimelineFilmstrip
          topoOrder={timeline.topoOrder}
          currentIndex={timeline.currentIndex}
          isPlaying={timeline.isPlaying}
          onGoToIndex={timeline.goToIndex}
          onTogglePlay={timeline.togglePlay}
          onGoNext={timeline.goNext}
          onGoPrev={timeline.goPrev}
          onFilterChange={(filter) => {
            if (filter) {
              setChatFilter({ types: filter.visibleTypes });
            } else {
              setChatFilter(null);
            }
          }}
        />
        </div>
      )}

      {/* ── Bottom input bar ── */}
      <footer className="bottom-bar" style={{}}>
        {/* Idea mode input row */}
        {activeMode === 'idea' && !(displayMode === 'resume' && idea$.nodes.length === 0 && !idea$.isGenerating) && (
          <div className="input-row">
            {displayMode === 'resume' ? (
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
                  {/* + Attachments menu */}
                  <div className="plus-menu-anchor">
                    <button
                      ref={plusMenuBtnRef}
                      className="plus-menu-btn"
                      title="Attach file or connect integrations"
                      onClick={() => setShowPlusMenu(v => !v)}
                      disabled={isBusy}
                    >
                      +
                    </button>
                    {showPlusMenu && (
                      <>
                        <div className="plus-menu-backdrop" onClick={() => setShowPlusMenu(false)} />
                        <div className="plus-menu-popover" style={(() => {
                          const r = plusMenuBtnRef.current?.getBoundingClientRect();
                          return r ? { bottom: window.innerHeight - r.top + 8, left: r.left } : {};
                        })()}>
                          <button className="plus-menu-item" onClick={() => { setShowPlusMenu(false); fileInputRef.current?.click(); }}>
                            <span className="plus-menu-item-icon">📎</span> Upload File
                          </button>
                          <button className="plus-menu-item" onClick={() => { setShowPlusMenu(false); sessionFileInputRef.current?.click(); }}>
                            <span className="plus-menu-item-icon">📁</span> Attach Context Files
                          </button>
                          <button className="plus-menu-item" onClick={() => { setShowPlusMenu(false); setShowClaudeCodePicker(true); }}>
                            <span className="plus-menu-item-icon">⬡</span> Import Claude Context
                          </button>
                          {gmail.configured && (
                            gmail.connected ? (
                              <>
                                <button className="plus-menu-item" onClick={() => { setShowPlusMenu(false); gmail.openPicker(); }}>
                                  <span className="plus-menu-item-icon">✉</span> Import Email
                                </button>
                                <button className="plus-menu-item plus-menu-item--danger" onClick={() => { setShowPlusMenu(false); gmail.disconnect(); }}>
                                  <span className="plus-menu-item-icon">✕</span> Disconnect Gmail
                                </button>
                              </>
                            ) : (
                              <button className="plus-menu-item" onClick={() => { setShowPlusMenu(false); gmail.connect(); }}>
                                <span className="plus-menu-item-icon">✉</span> Connect Gmail
                              </button>
                            )
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {attachedFile && (
                    <span className="file-badge" title={attachedFile.name}>
                      {attachedFile.name.length > 18 ? attachedFile.name.slice(0, 15) + '...' : attachedFile.name}
                      <button className="file-badge-x" onClick={() => { setAttachedFile(null); setIdea(''); setTimeout(autoResize, 0); }}>×</button>
                    </span>
                  )}
                  {emailContext && (
                    <span className="file-badge email-badge" title={emailContext.subject}>
                      ✉ {emailContext.subject?.length > 20 ? emailContext.subject.slice(0, 18) + '...' : emailContext.subject} ({emailContext.messageCount})
                      <button className="file-badge-x" onClick={() => setEmailContext(null)}>×</button>
                    </span>
                  )}
                  {claudeCodeContext && (
                    <span className="file-badge cc-badge" title="Claude Code context loaded">
                      ⬡ Claude Code ({claudeCodeContext.sessionCount} sessions)
                      <button className="file-badge-x" onClick={() => setClaudeCodeContext(null)}>×</button>
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
                    <button className="btn btn-generate" onClick={handleGenerateResearch} disabled={!idea.trim() || idea$.isRegenerating || isFetchingUrl}>
                      {isFetchingUrl ? '◌ FETCHING URL...' : '▶ GENERATE'}
                    </button>
                    {displayMode === 'idea' && onOpenForest && (
                      <button className="btn btn-forest" onClick={handleForestDecompose} disabled={!idea.trim() || isDecomposing} title="Decompose into multi-canvas forest">
                        {isDecomposing ? '◌ DECOMPOSING...' : '◈ FOREST'}
                      </button>
                    )}
                    <div className="gen-auto-options">
                      <label className="gen-auto-check" title="Auto-run refinement loop after generation">
                        <input type="checkbox" checked={autoRefineOnGen} onChange={e => setAutoRefineOnGen(e.target.checked)} />
                        <span>⟲ Refine</span>
                      </label>
                      <label className="gen-auto-check" title="Auto-generate alternative approaches after generation">
                        <input type="checkbox" checked={autoPortfolioOnGen} onChange={e => setAutoPortfolioOnGen(e.target.checked)} />
                        <span>◈ Portfolio</span>
                      </label>
                      <label className="gen-auto-check" title="Auto-build interactive prototype after generation">
                        <input type="checkbox" checked={autoPrototypeOnGen} onChange={e => setAutoPrototypeOnGen(e.target.checked)} />
                        <span>◰ Prototype</span>
                      </label>
                      {(autoRefineOnGen || autoPortfolioOnGen || autoPrototypeOnGen) && (
                        <label className="gen-auto-check" title="Auto-pilot: skip checkpoints and let AI choose patterns automatically">
                          <input type="checkbox" checked={autonomousMode} onChange={e => setAutonomousMode(e.target.checked)} />
                          <span>⚡ Auto-pilot</span>
                        </label>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
            {/* Hidden file input for session context files */}
            <input
              ref={sessionFileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.txt,.md,.json,.yaml,.yml,.js,.ts,.jsx,.tsx,.py"
              style={{ display: 'none' }}
              onChange={async (e) => {
                if (!e.target.files?.length || !gateway.sessionId) return;
                const formData = new FormData();
                for (const file of e.target.files) formData.append('files', file);
                try {
                  const res = await authFetch(`${API_URL}/api/sessions/${gateway.sessionId}/files`, { method: 'POST', body: formData });
                  const data = await res.json();
                  if (data.files) setSessionFiles(prev => [...prev, ...data.files]);
                } catch (err) { console.error('Upload failed:', err); }
                e.target.value = '';
              }}
            />
            <SessionFilesBar
              sessionId={gateway.sessionId}
              files={sessionFiles}
              setFiles={setSessionFiles}
              onContextUpdate={setSessionFileContext}
            />
          </div>
        )}

        {/* Codebase mode input row */}
        {activeMode === 'codebase' && !cbShowUpload && (
          <div className="input-row">
            <div className="input-wrapper" style={{ opacity: 0.65, pointerEvents: 'none', flex: 1 }}>
              <span className="input-prefix">⟨/⟩</span>
              <span className="idea-input" style={{ padding: '0 0 0 4px', display: 'flex', alignItems: 'center' }}>{cbFolderName}</span>
            </div>
            <div className="project-path-wrapper">
              <input
                type="text"
                className="project-path-input"
                value={cbProjectPath}
                onChange={(e) => setCbProjectPath(e.target.value)}
                placeholder={`local path, e.g. /Users/you/${cbFolderName || 'project'}`}
                title="Local filesystem path for Claude Code to fix issues"
              />
            </div>
            {cb$.isGenerating ? (
              <button className="btn btn-stop" onClick={handleStop}>■ STOP</button>
            ) : (
              <button className="btn btn-generate" onClick={handleNewCbAnalysis}>↺ NEW ANALYSIS</button>
            )}
          </div>
        )}
      </footer>

      {/* NodeEditPanel removed — replaced by NodeFocusCard in ChatPanel */}

      {/* NodeContextMenu removed — replaced by NodeFocusCard in ChatPanel */}

      {/* ── F4: Preview Overlay ── */}
      {previewState && (
        <PreviewOverlay
          previewNodes={previewState.nodes}
          removedNodeIds={previewState.removedIds}
          actionLabel={previewState.label}
          onAccept={() => {
            previewState.onAccept?.();
            setPreviewState(null);
          }}
          onReject={() => {
            previewState.onReject?.();
            setPreviewState(null);
          }}
        />
      )}

      {/* ── Full Prototype Viewer ── */}
      {showPrototypeViewer && proto$.prototype && (
        <FullPrototypePlayer
          prototype={proto$.prototype}
          onClose={() => setShowPrototypeViewer(false)}
          onRegenScreen={(idx, instruction) => proto$.handleRegenScreen(idx, instruction, gateway.sessionId || initialSession?.id)}
        />
      )}

      {/* ── Claude Code Picker ── */}
      {showClaudeCodePicker && (
        <ClaudeCodePicker
          onLoadContext={(context, sessionCount) => setClaudeCodeContext({ context, sessionCount })}
          onClose={() => setShowClaudeCodePicker(false)}
        />
      )}

      {/* ── F5: Inspector Panel ── */}
      {inspectorNode && (
        <InspectorPanel
          node={inspectorNode}
          rawNodesRef={active.rawNodesRef}
          onSave={(nodeId, updates) => {
            active.handleSaveNodeEdit(nodeId, updates);
            // Refresh inspector with updated node
            const updated = active.rawNodesRef.current.find(n => n.id === nodeId);
            if (updated) setInspectorNode(updated);
          }}
          onClose={() => setInspectorNode(null)}
          onNodeClick={(n) => {
            active.handleNodeClick(n);
            setInspectorNode(n);
          }}
        />
      )}

      {/* ── F5: Hover Preview Tooltip ── */}
      {hoverPreview.hoverPreview && (
        <div
          className="hover-preview-card"
          style={{
            left: Math.min(hoverPreview.hoverPreview.x + 20, window.innerWidth - 320),
            top: Math.min(hoverPreview.hoverPreview.y - 10, window.innerHeight - 200),
          }}
        >
          <div className="hover-preview-header">
            <span className="hover-preview-type" style={{
              color: hoverPreview.hoverPreview.nodeData?.type === 'thesis' ? '#a78bfa' :
                     hoverPreview.hoverPreview.nodeData?.type === 'antithesis' ? '#f472b6' :
                     hoverPreview.hoverPreview.nodeData?.type === 'synthesis' ? '#34d399' : '#888'
            }}>
              {(hoverPreview.hoverPreview.nodeData?.type || 'node').toUpperCase()}
            </span>
            {hoverPreview.hoverPreview.nodeData?.score != null && (
              <span className="hover-preview-score">
                {hoverPreview.hoverPreview.nodeData.score}/10
              </span>
            )}
          </div>
          <div className="hover-preview-label">
            {hoverPreview.hoverPreview.nodeData?.label}
          </div>
          {hoverPreview.hoverPreview.nodeData?.reasoning && (
            <div className="hover-preview-reasoning">
              {hoverPreview.hoverPreview.nodeData.reasoning.slice(0, 120)}
              {hoverPreview.hoverPreview.nodeData.reasoning.length > 120 ? '…' : ''}
            </div>
          )}
          <div className="hover-preview-meta">
            {hoverPreview.hoverPreview.parents.length > 0 && (
              <span>↑ {hoverPreview.hoverPreview.parents.length} parent{hoverPreview.hoverPreview.parents.length > 1 ? 's' : ''}</span>
            )}
            {hoverPreview.hoverPreview.childCount > 0 && (
              <span>↓ {hoverPreview.hoverPreview.childCount} children</span>
            )}
          </div>
        </div>
      )}

      {showHistory && (
        <HistoryModal
          versions={ideaVersions}
          currentNodes={idea$.rawNodesRef.current}
          onLoad={handleLoadVersion}
          onClose={() => setShowHistory(false)}
        />
      )}

      </div>{/* end canvas-column */}
      {/* ── Chat Companion Panel ── */}
      <ChatPanel
        isOpen={showChat}
        onClose={() => { setShowChat(false); setChatFilter(null); }}
        nodes={active.rawNodesRef.current}
        idea={ideaText}
        mode={displayMode}
        onChatAction={handleChatAction}
        chatFilterActive={chatFilterActive}
        onClearFilter={handleClearChatFilter}
        pendingChatCards={pendingChatCards}
        onClearPendingCards={() => setPendingChatCards([])}
        onCardButtonClick={handleCardButtonClick}
        executionStream={executionStream}
        onStopExecution={() => {
          if (executionAbortRef.current) {
            executionAbortRef.current.abort();
            authFetch(`${API_URL}/api/stop-execution`, { method: 'POST' }).catch(() => {});
          }
        }}
        onDismissStream={() => setExecutionStream(null)}
        refineStream={refineStream}
        portfolioStream={portfolioStream}
        learnStream={learnStream}
        experimentStream={experimentStream}
        debateStream={debateStream}
        prototypeStream={prototypeStream}
        focusedNode={focusedNode ? {
          ...focusedNode,
          node: active.rawNodesRef.current.find(n => n.id === focusedNode.node?.id) || focusedNode.node,
          isSplitting: nodeTools.isSplitting,
          isMerging: nodeTools.isMerging,
          mergeTarget: nodeTools.mergeTarget,
        } : null}
        onDismissFocus={() => { setFocusedNode(null); active.setSelectedNode(null); }}
        emailContext={emailContext}
        pipelineStages={pipelineStages}
        onClosePipeline={() => setPipelineStages(null)}
        patternFramework={patternFramework}
        patternExecState={patternExec$.isExecuting ? { stage: patternExec$.currentStage, round: patternExec$.currentRound, checkpoint: patternExec$.checkpoint } : null}
        onStopPattern={() => patternExec$.stop()}
        availablePatterns={availablePatterns}
        sessionFileContext={sessionFileContext}
        pipelineCheckpoint={pipelineCheckpoint}
        onPipelineCheckpointAction={handlePipelineCheckpointDecision}
        mnemonicJobs={mnemonic$.mnemonicJobs}
        onGenerateVideo={(nodeId, opts) => {
          const serialized = active.nodes.map(nd => nd.data);
          mnemonic$.generateMnemonic(nodeId, ideaText, serialized, opts);
          setVideoModalNodeId(nodeId);
        }}
        onPlayVideo={(nodeId) => setVideoModalNodeId(nodeId)}
      />
      </div>{/* end app-content-row */}

      {/* ── Gmail Thread Picker Modal ── */}
      <GmailPicker {...gmail} />

      {/* ── Auto-Fractal Panel ── */}
      {showAutoFractal && (
        <div className="auto-fractal-panel">
          <div className="auto-fractal-header">
            <span>∞ FRACTAL EXPLORE</span>
            <button className="panel-close-btn" onClick={() => setShowAutoFractal(false)}>✕</button>
          </div>
          {!autoFractalRunning ? (
            <div className="auto-fractal-config">
              <label className="auto-fractal-label">
                Rounds: <strong>{autoFractalRounds}</strong>
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={autoFractalRounds}
                onChange={(e) => setAutoFractalRounds(Number(e.target.value))}
                className="auto-fractal-slider"
              />
              <div className="auto-fractal-desc">
                AI will select the most promising leaf node and expand it, repeating for {autoFractalRounds} rounds.
              </div>
              <button
                className="btn btn-generate"
                onClick={handleStartAutoFractal}
                disabled={active.rawNodesRef.current.length === 0}
                style={{ width: '100%', marginTop: 8 }}
              >
                ▶ START EXPLORATION
              </button>
            </div>
          ) : (
            <div className="auto-fractal-progress">
              {autoFractalProgress && autoFractalProgress.status !== 'done' && (
                <>
                  <div className="auto-fractal-round">
                    Round {autoFractalProgress.round}/{autoFractalProgress.maxRounds}
                  </div>
                  <div className="auto-fractal-status">
                    {autoFractalProgress.status === 'selecting'
                      ? '🔍 Selecting most promising node...'
                      : `⊕ Expanding: "${active.rawNodesRef.current.find(n => n.id === autoFractalProgress.selectedNodeId)?.data?.label || autoFractalProgress.selectedNodeId}"`
                    }
                  </div>
                  {autoFractalProgress.reasoning && (
                    <div className="auto-fractal-reasoning">
                      "{autoFractalProgress.reasoning}"
                    </div>
                  )}
                  {autoFractalProgress.newNodeCount > 0 && (
                    <div className="auto-fractal-count">
                      +{autoFractalProgress.newNodeCount} nodes added
                    </div>
                  )}
                </>
              )}
              <button
                className="btn btn-stop"
                onClick={handleStopAutoFractal}
                style={{ width: '100%', marginTop: 8 }}
              >
                ◼ STOP
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pipeline now renders inside ChatPanel */}

      {/* ── Resume Changes Modal ── */}
      <ResumeChangesModal
        isOpen={showResumeChanges}
        onClose={() => setShowResumeChanges(false)}
        changes={resumeChanges?.changes}
        summary={resumeChanges?.summary}
        isLoading={isGeneratingChanges}
        error={resumeChangesError}
      />


      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        nodes={active.rawNodesRef.current}
        idea={ideaText}
      />

      <VideoModal
        isOpen={!!videoModalNodeId}
        onClose={() => setVideoModalNodeId(null)}
        job={videoModalNodeId ? mnemonic$.mnemonicJobs[videoModalNodeId] : null}
        nodeLabel={videoModalNodeId ? active.nodes.find(n => n.id === videoModalNodeId)?.data?.label : ''}
        onRetry={videoModalNodeId ? () => {
          const serialized = active.nodes.map(nd => nd.data);
          mnemonic$.generateMnemonic(videoModalNodeId, ideaText, serialized);
        } : null}
      />

    </div>
  );
}

const EMPTY_STATE_CONFIG = {
  idea: {
    icon: '◈',
    title: 'THOUGHTCLAW',
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
  learn: {
    icon: '⧫',
    title: 'LEARN CANVAS',
    desc: (<>Type a topic above and hit <kbd>Enter</kbd> or <kbd>GENERATE</kbd> to build a learning tree with concepts and prerequisites.</>),
    examples: ['"How neural networks work"', '"Rust ownership and borrowing"', '"Distributed systems fundamentals"'],
  },
  resume: {
    icon: '◎',
    title: 'RESUME CANVAS',
    desc: (<>Paste a job description above and hit <kbd>Enter</kbd> or <kbd>GENERATE</kbd> to build a tailored resume analysis.</>),
    examples: ['"Senior frontend engineer at Stripe"', '"Product manager role at a Series B startup"', '"ML engineer job description"'],
  },
};

function IdeaEmptyState({ mode, onExampleClick }) {
  const cfg = EMPTY_STATE_CONFIG[mode] || EMPTY_STATE_CONFIG.idea;
  return (
    <div className="empty-state">
      <div className="empty-icon">{cfg.icon}</div>
      <div className="empty-title">{cfg.title}</div>
      <div className="empty-desc">{cfg.desc}</div>
      <div className="empty-examples">
        <span className="examples-label">try:</span>
        {cfg.examples.map((ex) => (
          <span key={ex} className="example-chip" onClick={() => onExampleClick && onExampleClick(ex.replace(/^"|"$/g, ''))}>{ex}</span>
        ))}
      </div>
    </div>
  );
}
