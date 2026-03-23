// ── Pattern Executor Hook ─────────────────────────────────────
// React hook for executing thinking patterns via SSE.
// Replaces the need for separate useAutoRefine, useExperimentLoop
// hooks when a pattern is active.

import { useState, useRef, useCallback } from 'react';
import { authFetch } from './api';
import { buildFlowNode } from './useCanvasMode';

const API_URL = process.env.REACT_APP_API_URL || '';

export function usePatternExecutor({
  rawNodesRef,
  applyLayout,
  drillStackRef,
  dynamicTypesRef,
  dynamicConfigRef,
  setNodeCount,
  buildDynamicConfigFn,
}) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentStage, setCurrentStage] = useState(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [stageResults, setStageResults] = useState({});
  const [checkpoint, setCheckpoint] = useState(null);
  const [error, setError] = useState(null);
  const [executionId, setExecutionId] = useState(null);
  const abortRef = useRef(null);

  const execute = useCallback(async (patternId, idea, nodes, mode, config = {}) => {
    setIsExecuting(true);
    setError(null);
    setStageResults({});
    setCheckpoint(null);
    setCurrentStage(null);
    setCurrentRound(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Serialize nodes for the request
      const serializedNodes = (nodes || []).map(n => {
        const d = n.data || n;
        return {
          id: n.id || d.id,
          type: d.type,
          label: d.label,
          reasoning: d.reasoning,
          parentIds: d.parentIds || (d.parentId ? [d.parentId] : []),
        };
      });

      const res = await authFetch(`${API_URL}/api/pattern/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patternId,
          idea,
          nodes: serializedNodes,
          mode,
          ...config,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Pattern execution failed: ${res.status}`);
      }

      // Read SSE stream
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
            handleSSEEvent(event);
          } catch { /* skip non-JSON */ }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Pattern executor error:', err);
      setError(err.message);
    } finally {
      setIsExecuting(false);
      setCurrentStage(null);
      abortRef.current = null;
    }
  }, [rawNodesRef, applyLayout, drillStackRef, dynamicTypesRef, setNodeCount]); // eslint-disable-line

  const handleSSEEvent = useCallback((event) => {
    // Pattern progress
    if (event._patternProgress) {
      setCurrentStage(event.stage);
      setCurrentRound(event.round || 0);
      return;
    }

    // Stage result (non-streaming stages)
    if (event._patternStageResult) {
      setStageResults(prev => ({ ...prev, [event.stage]: event.data }));
      return;
    }

    // Checkpoint (branch/loop pause)
    if (event._checkpoint) {
      setCheckpoint(event);
      setExecutionId(event.executionId);
      return;
    }

    // Pattern complete
    if (event._patternComplete) {
      setExecutionId(event.executionId);
      return;
    }

    // Pattern error
    if (event._patternError) {
      if (event.fatal) {
        setError(`Stage "${event.stage}" failed: ${event.error}`);
      }
      return;
    }

    // Meta update (dynamic types from pattern generate stages)
    if (event._meta) {
      if (dynamicTypesRef) dynamicTypesRef.current = event.types || [];
      if (dynamicConfigRef && buildDynamicConfigFn && event.types) {
        dynamicConfigRef.current = buildDynamicConfigFn(event.types);
      }
      return;
    }

    // Alternative header (portfolio pattern)
    if (event._alternative) {
      // Forward as-is for PortfolioCard handling
      return;
    }

    // Regular node — add to canvas
    if (event.id && event.type) {
      const existingIds = new Set((rawNodesRef?.current || []).map(n => n.id));
      const flowNode = buildFlowNode(event, existingIds);
      if (flowNode && rawNodesRef) {
        if (dynamicConfigRef?.current) flowNode.data.dynamicConfig = dynamicConfigRef.current;
        rawNodesRef.current = [...rawNodesRef.current, flowNode];
        if (applyLayout) {
          applyLayout(rawNodesRef.current, drillStackRef?.current || []);
        }
        if (setNodeCount) setNodeCount(rawNodesRef.current.length);
      }
    }
  }, [rawNodesRef, applyLayout, drillStackRef, dynamicTypesRef, dynamicConfigRef, buildDynamicConfigFn, setNodeCount]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsExecuting(false);
    setCurrentStage(null);
  }, []);

  const resume = useCallback(async (decision) => {
    if (!executionId) return;
    setCheckpoint(null);

    try {
      await authFetch(`${API_URL}/api/pattern/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId, decision }),
      });
    } catch (err) {
      console.error('Resume error:', err);
    }
  }, [executionId]);

  return {
    execute,
    stop,
    resume,
    isExecuting,
    currentStage,
    currentRound,
    stageResults,
    checkpoint,
    error,
    executionId,
  };
}

export default usePatternExecutor;
