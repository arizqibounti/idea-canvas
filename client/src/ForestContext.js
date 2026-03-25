// ── Forest Context: Tabbed Multi-Canvas State Management ────────────
// All canvases live as in-memory arrays within a single session.
// No separate sessions or network loads per canvas.

import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

const ForestContext = createContext(null);

export function useForest() {
  return useContext(ForestContext);
}

// SSE reader for forest streams
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

export function ForestProvider({ forest: initialForest, children }) {
  const [forest, setForest] = useState(initialForest);
  const [activeCanvasKey, setActiveCanvasKeyRaw] = useState(initialForest?.activeCanvasKey || '__meta__');
  const [crossRefs, setCrossRefs] = useState(initialForest?.crossRefs || []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [critique, setCritique] = useState(null);
  const abortRef = useRef(null);

  // forestCanvases: array of { canvasKey, title, nodes[], status, description, dependencies }
  const [forestCanvases, setForestCanvases] = useState(() => {
    // If reopening from sidebar, canvases already have nodes
    if (initialForest?.canvases?.length) {
      return initialForest.canvases.map(c => ({
        canvasKey: c.canvasKey,
        title: c.title,
        description: c.description || '',
        dependencies: c.dependencies || [],
        nodes: c.nodes || [],
        status: c.status || (c.nodes?.length ? 'ready' : 'pending'),
        nodeCount: c.nodeCount || c.nodes?.length || 0,
      }));
    }
    // Fresh decompose — initialize from plan with empty nodes
    const plan = initialForest?.plan;
    if (!plan?.canvases) return [];
    return plan.canvases.map(c => ({
      canvasKey: c.canvasKey,
      title: c.title,
      description: c.description || '',
      dependencies: c.dependencies || [],
      nodes: [],
      status: c.status || 'pending',
    }));
  });

  const isForestMode = !!forest;
  const plan = forest?.plan;

  // Derived: nodes for whichever canvas tab is active
  const activeCanvasNodes = useMemo(() => {
    return forestCanvases.find(c => c.canvasKey === activeCanvasKey)?.nodes || [];
  }, [forestCanvases, activeCanvasKey]);

  // Switch canvas — pure state change, no network call
  const setActiveCanvas = useCallback((canvasKey) => {
    setActiveCanvasKeyRaw(canvasKey);
  }, []);

  // Update a specific canvas's nodes
  const setCanvasNodes = useCallback((canvasKey, nodes) => {
    setForestCanvases(prev => prev.map(c =>
      c.canvasKey === canvasKey ? { ...c, nodes } : c
    ));
  }, []);

  // Canvas statuses derived from forestCanvases
  const canvasStatuses = useMemo(() => {
    const statuses = {};
    forestCanvases.forEach(c => { statuses[c.canvasKey] = c.status; });
    return statuses;
  }, [forestCanvases]);

  // Generate all canvases via SSE
  const generateAll = useCallback(async () => {
    if (!forest?.id) return;
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset all canvases to pending before generation
    setForestCanvases(prev => prev.map(c => ({ ...c, status: 'pending', nodes: [] })));

    try {
      const res = await authFetch(`${API_URL}/api/forest/generate-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forestId: forest.id }),
        signal: controller.signal,
      });

      await readSSE(res, (event) => {
        // Progress updates (status changes)
        if (event._forestProgress) {
          if (event.canvasKey && event.status) {
            setForestCanvases(prev => prev.map(c =>
              c.canvasKey === event.canvasKey
                ? { ...c, status: event.status }
                : c
            ));
          }
        }
        // Cross-reference detection results
        if (event._forestCrossRefs) {
          setCrossRefs(event.crossRefs || []);
        }
        // Individual node streamed from a canvas (tagged with _canvasKey)
        if (event._canvasKey && !event._forestProgress && !event._forestCrossRefs && !event._forestComplete && !event._meta && !event._progress) {
          const canvasKey = event._canvasKey;
          const { _canvasKey, ...nodeData } = event;
          setForestCanvases(prev => prev.map(c =>
            c.canvasKey === canvasKey
              ? { ...c, nodes: [...c.nodes, nodeData] }
              : c
          ));
        }
        if (event._forestComplete) {
          setIsGenerating(false);
        }
      }, controller.signal);
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Forest generation error:', err);
    }
    setIsGenerating(false);
  }, [forest]);

  // Run cross-canvas critique
  const runCritique = useCallback(async () => {
    if (!forest?.id) return;
    try {
      const res = await authFetch(`${API_URL}/api/forest/critique`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forestId: forest.id }),
      });

      await readSSE(res, (event) => {
        if (event._forestCritique) {
          setCritique(event);
        }
      });
    } catch (err) {
      console.error('Forest critique error:', err);
    }
  }, [forest]);

  // Stop generation
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
  }, []);

  // Initialize from a session that already has forest data
  const initFromSession = useCallback((session) => {
    if (session?.forestCanvases && session?.forestPlan) {
      setForestCanvases(session.forestPlan.canvases.map(c => {
        const saved = session.forestCanvases.find(fc => fc.canvasKey === c.canvasKey);
        return {
          canvasKey: c.canvasKey,
          title: c.title,
          description: c.description || '',
          dependencies: c.dependencies || [],
          nodes: saved?.nodes || [],
          status: saved?.status || c.status || 'pending',
        };
      }));
    }
  }, []);

  const value = {
    forest,
    setForest,
    plan,
    activeCanvasKey,
    setActiveCanvas,
    activeCanvasNodes,
    forestCanvases,
    setForestCanvases,
    setCanvasNodes,
    crossRefs,
    canvasStatuses,
    isForestMode,
    isGenerating,
    generateAll,
    runCritique,
    critique,
    stopGeneration,
    initFromSession,
  };

  return (
    <ForestContext.Provider value={value}>
      {children}
    </ForestContext.Provider>
  );
}

export default ForestContext;
