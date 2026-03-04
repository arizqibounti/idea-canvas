import { useState, useCallback, useRef, useEffect } from 'react';
import { computeLayout, buildEdges, getSubtree, filterCollapsed, computeDepths } from './layoutUtils';
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
  const collapsedNodesRef = useRef(new Set()); // collapsed branch IDs
  const expandingNodeRef = useRef(null); // currently fractal-expanding node ID
  const autoFractalAbortRef = useRef(null); // abort controller for auto-fractal

  // ── Layout helper ─────────────────────────────────────────
  const applyLayout = useCallback((rawNodes, activeDrillStack) => {
    let displayRaw = activeDrillStack.length > 0
      ? getSubtree(rawNodes, activeDrillStack[activeDrillStack.length - 1].nodeId)
      : rawNodes;

    // Filter out collapsed branches
    displayRaw = filterCollapsed(displayRaw, collapsedNodesRef.current);

    const edgeOpts = { nodeConfigGetter: getNodeConfig };
    const parentEdges = buildEdges(displayRaw, edgeOpts);
    const laidOut = computeLayout(displayRaw, parentEdges);

    // Compute depths and child counts for fractal UI
    const depths = computeDepths(laidOut);
    const childCountMap = {};
    rawNodes.forEach(n => {
      if (n.data.parentId) {
        childCountMap[n.data.parentId] = (childCountMap[n.data.parentId] || 0) + 1;
      }
    });

    // Annotate nodes with fractal data
    laidOut.forEach(n => {
      n.data.depth = depths.get(n.id) || 0;
      n.data.childCount = childCountMap[n.id] || 0;
      n.data.isCollapsed = collapsedNodesRef.current.has(n.id);
      n.data.isExpanding = expandingNodeRef.current === n.id;
      n.data.nodeId = n.id;
    });

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
    const normalizedLabel = (labelValue || '').toLowerCase().trim();

    // Find existing session with same idea text — update in place (upsert)
    const existingIdx = sessions.findIndex(
      s => ((s.label || s[sessionLabel] || '').toLowerCase().trim()) === normalizedLabel
    );

    const sessionData = {
      id: existingIdx >= 0 ? sessions[existingIdx].id : new Date().toISOString(),
      [sessionLabel]: labelValue,
      label: labelValue,
      rawNodes,
      timestamp: Date.now(),
      nodeCount: rawNodes.length,
    };

    let updated;
    if (existingIdx >= 0) {
      // Update existing session in place, move to front
      updated = [sessionData, ...sessions.filter((_, i) => i !== existingIdx)];
    } else {
      // New session — prepend
      updated = [sessionData, ...sessions];
    }

    updated = updated.slice(0, 10);
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
    collapsedNodesRef.current = new Set();
    expandingNodeRef.current = null;
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

  // ── Toggle collapse/expand branch ──────────────────────────
  const handleToggleCollapse = useCallback((nodeId) => {
    const set = collapsedNodesRef.current;
    if (set.has(nodeId)) {
      set.delete(nodeId);
    } else {
      set.add(nodeId);
    }
    collapsedNodesRef.current = new Set(set);
    applyLayout(rawNodesRef.current, drillStackRef.current);
  }, [applyLayout]);

  // ── Collapse all expanded branches ────────────────────────
  const handleCollapseAll = useCallback(() => {
    // Find all nodes that have children (i.e. are parents)
    const parentIds = new Set();
    rawNodesRef.current.forEach(n => {
      if (n.data.parentId) parentIds.add(n.data.parentId);
    });
    collapsedNodesRef.current = new Set(parentIds);
    applyLayout(rawNodesRef.current, drillStackRef.current);
  }, [applyLayout]);

  // ── Expand all collapsed branches ─────────────────────────
  const handleExpandAll = useCallback(() => {
    collapsedNodesRef.current = new Set();
    applyLayout(rawNodesRef.current, drillStackRef.current);
  }, [applyLayout]);

  // ── Fractal expand (inline ⊕) ─────────────────────────────
  const handleFractalExpand = useCallback(async (nodeId) => {
    if (isGenerating || isRegenerating || expandingNodeRef.current) return;

    const targetNode = rawNodesRef.current.find((n) => n.id === nodeId);
    if (!targetNode) return;

    // Build ancestor chain
    const getAncestorChain = (id) => {
      const result = [];
      const nodeMap = Object.fromEntries(rawNodesRef.current.map((n) => [n.id, n]));
      let node = nodeMap[id];
      while (node?.data?.parentId) {
        const parent = nodeMap[node.data.parentId];
        if (!parent) break;
        result.unshift({
          id: parent.id, type: parent.data.type,
          label: parent.data.label, reasoning: parent.data.reasoning,
        });
        node = parent;
      }
      return result;
    };

    expandingNodeRef.current = nodeId;
    applyLayout(rawNodesRef.current, drillStackRef.current);

    const controller = new AbortController();

    try {
      const ancestorChain = getAncestorChain(nodeId);
      const treeSnapshot = rawNodesRef.current.map(n => ({
        type: n.data.type, label: n.data.label,
      }));

      const res = await authFetch(`${API_URL}/api/fractal-expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node: { id: targetNode.id, ...targetNode.data },
          ancestorChain,
          dynamicTypes: dynamicTypesRef.current || undefined,
          treeSnapshot,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const existingDynConfig = rawNodesRef.current[0]?.data?.dynamicConfig || null;
      const result = await readSSEStream(res, (nodeData) => {
        const flowNode = buildFlowNode(nodeData);
        if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
        flowNode.data.expanded = true;
        rawNodesRef.current = [...rawNodesRef.current, flowNode];
        applyLayout(rawNodesRef.current, drillStackRef.current);
        setNodeCount(rawNodesRef.current.length);
      });
      if (result.error) setError(result.error);

      // Mark the parent as expanded
      rawNodesRef.current = rawNodesRef.current.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, expanded: true } } : n
      );
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      expandingNodeRef.current = null;
      applyLayout(rawNodesRef.current, drillStackRef.current);
    }
  }, [isGenerating, isRegenerating, applyLayout]);

  // ── Autonomous fractal mode ────────────────────────────────
  const handleAutoFractal = useCallback(async (idea, maxRounds = 5, onProgress) => {
    if (isGenerating || isRegenerating) return null;

    const abortController = new AbortController();
    autoFractalAbortRef.current = abortController;

    try {
      for (let round = 1; round <= maxRounds; round++) {
        if (abortController.signal.aborted) break;

        // 1. Collect all leaf nodes (no children)
        const childSet = new Set();
        rawNodesRef.current.forEach(n => {
          if (n.data.parentId) childSet.add(n.data.parentId);
        });
        const leafNodes = rawNodesRef.current
          .filter(n => !childSet.has(n.id))
          .map(n => ({
            id: n.id, type: n.data.type,
            label: n.data.label, reasoning: n.data.reasoning,
          }));

        if (leafNodes.length === 0) break;

        // 2. AI selects most promising node
        onProgress?.({ round, maxRounds, status: 'selecting', reasoning: 'AI is evaluating leaf nodes...' });

        const fullContext = rawNodesRef.current.map(n => ({
          id: n.id, type: n.data.type, label: n.data.label,
          reasoning: n.data.reasoning, parentId: n.data.parentId,
        }));

        const selectRes = await authFetch(`${API_URL}/api/fractal-select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leafNodes, fullContext, idea }),
          signal: abortController.signal,
        });
        if (!selectRes.ok) throw new Error(`Select error: ${selectRes.status}`);

        const { selectedNodeId, reasoning } = await selectRes.json();
        if (!selectedNodeId) break;

        onProgress?.({ round, maxRounds, status: 'expanding', selectedNodeId, reasoning });

        // 3. Fractal expand the selected node
        const targetNode = rawNodesRef.current.find(n => n.id === selectedNodeId);
        if (!targetNode) break;

        expandingNodeRef.current = selectedNodeId;
        applyLayout(rawNodesRef.current, drillStackRef.current);

        const ancestorChain = [];
        const nodeMap = Object.fromEntries(rawNodesRef.current.map(n => [n.id, n]));
        let walker = nodeMap[selectedNodeId];
        while (walker?.data?.parentId) {
          const parent = nodeMap[walker.data.parentId];
          if (!parent) break;
          ancestorChain.unshift({
            id: parent.id, type: parent.data.type,
            label: parent.data.label, reasoning: parent.data.reasoning,
          });
          walker = parent;
        }

        const treeSnapshot = rawNodesRef.current.map(n => ({
          type: n.data.type, label: n.data.label,
        }));

        let newNodeCount = 0;
        const expandRes = await authFetch(`${API_URL}/api/fractal-expand`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            node: { id: targetNode.id, ...targetNode.data },
            ancestorChain,
            dynamicTypes: dynamicTypesRef.current || undefined,
            treeSnapshot,
          }),
          signal: abortController.signal,
        });
        if (!expandRes.ok) throw new Error(`Expand error: ${expandRes.status}`);

        const existingDynConfig = rawNodesRef.current[0]?.data?.dynamicConfig || null;
        await readSSEStream(expandRes, (nodeData) => {
          const flowNode = buildFlowNode(nodeData);
          if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
          flowNode.data.autoExplored = true;
          rawNodesRef.current = [...rawNodesRef.current, flowNode];
          applyLayout(rawNodesRef.current, drillStackRef.current);
          setNodeCount(rawNodesRef.current.length);
          newNodeCount++;
        });

        // Mark source node
        rawNodesRef.current = rawNodesRef.current.map(n =>
          n.id === selectedNodeId
            ? { ...n, data: { ...n.data, expanded: true, autoExplored: true } }
            : n
        );

        expandingNodeRef.current = null;
        applyLayout(rawNodesRef.current, drillStackRef.current);

        onProgress?.({ round, maxRounds, status: 'expanded', selectedNodeId, reasoning, newNodeCount });

        // Brief pause between rounds for visual effect
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      expandingNodeRef.current = null;
      autoFractalAbortRef.current = null;
      applyLayout(rawNodesRef.current, drillStackRef.current);
      onProgress?.({ status: 'done' });
    }
  }, [isGenerating, isRegenerating, applyLayout]);

  const handleStopAutoFractal = useCallback(() => {
    if (autoFractalAbortRef.current) {
      autoFractalAbortRef.current.abort();
      autoFractalAbortRef.current = null;
    }
    expandingNodeRef.current = null;
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
    // Fractal handlers
    handleFractalExpand, handleToggleCollapse, handleCollapseAll, handleExpandAll,
    handleAutoFractal, handleStopAutoFractal,
  };
}
