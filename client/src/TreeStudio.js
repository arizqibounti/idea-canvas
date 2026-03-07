// ── TreeStudio ─────────────────────────────────────────────
// Remotion-inspired scene-based editor for ThoughtClaw trees.
// 3-panel layout: Scene List | Live Preview | Properties
// with a visual block timeline and playback engine.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import IdeaCanvas from './IdeaCanvas';
import { getNodeConfig } from './nodeConfig';
import { MODES } from './modeConfig';

// ── Constants ────────────────────────────────────────────
const ROUND_LABELS = {
  0: 'SEED', 1: 'GENERATING IDEAS', 2: 'R1 CRITIQUE', 3: 'R1 REBUTTAL',
  4: 'R2 CRITIQUE', 5: 'R2 REBUTTAL', 6: 'R3 CRITIQUE', 7: 'R3 REBUTTAL',
  8: 'R4 CRITIQUE', 9: 'R4 REBUTTAL', 10: 'R5 CRITIQUE', 11: 'R5 REBUTTAL',
  12: 'SYNTHESIS',
};

const SCENE_TYPES = {
  intro: { icon: '◈', label: 'INTRO', color: '#6c63ff' },
  build: { icon: '▶', label: 'BUILD', color: '#22c55e' },
  focus: { icon: '✦', label: 'FOCUS', color: '#a855f7' },
  outro: { icon: '◉', label: 'OUTRO', color: '#facc15' },
};

const TRANSITIONS = {
  gentle: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)',
  snappy: 'cubic-bezier(0.36, 0.66, 0.04, 1.0)',
  bouncy: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
  smooth: 'cubic-bezier(0.4, 0.0, 0.2, 1.0)',
};

// ── Key node selection (ported from CinematicController) ─
function selectKeyNodes(nodes, getRoundIndex) {
  if (!nodes || nodes.length === 0) return [];
  const seed = nodes.find(n => getRoundIndex(n) === 0);
  const synthesis = nodes.find(n => getRoundIndex(n) === 12);
  const withScores = nodes.filter(n => n.data?.score != null);
  const ranked = withScores.length > 0
    ? [...withScores].sort((a, b) => (b.data.score || 0) - (a.data.score || 0))
    : nodes.filter(n => getRoundIndex(n) !== 0 && getRoundIndex(n) !== 12);
  const topRanked = ranked.slice(0, 3);
  const coveredTypes = new Set(
    [seed, synthesis, ...topRanked].filter(Boolean).map(n => n.data?.type)
  );
  const typeVariety = [];
  const pool = withScores.length > 0 ? ranked : nodes;
  for (const n of pool) {
    if (!coveredTypes.has(n.data?.type)) {
      typeVariety.push(n);
      coveredTypes.add(n.data?.type);
      if (typeVariety.length >= 2) break;
    }
  }
  const all = [
    ...new Map(
      [seed, ...topRanked, ...typeVariety, synthesis]
        .filter(Boolean)
        .map(n => [n.id, n])
    ).values(),
  ];
  return all.sort((a, b) => (a.data?.depth || 0) - (b.data?.depth || 0));
}

// ── Scene generation from tree data ──────────────────────
function generateScenes(nodes, getRoundIndex, sessionName, modeId) {
  if (!nodes || nodes.length === 0) return [];
  const scenes = [];
  let idCounter = 0;
  const nextId = () => `scene_${idCounter++}`;

  const modeConfig = MODES.find(m => m.id === modeId) || MODES[0];

  // 1. Intro
  scenes.push({
    id: nextId(), type: 'intro',
    label: sessionName || 'Untitled Session',
    duration: 3000, zoom: 0.5, nodeIds: [],
    overlayText: `${modeConfig.icon} ${modeConfig.label} MODE  |  ${nodes.length} NODES`,
    transition: 'gentle', _round: null, _focusNodeId: null,
  });

  // 2. Build scenes — one per distinct round
  const roundSet = new Set(nodes.map(n => getRoundIndex(n)));
  const presentRounds = Array.from(roundSet).sort((a, b) => a - b);
  for (const round of presentRounds) {
    const roundNodes = nodes.filter(n => getRoundIndex(n) === round);
    scenes.push({
      id: nextId(), type: 'build',
      label: ROUND_LABELS[round] || `ROUND ${round}`,
      duration: round === 0 ? 2500 : round === 1 ? 3000 : round === 12 ? 3000 : 2000,
      zoom: 0.7, nodeIds: roundNodes.map(n => n.id),
      overlayText: '', transition: 'smooth',
      _round: round, _cumulativeMax: round, _focusNodeId: null,
    });
  }

  // 3. Focus scenes — key nodes
  const keyNodes = selectKeyNodes(nodes, getRoundIndex);
  for (const node of keyNodes) {
    const type = node.data?.type || 'insight';
    const cfg = getNodeConfig(type, node.data?.dynamicConfig);
    const textLen = ((node.data?.label || '') + (node.data?.reasoning || '')).length;
    scenes.push({
      id: nextId(), type: 'focus',
      label: `${cfg.icon} ${cfg.label}: ${(node.data?.label || '').slice(0, 40)}`,
      duration: Math.max(3000, Math.round((textLen / 80) * 1000)),
      zoom: 0.85, nodeIds: [node.id],
      overlayText: node.data?.label || '', transition: 'snappy',
      _round: null, _focusNodeId: node.id,
    });
  }

  // 4. Outro
  const typeDistribution = {};
  nodes.forEach(n => {
    const t = n.data?.type || 'unknown';
    typeDistribution[t] = (typeDistribution[t] || 0) + 1;
  });
  const topType = Object.entries(typeDistribution).sort((a, b) => b[1] - a[1])[0];
  const scored = nodes.filter(n => n.data?.score != null);
  const topScore = scored.length > 0
    ? Math.max(...scored.map(n => n.data.score)).toFixed(1) : null;

  scenes.push({
    id: nextId(), type: 'outro', label: 'SUMMARY',
    duration: 4000, zoom: 0.4, nodeIds: [],
    overlayText: [
      `${nodes.length} NODES`,
      topScore ? `TOP SCORE: ${topScore}` : null,
      topType ? `MOST COMMON: ${topType[0].toUpperCase()} (${topType[1]})` : null,
    ].filter(Boolean).join('  |  '),
    transition: 'gentle', _round: null, _focusNodeId: null,
  });

  return scenes;
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// ── TreeStudio Component ─────────────────────────────────
export default function TreeStudio({
  nodes, displayNodes, displayEdges,
  maxRound, setRoundRange, setIsolatedRound,
  onExit, getRoundIndex, sessionName, modeId,
  onNodeClick, onNodeDoubleClick, onNodeContextMenu, onCloseContextMenu,
  drillStack, onExitDrill, onJumpToBreadcrumb, onReactFlowReady,
}) {
  const { fitView, setCenter, getNodes } = useReactFlow();

  // ── State ────────────────────────────────────────────
  const [scenes, setScenes] = useState([]);
  const [selectedSceneId, setSelectedSceneId] = useState(null);
  const [activeSceneId, setActiveSceneId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);

  const startTimeRef = useRef(null);
  const rafRef = useRef(null);
  const speedRef = useRef(1);
  const playingRef = useRef(false);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  // ── Derived ──────────────────────────────────────────
  const selectedScene = useMemo(() => scenes.find(s => s.id === selectedSceneId) || null, [scenes, selectedSceneId]);
  const activeScene = useMemo(() => scenes.find(s => s.id === activeSceneId) || null, [scenes, activeSceneId]);
  const activeSceneIndex = useMemo(() => scenes.findIndex(s => s.id === activeSceneId), [scenes, activeSceneId]);
  const totalDuration = useMemo(() => scenes.reduce((sum, s) => sum + s.duration, 0), [scenes]);
  const sceneStartTimes = useMemo(() => {
    let t = 0;
    return scenes.map(s => { const start = t; t += s.duration; return start; });
  }, [scenes]);

  // ── Initialize scenes from tree data ─────────────────
  useEffect(() => {
    const initial = generateScenes(nodes, getRoundIndex, sessionName, modeId);
    setScenes(initial);
    if (initial.length > 0) {
      setSelectedSceneId(initial[0].id);
      setActiveSceneId(initial[0].id);
    }
    setIsolatedRound(null);
    setRoundRange([0, maxRound]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply scene to canvas (camera + round visibility) ─
  const applyScene = useCallback((scene) => {
    if (!scene) return;
    if (scene.type === 'build') {
      setRoundRange([0, scene._cumulativeMax]);
      setTimeout(() => {
        try {
          const visible = getNodes().filter(n => n.data?.isInRange !== false);
          if (visible.length > 0) {
            fitView({ nodes: visible, padding: 0.3, duration: 800, maxZoom: scene.zoom });
          }
        } catch { /* ignore */ }
      }, 150);
    } else if (scene.type === 'focus') {
      setRoundRange([0, maxRound]);
      setTimeout(() => {
        try {
          const rfNodes = getNodes();
          const target = rfNodes.find(n => n.id === scene._focusNodeId);
          if (target) {
            setCenter(target.position.x + 130, target.position.y + 50, { zoom: scene.zoom, duration: 1000 });
          }
        } catch { /* ignore */ }
      }, 100);
    } else {
      // intro / outro — show all, fit view
      setRoundRange([0, maxRound]);
      setTimeout(() => {
        fitView({ padding: 0.4, duration: 800, maxZoom: scene.zoom });
      }, 100);
    }
  }, [maxRound, setRoundRange, fitView, setCenter, getNodes]);

  // ── Apply scene when activeSceneId changes ────────────
  useEffect(() => {
    if (activeScene) applyScene(activeScene);
  }, [activeSceneId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Playback engine (rAF loop) ────────────────────────
  useEffect(() => {
    if (!playing || !activeScene) return;
    startTimeRef.current = performance.now() - (elapsed / speedRef.current);

    const tick = () => {
      const now = performance.now();
      const e = (now - startTimeRef.current) * speedRef.current;
      if (e >= activeScene.duration) {
        const nextIdx = activeSceneIndex + 1;
        if (nextIdx >= scenes.length) {
          setPlaying(false);
          setElapsed(activeScene.duration);
          return;
        }
        const nextScene = scenes[nextIdx];
        setActiveSceneId(nextScene.id);
        setSelectedSceneId(nextScene.id);
        setElapsed(0);
        startTimeRef.current = performance.now();
      } else {
        setElapsed(e);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, activeSceneId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ─────────────────────────────────────────
  const updateScene = useCallback((sceneId, updates) => {
    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, ...updates } : s));
  }, []);

  const handlePlayPause = useCallback(() => {
    setPlaying(p => {
      if (!p && activeSceneIndex >= scenes.length - 1 && elapsed >= (activeScene?.duration || 0)) {
        // Restart from beginning
        if (scenes.length > 0) {
          setActiveSceneId(scenes[0].id);
          setSelectedSceneId(scenes[0].id);
          setElapsed(0);
        }
        return true;
      }
      return !p;
    });
  }, [activeSceneIndex, scenes, elapsed, activeScene]);

  const handleSceneClick = useCallback((sceneId) => {
    setSelectedSceneId(sceneId);
    if (!playing) {
      setActiveSceneId(sceneId);
      setElapsed(0);
    }
  }, [playing]);

  const handleTimelineBlockClick = useCallback((e, sceneId) => {
    e.stopPropagation();
    setPlaying(false);
    setActiveSceneId(sceneId);
    setSelectedSceneId(sceneId);
    setElapsed(0);
  }, []);

  // ── Progress calc ────────────────────────────────────
  const progressPct = totalDuration > 0
    ? ((sceneStartTimes[activeSceneIndex] || 0) + elapsed) / totalDuration * 100
    : 0;

  // ── Focus node data for overlay ──────────────────────
  const focusNode = activeScene?.type === 'focus'
    ? nodes.find(n => n.id === activeScene._focusNodeId) : null;
  const focusCfg = focusNode
    ? getNodeConfig(focusNode.data?.type, focusNode.data?.dynamicConfig) : null;

  // ── Render ───────────────────────────────────────────
  return (
    <div className="studio-layout">
      {/* LEFT: Scene List */}
      <aside className="studio-scene-list">
        <div className="studio-panel-header">
          <span>SCENES</span>
          <span className="studio-scene-count">{scenes.length}</span>
        </div>
        <div className="studio-scene-items">
          {scenes.map((scene, i) => {
            const stCfg = SCENE_TYPES[scene.type];
            const isActive = scene.id === activeSceneId;
            const isSelected = scene.id === selectedSceneId;
            return (
              <div
                key={scene.id}
                className={`studio-scene-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
                onClick={() => handleSceneClick(scene.id)}
              >
                <span className="studio-scene-icon" style={{ color: stCfg.color }}>{stCfg.icon}</span>
                <div className="studio-scene-info">
                  <div className="studio-scene-name">{scene.label}</div>
                  <div className="studio-scene-meta">
                    {stCfg.label} | {(scene.duration / 1000).toFixed(1)}s
                  </div>
                </div>
                <span className="studio-scene-num">{i + 1}</span>
              </div>
            );
          })}
        </div>
      </aside>

      {/* CENTER: Preview */}
      <div className="studio-preview-area">
        <div className="studio-preview-canvas">
          <IdeaCanvas
            nodes={displayNodes}
            edges={displayEdges}
            isGenerating={false}
            isScoring={false}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeContextMenu={onNodeContextMenu}
            onCloseContextMenu={onCloseContextMenu}
            drillStack={drillStack}
            onExitDrill={onExitDrill}
            onJumpToBreadcrumb={onJumpToBreadcrumb}
            onReactFlowReady={onReactFlowReady}
            isCinematic={true}
          />

          {/* Overlay: Intro */}
          {activeScene?.type === 'intro' && (
            <div className="studio-overlay studio-overlay-intro" key={`ov-${activeSceneId}`}>
              <div className="studio-overlay-title">{activeScene.label}</div>
              <div className="studio-overlay-sub">{activeScene.overlayText}</div>
            </div>
          )}

          {/* Overlay: Build chapter */}
          {activeScene?.type === 'build' && (
            <div className="studio-overlay studio-overlay-build" key={`ov-${activeSceneId}`}>
              <div className="studio-overlay-chapter">{activeScene.label}</div>
              <div className="studio-overlay-sub">{activeScene.nodeIds.length} nodes</div>
            </div>
          )}

          {/* Overlay: Focus narration */}
          {activeScene?.type === 'focus' && focusNode && focusCfg && (
            <div className="studio-overlay studio-overlay-focus" key={`ov-${activeSceneId}`}>
              <div className="studio-narration-header">
                <span className="studio-narration-badge"
                  style={{ color: focusCfg.color, background: focusCfg.bg, borderColor: focusCfg.border }}>
                  {focusCfg.icon} {focusCfg.label}
                </span>
                {focusNode.data?.score != null && (
                  <span className="studio-narration-score">
                    {typeof focusNode.data.score === 'number' ? focusNode.data.score.toFixed(1) : focusNode.data.score}
                  </span>
                )}
              </div>
              <div className="studio-narration-label">{focusNode.data?.label || ''}</div>
              {focusNode.data?.reasoning && (
                <div className="studio-narration-reasoning">{focusNode.data.reasoning}</div>
              )}
            </div>
          )}

          {/* Overlay: Outro */}
          {activeScene?.type === 'outro' && (
            <div className="studio-overlay studio-overlay-outro" key={`ov-${activeSceneId}`}>
              <div className="studio-overlay-title">COMPLETE</div>
              <div className="studio-overlay-stats">{activeScene.overlayText}</div>
            </div>
          )}
        </div>

        {/* BOTTOM: Timeline */}
        <div className="studio-timeline">
          <div className="studio-timeline-controls">
            <button className="studio-btn" onClick={handlePlayPause} title={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <select className="studio-speed" value={speed}
              onChange={e => setSpeed(Number(e.target.value))}>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
          </div>

          <div className="studio-timeline-track">
            {scenes.map((scene) => {
              const widthPct = totalDuration > 0 ? (scene.duration / totalDuration) * 100 : 0;
              const isActive = scene.id === activeSceneId;
              const stCfg = SCENE_TYPES[scene.type];
              return (
                <div
                  key={scene.id}
                  className={`studio-timeline-block${isActive ? ' active' : ''}`}
                  style={{ width: `${widthPct}%`, borderLeftColor: stCfg.color }}
                  onClick={(e) => handleTimelineBlockClick(e, scene.id)}
                  title={scene.label}
                >
                  <span className="studio-timeline-block-label">{stCfg.icon}</span>
                </div>
              );
            })}
            <div className="studio-timeline-playhead" style={{ left: `${Math.min(progressPct, 100)}%` }} />
          </div>

          <span className="studio-timeline-time">
            {formatTime((sceneStartTimes[activeSceneIndex] || 0) + elapsed)} / {formatTime(totalDuration)}
          </span>

          <button className="studio-exit" onClick={onExit}>BACK</button>
        </div>
      </div>

      {/* RIGHT: Properties */}
      {selectedScene && (
        <aside className="studio-properties">
          <div className="studio-panel-header">
            <span>PROPERTIES</span>
          </div>
          <div className="studio-props-body">
            <div className="studio-prop-group">
              <label className="studio-prop-label">TYPE</label>
              <div className="studio-prop-badge" style={{ color: SCENE_TYPES[selectedScene.type].color }}>
                {SCENE_TYPES[selectedScene.type].icon} {SCENE_TYPES[selectedScene.type].label}
              </div>
            </div>

            <div className="studio-prop-group">
              <label className="studio-prop-label">
                DURATION <span className="studio-prop-value">{(selectedScene.duration / 1000).toFixed(1)}s</span>
              </label>
              <input type="range" className="studio-prop-slider"
                min={1000} max={10000} step={500}
                value={selectedScene.duration}
                onChange={e => updateScene(selectedScene.id, { duration: Number(e.target.value) })}
              />
            </div>

            <div className="studio-prop-group">
              <label className="studio-prop-label">
                ZOOM <span className="studio-prop-value">{selectedScene.zoom.toFixed(2)}×</span>
              </label>
              <input type="range" className="studio-prop-slider"
                min={0.1} max={1.5} step={0.05}
                value={selectedScene.zoom}
                onChange={e => updateScene(selectedScene.id, { zoom: Number(e.target.value) })}
              />
            </div>

            <div className="studio-prop-group">
              <label className="studio-prop-label">TRANSITION</label>
              <select className="studio-prop-select"
                value={selectedScene.transition}
                onChange={e => updateScene(selectedScene.id, { transition: e.target.value })}>
                {Object.keys(TRANSITIONS).map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>

            {(selectedScene.type === 'intro' || selectedScene.type === 'outro') && (
              <div className="studio-prop-group">
                <label className="studio-prop-label">OVERLAY TEXT</label>
                <textarea className="studio-prop-textarea"
                  value={selectedScene.overlayText}
                  onChange={e => updateScene(selectedScene.id, { overlayText: e.target.value })}
                  rows={3}
                />
              </div>
            )}

            <div className="studio-prop-group">
              <label className="studio-prop-label">LABEL</label>
              <input type="text" className="studio-prop-input"
                value={selectedScene.label}
                onChange={e => updateScene(selectedScene.id, { label: e.target.value })}
              />
            </div>

            <div className="studio-prop-group">
              <label className="studio-prop-label">NODES IN SCENE</label>
              <div className="studio-prop-value-static">{selectedScene.nodeIds.length}</div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
