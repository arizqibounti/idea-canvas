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
import ChatPanel from './ChatPanel';
import ResumeChangesModal from './ResumeChangesModal';
import ExportGitHubModal from './ExportGitHubModal';
import Graph3D from './Graph3D';
import CinematicController from './CinematicController';
import { NODE_TYPES_CONFIG, buildDynamicConfig, getNodeConfig } from './nodeConfig';
import { MODES, detectMode } from './modeConfig';
import { useCanvasMode, buildFlowNode, readSSEStream, appendVersion, readVersions } from './useCanvasMode';
import { readTemplates, saveTemplate } from './TemplateStore';
import { useGateway } from './gateway/useGateway';
import CanvasPanel from './CanvasPanel';
import ExportDropdown from './ExportDropdown';
import { exportToPng, exportToSvg, copyToClipboard, downloadDataUrl, downloadSvg, generateInteractiveHtml, downloadHtml } from './exportImage';
import ShareModal from './ShareModal';
import ShareViewer from './ShareViewer';
import { useAuth } from './AuthContext';
import { setTokenGetter, authFetch } from './api';
import LandingPage from './LandingPage';
import SessionDashboard from './SessionDashboard';
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
  idea:     { icon: '⚔', label: 'CRITIQUE',  tooltip: 'VC critique of your idea' },
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

// ── Route wrapper: /share/:id → ShareViewer, landing page if not logged in, else → main app ──
function AppRouter() {
  const { user, loading, logout, isConfigured } = useAuth();
  const [activeSession, setActiveSession] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);

  // Check access on first authenticated API call
  useEffect(() => {
    if (!user || !isConfigured) return;
    // Ping health-like endpoint to check if user is allowed
    authFetch(`${API_URL}/api/usage`)
      .then(res => {
        if (res.status === 403) setAccessDenied(true);
      })
      .catch(() => { /* ignore network errors */ });
  }, [user, isConfigured]);

  // Share links require auth
  const shareMatch = window.location.pathname.match(/^\/share\/([a-zA-Z0-9_-]+)$/);
  if (shareMatch) {
    if (loading) return <LoadingScreen />;
    if (isConfigured && !user) return <LandingPage shareId={shareMatch[1]} />;
    if (accessDenied) return <AccessDenied email={user?.email} onLogout={logout} />;
    return <ShareViewer shareId={shareMatch[1]} />;
  }

  // Room links — collaborative sessions via Yjs
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

  // Authenticated (or auth not configured = local dev)
  // Show dashboard unless a session is active
  if (!activeSession) {
    return (
      <SessionDashboard
        onOpenSession={(session) => setActiveSession(session)}
        onNewSession={() => setActiveSession({ isNew: true })}
      />
    );
  }

  return (
    <App
      initialSession={activeSession}
      onBackToDashboard={() => setActiveSession(null)}
    />
  );
}

export { AppRouter };
export default function App({ initialSession, onBackToDashboard }) {
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

  // ── Auth ────────────────────────────────────────────────
  const { user: authUser, getToken, logout: authLogout } = useAuth();

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

  // ── Export & Share ───────────────────────────────────────────
  const [showExportModal, setShowExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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

  const handleExport = useCallback(async (key) => {
    if (key === 'github') {
      setShowExportModal(true);
      return;
    }
    const rfInstance = reactFlowRef.current;
    if (!rfInstance) return;
    setIsExporting(true);
    try {
      switch (key) {
        case 'png': {
          const dataUrl = await exportToPng(rfInstance);
          downloadDataUrl(dataUrl, `thoughtclaw-${Date.now()}.png`);
          break;
        }
        case 'svg': {
          const svgStr = await exportToSvg(rfInstance);
          downloadSvg(svgStr, `thoughtclaw-${Date.now()}.svg`);
          break;
        }
        case 'clipboard': {
          await copyToClipboard(rfInstance);
          setToastMsg('Copied to clipboard!');
          setTimeout(() => setToastMsg(''), 2200);
          break;
        }
        case 'html': {
          const rawNodes = idea$.rawNodesRef.current;
          const html = generateInteractiveHtml(rawNodes, idea);
          downloadHtml(html, `thoughtclaw-${Date.now()}.html`);
          break;
        }
        default: break;
      }
    } catch (err) {
      console.error('Export failed:', err);
      setToastMsg('Export failed — see console');
      setTimeout(() => setToastMsg(''), 3000);
    }
    setIsExporting(false);
  }, [idea]);

  // ── A2UI Canvas ───────────────────────────────────────────
  const [showCanvas, setShowCanvas] = useState(false);
  const [canvasArtifacts, setCanvasArtifacts] = useState([]);

  // ── Auto-Fractal (∞ EXPLORE) ────────────────────────────
  const [showAutoFractal, setShowAutoFractal] = useState(false);
  const [autoFractalRounds, setAutoFractalRounds] = useState(5);
  const [autoFractalRunning, setAutoFractalRunning] = useState(false);
  const [autoFractalProgress, setAutoFractalProgress] = useState(null);

  // ── View Mode ──────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('tree'); // 'tree' | '3d' | 'storyboard' | 'zen'
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
  const [genMode, setGenMode] = useState('single');
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

  // ── Sync cross-links toggle to canvas mode ref ───────────
  useEffect(() => {
    idea$.showCrossLinksRef.current = showCrossLinks;
    if (idea$.rawNodesRef.current.length > 0) {
      idea$.applyLayout(idea$.rawNodesRef.current, idea$.drillStackRef.current);
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
      idea$.setNodeScores(scores);
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

      const genParams = { idea: idea.trim(), mode: displayMode, fetchedUrlContent, templateGuidance };
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
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
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
  }, [idea, idea$, displayMode, saveVersionAndMemory, triggerScoring, yjs]);

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

      const genParams = { idea: idea.trim(), mode: displayMode, fetchedUrlContent, templateGuidance };
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
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
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
  }, [idea, idea$, displayMode, saveVersionAndMemory, triggerScoring, yjs]);

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

      const genParams = { idea: idea.trim(), mode: displayMode, fetchedUrlContent, templateGuidance };
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
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
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
  }, [idea, idea$, displayMode, saveVersionAndMemory, triggerScoring, yjs]);

  const handleStop = useCallback(() => {
    active.handleStop();
    setRedirectState('idle');
    setIsCritiquing(false);
  }, [active]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      genMode === 'research' ? handleGenerateResearch() : genMode === 'multi' ? handleGenerateMulti() : handleGenerate();
    }
  }, [handleGenerate, handleGenerateMulti, handleGenerateResearch, genMode]);

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
    const ideaText = displayMode === 'resume' ? resumeJobLabel : idea;
    await idea$.handleAutoFractal(ideaText, autoFractalRounds, (progress) => {
      setAutoFractalProgress(progress);
      if (progress.status === 'done') {
        setAutoFractalRunning(false);
      }
    });
    setAutoFractalRunning(false);
  }, [idea$, autoFractalRounds, idea, displayMode, resumeJobLabel]);

  const handleStopAutoFractal = useCallback(() => {
    idea$.handleStopAutoFractal();
    setAutoFractalRunning(false);
  }, [idea$]);

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

  // ── Template extraction: after debate consensus ──────────
  const handleConsensusReached = useCallback(async () => {
    try {
      const rawNodes = idea$.rawNodesRef.current;
      if (!rawNodes?.length) return;
      const res = await authFetch(`${API_URL}/api/extract-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: idea.trim(),
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
  }, [idea, idea$]);

  // ── Suggestion expand: add suggestion node + children to tree ─
  const handleSuggestionExpand = useCallback(async (suggestionText) => {
    const rawNodes = idea$.rawNodesRef.current;
    if (!rawNodes?.length) return;

    const res = await authFetch(`${API_URL}/api/expand-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suggestion: suggestionText,
        idea: displayMode === 'resume' ? resumeJobLabel : idea,
        nodes: rawNodes.map(n => ({
          id: n.id, type: n.data?.type, label: n.data?.label,
          reasoning: n.data?.reasoning, parentId: n.data?.parentId,
        })),
        mode: displayMode,
        dynamicTypes: idea$.dynamicTypesRef?.current || undefined,
      }),
    });
    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const existingDynConfig = rawNodes[0]?.data?.dynamicConfig || null;
    await readSSEStream(res, (nodeData) => {
      const flowNode = buildFlowNode(nodeData);
      if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
      idea$.rawNodesRef.current = [...idea$.rawNodesRef.current, flowNode];
      idea$.applyLayout(idea$.rawNodesRef.current, idea$.drillStackRef.current);
      idea$.setNodeCount(idea$.rawNodesRef.current.length);
    });
  }, [idea, idea$, displayMode, resumeJobLabel]);

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

  // ── Child count map (for badge on parent nodes) ──
  // Use raw nodes (not filtered/visible) so collapsed parents still show correct counts
  const childCountMap = useMemo(() => {
    const map = {};
    const raw = activeMode === 'idea' ? idea$.rawNodesRef.current : cb$.rawNodesRef.current;
    (raw || []).forEach((n) => {
      const pid = n.data?.parentId;
      if (pid) map[pid] = (map[pid] || 0) + 1;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.nodes, activeMode]);

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
        childCount: childCountMap[n.id] || 0,
        // Fractal callbacks
        onFractalExpand: idea$.handleFractalExpand,
        onToggleCollapse: idea$.handleToggleCollapse,
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
          {onBackToDashboard && (
            <button className="btn btn-icon btn-back" onClick={onBackToDashboard} title="Back to dashboard">
              ← BACK
            </button>
          )}
          <span className="logo-mark">◈</span>
          <span className="app-title">THOUGHTCLAW</span>
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
                    <button
                      className={`btn btn-mode-toggle ${genMode !== 'single' ? 'active' : ''} ${genMode === 'research' ? 'research' : ''}`}
                      onClick={() => setGenMode(prev => prev === 'single' ? 'multi' : prev === 'multi' ? 'research' : 'single')}
                      title={genMode === 'single' ? 'Single agent (fast)' : genMode === 'multi' ? 'Multi-agent (3 lenses)' : 'Research agents (deep research + generation)'}
                      style={{ padding: '6px 8px', fontSize: 9, marginRight: 4 }}
                    >
                      {genMode === 'single' ? '◈×1' : genMode === 'multi' ? '◈×3' : '⊛ R'}
                    </button>
                    <button className="btn btn-generate" onClick={genMode === 'research' ? handleGenerateResearch : genMode === 'multi' ? handleGenerateMulti : handleGenerate} disabled={!idea.trim() || idea$.isRegenerating || isFetchingUrl}>
                      {isFetchingUrl ? '◌ FETCHING URL...' : genMode === 'research' ? '▶ RESEARCH & GENERATE' : '▶ GENERATE'}
                    </button>
                    {gateway.connected && <span style={{ fontSize: 8, color: '#51cf66', marginLeft: 4, opacity: 0.7 }} title="WebSocket Gateway connected">⚡WS</span>}
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
          {/* Panels group — debate, chat, canvas */}
          {activeMode === 'idea' && idea$.rawNodesRef.current.length > 0 && (
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
                className={`btn btn-icon btn-canvas-icon ${showCanvas ? 'active-icon' : ''}`}
                onClick={() => setShowCanvas((v) => !v)}
                title="A2UI Canvas — Interactive Visualizations"
              >
                ◈ CANVAS
              </button>
              <button
                className={`btn btn-icon ${showAutoFractal ? 'active-icon' : ''}`}
                onClick={() => setShowAutoFractal((v) => !v)}
                title="Autonomous fractal exploration — AI recursively expands ideas"
              >
                ∞ EXPLORE
              </button>
              <div className="toolbar-sep" />
              <button
                className="btn btn-icon btn-share-icon"
                onClick={() => setShowShareModal(true)}
                title="Share tree via link"
              >
                ⊞ SHARE
              </button>
              {!yjs && (
                <button
                  className="btn btn-icon"
                  onClick={() => {
                    const roomId = generateRoomId();
                    window.location.href = buildRoomUrl(roomId);
                  }}
                  title="Start collaborative room"
                >
                  ◉ COLLAB
                </button>
              )}
              <ExportDropdown onExport={handleExport} isExporting={isExporting} />
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
          {/* View mode toggles — shown when canvas has nodes in idea mode */}
          {activeMode === 'idea' && idea$.rawNodesRef.current.length > 0 && (
            <>
              <button
                className={`btn btn-icon ${viewMode === '3d' ? 'active-icon' : ''}`}
                onClick={() => setViewMode(v => v === '3d' ? 'tree' : '3d')}
                title="Toggle 3D view"
              >
                ◈ 3D
              </button>
              <button
                className={`btn btn-icon ${viewMode === 'cinematic' ? 'active-icon' : ''}`}
                onClick={() => setViewMode(v => v === 'cinematic' ? 'tree' : 'cinematic')}
                title="Cinematic replay"
              >
                ▶ CINEMA
              </button>
            </>
          )}
          {/* Cross-links toggle — only in tree view */}
          {activeMode === 'idea' && idea$.rawNodesRef.current.length > 0 && viewMode === 'tree' && (
            <button
              className={`btn btn-icon ${showCrossLinks ? 'active-icon' : ''}`}
              onClick={() => setShowCrossLinks((v) => !v)}
              title={showCrossLinks ? 'Hide cross-links' : 'Show cross-links'}
            >
              ⇌ LINKS
            </button>
          )}
          {active.savedSessions.length > 0 && (
            <button className="btn btn-icon" onClick={() => active.setShowLoadModal(true)}>▤ LOAD</button>
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
          ) : viewMode === '3d' ? (
            <Graph3D
              nodes={idea$.rawNodesRef.current}
              onNodeClick={(node3d) => {
                const raw = idea$.rawNodesRef.current.find(n => n.id === node3d.id);
                if (raw) idea$.handleNodeClick({ id: raw.id, data: raw.data || raw });
              }}
            />
          ) : viewMode === 'cinematic' ? (
            <ReactFlowProvider>
              <IdeaCanvas
                nodes={displayNodes}
                edges={displayEdges}
                isGenerating={false}
                isScoring={false}
                onNodeClick={idea$.handleNodeClick}
                onNodeDoubleClick={idea$.handleDrill}
                onNodeContextMenu={idea$.handleNodeContextMenu}
                onCloseContextMenu={idea$.handleCloseContextMenu}
                drillStack={idea$.drillStack}
                onExitDrill={idea$.handleExitDrill}
                onJumpToBreadcrumb={idea$.handleJumpToBreadcrumb}
                onReactFlowReady={(instance) => { reactFlowRef.current = instance; }}
                isCinematic={true}
              />
              <CinematicController
                nodes={idea$.rawNodesRef.current}
                maxRound={maxRound}
                roundRange={roundRange}
                setRoundRange={setRoundRange}
                setIsolatedRound={setIsolatedRound}
                onExit={() => { setRoundRange([0, maxRound]); setViewMode('tree'); }}
                getRoundIndex={getRoundIndex}
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
                onCollapseAll={cb$.handleCollapseAll}
                onExpandAll={cb$.handleExpandAll}
                hasCollapsed={displayNodes.some(n => n.data?.isCollapsed)}
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
        onConsensusReached={handleConsensusReached}
        onSuggestionExpand={handleSuggestionExpand}
      />

      {/* ── Chat Companion Panel ── */}
      <ChatPanel
        isOpen={showChat}
        onClose={() => setShowChat(false)}
        nodes={idea$.rawNodesRef.current}
        idea={displayMode === 'resume' ? resumeJobLabel : idea}
        mode={displayMode}
      />

      {/* ── A2UI Canvas Panel ── */}
      {showCanvas && (
        <CanvasPanel
          onClose={() => setShowCanvas(false)}
          artifacts={canvasArtifacts}
          setArtifacts={setCanvasArtifacts}
          nodes={idea$.rawNodesRef.current}
          idea={idea}
          gateway={gateway}
        />
      )}

      {/* ── Auto-Fractal Panel ── */}
      {showAutoFractal && activeMode === 'idea' && (
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
                disabled={idea$.rawNodesRef.current.length === 0}
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
                      : `⊕ Expanding: "${idea$.rawNodesRef.current.find(n => n.id === autoFractalProgress.selectedNodeId)?.data?.label || autoFractalProgress.selectedNodeId}"`
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

      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        nodes={idea$.rawNodesRef.current}
        idea={idea}
      />

      {/* Toast notification */}
      {toastMsg && <div className="export-toast">{toastMsg}</div>}

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
