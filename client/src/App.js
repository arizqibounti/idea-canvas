import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import IdeaCanvas from './IdeaCanvas';
import NodeEditPanel from './NodeEditPanel';

import NodeContextMenu from './NodeContextMenu';
import CodebaseUpload from './CodebaseUpload';
import ResumeInput from './ResumeInput';
import HistoryModal from './HistoryModal';
import MemoryInsights, { buildMemoryEntry, appendMemory, readMemory } from './MemoryLayer';

import DebatePanel from './DebatePanel';
import ChatPanel from './ChatPanel';
import ResumeChangesModal from './ResumeChangesModal';

import Graph3D from './Graph3D';


import { NODE_TYPES_CONFIG, buildDynamicConfig, getNodeConfig } from './nodeConfig';
import { MODES, detectMode } from './modeConfig';
import { useCanvasMode, buildFlowNode, readSSEStream, appendVersion, readVersions } from './useCanvasMode';
import { readTemplates, saveTemplate } from './TemplateStore';
import { useGateway } from './gateway/useGateway';

import ShareModal from './ShareModal';
import ShareViewer from './ShareViewer';
import { useAuth } from './AuthContext';
import { setTokenGetter, authFetch } from './api';
import LandingPage from './LandingPage';
import Sidebar from './Sidebar';
import SettingsPage from './settings/SettingsPage';
import KnowledgeGraph from './KnowledgeGraph';
import { useAutoRefine } from './useAutoRefine';
import RefinePanel from './RefinePanel';
import PortfolioPanel from './PortfolioPanel';
import PipelineOverlay from './PipelineOverlay';
import FlowchartView from './FlowchartView';
import GmailPicker from './GmailConnect';
import useGmail from './useGmail';
import InviteAccept from './InviteAccept';
import { YjsProvider, useYjs } from './yjs/YjsContext';
import { generateRoomId, buildRoomUrl } from './yjs/roomUtils';
import SyncStatusBar from './yjs/SyncStatusBar';
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
};

const CHAT_LABELS = {
  idea:     { title: 'STRATEGIST', tooltip: 'Product strategist companion' },
  resume:   { title: 'COACH',     tooltip: 'Career coach companion' },
  codebase: { title: 'ADVISOR',   tooltip: 'Tech advisor companion' },
  decision: { title: 'ANALYST',   tooltip: 'Decision analyst companion' },
  writing:  { title: 'EDITOR',    tooltip: 'Writing editor companion' },
  plan:     { title: 'PLANNER',   tooltip: 'Project advisor companion' },
};

// Helper: stream generation via WebSocket, with same callback pattern as readSSEStream
// Returns null if WS send fails (caller should fall back to REST)
function streamViaGateway(gateway, type, params, onNode) {
  return new Promise((resolve) => {
    const reqId = gateway.send(type, params, {
      onNode: (data) => onNode(data),
      onMeta: (data) => onNode({ ...data, _meta: true }),
      onProgress: (stage) => onNode({ _progress: true, stage }),
      onText: (data) => onNode(data),
      onResult: (data) => resolve({ done: true, result: data }),
      onCanvasArtifact: (data) => onNode({ _canvas: true, ...data }),
      onDone: () => resolve({ done: true }),
      onError: (message) => resolve({ error: message }),
    });
    if (!reqId) resolve(null); // null signals: fall back to REST
  });
}

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
        {MODES.map(m => (
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
        onOpenSettings={() => { setShowSettings(true); setShowKnowledge(false); setActiveSession(null); if (window.innerWidth <= 768) setSidebarCollapsed(true); }}
        onOpenKnowledge={() => { setShowKnowledge(true); setShowSettings(false); setActiveSession(null); if (window.innerWidth <= 768) setSidebarCollapsed(true); }}
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
        ) : !activeSession ? (
          <EmptyState onNewSession={(modeId) => setActiveSession({ isNew: true, mode: modeId })} />
        ) : (
          <App
            key={activeSession.id || 'new-' + (activeSession.mode || 'default')}
            initialSession={activeSession}
            onBackToDashboard={null}
            onSessionSaved={handleSessionSaved}
          />
        )}
      </div>
    </div>
  );
}

export { AppRouter };
export default function App({ initialSession, onBackToDashboard, onSessionSaved }) {
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

  // ── Canvas hooks ──────────────────────────────────────────
  const idea$ = useCanvasMode({ storageKey: 'IDEA_CANVAS_SESSIONS', sessionLabel: 'idea', yjsSyncRef });
  const cb$ = useCanvasMode({ storageKey: 'CODEBASE_CANVAS_SESSIONS', sessionLabel: 'folderName' });

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

  // ── Load initial session from dashboard ───────────────────
  const initialSessionLoaded = useRef(false);
  useEffect(() => {
    if (initialSessionLoaded.current || !initialSession || initialSession.isNew) return;
    initialSessionLoaded.current = true;

    // Determine which canvas mode to load into
    const sessionMode = initialSession.mode || 'idea';

    if (sessionMode === 'codebase') {
      // Load into codebase canvas
      if (initialSession.rawNodes?.length) {
        cb$.handleLoadSession(initialSession, (label) => setCbFolderName(label));
      }
      setManualMode('codebase');
    } else {
      // Load into idea canvas (for all non-codebase modes)
      if (initialSession.rawNodes?.length) {
        idea$.handleLoadSession(initialSession, (label) => setIdea(label));
      } else if (initialSession.idea) {
        setIdea(initialSession.idea);
      }
      if (sessionMode !== 'idea') {
        setManualMode(sessionMode);
      }
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

  // ── Mode: derived ─────────────────────────────────────────
  // displayMode drives the tab highlight + placeholder + icon
  // activeMode collapses all non-codebase modes to 'idea' for canvas routing
  const displayMode = manualMode ?? detectedMode ?? 'idea';
  const activeMode  = displayMode === 'codebase' ? 'codebase' : 'idea';
  const active = activeMode === 'idea' ? idea$ : cb$;
  const refine$ = activeMode === 'idea' ? refineIdea$ : refineCb$;
  const ideaText = useMemo(() => {
    if (activeMode === 'codebase') return cbFolderName;
    if (displayMode === 'resume') return resumeJobLabel;
    return idea;
  }, [activeMode, cbFolderName, displayMode, resumeJobLabel, idea]);

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

  // ── Chat Companion ────────────────────────────────────────
  const [showChat, setShowChat] = useState(false);
  const [chatFilter, setChatFilter] = useState(null);
  // shape: { types?: string[], nodeIds?: string[] } | null
  const [pendingChatCards, setPendingChatCards] = useState([]);
  const [executionStream, setExecutionStream] = useState(null); // { nodeLabel, text, done, error }
  const [refineStream, setRefineStream] = useState(null); // live refine progress for inline chat card
  const [portfolioStream, setPortfolioStream] = useState(null); // live portfolio progress for inline chat card

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

  // ── Auto-Refine (⟲ REFINE) ────────────────────────────
  const [showRefine, setShowRefine] = useState(false);

  // ── Portfolio (◈ PORTFOLIO) ────────────────────────────
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [portfolioData, setPortfolioData] = useState({ alternatives: [], scores: null, recommendation: '' });

  // ── Post-generation automation options ───────────────────
  const [autoRefineOnGen, setAutoRefineOnGen] = useState(false);
  const [autoPortfolioOnGen, setAutoPortfolioOnGen] = useState(false);
  const [portfolioAutoGen, setPortfolioAutoGen] = useState(false); // triggers auto-generate in PortfolioPanel
  const [portfolioFocus, setPortfolioFocus] = useState(null); // dynamic focus context from chat (types/nodeIds/userIntent)
  const [pipelineStages, setPipelineStages] = useState(null); // pipeline overlay stages
  const [emailContext, setEmailContext] = useState(null); // { id, subject, messageCount, formatted }
  const [showPlusMenu, setShowPlusMenu] = useState(false); // + attachments popover
  const plusMenuBtnRef = useRef(null);

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

  // ── Auto-save (skip when Yjs handles persistence) ────────
  useEffect(() => {
    if (yjs) return; // Yjs handles persistence via y-indexeddb
    if (activeMode === 'idea') idea$.triggerAutoSave(idea);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea$.nodeCount, idea, activeMode]);

  useEffect(() => {
    if (activeMode === 'codebase') cb$.triggerAutoSave(cbFolderName);
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

      const genParams = { idea: idea.trim(), mode: displayMode, fetchedUrlContent, templateGuidance, emailThread: emailContext?.formatted || null };
      const seenTypes = [];
      if (yjs) yjs.setLocalGenerating(true);
      const onNodeData = (nodeData) => {
        if (nodeData._meta) {
          const config = buildDynamicConfig(nodeData.types || []);
          dynamicConfigRef.current = config;
          dynamicTypesRef.current = nodeData.types || [];
          idea$.dynamicTypesRef.current = nodeData.types || [];
          setDynamicDomain(nodeData.domain || 'Canvas');
          if (yjs) yjs.writeMetaToYjs({ types: nodeData.types, domain: nodeData.domain, idea: idea.trim(), mode: displayMode });
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
      // Auto-open debate panel and kick off the loop if generation completed successfully
      if (!controller.signal.aborted && idea$.rawNodesRef.current.length > 0) {
        setShowDebate(true);
        setDebateAutoStart(true);
        triggerScoring(idea$.rawNodesRef.current, idea.trim());
      }
    }
  }, [idea, idea$, displayMode, saveVersionAndMemory, triggerScoring, yjs, checkUpgradable, emailContext]);

  // ── Multi-agent generation (3 lenses + merge) ─────────────
  const handleGenerateMulti = useCallback(async () => {
    if (!idea.trim() || idea$.isGenerating || idea$.isRegenerating) return;
    idea$.resetCanvas();
    idea$.setIsGenerating(true);
    setMultiAgentProgress('Starting multi-agent analysis...');
    setRedirectState('idle');
    setDebateAutoStart(false);
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

      const genParams = { idea: idea.trim(), mode: displayMode, fetchedUrlContent, templateGuidance, emailThread: emailContext?.formatted || null };
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
      if (!controller.signal.aborted && idea$.rawNodesRef.current.length > 0) {
        setShowDebate(true);
        setDebateAutoStart(true);
        triggerScoring(idea$.rawNodesRef.current, idea.trim());
      }
    }
  }, [idea, idea$, displayMode, saveVersionAndMemory, triggerScoring, yjs, checkUpgradable, emailContext]);

  const handleGenerateResearch = useCallback(async () => {
    if (!idea.trim() || idea$.isGenerating || idea$.isRegenerating) return;
    idea$.resetCanvas();
    idea$.setIsGenerating(true);
    setMultiAgentProgress('Planning research strategy...');
    setRedirectState('idle');
    setDebateAutoStart(false);
    dynamicConfigRef.current = null;
    dynamicTypesRef.current = null;
    setDynamicDomain(null);
    setDynamicLegendTypes([]);

    // Initialise pipeline overlay when automation checkboxes are active
    if (autoRefineOnGen || autoPortfolioOnGen) {
      const stages = [
        { id: 'generate', label: 'Generate', status: 'active', detail: 'Research & multi-agent thinking...' },
        { id: 'debate', label: 'Debate', status: 'pending', detail: null },
        ...(autoRefineOnGen ? [{ id: 'refine', label: 'Refine', status: 'pending', detail: null }] : []),
        ...(autoPortfolioOnGen ? [{ id: 'portfolio', label: 'Portfolio', status: 'pending', detail: null }] : []),
      ];
      setPipelineStages(stages);
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

      const genParams = { idea: idea.trim(), mode: displayMode, fetchedUrlContent, templateGuidance, emailThread: emailContext?.formatted || null };
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
        setShowDebate(true);
        setDebateAutoStart(true);
        triggerScoring(idea$.rawNodesRef.current, idea.trim());
        // Pipeline: generate done → debate active
        setPipelineStages(prev => prev?.map(s =>
          s.id === 'generate' ? { ...s, status: 'done', detail: `${idea$.rawNodesRef.current.length} nodes` } :
          s.id === 'debate' ? { ...s, status: 'active', detail: 'Critic vs. architect debate...' } : s
        ));
      }
    }
  }, [idea, idea$, displayMode, saveVersionAndMemory, triggerScoring, yjs, checkUpgradable, emailContext]);

  const handleStop = useCallback(() => {
    active.handleStop();
    setRedirectState('idle');
    setIsCritiquing(false);
  }, [active]);

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
    setDebateAutoStart(false);

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

  // Opens the refine panel + starts auto-refine (used by Portfolio panel)
  const handleOpenAndStartRefine = useCallback(() => {
    setShowRefine(true);
    setShowPortfolio(false);
    // Start with a small delay so the panel renders first
    setTimeout(() => handleStartRefine(3), 100);
  }, [handleStartRefine]);

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

    // Pipeline: debate done
    setPipelineStages(prev => prev?.map(s =>
      s.id === 'debate' ? { ...s, status: 'done', detail: 'Consensus reached' } :
      s.id === 'refine' && s.status === 'pending' ? { ...s, status: 'active', detail: 'Starting refinement...' } :
      s.id === 'portfolio' && s.status === 'pending' && !autoRefineOnGen ? { ...s, status: 'active', detail: 'Starting portfolio...' } :
      s
    ));

    // Post-debate automation: auto-trigger refine and/or portfolio after consensus
    if (autoRefineOnGen && !refine$.isRefining) {
      setShowRefine(true);
      // Small delay so panel mounts before starting
      setTimeout(() => {
        refine$.handleStartRefine(ideaText, displayMode, 3, (progress) => {
          // Update pipeline overlay with refine progress
          if (progress.status === 'critiquing' || progress.status === 'strengthening' || progress.status === 'scoring') {
            setPipelineStages(prev => prev?.map(s =>
              s.id === 'refine' ? {
                ...s, status: 'active',
                detail: progress.detail || progress.status,
                round: progress.round, maxRounds: progress.maxRounds,
                substages: [
                  { label: 'Research', status: progress.detail?.includes('research') || progress.detail?.includes('Research') ? 'active' : progress.status === 'critiquing' ? 'pending' : 'done' },
                  { label: 'Lenses', status: progress.detail?.includes('lens') || progress.detail?.includes('Lens') ? 'active' : progress.status === 'critiquing' ? 'pending' : 'done' },
                  { label: 'Critique', status: progress.status === 'critiquing' ? 'active' : progress.status === 'strengthening' || progress.status === 'scoring' ? 'done' : 'pending' },
                  { label: 'Strengthen', status: progress.status === 'strengthening' ? 'active' : progress.status === 'scoring' ? 'done' : 'pending' },
                  { label: 'Score', status: progress.status === 'scoring' ? 'active' : 'pending' },
                ],
                progress: progress.status === 'critiquing' ? 20 : progress.status === 'strengthening' ? 55 : 85,
              } : s
            ));
          } else if (progress.status === 'round_complete') {
            setPipelineStages(prev => prev?.map(s =>
              s.id === 'refine' ? {
                ...s,
                detail: `Round ${progress.round}/${progress.maxRounds} — ${progress.oldScore?.toFixed?.(1)} → ${progress.newScore?.toFixed?.(1)}`,
                progress: Math.round((progress.round / progress.maxRounds) * 100),
              } : s
            ));
          } else if (progress.status === 'complete' || progress.status === 'done') {
            setPipelineStages(prev => prev?.map(s =>
              s.id === 'refine' ? { ...s, status: 'done', detail: 'Refinement complete', substages: null, progress: null } :
              s.id === 'portfolio' && s.status === 'pending' ? { ...s, status: 'active', detail: 'Generating alternatives...' } :
              s
            ));
          }
        });
      }, 500);
    }
    if (autoPortfolioOnGen) {
      setShowPortfolio(true);
      setPortfolioAutoGen(true);
    }
  }, [idea, idea$, autoRefineOnGen, autoPortfolioOnGen, refine$, displayMode, resumeJobLabel]);

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
    // Debate: open debate panel and auto-start critique
    if (actions.debate) {
      applyScope(actions.debate);
      setShowDebate(true);
      setDebateAutoStart(true);
      pushCard('debate', 'Debate Started', 'Auto-critique is analyzing your tree...', [
        { label: 'Open Panel', actionType: 'openPanel', panel: 'debate' },
      ]);
    }
    // Refine: run inline in chat
    if (actions.refine) {
      applyScope(actions.refine);
      setRefineStream({ status: 'critiquing', round: 1, maxRounds: 3 });
      setShowChat(true);
      const refineHistory = [];
      handleStartRefine(3, (progress) => {
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
      let focus = null;
      if (actionVal && typeof actionVal === 'object' && actionVal !== true) {
        const scopedNodes = getScopedNodes(actionVal);
        const nodeSummaries = scopedNodes.slice(0, 20).map(n => {
          const d = n.data || n;
          return `[${d.type}] ${d.label}: ${(d.reasoning || '').slice(0, 100)}`;
        });
        focus = { types: actionVal.types || null, nodeIds: actionVal.nodeIds || null, nodeSummaries };
        setPortfolioFocus(focus);
      } else {
        setPortfolioFocus(null);
      }
      setPortfolioStream({ status: 'generating', stageDetail: 'Starting...', alternatives: [], scores: [] });
      setShowChat(true);
      // Use the portfolio panel's generate flow via auto-gen
      setShowPortfolio(true);
      setPortfolioAutoGen(true);
    }
    // Portfolio more: generate more alternatives
    if (actions.portfolioMore) {
      setPortfolioStream({ status: 'generating', stageDetail: 'Generating more alternatives...', alternatives: [], scores: [] });
      setShowChat(true);
      setShowPortfolio(true);
      setPortfolioAutoGen(true);
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
  }, [active, handleStartRefine, handleGoDeeper, handleStartAutoFractal, ideaText, triggerScoring, setManualMode, setIdea]);

  const handleClearChatFilter = useCallback(() => setChatFilter(null), []);

  const handleCardButtonClick = useCallback((btn) => {
    if (btn.actionType === 'openPanel') {
      if (btn.panel === 'debate') setShowDebate(true);
      else if (btn.panel === 'refine') setShowRefine(true);
      else if (btn.panel === 'portfolio') setShowPortfolio(true);
      else if (btn.panel === 'fractalExpand') setShowAutoFractal(true);
    } else if (btn.actionType === 'stopExecution') {
      if (executionAbortRef.current) {
        executionAbortRef.current.abort();
        executionAbortRef.current = null;
      }
      authFetch(`${API_URL}/api/stop-execution`, { method: 'POST' }).catch(() => {});
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
      const alt = portfolioData.alternatives?.find(a => a.index === btn.altIndex);
      if (alt) {
        const flowNodes = alt.nodes.map(n => {
          const flowNode = buildFlowNode(n);
          if (alt.meta) flowNode.data.dynamicConfig = alt.meta;
          return flowNode;
        });
        active.rawNodesRef.current = flowNodes;
        active.applyLayout(active.rawNodesRef.current, active.drillStackRef?.current);
        active.setNodeCount?.(active.rawNodesRef.current.length);
      }
    } else if (btn.actionType === 'exploreAndRefine') {
      // Explore then start refine
      const alt = portfolioData.alternatives?.find(a => a.index === btn.altIndex);
      if (alt) {
        const flowNodes = alt.nodes.map(n => {
          const flowNode = buildFlowNode(n);
          if (alt.meta) flowNode.data.dynamicConfig = alt.meta;
          return flowNode;
        });
        active.rawNodesRef.current = flowNodes;
        active.applyLayout(active.rawNodesRef.current, active.drillStackRef?.current);
        active.setNodeCount?.(active.rawNodesRef.current.length);
        // Auto-start refine
        setRefineStream({ status: 'critiquing', round: 1, maxRounds: 3 });
        const refineHistory = [];
        handleStartRefine(3, (progress) => {
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
    } else if (btn.actionType === 'generateMore') {
      setShowPortfolio(true);
      setPortfolioAutoGen(true);
    }
  }, [handleStopRefine, handleGoDeeper, handleStartRefine, active, portfolioData]);

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
              // Append Claude Code text output
              streamAccum += evt.text;
              setExecutionStream(prev => prev ? { ...prev, text: streamAccum } : prev);
            } else if (evt._progress) {
              // Append progress marker
              streamAccum += `\n── ${evt.stage} ──\n`;
              setExecutionStream(prev => prev ? { ...prev, text: streamAccum } : prev);
            } else if (evt._result) {
              // Mark node as completed
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
        // Fractal callbacks
        onFractalExpand: active.handleFractalExpand,
        onToggleCollapse: active.handleToggleCollapse,
      },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [active.nodes, selectedNodeId, is3D, isolatedRound, roundRange, treeSearchTrim, chatFilterActive, chatFilter, childCountMap]);

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
                className={`btn btn-icon btn-debate-icon ${showDebate ? 'active-icon' : ''}`}
                onClick={() => setShowDebate((v) => !v)}
                title={(DEBATE_LABELS[displayMode] || DEBATE_LABELS.idea).tooltip}
              >
                {(DEBATE_LABELS[displayMode] || DEBATE_LABELS.idea).icon} {(DEBATE_LABELS[displayMode] || DEBATE_LABELS.idea).label}
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
                className={`btn btn-icon ${showRefine ? 'active-icon' : ''}`}
                onClick={() => setShowRefine((v) => !v)}
                title="Auto-refine — recursive critique and strengthen loop"
              >
                ⟲ REFINE
              </button>
              <button
                className={`btn btn-icon ${showPortfolio ? 'active-icon' : ''}`}
                onClick={() => setShowPortfolio((v) => !v)}
                title="Generate and compare alternative approaches"
              >
                ◈ PORTFOLIO
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

      {/* ── Canvas area ── */}
      <main className="canvas-area" style={{ marginRight: panelOpen ? '300px' : '0', transition: 'margin-right 0.25s ease' }}>

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
              <IdeaEmptyState onMemoryClick={memorySessionCount >= 2 ? () => setShowMemory(true) : null} mode={displayMode} />
            </>
          ) : viewMode === '3d' ? (
            <Graph3D
              nodes={idea$.rawNodesRef.current}
              onNodeClick={(node3d) => {
                const raw = idea$.rawNodesRef.current.find(n => n.id === node3d.id);
                if (raw) idea$.handleNodeClick({ id: raw.id, data: raw.data || raw });
              }}
            />
          ) : viewMode === 'flowchart' ? (
            <ReactFlowProvider>
              <FlowchartView
                displayNodes={displayNodes}
                onNodeClick={idea$.handleNodeClick}
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
                onNodeClick={idea$.handleNodeClick}
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

      {/* ── Bottom input bar ── */}
      <footer className="bottom-bar" style={{ marginRight: panelOpen ? '300px' : '0', transition: 'margin-right 0.25s ease' }}>
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
                    <div className="gen-auto-options">
                      <label className="gen-auto-check" title="Auto-run refinement loop after generation">
                        <input type="checkbox" checked={autoRefineOnGen} onChange={e => setAutoRefineOnGen(e.target.checked)} />
                        <span>⟲ Refine</span>
                      </label>
                      <label className="gen-auto-check" title="Auto-generate alternative approaches after generation">
                        <input type="checkbox" checked={autoPortfolioOnGen} onChange={e => setAutoPortfolioOnGen(e.target.checked)} />
                        <span>◈ Portfolio</span>
                      </label>
                    </div>
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

      <NodeEditPanel
        node={active.selectedNode}
        onClose={() => active.setSelectedNode(null)}
        onSave={active.handleSaveNodeEdit}
        onRegenerate={active.handleRegenerate}
        isDisabled={isBusy}
        onGetAncestors={active.handleGetAncestors}
        allowRegenerate={true}
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
          onExecuteAction={handleExecuteAction}
          mode={activeMode}
          hasProjectPath={!!cbProjectPath}
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
        isOpen={showDebate}
        onClose={() => { setShowDebate(false); setDebateAutoStart(false); }}
        nodes={active.rawNodesRef.current}
        idea={ideaText}
        mode={displayMode}
        onNodesAdded={handleDebateNodesAdded}
        onNodeUpdate={handleDebateNodeUpdate}
        autoStart={debateAutoStart}
        debateRoundsRef={debateRoundsRef}
        onApplyToResume={displayMode === 'resume' ? handleApplyToResume : undefined}
        onConsensusReached={handleConsensusReached}
        onSuggestionExpand={handleSuggestionExpand}
      />

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
        emailContext={emailContext}
      />

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

      {/* ── Auto-Refine Panel ── */}
      {showRefine && (
        <RefinePanel
          mode={displayMode}
          isRefining={refine$.isRefining}
          refineProgress={refine$.refineProgress}
          refineHistory={refine$.refineHistory}
          onStart={handleStartRefine}
          onStop={handleStopRefine}
          onGoDeeper={handleGoDeeper}
          onClose={() => setShowRefine(false)}
          nodeCount={active.rawNodesRef.current.length}
        />
      )}

      {/* ── Portfolio Panel ── */}
      {showPortfolio && (
        <PortfolioPanel
          idea={ideaText}
          mode={displayMode}
          focus={portfolioFocus}
          onClose={() => { setShowPortfolio(false); setPortfolioFocus(null); }}
          portfolioData={portfolioData}
          onPortfolioDataChange={setPortfolioData}
          rawNodesRef={active.rawNodesRef}
          applyLayout={active.applyLayout}
          drillStackRef={active.drillStackRef}
          setNodeCount={active.setNodeCount}
          yjsSyncRef={yjsSyncRef}
          onStartRefine={handleOpenAndStartRefine}
          autoGenerate={portfolioAutoGen}
          onAutoGenDone={() => {
            setPortfolioAutoGen(false);
            // Freeze portfolio data into chat card and clear stream
            if (portfolioStream) {
              setPendingChatCards(prev => [...prev, {
                type: 'portfolio_card',
                state: {
                  status: 'done',
                  alternatives: portfolioData.alternatives,
                  scores: portfolioData.scores || [],
                  recommendation: portfolioData.recommendation || '',
                },
              }]);
              setPortfolioStream(null);
            }
          }}
          onPipelineUpdate={(stage) => {
            setPipelineStages(prev => prev?.map(s =>
              s.id === 'portfolio' ? { ...s, ...stage } : s
            ));
            // Also update live portfolio stream if active
            if (portfolioStream || stage.status === 'active') {
              setPortfolioStream(prev => ({
                ...(prev || {}),
                status: stage.status === 'done' ? 'done' : 'generating',
                stageDetail: stage.detail || '',
                alternatives: portfolioData.alternatives || [],
                scores: portfolioData.scores || [],
                recommendation: portfolioData.recommendation || '',
              }));
            }
          }}
        />
      )}

      {/* ── Pipeline Activity Overlay ── */}
      {pipelineStages && (
        <PipelineOverlay
          stages={pipelineStages}
          onClose={() => setPipelineStages(null)}
        />
      )}

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
