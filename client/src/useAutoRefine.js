// ── Auto-Refine Hook ─────────────────────────────────────────
// Client-orchestrated critique → strengthen → score loop.
// Follows the handleAutoFractal pattern from useCanvasMode.js.

import { useState, useCallback, useRef } from 'react';
import { buildFlowNode, readSSEStream } from './useCanvasMode';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

export function useAutoRefine({ rawNodesRef, applyLayout, drillStackRef, dynamicTypesRef, yjsSyncRef, setNodeCount }) {
  const [isRefining, setIsRefining] = useState(false);
  const [refineProgress, setRefineProgress] = useState(null);
  const [refineHistory, setRefineHistory] = useState([]);
  const refineAbortRef = useRef(null);

  // Serialize raw nodes for API calls (extract data fields)
  const serializeNodes = useCallback(() => {
    return rawNodesRef.current.map(n => ({
      id: n.id,
      type: n.data?.type || n.type,
      label: n.data?.label || n.label,
      reasoning: n.data?.reasoning || n.reasoning,
      parentIds: n.data?.parentIds || [],
    }));
  }, [rawNodesRef]);

  const handleStartRefine = useCallback(async (idea, mode, maxRounds = 3, onProgress) => {
    if (isRefining) return;
    setIsRefining(true);
    setRefineProgress(null);

    const abortController = new AbortController();
    refineAbortRef.current = abortController;

    try {
      const allWeaknesses = [];

      for (let round = 1; round <= maxRounds; round++) {
        if (abortController.signal.aborted) break;

        // ── Step 1: Critique ──────────────────────────────────
        const critiqueStatus = { round, maxRounds, status: 'critiquing', detail: 'Evaluating tree quality...' };
        setRefineProgress(critiqueStatus);
        onProgress?.(critiqueStatus);

        const critiqueRes = await authFetch(`${API_URL}/api/refine/critique`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: serializeNodes(),
            idea,
            mode: mode || 'idea',
            round,
            priorWeaknesses: allWeaknesses,
          }),
          signal: abortController.signal,
        });

        if (!critiqueRes.ok) throw new Error(`Critique error: ${critiqueRes.status}`);
        const critiqueResult = await critiqueRes.json();
        const { weaknesses, gaps, contradictions, overallScore, stopReason } = critiqueResult;
        const totalIssues = (weaknesses?.length || 0) + (gaps?.length || 0) + (contradictions?.length || 0);

        // If AI says stop or no issues found → tree is strong enough
        if (stopReason || totalIssues === 0) {
          const doneStatus = {
            round, maxRounds, status: 'complete',
            overallScore, stopReason: stopReason || 'No significant weaknesses found',
          };
          setRefineProgress(doneStatus);
          onProgress?.(doneStatus);
          setRefineHistory(prev => [...prev, {
            round, weaknesses: [], oldScore: overallScore, newScore: overallScore,
            summary: stopReason || 'Tree is strong — no weaknesses to fix.',
          }]);
          break;
        }

        allWeaknesses.push(...weaknesses);

        // ── Step 2: Strengthen ────────────────────────────────
        const strengthenStatus = {
          round, maxRounds, status: 'strengthening',
          weaknesses, gaps, contradictions, overallScore,
          detail: `Fixing ${totalIssues} issues (${weaknesses?.length || 0} weaknesses, ${gaps?.length || 0} gaps, ${contradictions?.length || 0} contradictions)...`,
        };
        setRefineProgress(strengthenStatus);
        onProgress?.(strengthenStatus);

        if (abortController.signal.aborted) break;

        const strengthenRes = await authFetch(`${API_URL}/api/refine/strengthen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: serializeNodes(),
            idea,
            mode: mode || 'idea',
            weaknesses: weaknesses || [],
            gaps: gaps || [],
            contradictions: contradictions || [],
            dynamicTypes: dynamicTypesRef?.current || undefined,
            round,
          }),
          signal: abortController.signal,
        });

        if (!strengthenRes.ok) throw new Error(`Strengthen error: ${strengthenRes.status}`);

        const existingDynConfig = rawNodesRef.current[0]?.data?.dynamicConfig || null;
        let newNodeCount = 0;

        await readSSEStream(strengthenRes, (nodeData) => {
          // Handle progress events from research/multi-agent enrichment
          if (nodeData._progress) {
            setRefineProgress(prev => ({
              ...prev,
              detail: nodeData.stage,
              status: 'strengthening',
            }));
            onProgress?.({ ...strengthenStatus, detail: nodeData.stage });
            return;
          }
          if (nodeData._update) {
            // Update existing node in-place
            rawNodesRef.current = rawNodesRef.current.map(n => {
              if (n.id === nodeData.id) {
                const updated = {
                  ...n,
                  data: {
                    ...n.data,
                    label: nodeData.label || n.data.label,
                    reasoning: nodeData.reasoning || n.data.reasoning,
                    type: nodeData.type || n.data.type,
                  },
                };
                yjsSyncRef?.current?.updateNodeInYjs(n.id, updated.data);
                return updated;
              }
              return n;
            });
          } else if (nodeData.id) {
            // Add new node
            const flowNode = buildFlowNode(nodeData);
            if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
            flowNode.data.autoRefined = true;
            rawNodesRef.current = [...rawNodesRef.current, flowNode];
            newNodeCount++;
            yjsSyncRef?.current?.addNodeToYjs(flowNode);
          }
          applyLayout(rawNodesRef.current, drillStackRef?.current);
          setNodeCount?.(rawNodesRef.current.length);
        });

        // ── Step 3: Re-score ──────────────────────────────────
        if (abortController.signal.aborted) break;

        const scoreStatus = { round, maxRounds, status: 'scoring', detail: 'Measuring improvement...' };
        setRefineProgress(scoreStatus);
        onProgress?.(scoreStatus);

        const scoreRes = await authFetch(`${API_URL}/api/refine/score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: serializeNodes(),
            idea,
            mode: mode || 'idea',
          }),
          signal: abortController.signal,
        });

        if (!scoreRes.ok) throw new Error(`Score error: ${scoreRes.status}`);
        const scoreResult = await scoreRes.json();

        const roundComplete = {
          round, maxRounds, status: 'round_complete',
          oldScore: overallScore, newScore: scoreResult.overallScore,
          improved: scoreResult.improved, summary: scoreResult.summary,
          weaknesses, newNodeCount,
        };
        setRefineProgress(roundComplete);
        onProgress?.(roundComplete);

        // Record round
        setRefineHistory(prev => [...prev, {
          round,
          weaknesses,
          oldScore: overallScore,
          newScore: scoreResult.overallScore,
          improved: scoreResult.improved,
          summary: scoreResult.summary,
          newNodeCount,
        }]);

        // Brief pause between rounds
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        const errStatus = { status: 'error', error: err.message };
        setRefineProgress(errStatus);
        onProgress?.(errStatus);
      }
    } finally {
      setIsRefining(false);
      refineAbortRef.current = null;
      applyLayout(rawNodesRef.current, drillStackRef?.current);
      onProgress?.({ status: 'done' });
    }
  }, [isRefining, rawNodesRef, applyLayout, drillStackRef, dynamicTypesRef, yjsSyncRef, setNodeCount, serializeNodes]);

  const handleStopRefine = useCallback(() => {
    if (refineAbortRef.current) {
      refineAbortRef.current.abort();
      refineAbortRef.current = null;
    }
    setIsRefining(false);
  }, []);

  const handleGoDeeper = useCallback(async (idea, mode, additionalRounds = 2, onProgress) => {
    // Resume refinement for more rounds
    await handleStartRefine(idea, mode, additionalRounds, onProgress);
  }, [handleStartRefine]);

  const resetRefineHistory = useCallback(() => {
    setRefineHistory([]);
    setRefineProgress(null);
  }, []);

  return {
    isRefining,
    refineProgress,
    refineHistory,
    handleStartRefine,
    handleStopRefine,
    handleGoDeeper,
    resetRefineHistory,
  };
}
