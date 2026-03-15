// ── Portfolio Hook ────────────────────────────────────────────
// Extracted from PortfolioPanel for reuse by inline chat cards.

import { useState, useCallback, useRef } from 'react';
import { buildFlowNode, readSSEStream } from './useCanvasMode';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

export function usePortfolio({ rawNodesRef, applyLayout, drillStackRef, setNodeCount, yjsSyncRef }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [alternatives, setAlternatives] = useState([]);
  const [scores, setScores] = useState(null);
  const [recommendation, setRecommendation] = useState('');
  const [stageDetail, setStageDetail] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const previousNodesRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(null);

  const scoreAlternatives = useCallback(async (alts, idea, mode, focus) => {
    setIsScoring(true);
    try {
      const res = await authFetch(`${API_URL}/api/portfolio/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alternatives: alts.map(a => ({ index: a.index, title: a.title, thesis: a.thesis, nodes: a.nodes })),
          idea, mode: mode || 'idea',
          ...(focus && { focus }),
        }),
      });
      if (!res.ok) throw new Error(`Score error: ${res.status}`);
      const result = await res.json();
      setScores(result.scores || []);
      setRecommendation(result.recommendation || '');
      return result;
    } catch (err) {
      console.error('Portfolio score error:', err);
      return null;
    } finally {
      setIsScoring(false);
    }
  }, []);

  const generate = useCallback(async ({ idea, mode, focus, count = 3, existingTitles = [], onProgress } = {}) => {
    setIsGenerating(true);
    setError(null);
    setStageDetail('Initializing research pipeline...');
    onProgress?.({ status: 'generating', stageDetail: 'Initializing research pipeline...' });

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const res = await authFetch(`${API_URL}/api/portfolio/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea, mode: mode || 'idea', count, existingTitles,
          ...(focus && { focus }),
        }),
        signal: abortController.signal,
      });

      if (!res.ok) throw new Error(`Generate error: ${res.status}`);

      let currentAlt = null;
      const newAlternatives = [];

      await readSSEStream(res, (data) => {
        if (data._progress) {
          setStageDetail(data.stage || 'Processing...');
          onProgress?.({ status: 'generating', stageDetail: data.stage || 'Processing...' });
          return;
        }
        if (data._alternative) {
          if (currentAlt) newAlternatives.push(currentAlt);
          currentAlt = {
            index: data.index,
            title: data.title,
            thesis: data.thesis,
            approach: data.approach,
            nodes: [],
            meta: null,
          };
        } else if (data._meta && currentAlt) {
          currentAlt.meta = data;
        } else if (data.id && currentAlt) {
          currentAlt.nodes.push(data);
        }
      });
      if (currentAlt) newAlternatives.push(currentAlt);

      const allAlts = [...alternatives, ...newAlternatives];
      setAlternatives(allAlts);

      // Auto-score
      if (newAlternatives.length > 0) {
        setStageDetail('Scoring alternatives...');
        onProgress?.({ status: 'generating', stageDetail: 'Scoring alternatives...' });
        const scoreResult = await scoreAlternatives(allAlts, idea, mode, focus);
        onProgress?.({
          status: 'done',
          alternatives: allAlts,
          scores: scoreResult?.scores || [],
          recommendation: scoreResult?.recommendation || '',
        });
      } else {
        onProgress?.({ status: 'done', alternatives: allAlts, scores: [], recommendation: '' });
      }

      return newAlternatives;
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        onProgress?.({ status: 'error', error: err.message });
      }
      return [];
    } finally {
      setIsGenerating(false);
      setStageDetail(null);
      abortRef.current = null;
    }
  }, [alternatives, scoreAlternatives]);

  const handleExplore = useCallback((altIndex) => {
    const alt = alternatives.find(a => a.index === altIndex);
    if (!alt) return;

    if (selectedIndex === null) {
      previousNodesRef.current = [...rawNodesRef.current];
    }

    const flowNodes = alt.nodes.map(n => {
      const flowNode = buildFlowNode(n);
      if (alt.meta) flowNode.data.dynamicConfig = alt.meta;
      return flowNode;
    });

    rawNodesRef.current = flowNodes;
    applyLayout(rawNodesRef.current, drillStackRef?.current);
    setNodeCount?.(rawNodesRef.current.length);
    setSelectedIndex(altIndex);
  }, [alternatives, rawNodesRef, applyLayout, drillStackRef, setNodeCount, selectedIndex]);

  const handleRestoreOriginal = useCallback(() => {
    if (previousNodesRef.current) {
      rawNodesRef.current = previousNodesRef.current;
      applyLayout(rawNodesRef.current, drillStackRef?.current);
      setNodeCount?.(rawNodesRef.current.length);
      previousNodesRef.current = null;
    }
    setSelectedIndex(null);
  }, [rawNodesRef, applyLayout, drillStackRef, setNodeCount]);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    setAlternatives([]);
    setScores(null);
    setRecommendation('');
    setError(null);
    setStageDetail(null);
  }, []);

  return {
    generate,
    stop,
    reset,
    handleExplore,
    handleRestoreOriginal,
    isGenerating,
    isScoring,
    alternatives,
    scores,
    recommendation,
    stageDetail,
    error,
    selectedIndex,
  };
}
