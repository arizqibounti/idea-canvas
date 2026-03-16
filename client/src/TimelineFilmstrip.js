// ── Timeline Filmstrip ───────────────────────────────────────
// Horizontal strip of node thumbnails with transport controls.
// Supports flat mode (single strip) and track mode (grouped by type).

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { getNodeConfig } from './nodeConfig';
import './TimelineFilmstrip.css';

// ── Thumbnail component (shared between flat & track modes) ──
function Thumb({ node, index, isActive, isPast, isMuted, onClick, activeRef }) {
  const nodeType = node.data?.type || node.type || 'unknown';
  const config = getNodeConfig(nodeType, node.data?.dynamicConfig);
  const label = node.data?.label || node.label || '?';

  return (
    <div
      ref={isActive ? activeRef : null}
      className={`filmstrip-thumb ${isActive ? 'active' : ''} ${isMuted ? 'muted-thumb' : ''}`}
      style={{
        '--thumb-color': config.color,
        '--thumb-glow': config.glow,
      }}
      onClick={() => onClick(index)}
      title={`${label} (${nodeType})`}
    >
      <span className="filmstrip-dot" style={{ background: config.color }} />
      <span className="filmstrip-label">
        {label.length > 12 ? label.slice(0, 11) + '…' : label}
      </span>
      <span className="filmstrip-type">{nodeType}</span>
    </div>
  );
}

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
  const [trackMode, setTrackMode] = useState(false);
  const [soloTypes, setSoloTypes] = useState(new Set());
  const [muteTypes, setMuteTypes] = useState(new Set());
  const activeRef = useRef(null);

  // Auto-scroll to keep active thumbnail visible
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [currentIndex]);

  // Group nodes by type for track mode
  const tracks = useMemo(() => {
    if (!topoOrder || topoOrder.length === 0) return [];
    const typeMap = new Map(); // type -> { config, nodes: [{node, topoIndex}] }
    topoOrder.forEach((node, topoIndex) => {
      const nodeType = node.data?.type || node.type || 'unknown';
      if (!typeMap.has(nodeType)) {
        const config = getNodeConfig(nodeType, node.data?.dynamicConfig);
        typeMap.set(nodeType, { type: nodeType, config, nodes: [] });
      }
      typeMap.get(nodeType).nodes.push({ node, topoIndex });
    });
    // Sort tracks by first appearance in topo order
    return [...typeMap.values()].sort(
      (a, b) => a.nodes[0].topoIndex - b.nodes[0].topoIndex
    );
  }, [topoOrder]);

  // Compute visible types based on solo/mute
  const getVisibleTypes = useCallback(() => {
    const allTypes = tracks.map(t => t.type);
    if (soloTypes.size > 0) {
      return allTypes.filter(t => soloTypes.has(t));
    }
    return allTypes.filter(t => !muteTypes.has(t));
  }, [tracks, soloTypes, muteTypes]);

  // Stable ref for callback to avoid infinite loops
  const filterChangeRef = useRef(onFilterChange);
  filterChangeRef.current = onFilterChange;

  // Notify parent of filter changes
  useEffect(() => {
    if (!filterChangeRef.current) return;
    const hasFilter = soloTypes.size > 0 || muteTypes.size > 0;
    if (hasFilter) {
      filterChangeRef.current({ visibleTypes: getVisibleTypes() });
    } else {
      filterChangeRef.current(null);
    }
  }, [soloTypes, muteTypes, getVisibleTypes]);

  // Clear filters when leaving track mode
  const handleToggleTrackMode = useCallback(() => {
    setTrackMode(prev => {
      if (prev) {
        // Leaving track mode — clear filters
        setSoloTypes(new Set());
        setMuteTypes(new Set());
      }
      return !prev;
    });
  }, []);

  const handleSolo = useCallback((type) => {
    setSoloTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleMute = useCallback((type) => {
    setMuteTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Is a given type muted (either explicitly muted, or not in solo set when solo is active)
  const isTypeMuted = useCallback((type) => {
    if (soloTypes.size > 0) return !soloTypes.has(type);
    return muteTypes.has(type);
  }, [soloTypes, muteTypes]);

  if (!topoOrder || topoOrder.length <= 1) return null;

  return (
    <div className={`timeline-filmstrip ${trackMode ? 'track-mode' : 'flat-mode'}`}>
      {/* Left controls column */}
      <div className="filmstrip-controls" style={trackMode ? { alignSelf: 'flex-start', paddingTop: 4 } : {}}>
        <div style={{ textAlign: 'center' }}>
          <button className="filmstrip-btn" onClick={onGoPrev} title="Previous (J)">◀</button>
          <div className="filmstrip-key-hint">J</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <button
            className={`filmstrip-btn ${isPlaying ? 'playing' : ''}`}
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause (K)' : 'Play (K)'}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <div className="filmstrip-key-hint">K</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <button className="filmstrip-btn" onClick={onGoNext} title="Next (L)">▶</button>
          <div className="filmstrip-key-hint">L</div>
        </div>
        {/* Track mode toggle */}
        <button
          className={`filmstrip-mode-toggle ${trackMode ? 'active' : ''}`}
          onClick={handleToggleTrackMode}
          title={trackMode ? 'Flat view' : 'Track view'}
        >
          ≡
        </button>
      </div>

      {/* Position indicator */}
      <div className="filmstrip-position" style={trackMode ? { alignSelf: 'flex-start', paddingTop: 10 } : {}}>
        {currentIndex >= 0 ? currentIndex + 1 : '–'}/{topoOrder.length}
      </div>

      {/* ── Flat mode: single scrollable strip ── */}
      {!trackMode && (
        <div className="filmstrip-track">
          {topoOrder.map((node, i) => {
            const isPast = currentIndex >= 0 && i < currentIndex;
            return (
              <React.Fragment key={node.id}>
                {i > 0 && (
                  <div className={`filmstrip-connector ${isPast ? 'done' : ''}`} />
                )}
                <Thumb
                  node={node}
                  index={i}
                  isActive={i === currentIndex}
                  isPast={isPast}
                  isMuted={false}
                  onClick={onGoToIndex}
                  activeRef={activeRef}
                />
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* ── Track mode: grouped by type ── */}
      {trackMode && (
        <div className="filmstrip-tracks-container">
          {tracks.map(track => {
            const muted = isTypeMuted(track.type);
            const soloed = soloTypes.has(track.type);
            const mutedExplicit = muteTypes.has(track.type);
            return (
              <div
                key={track.type}
                className={`filmstrip-track-row ${muted ? 'muted' : ''}`}
              >
                <div className="filmstrip-track-header">
                  <button
                    className={`track-sm-btn ${soloed ? 'solo-active' : ''}`}
                    onClick={() => handleSolo(track.type)}
                    title={`Solo ${track.config.label || track.type}`}
                  >
                    S
                  </button>
                  <button
                    className={`track-sm-btn ${mutedExplicit ? 'mute-active' : ''}`}
                    onClick={() => handleMute(track.type)}
                    title={`Mute ${track.config.label || track.type}`}
                  >
                    M
                  </button>
                  <span className="track-type-dot" style={{ background: track.config.color }} />
                  <span className="track-type-label" style={{ color: track.config.color }}>
                    {track.config.label || track.type}
                  </span>
                  <span className="track-type-count">{track.nodes.length}</span>
                </div>
                <div className="filmstrip-track-thumbs">
                  {track.nodes.map(({ node, topoIndex }, j) => (
                    <React.Fragment key={node.id}>
                      {j > 0 && <div className="filmstrip-connector" />}
                      <Thumb
                        node={node}
                        index={topoIndex}
                        isActive={topoIndex === currentIndex}
                        isPast={currentIndex >= 0 && topoIndex < currentIndex}
                        isMuted={muted}
                        onClick={onGoToIndex}
                        activeRef={activeRef}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
