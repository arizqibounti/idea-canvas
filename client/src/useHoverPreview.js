// ── Hover Preview Hook ───────────────────────────────────────
// Shows a floating preview card when hovering over a node for 400ms.
// Displays: full label, reasoning, type, parent chain, children count,
// and any debate excerpts or scores.

import { useState, useRef, useCallback } from 'react';

function getParentIds(n) {
  return n.data?.parentIds || (n.data?.parentId ? [n.data.parentId] : []);
}

export function useHoverPreview({ rawNodesRef }) {
  const [hoverPreview, setHoverPreview] = useState(null);
  // { nodeId, x, y, nodeData, parents, childCount }
  const timerRef = useRef(null);
  const activeNodeRef = useRef(null);

  const showPreview = useCallback((nodeId, x, y) => {
    // Don't re-trigger for same node
    if (activeNodeRef.current === nodeId) return;

    // Clear any pending timer
    if (timerRef.current) clearTimeout(timerRef.current);
    activeNodeRef.current = nodeId;

    timerRef.current = setTimeout(() => {
      const nodes = rawNodesRef.current || [];
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;

      const parentIds = getParentIds(node);
      const parents = parentIds
        .map(pid => nodes.find(n => n.id === pid))
        .filter(Boolean)
        .map(p => ({ id: p.id, label: p.data?.label, type: p.data?.type }));

      const children = nodes.filter(n => {
        const pids = getParentIds(n);
        return pids.includes(nodeId);
      });

      setHoverPreview({
        nodeId,
        x,
        y,
        node: node,
        nodeData: node.data,
        parents,
        childCount: children.length,
        children: children.slice(0, 5).map(c => ({
          id: c.id, label: c.data?.label, type: c.data?.type,
        })),
      });
    }, 400);
  }, [rawNodesRef]);

  const hidePreview = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    activeNodeRef.current = null;
    setHoverPreview(null);
  }, []);

  return {
    hoverPreview,
    showPreview,
    hidePreview,
  };
}
