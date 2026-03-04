import dagre from 'dagre';

const NODE_WIDTH = 260;
const MIN_NODE_HEIGHT = 100;
const CHARS_PER_LINE = 30; // approximate at 260px with padding

function estimateNodeHeight(node) {
  const label = node.data?.label || '';
  const reasoning = node.data?.reasoning || '';
  // Type badge row: ~32px
  // Label: ~18px per line (13px font × 1.4 line-height)
  const labelLines = Math.max(1, Math.ceil(label.length / CHARS_PER_LINE));
  // Reasoning: ~16px per line (11px font × 1.5 line-height), capped at 4 lines
  const reasoningLines = reasoning
    ? Math.min(4, Math.ceil(reasoning.length / CHARS_PER_LINE))
    : 0;
  // 32 (badge) + label + 8 (gap) + reasoning section + 12 (bottom pad)
  const reasoningPad = reasoningLines > 0 ? 15 : 0; // border-top + paddingTop
  const height = 32 + labelLines * 18 + 8 + reasoningPad + reasoningLines * 16 + 12;
  return Math.max(MIN_NODE_HEIGHT, height);
}

export function computeLayout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    nodesep: 80,
    ranksep: 140,
    marginx: 100,
    marginy: 100,
  });

  nodes.forEach((node) => {
    const height = estimateNodeHeight(node);
    g.setNode(node.id, { width: NODE_WIDTH, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const laidOutNodes = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    return {
      ...node,
      position: {
        x: dagreNode.x - NODE_WIDTH / 2,
        y: dagreNode.y - dagreNode.height / 2,
      },
    };
  });

  return laidOutNodes;
}

export function getSubtree(allNodes, rootId) {
  const result = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    const node = allNodes.find((n) => n.id === id);
    if (node) result.push(node);
    const children = allNodes.filter((n) => n.data.parentId === id);
    queue.push(...children.map((c) => c.id));
  }
  return result;
}

export function buildEdges(nodes, { showCrossLinks = false, nodeConfigGetter = null } = {}) {
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Parent-child edges — optionally tinted to child node's type color
  const parentEdges = nodes
    .filter((n) => n.data.parentId)
    .map((n) => {
      let strokeColor = '#2a2a3a';
      let strokeOpacity = 1;
      if (nodeConfigGetter) {
        try {
          strokeColor = nodeConfigGetter(n.data.type, n.data.dynamicConfig).color;
          strokeOpacity = 0.35;
        } catch { /* fallback to default */ }
      }
      return {
        id: `e-${n.data.parentId}-${n.id}`,
        source: n.data.parentId,
        target: n.id,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: strokeColor,
          strokeWidth: 1.5,
          opacity: strokeOpacity,
        },
      };
    });

  if (!showCrossLinks) return parentEdges;

  // Cross-link edges (from relatedIds)
  const crossEdges = [];
  const seenPairs = new Set();
  nodes.forEach((n) => {
    (n.data.relatedIds || []).forEach((relId) => {
      if (!nodeIds.has(relId)) return;
      if (relId === n.data.parentId) return;
      const pairKey = [n.id, relId].sort().join('::');
      if (seenPairs.has(pairKey)) return;
      seenPairs.add(pairKey);
      crossEdges.push({
        id: `cx-${n.id}-${relId}`,
        source: n.id,
        target: relId,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: '#6c63ff',
          strokeWidth: 1,
          strokeDasharray: '6 3',
          opacity: 0.5,
        },
      });
    });
  });

  return [...parentEdges, ...crossEdges];
}
