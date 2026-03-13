// ── Portfolio Panel ───────────────────────────────────────────
// Side panel showing alternative approaches with tab navigation and scoring.

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
  user_value: 'User Value',
  market_differentiation: 'Differentiation',
  risk_reduction: 'Risk Reduction',
  developer_velocity: 'Dev Velocity',
  migration_effort: 'Migration',
  long_term_value: 'Long-term',
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
  focus,
  onClose,
  portfolioData,
  onPortfolioDataChange,
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
  // Lifted state from App.js
  const { alternatives, scores, recommendation } = portfolioData;

  // Local ephemeral UI state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [activeTab, setActiveTab] = useState(null); // tracks by alt.index
  const [error, setError] = useState(null);
  const [stageDetail, setStageDetail] = useState(null);
  const abortRef = useRef(null);
  const previousNodesRef = useRef(null);
  const autoGenTriggeredRef = useRef(false);
  const handleGenerateRef = useRef(null);

  // Auto-select first tab when alternatives arrive
  useEffect(() => {
    if (alternatives.length > 0 && activeTab === null) {
      setActiveTab(alternatives[0].index);
    }
  }, [alternatives, activeTab]);

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
          setError(null);
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
          // Portfolio marker — ignored
        } else if (data._alternative) {
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

      onPortfolioDataChange(prev => ({ ...prev, alternatives: [...prev.alternatives, ...newAlternatives] }));

      // Auto-select first new tab if none selected
      if (newAlternatives.length > 0 && activeTab === null) {
        setActiveTab(newAlternatives[0].index);
      }

      // Auto-score after generation
      if (newAlternatives.length > 0) {
        setStageDetail('Scoring alternatives...');
        onPipelineUpdate?.({ status: 'active', detail: `Scoring ${newAlternatives.length} alternatives...`, substages: null });
        await scoreAlternatives([...alternatives, ...newAlternatives]);
      }
      onPipelineUpdate?.({ status: 'done', detail: `${newAlternatives.length} alternatives generated`, substages: null });
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setIsGenerating(false);
      setStageDetail(null);
      abortRef.current = null;
    }
  }, [idea, mode, alternatives, activeTab, onPipelineUpdate, onPortfolioDataChange]); // eslint-disable-line react-hooks/exhaustive-deps

  handleGenerateRef.current = handleGenerate;

  // Auto-generate when autoGenerate prop becomes true
  useEffect(() => {
    if (!autoGenerate) return;
    if (autoGenTriggeredRef.current) return;
    const timer = setTimeout(() => {
      if (handleGenerateRef.current && !autoGenTriggeredRef.current) {
        autoGenTriggeredRef.current = true;
        handleGenerateRef.current(3);
        onAutoGenDone?.();
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [autoGenerate]); // eslint-disable-line react-hooks/exhaustive-deps

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
          ...(focus && { focus }),
        }),
      });
      if (!res.ok) throw new Error(`Score error: ${res.status}`);
      const result = await res.json();
      onPortfolioDataChange(prev => ({
        ...prev,
        scores: result.scores || [],
        recommendation: result.recommendation || '',
      }));
    } catch (err) {
      console.error('Portfolio score error:', err);
    } finally {
      setIsScoring(false);
    }
  }, [idea, mode, focus, onPortfolioDataChange]);

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

  // Find active tab's alternative
  const activeAlt = sortedAlternatives.find(a => a.index === activeTab) || sortedAlternatives[0] || null;

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

      {/* Tab Bar */}
      {sortedAlternatives.length > 0 && (
        <div className="portfolio-tabs">
          {sortedAlternatives.map((alt) => {
            const isActive = activeTab === alt.index;
            return (
              <button
                key={alt.index}
                className={`portfolio-tab${isActive ? ' portfolio-tab-active' : ''}`}
                onClick={() => setActiveTab(alt.index)}
                title={alt.title}
              >
                <span className="portfolio-tab-rank">
                  {alt.score?.rank === 1 ? '★' : `#${alt.score?.rank || alt.index + 1}`}
                </span>
                <span className="portfolio-tab-label">{alt.title}</span>
                {alt.score && (
                  <span className="portfolio-tab-score">{alt.score.composite?.toFixed?.(1)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Active Alternative Card (expanded) */}
      {activeAlt && (
        <div className="portfolio-cards">
          <div className={`portfolio-card ${selectedIndex === activeAlt.index ? 'selected' : ''}`}>
            <div className="portfolio-card-header">
              <div className="portfolio-card-rank">
                {activeAlt.score?.rank === 1 ? '★' : `#${activeAlt.score?.rank || activeAlt.index + 1}`}
              </div>
              <div className="portfolio-card-title">{activeAlt.title}</div>
              {activeAlt.score && (
                <div className="portfolio-card-score">
                  {activeAlt.score.composite?.toFixed?.(1) || activeAlt.score.composite}
                </div>
              )}
            </div>

            <div className="portfolio-card-thesis">{activeAlt.thesis}</div>

            {activeAlt.score?.dimensions && (
              <div className="portfolio-dimensions">
                {Object.entries(activeAlt.score.dimensions).map(([dim, val]) => (
                  <DimensionBar key={dim} name={dim} score={val.score} />
                ))}
              </div>
            )}

            {activeAlt.score?.recommendation && (
              <div className="portfolio-card-rec">{activeAlt.score.recommendation}</div>
            )}

            <div className="portfolio-card-actions">
              <button
                className={`portfolio-btn ${selectedIndex === activeAlt.index ? 'active' : ''}`}
                onClick={() => selectedIndex === activeAlt.index ? handleRestoreOriginal() : handleExplore(activeAlt.index)}
              >
                {selectedIndex === activeAlt.index ? '← BACK' : 'EXPLORE'}
              </button>
              <button
                className="portfolio-btn portfolio-btn-refine"
                onClick={() => handleExploreAndRefine(activeAlt.index)}
              >
                REFINE
              </button>
              <span className="portfolio-node-count">{activeAlt.nodes.length} nodes</span>
            </div>
          </div>
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
