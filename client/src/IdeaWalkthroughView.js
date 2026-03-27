// ── Idea Walkthrough View (Slide Deck Mode) ──────────────────
// Linearizes a thinking tree into a narrative walkthrough.
// Left rail: table of contents grouped by type.
// Main panel: one slide at a time (overview, section headers, node content, transitions).
// Uses research-backed ordering: Pyramid Principle, theme grouping, depth-first within themes.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getNodeConfig } from './nodeConfig';

// ── Slide types ──────────────────────────────────────────────
const SLIDE_OVERVIEW = 'overview';
const SLIDE_SECTION = 'section';
const SLIDE_NODE = 'node';
const SLIDE_TRANSITION = 'transition';

// ── Overview Slide ───────────────────────────────────────────
function OverviewSlide({ sections, domain, totalNodes }) {
  return (
    <div className="idea-wt-slide idea-wt-overview">
      <div className="idea-wt-overview-domain">{domain || 'Analysis'}</div>
      <h1 className="idea-wt-overview-title">Thinking Tree Overview</h1>
      <p className="idea-wt-overview-sub">{totalNodes} nodes across {sections.length} dimensions</p>
      <div className="idea-wt-overview-grid">
        {sections.map(sec => {
          const config = getNodeConfig(sec.type);
          return (
            <div key={sec.type} className="idea-wt-overview-group">
              <div className="idea-wt-overview-group-header" style={{ color: config.color }}>
                {config.icon} {config.label} <span className="idea-wt-overview-count">({sec.nodes.length})</span>
              </div>
              {sec.nodes.map(n => (
                <div key={n.id} className="idea-wt-overview-node">{n.data?.label}</div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="idea-wt-slide-hint">Press → or click Next to begin the walkthrough</div>
    </div>
  );
}

// ── Section Header Slide ─────────────────────────────────────
function SectionHeaderSlide({ section, index, totalSections }) {
  const config = getNodeConfig(section.type);
  return (
    <div className="idea-wt-slide idea-wt-section-slide">
      <div className="idea-wt-section-counter">Section {index + 1} of {totalSections}</div>
      <div className="idea-wt-section-icon" style={{ color: config.color }}>{config.icon}</div>
      <h2 className="idea-wt-section-title" style={{ color: config.color }}>{config.label}</h2>
      <p className="idea-wt-section-desc">{section.nodes.length} node{section.nodes.length !== 1 ? 's' : ''} in this dimension</p>
      <div className="idea-wt-section-preview">
        {section.nodes.map(n => (
          <span key={n.id} className="idea-wt-section-preview-chip" style={{ borderColor: `${config.color}44` }}>
            {n.data?.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Node Slide ───────────────────────────────────────────────
function NodeSlide({ node, parentNodes, onNodeFocus }) {
  const data = node.data || {};
  const config = getNodeConfig(data.type, data.dynamicConfig);

  return (
    <div className="idea-wt-slide idea-wt-node-slide">
      {/* Breadcrumb */}
      {parentNodes.length > 0 && (
        <div className="idea-wt-breadcrumb">
          {parentNodes.map((p, i) => (
            <span key={p.id}>
              <span className="idea-wt-breadcrumb-item">{p.data?.label}</span>
              {i < parentNodes.length - 1 && <span className="idea-wt-breadcrumb-sep"> → </span>}
            </span>
          ))}
          <span className="idea-wt-breadcrumb-sep"> → </span>
        </div>
      )}

      {/* Type + Score badges */}
      <div className="idea-wt-node-meta">
        <span className="idea-wt-node-type" style={{ color: config.color, borderColor: `${config.color}44`, background: `${config.color}12` }}>
          {config.icon} {config.label}
        </span>
        {data.score != null && (
          <span className="idea-wt-node-score">{data.score}/10</span>
        )}
        {data.lens && (
          <span className="idea-wt-node-lens">{data.lens}</span>
        )}
      </div>

      {/* Title */}
      <h2 className="idea-wt-node-title">{data.label}</h2>

      {/* Reasoning */}
      {data.reasoning && (
        <p className="idea-wt-node-reasoning">{data.reasoning}</p>
      )}

      {/* Actions */}
      <div className="idea-wt-node-actions">
        <button className="idea-wt-action-btn" onClick={() => onNodeFocus?.(node)} title="Chat about this node">
          💬 Discuss
        </button>
      </div>
    </div>
  );
}

// ── Transition Slide ─────────────────────────────────────────
function TransitionSlide({ prevSection, nextSection }) {
  const prevConfig = getNodeConfig(prevSection.type);
  const nextConfig = getNodeConfig(nextSection.type);
  return (
    <div className="idea-wt-slide idea-wt-transition">
      <div className="idea-wt-transition-summary">
        <span style={{ color: prevConfig.color }}>{prevConfig.icon}</span>
        We explored <strong>{prevSection.nodes.length} {prevConfig.label.toLowerCase()}</strong> node{prevSection.nodes.length !== 1 ? 's' : ''}.
      </div>
      <div className="idea-wt-transition-arrow">↓</div>
      <div className="idea-wt-transition-next">
        <span style={{ color: nextConfig.color }}>{nextConfig.icon}</span>
        Next: <strong>{nextConfig.label}</strong> — {nextSection.nodes.length} node{nextSection.nodes.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// ── Minimap ──────────────────────────────────────────────────
function WalkthroughMinimap({ sections, currentNodeId }) {
  // Simple grid-based minimap showing nodes as colored dots
  const allNodes = sections.flatMap(s => s.nodes);
  const cols = Math.ceil(Math.sqrt(allNodes.length));

  return (
    <div className="idea-wt-minimap">
      <div className="idea-wt-minimap-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {allNodes.map(n => {
          const config = getNodeConfig(n.data?.type, n.data?.dynamicConfig);
          const isCurrent = n.id === currentNodeId;
          return (
            <div
              key={n.id}
              className={`idea-wt-minimap-dot ${isCurrent ? 'current' : ''}`}
              style={{ background: isCurrent ? config.color : `${config.color}66` }}
              title={n.data?.label}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────
export default function IdeaWalkthroughView({
  displayNodes,
  dynamicDomain,
  dynamicLegendTypes,
  onNodeClick,
  onNodeFocus,
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [visited, setVisited] = useState(new Set([0]));

  // Build sections and slides
  const { sections, slides, nodeMap } = useMemo(() => {
    if (!displayNodes?.length) return { sections: [], slides: [], nodeMap: new Map() };

    const nMap = new Map(displayNodes.map(n => [n.id, n]));

    // Separate seed from other nodes
    const seed = displayNodes.find(n => n.data?.type === 'seed');
    const rest = displayNodes.filter(n => n.data?.type !== 'seed');

    // Get type ordering from _meta (dynamicLegendTypes) or fall back to frequency
    let typeOrder;
    if (dynamicLegendTypes?.length) {
      typeOrder = dynamicLegendTypes.map(t => t.type || t).filter(t => t !== 'seed');
    } else {
      // Count by type, sort by frequency descending
      const typeCounts = {};
      rest.forEach(n => { typeCounts[n.data?.type] = (typeCounts[n.data?.type] || 0) + 1; });
      typeOrder = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    }

    // Group nodes by type
    const groups = {};
    rest.forEach(n => {
      const t = n.data?.type || 'unknown';
      if (!groups[t]) groups[t] = [];
      groups[t].push(n);
    });

    // Sort within each group: by depth, then by parent grouping
    Object.values(groups).forEach(nodes => {
      nodes.sort((a, b) => {
        const da = a.data?.depth ?? 99;
        const db = b.data?.depth ?? 99;
        if (da !== db) return da - db;
        // Keep siblings together
        const pa = (a.data?.parentIds || [])[0] || '';
        const pb = (b.data?.parentIds || [])[0] || '';
        return pa.localeCompare(pb);
      });
    });

    // Build ordered sections
    const secs = [];
    for (const type of typeOrder) {
      if (groups[type]?.length) {
        secs.push({ type, nodes: groups[type] });
        delete groups[type];
      }
    }
    // Add any remaining types not in typeOrder
    for (const [type, nodes] of Object.entries(groups)) {
      if (nodes.length) secs.push({ type, nodes });
    }

    // Build slide list
    const sl = [];

    // 1. Overview slide
    sl.push({ type: SLIDE_OVERVIEW, sections: secs });

    // 2. Seed node slide (if exists)
    if (seed) {
      sl.push({ type: SLIDE_NODE, node: seed, sectionIdx: -1 });
    }

    // 3. For each section: header → nodes → transition to next
    secs.forEach((sec, si) => {
      sl.push({ type: SLIDE_SECTION, section: sec, sectionIdx: si });
      sec.nodes.forEach(n => {
        sl.push({ type: SLIDE_NODE, node: n, sectionIdx: si });
      });
      // Transition to next section (if not last)
      if (si < secs.length - 1) {
        sl.push({ type: SLIDE_TRANSITION, prevSection: sec, nextSection: secs[si + 1] });
      }
    });

    return { sections: secs, slides: sl, nodeMap: nMap };
  }, [displayNodes, dynamicLegendTypes]);

  // Get parent nodes for breadcrumb
  const getParentNodes = useCallback((node) => {
    const parentIds = node?.data?.parentIds || [];
    return parentIds.map(pid => nodeMap.get(pid)).filter(Boolean);
  }, [nodeMap]);

  // Navigation
  const goTo = useCallback((idx) => {
    if (idx >= 0 && idx < slides.length) {
      setCurrentIdx(idx);
      setVisited(prev => new Set([...prev, idx]));
      // If it's a node slide, trigger onNodeClick
      const slide = slides[idx];
      if (slide?.type === SLIDE_NODE && slide.node) {
        onNodeClick?.(slide.node);
      }
    }
  }, [slides, onNodeClick]);

  const goNext = useCallback(() => goTo(currentIdx + 1), [currentIdx, goTo]);
  const goPrev = useCallback(() => goTo(currentIdx - 1), [currentIdx, goTo]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  const currentSlide = slides[currentIdx];
  const currentNodeId = currentSlide?.type === SLIDE_NODE ? currentSlide.node?.id : null;
  const totalNodes = displayNodes?.length || 0;
  const nodeSlideCount = slides.filter(s => s.type === SLIDE_NODE).length;
  const visitedNodeCount = slides.filter((s, i) => s.type === SLIDE_NODE && visited.has(i)).length;
  const pct = nodeSlideCount > 0 ? Math.round((visitedNodeCount / nodeSlideCount) * 100) : 0;

  if (!slides.length) {
    return <div className="idea-wt-empty">No nodes to walk through</div>;
  }

  return (
    <div className="idea-walkthrough">
      {/* Left Rail — Table of Contents */}
      <div className="idea-walkthrough-rail">
        <div className="idea-wt-progress">
          <div className="idea-wt-progress-track">
            <div className="idea-wt-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="idea-wt-progress-label">{visitedNodeCount}/{nodeSlideCount} explored ({pct}%)</span>
        </div>

        <div className="idea-wt-toc">
          {/* Overview item */}
          <button
            className={`idea-wt-toc-item idea-wt-toc-overview ${currentIdx === 0 ? 'active' : ''}`}
            onClick={() => goTo(0)}
          >
            ◈ Overview
          </button>

          {/* Seed */}
          {slides[1]?.type === SLIDE_NODE && slides[1].node?.data?.type === 'seed' && (
            <button
              className={`idea-wt-toc-item ${currentIdx === 1 ? 'active' : ''} ${visited.has(1) ? 'visited' : ''}`}
              onClick={() => goTo(1)}
              style={{ borderLeftColor: getNodeConfig('seed').color }}
            >
              ◈ {slides[1].node.data?.label}
            </button>
          )}

          {/* Sections with their nodes */}
          {sections.map((sec, si) => {
            const config = getNodeConfig(sec.type);
            // Find slide indices for this section
            const sectionSlideIdx = slides.findIndex(s => s.type === SLIDE_SECTION && s.sectionIdx === si);

            return (
              <div key={sec.type} className="idea-wt-toc-section">
                <button
                  className={`idea-wt-toc-section-header ${currentIdx === sectionSlideIdx ? 'active' : ''}`}
                  onClick={() => goTo(sectionSlideIdx)}
                  style={{ color: config.color }}
                >
                  {config.icon} {config.label} <span className="idea-wt-toc-count">{sec.nodes.length}</span>
                </button>
                {sec.nodes.map(n => {
                  const nodeSlideIdx = slides.findIndex(s => s.type === SLIDE_NODE && s.node?.id === n.id);
                  return (
                    <button
                      key={n.id}
                      className={`idea-wt-toc-item ${currentIdx === nodeSlideIdx ? 'active' : ''} ${visited.has(nodeSlideIdx) ? 'visited' : ''}`}
                      onClick={() => goTo(nodeSlideIdx)}
                      style={{ borderLeftColor: config.color }}
                    >
                      {n.data?.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Panel — Current Slide */}
      <div className="idea-walkthrough-main">
        <div className="idea-wt-slide-container">
          {currentSlide.type === SLIDE_OVERVIEW && (
            <OverviewSlide sections={sections} domain={dynamicDomain} totalNodes={totalNodes} />
          )}
          {currentSlide.type === SLIDE_SECTION && (
            <SectionHeaderSlide section={currentSlide.section} index={currentSlide.sectionIdx} totalSections={sections.length} />
          )}
          {currentSlide.type === SLIDE_NODE && (
            <NodeSlide
              node={currentSlide.node}
              parentNodes={getParentNodes(currentSlide.node)}
              onNodeFocus={onNodeFocus}
            />
          )}
          {currentSlide.type === SLIDE_TRANSITION && (
            <TransitionSlide prevSection={currentSlide.prevSection} nextSection={currentSlide.nextSection} />
          )}
        </div>

        {/* Navigation */}
        <div className="idea-wt-nav">
          <button className="idea-wt-nav-btn" onClick={goPrev} disabled={currentIdx <= 0}>
            ← Previous
          </button>
          <span className="idea-wt-nav-pos">
            {currentIdx + 1} / {slides.length}
          </span>
          <button className="idea-wt-nav-btn" onClick={goNext} disabled={currentIdx >= slides.length - 1}>
            Next →
          </button>
        </div>

        {/* Minimap */}
        {sections.length > 0 && (
          <WalkthroughMinimap sections={sections} currentNodeId={currentNodeId} />
        )}
      </div>
    </div>
  );
}
