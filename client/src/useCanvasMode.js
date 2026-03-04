import { useState, useCallback, useRef, useEffect } from 'react';
import { computeLayout, buildEdges, getSubtree } from './layoutUtils';
import { getNodeConfig } from './nodeConfig';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

// ── localStorage helpers ──────────────────────────────────────
function readSessions(storageKey) {
  try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); }
  catch { return []; }
}
function writeSessions(storageKey, sessions) {
  localStorage.setItem(storageKey, JSON.stringify(sessions));
}

// ── Version history helpers ───────────────────────────────────
const VERSIONS_STORAGE_KEY = 'IDEA_GRAPH_VERSIONS';

function readVersionStore() {
  try { return JSON.parse(localStorage.getItem(VERSIONS_STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function writeVersionStore(store) {
  localStorage.setItem(VERSIONS_STORAGE_KEY, JSON.stringify(store));
}

export function appendVersion(ideaKey, rawNodes) {
  if (!ideaKey?.trim() || !rawNodes?.length) return [];
  const store = readVersionStore();
  const key = ideaKey.trim().toLowerCase().slice(0, 60);
  const existing = store[key] || [];
  const newVersion = {
    id: `v_${Date.now()}`,
    label: ideaKey,
    rawNodes,
    timestamp: Date.now(),
    nodeCount: rawNodes.length,
  };
  const updated = [newVersion, ...existing].slice(0, 15);
  store[key] = updated;
  writeVersionStore(store);
  return updated;
}

export function readVersions(ideaKey) {
  if (!ideaKey?.trim()) return [];
  const store = readVersionStore();
  const key = ideaKey.trim().toLowerCase().slice(0, 60);
  return store[key] || [];
}

// ── Node builder ──────────────────────────────────────────────
export function buildFlowNode(raw) {
  return {
    id: raw.id,
    type: 'ideaNode',
    position: { x: 0, y: 0 },
    data: {
      type: raw.type,
      label: raw.label,
      reasoning: raw.reasoning,
      parentId: raw.parentId || null,
      relatedIds: raw.relatedIds || [],
      score: raw.score || null,
      lens: raw.lens || null,
    },
  };
}

// ── Shared SSE reader ─────────────────────────────────────────
export async function readSSEStream(response, onNode) {
  const reader = response.body.getReader();
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
      if (payload === '[DONE]') return { done: true };

      let parsed;
      try { parsed = JSON.parse(payload); } catch { continue; }
      if (parsed.error) return { error: parsed.error };
      onNode(parsed);
    }
  }
  return { done: true };
}

/**
 * useCanvasMode — encapsulates all canvas state and handlers for one mode.
 *
 * @param {string} storageKey     - localStorage key for session persistence
 * @param {string} sessionLabel   - label field name used when saving ('idea' | 'folderName')
 */
export function useCanvasMode({ storageKey, sessionLabel = 'label' }) {
  // ── Canvas state ──────────────────────────────────────────
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const [error, setError] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [drillStack, setDrillStack] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [savedSessions, setSavedSessions] = useState([]);
  const [showResumeBanner, setShowResumeBanner] = useState(false);

  // ── Refs ──────────────────────────────────────────────────
  const rawNodesRef = useRef([]);
  const abortRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const drillStackRef = useRef([]);
  const dynamicTypesRef = useRef(null); // for adaptive mode regen/drill
  const showCrossLinksRef = useRef(false); // toggle cross-link edges

  // ── Layout helper ─────────────────────────────────────────
  const applyLayout = useCallback((rawNodes, activeDrillStack) => {
    const displayRaw = activeDrillStack.length > 0
      ? getSubtree(rawNodes, activeDrillStack[activeDrillStack.length - 1].nodeId)
      : rawNodes;
    const edgeOpts = { nodeConfigGetter: getNodeConfig };
    const parentEdges = buildEdges(displayRaw, edgeOpts);
    const laidOut = computeLayout(displayRaw, parentEdges);
    const displayEdges = showCrossLinksRef.current
      ? buildEdges(displayRaw, { ...edgeOpts, showCrossLinks: true })
      : parentEdges;
    setNodes(laidOut);
    setEdges(displayEdges);
  }, []);

  // ── On mount: load saved sessions ────────────────────────
  useEffect(() => {
    const sessions = readSessions(storageKey);
    setSavedSessions(sessions);
    if (sessions.length > 0) setShowResumeBanner(true);
  }, [storageKey]);

  // ── Save session helper ───────────────────────────────────
  const saveSession = useCallback((labelValue, rawNodes) => {
    const sessions = readSessions(storageKey);
    const newSession = {
      id: new Date().toISOString(),
      [sessionLabel]: labelValue,
      label: labelValue, // always store as 'label' for LoadModal compatibility
      rawNodes,
      timestamp: Date.now(),
      nodeCount: rawNodes.length,
    };
    const updated = [newSession, ...sessions].slice(0, 10);
    writeSessions(storageKey, updated);
    setSavedSessions(updated);
  }, [storageKey, sessionLabel]);

  // ── Auto-save trigger (called by parent with current label) ──
  // Returns a function the parent can call when it wants auto-save
  const triggerAutoSave = useCallback((labelValue) => {
    if (!rawNodesRef.current.length || !labelValue?.trim()) return;
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveSession(labelValue, rawNodesRef.current);
    }, 500);
  }, [saveSession]);

  // ── Reset canvas ──────────────────────────────────────────
  const resetCanvas = useCallback(() => {
    rawNodesRef.current = [];
    drillStackRef.current = [];
    setDrillStack([]);
    setNodes([]);
    setEdges([]);
    setError(null);
    setNodeCount(0);
    setSelectedNode(null);
  }, []);

  // ── Stop streaming ────────────────────────────────────────
  const handleStop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setIsGenerating(false);
    setIsRegenerating(false);
  }, []);

  // ── Load/Delete session handlers ──────────────────────────
  const handleLoadSession = useCallback((session, onLabelUpdate) => {
    rawNodesRef.current = session.rawNodes;
    drillStackRef.current = [];
    setDrillStack([]);
    setNodeCount(session.rawNodes.length);
    setSelectedNode(null);
    setShowLoadModal(false);
    setShowResumeBanner(false);
    applyLayout(session.rawNodes, []);
    if (onLabelUpdate) onLabelUpdate(session.label || session[sessionLabel] || '');
  }, [applyLayout, sessionLabel]);

  const handleDeleteSession = useCallback((sessionId) => {
    const sessions = readSessions(storageKey);
    const updated = sessions.filter((s) => s.id !== sessionId);
    writeSessions(storageKey, updated);
    setSavedSessions(updated);
  }, [storageKey]);

  const handleManualSave = useCallback((labelValue) => {
    if (rawNodesRef.current.length && labelValue?.trim()) {
      saveSession(labelValue, rawNodesRef.current);
    }
  }, [saveSession]);

  // ── Node click ────────────────────────────────────────────
  const handleNodeClick = useCallback((node) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node));
    setContextMenu(null);
  }, []);

  // ── Toggle star (converge phase) ──────────────────────────
  const handleToggleStar = useCallback((nodeId) => {
    rawNodesRef.current = rawNodesRef.current.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, starred: !n.data.starred } }
        : n
    );
    applyLayout(rawNodesRef.current, drillStackRef.current);
  }, [applyLayout]);

  // ── Get ancestors ─────────────────────────────────────────
  const handleGetAncestors = useCallback((id) => {
    const nodeMap = Object.fromEntries(rawNodesRef.current.map((n) => [n.id, n]));
    const result = [];
    let node = nodeMap[id];
    while (node?.data?.parentId) {
      const parent = nodeMap[node.data.parentId];
      if (!parent) break;
      result.unshift(parent);
      node = parent;
    }
    return result;
  }, []);

  // ── Set node scores (from scoring API) ───────────────────
  const setNodeScores = useCallback((scores) => {
    rawNodesRef.current = rawNodesRef.current.map((n) => {
      const score = scores[n.id];
      if (score != null) {
        return { ...n, data: { ...n.data, score } };
      }
      return n;
    });
    applyLayout(rawNodesRef.current, drillStackRef.current);
  }, [applyLayout]);

  // ── Save node edit ────────────────────────────────────────
  const handleSaveNodeEdit = useCallback((nodeId, { label, reasoning }) => {
    rawNodesRef.current = rawNodesRef.current.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, label, reasoning } }
        : n
    );
    setSelectedNode((prev) =>
      prev?.id === nodeId
        ? { ...prev, data: { ...prev.data, label, reasoning } }
        : prev
    );
    applyLayout(rawNodesRef.current, drillStackRef.current);
  }, [applyLayout]);

  // ── Regenerate subtree ────────────────────────────────────
  const handleRegenerate = useCallback(async (nodeId) => {
    if (isGenerating || isRegenerating) return;

    const getAncestors = (id) => {
      const result = [];
      const nodeMap = Object.fromEntries(rawNodesRef.current.map((n) => [n.id, n]));
      let node = nodeMap[id];
      while (node?.data?.parentId) {
        const parent = nodeMap[node.data.parentId];
        if (!parent) break;
        result.unshift(parent);
        node = parent;
      }
      return result;
    };

    const getDescendantIds = (id) => {
      const children = rawNodesRef.current.filter((n) => n.data.parentId === id);
      return children.flatMap((c) => [c.id, ...getDescendantIds(c.id)]);
    };

    const targetNode = rawNodesRef.current.find((n) => n.id === nodeId);
    if (!targetNode) return;

    const parentContext = getAncestors(nodeId).map((n) => ({
      id: n.id, type: n.data.type, label: n.data.label,
      reasoning: n.data.reasoning, parentId: n.data.parentId,
    }));

    const descendantIds = new Set(getDescendantIds(nodeId));
    rawNodesRef.current = rawNodesRef.current.filter((n) => !descendantIds.has(n.id));
    applyLayout(rawNodesRef.current, drillStackRef.current);
    setNodeCount(rawNodesRef.current.length);
    setIsRegenerating(true);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await authFetch(`${API_URL}/api/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node: { id: targetNode.id, ...targetNode.data },
          parentContext,
          dynamicTypes: dynamicTypesRef.current || undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      // Grab dynamicConfig from existing nodes so new ones match
      const existingDynConfig = rawNodesRef.current[0]?.data?.dynamicConfig || null;
      const result = await readSSEStream(res, (nodeData) => {
        const flowNode = buildFlowNode(nodeData);
        if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
        rawNodesRef.current = [...rawNodesRef.current, flowNode];
        applyLayout(rawNodesRef.current, drillStackRef.current);
        setNodeCount(rawNodesRef.current.length);
      });
      if (result.error) setError(result.error);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setIsRegenerating(false);
    }
  }, [isGenerating, isRegenerating, applyLayout]);

  // ── Drill-down ────────────────────────────────────────────
  const handleDrill = useCallback(async (nodeId) => {
    if (isGenerating || isRegenerating) return;

    const targetNode = rawNodesRef.current.find((n) => n.id === nodeId);
    if (!targetNode) return;

    const newStack = [...drillStackRef.current, { nodeId, nodeLabel: targetNode.data.label }];
    drillStackRef.current = newStack;
    setDrillStack(newStack);
    setContextMenu(null);
    applyLayout(rawNodesRef.current, newStack);
    setIsGenerating(true);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const fullContext = rawNodesRef.current.map((n) => ({
      id: n.id, type: n.data.type, label: n.data.label,
      reasoning: n.data.reasoning, parentId: n.data.parentId,
    }));

    try {
      const res = await authFetch(`${API_URL}/api/drill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node: { id: targetNode.id, ...targetNode.data },
          fullContext,
          dynamicTypes: dynamicTypesRef.current || undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const existingDynConfig = rawNodesRef.current[0]?.data?.dynamicConfig || null;
      const result = await readSSEStream(res, (nodeData) => {
        const flowNode = buildFlowNode(nodeData);
        if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
        rawNodesRef.current = [...rawNodesRef.current, flowNode];
        applyLayout(rawNodesRef.current, drillStackRef.current);
        setNodeCount(rawNodesRef.current.length);
      });
      if (result.error) setError(result.error);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, isRegenerating, applyLayout]);

  const handleExitDrill = useCallback(() => {
    drillStackRef.current = [];
    setDrillStack([]);
    applyLayout(rawNodesRef.current, []);
  }, [applyLayout]);

  const handleJumpToBreadcrumb = useCallback((index) => {
    const newStack = drillStack.slice(0, index + 1);
    drillStackRef.current = newStack;
    setDrillStack(newStack);
    applyLayout(rawNodesRef.current, newStack);
  }, [drillStack, applyLayout]);

  const handleNodeContextMenu = useCallback((nodeId, x, y) => {
    setContextMenu({ nodeId, x, y });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    // State
    nodes, edges, isGenerating, setIsGenerating, isRegenerating, setIsRegenerating,
    nodeCount, setNodeCount, error, setError,
    selectedNode, setSelectedNode, drillStack, setDrillStack,
    contextMenu, showLoadModal, setShowLoadModal,
    savedSessions, showResumeBanner, setShowResumeBanner,
    // Refs
    rawNodesRef, abortRef, drillStackRef, dynamicTypesRef, showCrossLinksRef,
    // Handlers
    applyLayout, resetCanvas, handleStop, triggerAutoSave,
    handleLoadSession, handleDeleteSession, handleManualSave,
    handleNodeClick, handleGetAncestors, handleSaveNodeEdit, handleRegenerate,
    handleDrill, handleExitDrill, handleJumpToBreadcrumb,
    handleNodeContextMenu, handleCloseContextMenu, handleToggleStar, setNodeScores,
  };
}
