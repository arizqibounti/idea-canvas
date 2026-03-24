// ── Forest Context: Multi-Canvas State Management ────────────
// Provides forest state and methods to all forest-mode components.

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
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
  const [activeCanvasKey, setActiveCanvasKey] = useState('__meta__');
  const [canvasSessions, setCanvasSessions] = useState(new Map());
  const [crossRefs, setCrossRefs] = useState(initialForest?.crossRefs || []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [canvasStatuses, setCanvasStatuses] = useState(() => {
    const statuses = {};
    (initialForest?.canvases || []).forEach(c => { statuses[c.canvasKey] = c.status; });
    return statuses;
  });
  const [critique, setCritique] = useState(null);
  const abortRef = useRef(null);

  const isForestMode = !!forest;
  const plan = forest?.plan;

  // Load a canvas session by key
  const loadCanvasSession = useCallback(async (canvasKey) => {
    const canvasRef = forest?.canvases?.find(c => c.canvasKey === canvasKey);
    if (!canvasRef?.sessionId) return null;
    try {
      const res = await authFetch(`${API_URL}/api/sessions/${canvasRef.sessionId}`);
      if (res.ok) {
        const session = await res.json();
        setCanvasSessions(prev => new Map(prev).set(canvasKey, session));
        return session;
      }
    } catch {}
    return null;
  }, [forest]);

  // Switch to a canvas
  const setActiveCanvas = useCallback((canvasKey) => {
    setActiveCanvasKey(canvasKey);
    if (canvasKey !== '__meta__' && !canvasSessions.has(canvasKey)) {
      loadCanvasSession(canvasKey);
    }
  }, [canvasSessions, loadCanvasSession]);

  // Generate all canvases
  const generateAll = useCallback(async () => {
    if (!forest?.id) return;
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await authFetch(`${API_URL}/api/forest/generate-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forestId: forest.id }),
        signal: controller.signal,
      });

      await readSSE(res, (event) => {
        if (event._forestProgress) {
          setCanvasStatuses(prev => ({
            ...prev,
            [event.canvasKey]: event.status,
          }));
        }
        if (event._forestCrossRefs) {
          setCrossRefs(event.crossRefs || []);
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

  const value = {
    forest,
    setForest,
    plan,
    activeCanvasKey,
    setActiveCanvas,
    canvasSessions,
    loadCanvasSession,
    crossRefs,
    canvasStatuses,
    isForestMode,
    isGenerating,
    generateAll,
    runCritique,
    critique,
    stopGeneration,
  };

  return (
    <ForestContext.Provider value={value}>
      {children}
    </ForestContext.Provider>
  );
}

export default ForestContext;
