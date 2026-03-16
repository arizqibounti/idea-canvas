// ── Ghost Nodes Hook ─────────────────────────────────────────
// Manages placeholder "ghost" nodes that appear while AI is
// streaming new content. Ghosts pulse with a shimmer animation
// and can be cancelled mid-stream.
//
// Pattern:
//   1. Before AI call → addGhost(parentId, count)
//   2. As SSE streams in → promoteGhost(ghostId, realNode)
//   3. On cancel → clearGhosts()

import { useCallback, useRef, useState } from 'react';

let ghostCounter = 0;

function makeGhostId() {
  return `ghost_${Date.now()}_${++ghostCounter}`;
}

export function useGhostNodes({ rawNodesRef, applyLayout, drillStackRef, setNodeCount }) {
  const [ghostIds, setGhostIds] = useState(new Set());
  const ghostMapRef = useRef(new Map()); // ghostId → { parentId, index }

  // Add N ghost placeholders beneath a parent node
  const addGhosts = useCallback((parentId, count = 1, type = 'ghost') => {
    const parentNode = rawNodesRef.current.find(n => n.id === parentId);
    if (!parentNode) return [];

    const newGhosts = [];
    const ids = [];

    for (let i = 0; i < count; i++) {
      const gid = makeGhostId();
      ids.push(gid);
      ghostMapRef.current.set(gid, { parentId, index: i });

      newGhosts.push({
        id: gid,
        type: 'ideaNode',
        position: {
          x: (parentNode.position?.x || 0) + (i + 1) * 60,
          y: (parentNode.position?.y || 0) + 120,
        },
        data: {
          type: type,
          label: 'Generating…',
          reasoning: '',
          parentId: parentId,
          isGhost: true,
          ghostIndex: i,
        },
      });
    }

    rawNodesRef.current = [...rawNodesRef.current, ...newGhosts];
    applyLayout(rawNodesRef.current, drillStackRef.current);
    setNodeCount(rawNodesRef.current.length);
    setGhostIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });

    return ids;
  }, [rawNodesRef, applyLayout, drillStackRef, setNodeCount]);

  // Promote a ghost to a real node (replace in-place)
  const promoteGhost = useCallback((ghostId, realNode) => {
    if (!ghostMapRef.current.has(ghostId)) return;

    rawNodesRef.current = rawNodesRef.current.map(n =>
      n.id === ghostId
        ? { ...realNode, id: realNode.id || ghostId }
        : n
    );

    ghostMapRef.current.delete(ghostId);
    setGhostIds(prev => {
      const next = new Set(prev);
      next.delete(ghostId);
      return next;
    });

    applyLayout(rawNodesRef.current, drillStackRef.current);
    setNodeCount(rawNodesRef.current.length);
  }, [rawNodesRef, applyLayout, drillStackRef, setNodeCount]);

  // Clear all ghost nodes (cancellation)
  const clearGhosts = useCallback(() => {
    const gids = new Set(ghostMapRef.current.keys());
    if (gids.size === 0) return;

    rawNodesRef.current = rawNodesRef.current.filter(n => !gids.has(n.id));
    ghostMapRef.current.clear();
    setGhostIds(new Set());

    applyLayout(rawNodesRef.current, drillStackRef.current);
    setNodeCount(rawNodesRef.current.length);
  }, [rawNodesRef, applyLayout, drillStackRef, setNodeCount]);

  // Check if a node ID is a ghost
  const isGhost = useCallback((nodeId) => {
    return ghostIds.has(nodeId);
  }, [ghostIds]);

  const hasGhosts = ghostIds.size > 0;

  return {
    addGhosts,
    promoteGhost,
    clearGhosts,
    isGhost,
    hasGhosts,
    ghostIds,
  };
}
