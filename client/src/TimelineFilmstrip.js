// ── Timeline Filmstrip ───────────────────────────────────────
// Compact navigation bar: transport controls + type-grouped node chips.
// Click a type group to filter the canvas. Click a node chip to select it.

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { getNodeConfig } from './nodeConfig';
import './TimelineFilmstrip.css';

export default function TimelineFilmstrip({
  topoOrder,
  currentIndex,
  isPlaying,
  onGoToIndex,
  onTogglePlay,
  onGoNext,
  onGoPrev,
  onFilterChange,
}) {
  const [expandedType, setExpandedType] = useState(null);
  const activeRef = useRef(null);
  const scrollRef = useRef(null);

  // Auto-scroll to keep active item visible
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [currentIndex]);

  // Group nodes by type
  const typeGroups = useMemo(() => {
    if (!topoOrder?.length) return [];
    const map = new Map();
    topoOrder.forEach((node, idx) => {
      const t = node.data?.type || node.type || 'unknown';
      if (!map.has(t)) {
        const config = getNodeConfig(t, node.data?.dynamicConfig);
        map.set(t, { type: t, config, nodes: [], indices: [] });
      }
      map.get(t).nodes.push(node);
      map.get(t).indices.push(idx);
    });
    return [...map.values()].sort((a, b) => a.indices[0] - b.indices[0]);
  }, [topoOrder]);

  const handleTypeClick = useCallback((type) => {
    if (expandedType === type) {
      setExpandedType(null);
      onFilterChange?.(null);
    } else {
      setExpandedType(type);
      onFilterChange?.({ visibleTypes: [type] });
      // Jump to first node of this type
      const group = typeGroups.find(g => g.type === type);
      if (group?.indices[0] !== undefined) onGoToIndex(group.indices[0]);
    }
  }, [expandedType, typeGroups, onGoToIndex, onFilterChange]);

  const handleNodeClick = useCallback((topoIdx) => {
    onGoToIndex(topoIdx);
  }, [onGoToIndex]);

  if (!topoOrder?.length) return null;

  return (
    <div className="filmstrip">
      {/* Transport controls */}
      <div className="filmstrip-transport">
        <button className="filmstrip-btn" onClick={onGoPrev} title="Previous (J)">◄</button>
        <button className="filmstrip-btn" onClick={onTogglePlay} title="Play/Pause (K)">
          {isPlaying ? '■' : '►'}
        </button>
        <button className="filmstrip-btn" onClick={onGoNext} title="Next (L)">►</button>
        <button
          className="filmstrip-btn filmstrip-btn-list"
          onClick={() => { setExpandedType(null); onFilterChange?.(null); }}
          title="Show all"
        >
          ☰
        </button>
        <span className="filmstrip-counter">
          {currentIndex >= 0 ? currentIndex + 1 : '–'}/{topoOrder.length}
        </span>
      </div>

      {/* Type chips */}
      <div className="filmstrip-types" ref={scrollRef}>
        {typeGroups.map(group => (
          <div key={group.type} className="filmstrip-type-group">
            <button
              className={`filmstrip-type-chip ${expandedType === group.type ? 'expanded' : ''}`}
              style={{ '--chip-color': group.config.color }}
              onClick={() => handleTypeClick(group.type)}
              title={`${group.type} (${group.nodes.length})`}
            >
              <span className="filmstrip-chip-dot" style={{ background: group.config.color }} />
              <span className="filmstrip-chip-label">{group.type.replace(/_/g, ' ')}</span>
              <span className="filmstrip-chip-count">{group.nodes.length}</span>
            </button>

            {/* Expanded: show individual nodes */}
            {expandedType === group.type && (
              <div className="filmstrip-expanded-nodes">
                {group.nodes.map((node, i) => {
                  const topoIdx = group.indices[i];
                  const isActive = topoIdx === currentIndex;
                  const label = node.data?.label || node.label || '?';
                  return (
                    <button
                      key={node.id}
                      ref={isActive ? activeRef : null}
                      className={`filmstrip-node-chip ${isActive ? 'active' : ''}`}
                      style={{ '--chip-color': group.config.color }}
                      onClick={() => handleNodeClick(topoIdx)}
                      title={label}
                    >
                      {label.length > 18 ? label.slice(0, 17) + '…' : label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
