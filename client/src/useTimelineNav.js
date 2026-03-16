// ── Timeline Navigation Hook ─────────────────────────────────
// Topological sort of the DAG into a linear sequence,
// J/K/L keyboard navigation, and auto-playback.

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';

/**
 * Get parent IDs from a node (mirrors layoutUtils.js helper).
 */
function getParentIds(n) {
  return n.data?.parentIds || (n.data?.parentId ? [n.data.parentId] : []);
}

/**
 * Kahn's algorithm topological sort.
 * Same-depth peers ordered by their position in the original array (generation order).
 */
function topoSort(rawNodes) {
  if (!rawNodes || rawNodes.length === 0) return [];

  const idSet = new Set(rawNodes.map(n => n.id));
  const idxMap = new Map(rawNodes.map((n, i) => [n.id, i]));

  // Build children map and in-degree
  const childrenOf = new Map();  // parentId -> [childNode, ...]
  const inDegree = new Map();

  for (const n of rawNodes) {
    inDegree.set(n.id, 0);
    if (!childrenOf.has(n.id)) childrenOf.set(n.id, []);
  }

  for (const n of rawNodes) {
    const parents = getParentIds(n).filter(pid => idSet.has(pid));
    inDegree.set(n.id, parents.length);
    for (const pid of parents) {
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(n);
    }
  }

  // Seed queue with roots (in-degree 0), sorted by array index
  const queue = rawNodes
    .filter(n => inDegree.get(n.id) === 0)
    .sort((a, b) => (idxMap.get(a.id) || 0) - (idxMap.get(b.id) || 0));

  const result = [];
  const visited = new Set();

  while (queue.length > 0) {
    const node = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    result.push(node);

    // Sort children by original array index for stable ordering
    const children = (childrenOf.get(node.id) || [])
      .sort((a, b) => (idxMap.get(a.id) || 0) - (idxMap.get(b.id) || 0));

    for (const child of children) {
      inDegree.set(child.id, inDegree.get(child.id) - 1);
      if (inDegree.get(child.id) === 0 && !visited.has(child.id)) {
        queue.push(child);
      }
    }
  }

  // Append any remaining nodes (cycles or orphans) by original order
  if (result.length < rawNodes.length) {
    for (const n of rawNodes) {
      if (!visited.has(n.id)) result.push(n);
    }
  }

  return result;
}

export function useTimelineNav({ rawNodesRef, selectedNode, handleNodeClick, nodeCount }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1500);
  const playingRef = useRef(false);
  const topoOrderRef = useRef([]);

  // Recompute topo order when node count changes
  const topoOrder = useMemo(() => {
    const sorted = topoSort(rawNodesRef.current || []);
    topoOrderRef.current = sorted;
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCount]);

  // Derive current index from selected node
  const currentIndex = useMemo(() => {
    if (!selectedNode) return -1;
    const selId = selectedNode.id || selectedNode.data?.nodeId;
    return topoOrder.findIndex(n => n.id === selId);
  }, [selectedNode, topoOrder]);

  const goToIndex = useCallback((i) => {
    if (i >= 0 && i < topoOrderRef.current.length) {
      handleNodeClick(topoOrderRef.current[i]);
    }
  }, [handleNodeClick]);

  const goNext = useCallback(() => {
    const idx = currentIndex < 0 ? -1 : currentIndex;
    if (idx < topoOrderRef.current.length - 1) {
      goToIndex(idx + 1);
    } else {
      // Reached end — stop playback
      setIsPlaying(false);
      playingRef.current = false;
    }
  }, [currentIndex, goToIndex]);

  const goPrev = useCallback(() => {
    const idx = currentIndex < 0 ? topoOrderRef.current.length : currentIndex;
    if (idx > 0) {
      goToIndex(idx - 1);
    }
  }, [currentIndex, goToIndex]);

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => {
      const next = !prev;
      playingRef.current = next;
      // If starting playback with nothing selected, start from first node
      if (next && currentIndex < 0 && topoOrderRef.current.length > 0) {
        goToIndex(0);
      }
      return next;
    });
  }, [currentIndex, goToIndex]);

  // Auto-advance interval
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      if (!playingRef.current) return;
      // Read current index from topoOrder + selectedNode
      goNext();
    }, playbackSpeed);
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, goNext]);

  // J/K/L keyboard listener
  useEffect(() => {
    function handler(e) {
      // Don't capture when typing in input fields
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (document.activeElement?.isContentEditable) return;

      // Only when we have nodes
      if (topoOrderRef.current.length === 0) return;

      switch (e.key.toLowerCase()) {
        case 'j':
          e.preventDefault();
          goPrev();
          break;
        case 'l':
          e.preventDefault();
          goNext();
          break;
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        default:
          break;
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [goNext, goPrev, togglePlay]);

  return {
    topoOrder,
    currentIndex,
    isPlaying,
    playbackSpeed,
    goNext,
    goPrev,
    togglePlay,
    goToIndex,
    setPlaybackSpeed,
  };
}
