// ── Learn Journey View ────────────────────────────────────────
// Replaces FlowchartView for Learn Mode with a linear path + focus panel.
// Left rail: ordered concept list with mastery rings.
// Main panel: concept detail or active LearnCard.

import React, { useState, useEffect, useMemo } from 'react';
import LearnCard from './chat/LearnCard';
import { getNodeConfig } from './nodeConfig';

// ── Mastery Ring (SVG) ──────────────────────────────────────
function MasteryRing({ mastery, size = 28 }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(mastery / 10, 1);
  const dashArray = `${circumference * progress} ${circumference * (1 - progress)}`;
  const color = mastery >= 8 ? '#22c55e' : mastery >= 5 ? '#fbbf24' : mastery >= 1 ? '#ef4444' : '#374151';
  const bgColor = mastery >= 8 ? '#22c55e22' : '#374151';

  return (
    <svg width={size} height={size} className="learn-mastery-ring">
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={bgColor} strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={dashArray}
        strokeDashoffset={circumference * 0.25}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.4s ease' }} />
      {mastery >= 8 && (
        <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize={10} fontWeight={700}>✓</text>
      )}
      {mastery > 0 && mastery < 8 && (
        <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize={8} fontWeight={700}>{mastery}</text>
      )}
    </svg>
  );
}

// ── Concept Detail (no active learn loop) ────────────────────
function ConceptDetail({ concept, mastery, onStartLearn }) {
  const data = concept.data || concept;
  const config = getNodeConfig(data.type, data.dynamicConfig);
  const score = mastery?.score || 0;
  const statusLabel = score >= 8 ? 'Mastered' : score >= 5 ? 'Partial' : score >= 1 ? 'In Progress' : 'Not Started';
  const statusColor = score >= 8 ? '#22c55e' : score >= 5 ? '#fbbf24' : score >= 1 ? '#ef4444' : '#6b7280';

  return (
    <div className="learn-journey-concept">
      <div className="learn-journey-concept-meta">
        <span className="learn-journey-concept-type" style={{ color: config.color, borderColor: `${config.color}44`, background: `${config.color}12` }}>
          {config.icon} {config.label}
        </span>
        <span className="learn-journey-concept-status" style={{ color: statusColor, borderColor: `${statusColor}44`, background: `${statusColor}12` }}>
          {score}/10 {statusLabel}
        </span>
      </div>

      <h2 className="learn-journey-concept-title">{data.label}</h2>

      {data.reasoning && (
        <p className="learn-journey-concept-reasoning">{data.reasoning}</p>
      )}

      <button className="learn-journey-start-btn" onClick={() => onStartLearn(concept.id)}>
        {score >= 8 ? '↻ Review This Concept' : score > 0 ? '▶ Continue Learning' : '▶ Start Learning'}
      </button>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────
export default function LearnJourneyView({
  displayNodes,
  learnStream,
  masteryMap = {},
  isLearning,
  onConceptClick,
  onStartLearn,
  onAction,
  mnemonicJobs = {},
  onGenerateVideo,
  onPlayVideo,
}) {
  const [selectedId, setSelectedId] = useState(null);

  // Sort concepts into learning order (prerequisites first, then by difficulty/depth)
  const orderedConcepts = useMemo(() => {
    if (!displayNodes?.length) return [];

    const learnable = displayNodes.filter(n => {
      const t = n.data?.type;
      return t === 'concept' || t === 'prerequisite' || t === 'exercise' || t === 'milestone';
    });

    // Build depth map via BFS from seed
    const depthMap = new Map();
    const queue = [];
    displayNodes.forEach(n => {
      const pids = n.data?.parentIds || [];
      if (pids.length === 0 || n.data?.type === 'seed') {
        depthMap.set(n.id, 0);
        queue.push(n.id);
      }
    });
    while (queue.length) {
      const id = queue.shift();
      const depth = depthMap.get(id);
      displayNodes.forEach(n => {
        if ((n.data?.parentIds || []).includes(id) && !depthMap.has(n.id)) {
          depthMap.set(n.id, depth + 1);
          queue.push(n.id);
        }
      });
    }

    // Sort: type priority (prerequisite < concept < exercise < milestone), then depth, then difficulty
    const typePriority = { prerequisite: 0, concept: 1, exercise: 2, milestone: 3 };
    return [...learnable].sort((a, b) => {
      const ta = typePriority[a.data?.type] ?? 1;
      const tb = typePriority[b.data?.type] ?? 1;
      if (ta !== tb) return ta - tb;
      const da = depthMap.get(a.id) ?? 99;
      const db = depthMap.get(b.id) ?? 99;
      if (da !== db) return da - db;
      return (a.data?.difficulty || 1) - (b.data?.difficulty || 1);
    });
  }, [displayNodes]);

  // Auto-select first concept if none selected
  useEffect(() => {
    if (!selectedId && orderedConcepts.length > 0) {
      setSelectedId(orderedConcepts[0].id);
    }
  }, [orderedConcepts, selectedId]);

  // Auto-advance when learn loop changes concept
  useEffect(() => {
    if (learnStream?.conceptId) {
      setSelectedId(learnStream.conceptId);
    }
  }, [learnStream?.conceptId]);

  // Compute progress
  const { mastered, total } = useMemo(() => {
    const learnableConcepts = orderedConcepts.filter(n =>
      n.data?.type === 'concept' || n.data?.type === 'prerequisite'
    );
    const masteredCount = learnableConcepts.filter(n =>
      (masteryMap[n.id]?.score || 0) >= 8
    ).length;
    return { mastered: masteredCount, total: learnableConcepts.length };
  }, [orderedConcepts, masteryMap]);

  const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
  const selectedConcept = orderedConcepts.find(n => n.id === selectedId);
  const selectedIdx = orderedConcepts.findIndex(n => n.id === selectedId);

  const handleSelect = (concept) => {
    setSelectedId(concept.id);
    onConceptClick?.(concept.id);
  };

  const goPrev = () => {
    if (selectedIdx > 0) handleSelect(orderedConcepts[selectedIdx - 1]);
  };
  const goNext = () => {
    if (selectedIdx < orderedConcepts.length - 1) handleSelect(orderedConcepts[selectedIdx + 1]);
  };

  return (
    <div className="learn-journey">
      {/* Left Rail */}
      <div className="learn-journey-rail">
        <div className="learn-journey-progress">
          <div className="learn-journey-progress-track">
            <div className="learn-journey-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="learn-journey-progress-label">
            {mastered}/{total} concepts {pct === 100 ? 'mastered' : `(${pct}%)`}
          </span>
        </div>

        <div className="learn-journey-stops">
          {orderedConcepts.map((concept, i) => {
            const score = masteryMap[concept.id]?.score || 0;
            const isMastered = score >= 8;
            const isActive = concept.id === selectedId;
            const isCurrentLearn = learnStream?.conceptId === concept.id;
            const config = getNodeConfig(concept.data?.type, concept.data?.dynamicConfig);

            return (
              <button
                key={concept.id}
                className={`learn-journey-stop ${isActive ? 'active' : ''} ${isMastered ? 'mastered' : ''} ${isCurrentLearn ? 'learning' : ''}`}
                onClick={() => handleSelect(concept)}
              >
                {/* Connector line */}
                {i > 0 && <div className="learn-journey-connector" />}

                <MasteryRing mastery={score} />

                <div className="learn-journey-stop-text">
                  <span className="learn-journey-stop-label">{concept.data?.label}</span>
                  <span className="learn-journey-stop-type" style={{ color: config.color }}>
                    {config.icon} {concept.data?.type}
                  </span>
                </div>

                {isCurrentLearn && <span className="learn-journey-pulse">●</span>}
                {mnemonicJobs[concept.id]?.status === 'complete' && (
                  <span className="learn-journey-video-icon" title="Video available">▶</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Panel */}
      <div className="learn-journey-main">
        {learnStream && learnStream.conceptId === selectedId ? (
          <LearnCard
            state={learnStream}
            onAction={onAction}
            mnemonicJob={learnStream?.conceptId ? mnemonicJobs[learnStream.conceptId] : null}
            onGenerateVideo={onGenerateVideo}
            onPlayVideo={onPlayVideo}
          />
        ) : selectedConcept ? (
          <ConceptDetail
            concept={selectedConcept}
            mastery={masteryMap[selectedConcept.id]}
            onStartLearn={onStartLearn}
          />
        ) : (
          <div className="learn-journey-empty">
            <span style={{ fontSize: 32, opacity: 0.3 }}>⧫</span>
            <p>Select a concept from the path to begin learning</p>
          </div>
        )}

        {/* Navigation */}
        <div className="learn-journey-nav">
          <button className="learn-journey-nav-btn" onClick={goPrev} disabled={selectedIdx <= 0}>
            ← Previous
          </button>
          <span className="learn-journey-nav-pos">
            {selectedIdx + 1} / {orderedConcepts.length}
          </span>
          <button className="learn-journey-nav-btn" onClick={goNext} disabled={selectedIdx >= orderedConcepts.length - 1}>
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
