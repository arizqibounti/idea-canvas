// ── Tree Utilities ────────────────────────────────────────────
// Shared functions for subtree collection and serialization.

export function serializeTree(nodes) {
  if (!nodes || !nodes.length) return '';
  return nodes.map(n => {
    const d = n.data || n;
    return `- [${d.type || 'node'}] (id: ${n.id}) ${d.label || n.id}${d.reasoning ? ': ' + d.reasoning : ''}`;
  }).join('\n');
}

// Collect all descendant node IDs via BFS (includes the root nodeId itself)
export function getSubtreeNodeIds(nodeId, allNodes) {
  const childMap = new Map();
  for (const n of allNodes) {
    const d = n.data || n;
    const parents = d.parentIds || (d.parentId ? [d.parentId] : []);
    for (const pid of parents) {
      if (!childMap.has(pid)) childMap.set(pid, []);
      childMap.get(pid).push(n);
    }
  }

  const ids = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift();
    for (const child of (childMap.get(id) || [])) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return ids;
}

// Build focused node + its full subtree for scoped chat context
export function buildFocusedSubtree(focusedNode, allNodes) {
  if (!focusedNode?.node || !allNodes?.length) return null;
  const fNode = focusedNode.node;
  const fId = fNode.id;

  const subtreeIds = getSubtreeNodeIds(fId, allNodes);
  const subtreeNodes = allNodes.filter(n => subtreeIds.has(n.id));
  const fd = fNode.data || fNode;

  return {
    id: fId,
    type: fd.type || 'node',
    label: fd.label || fId,
    reasoning: fd.reasoning || '',
    subtree: serializeTree(subtreeNodes),
    subtreeCount: subtreeNodes.length,
  };
}
