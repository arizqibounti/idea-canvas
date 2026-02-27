import dagre from 'dagre';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 110;

export function computeLayout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    nodesep: 56,
    ranksep: 100,
    marginx: 80,
    marginy: 80,
  });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const laidOutNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
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

export function buildEdges(nodes) {
  return nodes
    .filter((n) => n.data.parentId)
    .map((n) => ({
      id: `e-${n.data.parentId}-${n.id}`,
      source: n.data.parentId,
      target: n.id,
      type: 'smoothstep',
      animated: false,
      style: {
        stroke: '#2a2a3a',
        strokeWidth: 1.5,
      },
    }));
}
