// ── Portfolio Panel ───────────────────────────────────────────
// Side panel showing 3-5 alternative approaches with scoring.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { buildFlowNode, readSSEStream } from './useCanvasMode';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

const DIMENSION_LABELS = {
  market_size: 'Market',
  defensibility: 'Moat',
  execution_feasibility: 'Execution',
  innovation: 'Innovation',
  match_strength: 'Match',
  story_quality: 'Stories',
  positioning_uniqueness: 'Position',
  keyword_coverage: 'Keywords',
  architecture_quality: 'Architecture',
  maintainability: 'Maintain',
  scalability: 'Scale',
  team_fit: 'Team Fit',
  risk_adjusted_outcome: 'Risk-Adj',
  reversibility: 'Reversible',
  confidence: 'Confidence',
  second_order_effects: '2nd Order',
  argument_strength: 'Argument',
  novelty: 'Novelty',
  evidence_quality: 'Evidence',
  audience_resonance: 'Audience',
  feasibility: 'Feasible',
  resource_efficiency: 'Resources',
  risk_mitigation: 'Risk',
  speed_to_value: 'Speed',
};

function DimensionBar({ name, score }) {
  const label = DIMENSION_LABELS[name] || name;
  const pct = (score / 10) * 100;
  const color = score >= 8 ? '#22c55e' : score >= 5 ? '#f59e0b' : '#ef4444';
  return (
    <div className="portfolio-dimension">
      <span className="portfolio-dim-label">{label}</span>
      <div className="portfolio-dim-track">
        <div className="portfolio-dim-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="portfolio-dim-score">{score}</span>
    </div>
  );
}

export default function PortfolioPanel({
  idea,
  mode,
  onClose,
  rawNodesRef,
  applyLayout,
  drillStackRef,
  setNodeCount,
  yjsSyncRef,
  onStartRefine,
  autoGenerate,
  onAutoGenDone,
  onPipelineUpdate,
}) {
  const [alternatives, setAlternatives] = useState([]);
  const [scores, setScores] = useState(null);
  const [recommendation, setRecommendation] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [error, setError] = useState(null);
  const [stageDetail, setStageDetail] = useState(null); // current substage label for progress display
  const abortRef = useRef(null);
  const previousNodesRef = useRef(null); // Store canvas state before switching
  const autoGenTriggeredRef = useRef(false); // Prevent double-trigger
  const handleGenerateRef = useRef(null); // Stable ref for auto-gen effect

  const handleGenerate = useCallback(async (count = 3, existingTitles = []) => {
    setIsGenerating(true);
    setError(null);
    setStageDetail('Initializing research pipeline...');
    onPipelineUpdate?.({ status: 'active', detail: 'Starting research pipeline...' });

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const res = await authFetch(`${API_URL}/api/portfolio/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea, mode: mode || 'idea', count, existingTitles,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) throw new Error(`Generate error: ${res.status}`);

      let currentAlt = null;
      const newAlternatives = [];

      await readSSEStream(res, (data) => {
        if (data._progress) {
          // Progress event from research/multi-agent pipeline — update loading text
          setStageDetail(data.stage || 'Processing...');
          setError(null); // clear any prior errors
          onPipelineUpdate?.({
            status: 'active',
            detail: data.stage || 'Processing...',
            substages: [
              { label: 'Research', status: data.stage?.includes('research') || data.stage?.includes('Research') ? 'active' : data.stage?.includes('lens') || data.stage?.includes('Lens') || data.stage?.includes('Generat') ? 'done' : 'pending' },
              { label: 'Lenses', status: data.stage?.includes('lens') || data.stage?.includes('Lens') ? 'active' : data.stage?.includes('Generat') ? 'done' : 'pending' },
              { label: 'Generate', status: data.stage?.includes('Generat') ? 'active' : 'pending' },
            ],
          });
          return;
        }
        if (data._portfolio) {
          // Portfolio marker — ignored for now
        } else if (data._alternative) {
          // New alternative starts
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

      setAlternatives(prev => [...prev, ...newAlternatives]);

      // Auto-score after generation
      if (newAlternatives.length > 0) {
        setStageDetail('Scoring alternatives...');
        onPipelineUpdate?.({ status: 'active', detail: `Scoring ${newAlternatives.length} alternatives...`, substages: null });
        await scoreAlternatives([...alternatives, ...newAlternatives]);
      }
      // Pipeline: portfolio done
      onPipelineUpdate?.({ status: 'done', detail: `${newAlternatives.length} alternatives generated`, substages: null });
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setIsGenerating(false);
      setStageDetail(null);
      abortRef.current = null;
    }
  }, [idea, mode, alternatives, onPipelineUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a stable ref to handleGenerate for the auto-gen effect
  handleGenerateRef.current = handleGenerate;

  // Auto-generate when autoGenerate prop becomes true (post-debate automation)
  useEffect(() => {
    if (!autoGenerate) return;
    if (autoGenTriggeredRef.current) return;
    // Delay to ensure refs are populated and component is fully mounted
    const timer = setTimeout(() => {
      if (handleGenerateRef.current && !autoGenTriggeredRef.current) {
        autoGenTriggeredRef.current = true;
        handleGenerateRef.current(3);
        // Reset the flag in parent so reopening the panel doesn't re-trigger
        onAutoGenDone?.();
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [autoGenerate]); // eslint-disable-line react-hooks/exhaustive-deps -- fire when autoGenerate becomes true

  const scoreAlternatives = useCallback(async (alts) => {
    setIsScoring(true);
    try {
      const res = await authFetch(`${API_URL}/api/portfolio/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alternatives: alts.map(a => ({
            index: a.index, title: a.title, thesis: a.thesis, nodes: a.nodes,
          })),
          idea, mode: mode || 'idea',
        }),
      });
      if (!res.ok) throw new Error(`Score error: ${res.status}`);
      const result = await res.json();
      setScores(result.scores || []);
      setRecommendation(result.recommendation || '');
    } catch (err) {
      console.error('Portfolio score error:', err);
    } finally {
      setIsScoring(false);
    }
  }, [idea, mode]);

  const handleExplore = useCallback((altIndex) => {
    const alt = alternatives.find(a => a.index === altIndex);
    if (!alt) return;

    // Save current canvas state for switching back
    if (selectedIndex === null) {
      previousNodesRef.current = [...rawNodesRef.current];
    }

    // Load alternative's nodes into canvas
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

  const handleExploreAndRefine = useCallback((altIndex) => {
    handleExplore(altIndex);
    onStartRefine?.();
  }, [handleExplore, onStartRefine]);

  const handleAutoPickAndRefine = useCallback(() => {
    if (!scores?.length) return;
    const topRanked = scores.reduce((best, s) => (!best || s.rank < best.rank) ? s : best, null);
    if (topRanked) {
      handleExplore(topRanked.alternativeIndex);
      onStartRefine?.();
    }
  }, [scores, handleExplore, onStartRefine]);

  const handleGenerateMore = useCallback(() => {
    const existingTitles = alternatives.map(a => a.title);
    handleGenerate(2, existingTitles);
  }, [alternatives, handleGenerate]);

  // Sort alternatives by rank if scored
  const sortedAlternatives = alternatives.map(alt => {
    const score = scores?.find(s => s.alternativeIndex === alt.index);
    return { ...alt, score };
  }).sort((a, b) => {
    if (a.score && b.score) return a.score.rank - b.score.rank;
    return a.index - b.index;
  });

  return (
    <div className="portfolio-panel">
      {/* Header */}
      <div className="portfolio-header">
        <span className="portfolio-title">
          ◈ PORTFOLIO
          {alternatives.length > 0 && (
            <span className="portfolio-count">({alternatives.length} alternatives)</span>
          )}
        </span>
        <button className="panel-close-btn" onClick={onClose}>✕</button>
      </div>

      {/* Initial state */}
      {alternatives.length === 0 && !isGenerating && (
        <div className="portfolio-empty">
          <div className="portfolio-empty-text">
            Generate 3-5 alternative approaches to explore different directions for your idea.
          </div>
          <button
            className="btn btn-generate"
            onClick={() => handleGenerate(3)}
            style={{ width: '100%', marginTop: 12 }}
          >
            ◈ GENERATE ALTERNATIVES
          </button>
        </div>
      )}

      {/* Loading */}
      {isGenerating && (
        <div className="portfolio-loading">
          <span className="refine-pulse">●</span> Generating alternatives...
          {stageDetail && (
            <div className="portfolio-stage-detail">
              <span className="refine-pulse" style={{ color: '#a29bfe' }}>●</span>
              {stageDetail}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="portfolio-error">Error: {error}</div>
      )}

      {/* AI Recommendation */}
      {recommendation && (
        <div className="portfolio-recommendation">
          {recommendation}
        </div>
      )}

      {/* Alternative Cards */}
      {sortedAlternatives.length > 0 && (
        <div className="portfolio-cards">
          {sortedAlternatives.map((alt) => {
            const isSelected = selectedIndex === alt.index;
            return (
              <div key={alt.index} className={`portfolio-card ${isSelected ? 'selected' : ''}`}>
                <div className="portfolio-card-header">
                  <div className="portfolio-card-rank">
                    {alt.score?.rank === 1 ? '★' : `#${alt.score?.rank || alt.index + 1}`}
                  </div>
                  <div className="portfolio-card-title">{alt.title}</div>
                  {alt.score && (
                    <div className="portfolio-card-score">
                      {alt.score.composite?.toFixed?.(1) || alt.score.composite}
                    </div>
                  )}
                </div>

                <div className="portfolio-card-thesis">{alt.thesis}</div>

                {alt.score?.dimensions && (
                  <div className="portfolio-dimensions">
                    {Object.entries(alt.score.dimensions).map(([dim, val]) => (
                      <DimensionBar key={dim} name={dim} score={val.score} />
                    ))}
                  </div>
                )}

                <div className="portfolio-card-actions">
                  <button
                    className={`portfolio-btn ${isSelected ? 'active' : ''}`}
                    onClick={() => isSelected ? handleRestoreOriginal() : handleExplore(alt.index)}
                  >
                    {isSelected ? '← BACK' : 'EXPLORE'}
                  </button>
                  <button
                    className="portfolio-btn portfolio-btn-refine"
                    onClick={() => handleExploreAndRefine(alt.index)}
                  >
                    REFINE
                  </button>
                  <span className="portfolio-node-count">{alt.nodes.length} nodes</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Scoring indicator */}
      {isScoring && (
        <div className="portfolio-loading" style={{ marginTop: 8 }}>
          <span className="refine-pulse" style={{ color: '#f59e0b' }}>●</span> Scoring alternatives...
        </div>
      )}

      {/* Footer controls */}
      {alternatives.length > 0 && !isGenerating && (
        <div className="portfolio-footer">
          <button className="portfolio-btn" onClick={handleGenerateMore}>
            + MORE
          </button>
          {scores?.length > 0 && (
            <button className="portfolio-btn portfolio-btn-refine" onClick={handleAutoPickAndRefine}>
              AUTO-PICK & REFINE
            </button>
          )}
        </div>
      )}
    </div>
  );
}
