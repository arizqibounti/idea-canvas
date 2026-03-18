// ── AutoIdea Experiment Loop Hook ────────────────────────────
// Autonomous idea experimentation: mutate → score → compare → keep/discard.
// Inspired by Karpathy's autoresearch. Follows useAutoRefine.js pattern.

import { useState, useCallback, useRef } from 'react';
import { buildFlowNode, readSSEStream } from './useCanvasMode';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

export function useExperimentLoop({ rawNodesRef, applyLayout, drillStackRef, dynamicTypesRef, yjsSyncRef, setNodeCount }) {
  const [isExperimenting, setIsExperimenting] = useState(false);
  const [experimentProgress, setExperimentProgress] = useState(null);
  const [experimentHistory, setExperimentHistory] = useState([]);
  const [bestTree, setBestTree] = useState(null);
  const experimentAbortRef = useRef(null);

  // Serialize raw nodes for API calls
  const serializeNodes = useCallback(() => {
    return rawNodesRef.current.map(n => ({
      id: n.id,
      type: n.data?.type || n.type,
      label: n.data?.label || n.label,
      reasoning: n.data?.reasoning || n.reasoning,
      parentIds: n.data?.parentIds || [],
    }));
  }, [rawNodesRef]);

  // ── Main experiment loop ──────────────────────────────────
  const handleStartExperiment = useCallback(async (idea, mode, maxIterations = 5, onProgress) => {
    if (isExperimenting) return;
    setIsExperimenting(true);
    setExperimentProgress(null);

    const abortController = new AbortController();
    experimentAbortRef.current = abortController;

    const history = [];
    let currentBest = {
      nodes: serializeNodes(),
      title: 'Original',
      thesis: idea,
      scores: null,
      total: 0,
      iteration: 0,
    };

    try {
      // ── Step 0: Score baseline ────────────────────────────
      const initStatus = { status: 'scoring_baseline', iteration: 0, maxIterations, detail: 'Scoring baseline tree...' };
      setExperimentProgress(initStatus);
      onProgress?.(initStatus);

      const baselineScoreRes = await authFetch(`${API_URL}/api/experiment/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baselineTree: { nodes: currentBest.nodes, title: currentBest.title, thesis: currentBest.thesis },
          candidateTree: { nodes: currentBest.nodes, title: currentBest.title, thesis: currentBest.thesis },
          idea,
          mode: mode || 'idea',
        }),
        signal: abortController.signal,
      });

      if (baselineScoreRes.ok) {
        const baselineResult = await baselineScoreRes.json();
        currentBest.scores = baselineResult.baseline?.dimensions || {};
        currentBest.total = baselineResult.baseline?.total || 5;
      }
      setBestTree({ ...currentBest });

      // ── Iteration loop ────────────────────────────────────
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        if (abortController.signal.aborted) break;

        // ── Step 1: Analyze — pick next mutation strategy ───
        const analyzeStatus = {
          status: 'analyzing', iteration, maxIterations,
          detail: 'Choosing mutation strategy...', bestTotal: currentBest.total,
        };
        setExperimentProgress(analyzeStatus);
        onProgress?.(analyzeStatus);

        let nextStrategy = 'wildcard';
        let focusAreas = [];

        try {
          const analyzeRes = await authFetch(`${API_URL}/api/experiment/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentScores: currentBest.scores,
              idea,
              mode: mode || 'idea',
              history,
            }),
            signal: abortController.signal,
          });

          if (analyzeRes.ok) {
            const analysis = await analyzeRes.json();
            nextStrategy = analysis.nextStrategy || 'wildcard';
            focusAreas = analysis.focusAreas || [];
          }
        } catch (err) {
          if (err.name === 'AbortError') break;
          console.error('Analyze error:', err.message);
        }

        if (abortController.signal.aborted) break;

        // ── Step 2: Mutate — generate alternative tree ──────
        const weakDimensions = focusAreas.map(name => ({
          name,
          score: currentBest.scores?.[name]?.score || currentBest.scores?.[name] || 5,
        }));

        const mutateStatus = {
          status: 'mutating', iteration, maxIterations,
          strategy: nextStrategy, bestTotal: currentBest.total,
          detail: `Generating ${nextStrategy.replace(/_/g, ' ')} variant...`,
        };
        setExperimentProgress(mutateStatus);
        onProgress?.(mutateStatus);

        const mutateRes = await authFetch(`${API_URL}/api/experiment/mutate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: currentBest.nodes,
            idea,
            mode: mode || 'idea',
            mutationStrategy: nextStrategy,
            weakDimensions,
            iteration,
            priorMutations: history.map(h => ({ strategy: h.strategy, title: h.candidateTitle, kept: h.kept })),
            dynamicTypes: dynamicTypesRef?.current || undefined,
          }),
          signal: abortController.signal,
        });

        if (!mutateRes.ok) throw new Error(`Mutate error: ${mutateRes.status}`);

        // Collect candidate nodes from SSE stream
        const candidateNodes = [];
        let candidateTitle = 'Candidate';
        let candidateThesis = '';
        let candidateStrategy = nextStrategy;

        await readSSEStream(mutateRes, (nodeData) => {
          if (nodeData._progress) {
            setExperimentProgress(prev => ({ ...prev, detail: nodeData.stage }));
            return;
          }
          if (nodeData._alternative) {
            candidateTitle = nodeData.title || candidateTitle;
            candidateThesis = nodeData.thesis || candidateThesis;
            candidateStrategy = nodeData.strategy || candidateStrategy;
            return;
          }
          if (nodeData._meta) return; // skip meta lines
          if (nodeData.id && !nodeData._progress) {
            candidateNodes.push(nodeData);
          }
        });

        if (abortController.signal.aborted) break;
        if (!candidateNodes.length) {
          // Empty mutation — skip
          history.push({ iteration, strategy: nextStrategy, candidateTitle, baselineTotal: currentBest.total, candidateTotal: 0, kept: false });
          continue;
        }

        // ── Step 3: Score — compare baseline vs candidate ───
        const scoreStatus = {
          status: 'scoring', iteration, maxIterations,
          strategy: nextStrategy, candidateTitle, bestTotal: currentBest.total,
          detail: 'Scoring variant...',
        };
        setExperimentProgress(scoreStatus);
        onProgress?.(scoreStatus);

        const scoreRes = await authFetch(`${API_URL}/api/experiment/score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baselineTree: { nodes: currentBest.nodes, title: currentBest.title, thesis: currentBest.thesis },
            candidateTree: { nodes: candidateNodes, title: candidateTitle, thesis: candidateThesis, strategy: candidateStrategy },
            idea,
            mode: mode || 'idea',
          }),
          signal: abortController.signal,
        });

        if (!scoreRes.ok) throw new Error(`Score error: ${scoreRes.status}`);
        const scoreResult = await scoreRes.json();

        const candidateTotal = scoreResult.candidate?.total || 0;
        const baselineTotal = scoreResult.baseline?.total || currentBest.total;
        const isImprovement = scoreResult.winner === 'candidate';

        // ── Step 4: Keep or discard ─────────────────────────
        const historyEntry = {
          iteration,
          strategy: nextStrategy,
          candidateTitle,
          candidateThesis,
          baselineTotal,
          candidateTotal,
          baselineDims: scoreResult.baseline?.dimensions || {},
          candidateDims: scoreResult.candidate?.dimensions || {},
          analysis: scoreResult.analysis,
          kept: isImprovement,
        };
        history.push(historyEntry);
        setExperimentHistory([...history]);

        if (isImprovement) {
          // ── KEEP: Replace canvas with winning variant ────
          const existingDynConfig = rawNodesRef.current[0]?.data?.dynamicConfig || null;
          const newFlowNodes = candidateNodes.map(nodeData => {
            const flowNode = buildFlowNode(nodeData);
            if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
            flowNode.data.autoExperimented = true;
            return flowNode;
          });

          rawNodesRef.current = newFlowNodes;
          newFlowNodes.forEach(n => yjsSyncRef?.current?.addNodeToYjs(n));
          applyLayout(rawNodesRef.current, drillStackRef?.current);
          setNodeCount?.(rawNodesRef.current.length);

          currentBest = {
            nodes: candidateNodes,
            title: candidateTitle,
            thesis: candidateThesis,
            scores: scoreResult.candidate?.dimensions || {},
            total: candidateTotal,
            iteration,
          };
          setBestTree({ ...currentBest });

          const keptStatus = {
            status: 'kept', iteration, maxIterations,
            strategy: nextStrategy, candidateTitle, candidateThesis,
            baselineTotal, candidateTotal, bestTotal: candidateTotal,
            baselineDims: scoreResult.baseline?.dimensions || {},
            candidateDims: scoreResult.candidate?.dimensions || {},
            analysis: scoreResult.analysis,
            history: [...history],
          };
          setExperimentProgress(keptStatus);
          onProgress?.(keptStatus);
        } else {
          // ── DISCARD: Keep current best ───────────────────
          const discardedStatus = {
            status: 'discarded', iteration, maxIterations,
            strategy: nextStrategy, candidateTitle, candidateThesis,
            baselineTotal, candidateTotal, bestTotal: currentBest.total,
            baselineDims: scoreResult.baseline?.dimensions || {},
            candidateDims: scoreResult.candidate?.dimensions || {},
            analysis: scoreResult.analysis,
            history: [...history],
          };
          setExperimentProgress(discardedStatus);
          onProgress?.(discardedStatus);
        }

        // Brief pause between iterations
        await new Promise(r => setTimeout(r, 800));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        const errStatus = { status: 'error', error: err.message };
        setExperimentProgress(errStatus);
        onProgress?.(errStatus);
      }
    } finally {
      setIsExperimenting(false);
      experimentAbortRef.current = null;
      applyLayout(rawNodesRef.current, drillStackRef?.current);
      onProgress?.({ status: 'done', bestTree: currentBest, history });
    }
  }, [isExperimenting, rawNodesRef, applyLayout, drillStackRef, dynamicTypesRef, yjsSyncRef, setNodeCount, serializeNodes]);

  const handleStopExperiment = useCallback(() => {
    if (experimentAbortRef.current) {
      experimentAbortRef.current.abort();
      experimentAbortRef.current = null;
    }
    setIsExperimenting(false);
  }, []);

  const resetExperimentHistory = useCallback(() => {
    setExperimentHistory([]);
    setExperimentProgress(null);
    setBestTree(null);
  }, []);

  return {
    isExperimenting,
    experimentProgress,
    experimentHistory,
    bestTree,
    handleStartExperiment,
    handleStopExperiment,
    resetExperimentHistory,
  };
}
