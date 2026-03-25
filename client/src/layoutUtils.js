import dagre from 'dagre';

const NODE_WIDTH = 260;
const MIN_NODE_HEIGHT = 100;
const CHARS_PER_LINE = 30; // approximate at 260px with padding

function estimateNodeHeight(node) {
  const label = node.data?.label || '';
  const reasoning = node.data?.reasoning || '';
  const labelLines = Math.max(1, Math.ceil(label.length / CHARS_PER_LINE));
  const reasoningLines = reasoning
    ? Math.min(4, Math.ceil(reasoning.length / CHARS_PER_LINE))
    : 0;
  const reasoningPad = reasoningLines > 0 ? 15 : 0;
  const height = 32 + labelLines * 18 + 8 + reasoningPad + reasoningLines * 16 + 12;
  return Math.max(MIN_NODE_HEIGHT, height);
}

// ── Position cache for incremental force layout ──────────────
// Persists positions between calls so existing nodes stay stable
const _positionCache = new Map();
let _lastNodeCount = 0;

// Helper: get parentIds array from a node (supports both legacy parentId and new parentIds)
function getParentIds(n) {
  const d = n.data || n;
  return d.parentIds || (d.parentId ? [d.parentId] : []);
}

/**
 * Detect cycles via DFS and reverse back-edges so dagre can handle them.
 * The visual edges remain unchanged — only layout edges are modified.
 */
function breakCyclesForLayout(edges) {
  if (!edges.length) return edges;

  const adj = {};
  const nodeSet = new Set();
  edges.forEach(e => {
    nodeSet.add(e.source);
    nodeSet.add(e.target);
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  });

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  nodeSet.forEach(n => { color[n] = WHITE; });
  const backEdgeKeys = new Set();

  function dfs(u) {
    color[u] = GRAY;
    for (const v of (adj[u] || [])) {
      if (color[v] === GRAY) {
        backEdgeKeys.add(`${u}→${v}`);
      } else if (color[v] === WHITE) {
        dfs(v);
      }
    }
    color[u] = BLACK;
  }

  nodeSet.forEach(n => { if (color[n] === WHITE) dfs(n); });
  if (backEdgeKeys.size === 0) return edges;

  // Reverse back-edges for layout only
  return edges.map(e => {
    if (backEdgeKeys.has(`${e.source}→${e.target}`)) {
      return { source: e.target, target: e.source };
    }
    return e;
  });
}

/**
 * Force-directed layout for multi-parent graphs.
 * Positions nodes by semantic proximity, not strict hierarchy.
 * Convergence nodes (multi-parent) settle between their parents.
 * Feedback loops form visible circular patterns.
 *
 * @param {Array} nodes - flow nodes
 * @param {Array} edges - { source, target } edges (including cross-links)
 * @returns {Array} nodes with computed positions
 */
export function computeForceLayout(nodes, edges) {
  if (!nodes.length) return [];
  if (nodes.length === 1) {
    _positionCache.clear();
    _positionCache.set(nodes[0].id, { x: 500, y: 200 });
    _lastNodeCount = 1;
    return [{ ...nodes[0], position: { x: 500 - NODE_WIDTH / 2, y: 200 } }];
  }

  // Determine if incremental (few new nodes) vs full recompute
  const newNodeIds = nodes.filter(n => !_positionCache.has(n.id)).map(n => n.id);
  const isIncremental = newNodeIds.length > 0 && newNodeIds.length <= 3 && _lastNodeCount > 0;
  const iterations = isIncremental ? 60 : 200;

  // Tuning parameters
  const repulsion = 6000;
  const edgeAttraction = 0.008;
  const gravity = 0.015;
  const damping = 0.88;
  const idealEdgeLen = 200;
  const overlapPadding = 30;

  // Compute depths for gentle hierarchical bias
  const depths = computeDepths(nodes);

  // Connection count per node (for importance weighting)
  const connectionCount = {};
  const edgeAdj = new Map();
  edges.forEach(e => {
    if (!edgeAdj.has(e.source)) edgeAdj.set(e.source, new Set());
    if (!edgeAdj.has(e.target)) edgeAdj.set(e.target, new Set());
    edgeAdj.get(e.source).add(e.target);
    edgeAdj.get(e.target).add(e.source);
  });
  nodes.forEach(n => {
    connectionCount[n.id] = (edgeAdj.get(n.id)?.size || 0);
  });

  // Initialize positions
  const pos = {};
  const vel = {};

  // Sort nodes by depth for row-based initialization
  const depthGroups = {};
  nodes.forEach(n => {
    const d = depths.get(n.id) || 0;
    if (!depthGroups[d]) depthGroups[d] = [];
    depthGroups[d].push(n.id);
  });

  const centerX = 600;
  const startY = 120;

  nodes.forEach(n => {
    if (_positionCache.has(n.id)) {
      // Reuse cached position for stability
      pos[n.id] = { ..._positionCache.get(n.id) };
    } else {
      // New node: place near parent(s) geometric center
      const pids = getParentIds(n);
      const parentPositions = pids.map(pid => pos[pid]).filter(Boolean);
      if (parentPositions.length > 0) {
        const avgX = parentPositions.reduce((s, p) => s + p.x, 0) / parentPositions.length;
        const avgY = parentPositions.reduce((s, p) => s + p.y, 0) / parentPositions.length;
        pos[n.id] = {
          x: avgX + (Math.random() * 120 - 60),
          y: avgY + idealEdgeLen * 0.6 + (Math.random() * 40 - 20),
        };
      } else {
        // Root node or orphan: grid initialization by depth
        const d = depths.get(n.id) || 0;
        const group = depthGroups[d] || [n.id];
        const idx = group.indexOf(n.id);
        const rowWidth = group.length * (NODE_WIDTH + 50);
        pos[n.id] = {
          x: centerX - rowWidth / 2 + idx * (NODE_WIDTH + 50) + NODE_WIDTH / 2,
          y: startY + d * idealEdgeLen * 0.85 + (Math.random() * 16 - 8),
        };
      }
    }
    vel[n.id] = { x: 0, y: 0 };
  });

  // Prune stale entries from cache
  const activeIds = new Set(nodes.map(n => n.id));
  for (const id of _positionCache.keys()) {
    if (!activeIds.has(id)) _positionCache.delete(id);
  }

  // Node heights for overlap detection
  const nodeHeights = {};
  nodes.forEach(n => { nodeHeights[n.id] = estimateNodeHeight(n); });

  // ── Force simulation ──────────────────────────────────────
  for (let iter = 0; iter < iterations; iter++) {
    const alpha = Math.max(0.01, 1 - iter / iterations);
    const forces = {};
    nodes.forEach(n => { forces[n.id] = { x: 0, y: 0 }; });

    // 1. Repulsion between all pairs (Barnes-Hut would be better for >500 nodes)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].id, b = nodes[j].id;
        let dx = pos[a].x - pos[b].x;
        let dy = pos[a].y - pos[b].y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq) || 0.1;

        // Overlap prevention: stronger repulsion when nodes overlap
        const minDist = NODE_WIDTH + overlapPadding;
        const effectiveDist = Math.max(dist, 1);
        let force = repulsion / (effectiveDist * effectiveDist);

        // Extra push if overlapping
        if (dist < minDist) {
          force += (minDist - dist) * 0.5;
        }

        const fx = (dx / dist) * force * alpha;
        const fy = (dy / dist) * force * alpha;
        forces[a].x += fx; forces[a].y += fy;
        forces[b].x -= fx; forces[b].y -= fy;
      }
    }

    // 2. Edge attraction (spring force toward ideal length)
    edges.forEach(e => {
      if (!pos[e.source] || !pos[e.target]) return;
      const dx = pos[e.target].x - pos[e.source].x;
      const dy = pos[e.target].y - pos[e.source].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const displacement = dist - idealEdgeLen;
      const force = displacement * edgeAttraction * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      forces[e.source].x += fx; forces[e.source].y += fy;
      forces[e.target].x -= fx; forces[e.target].y -= fy;
    });

    // 3. Center gravity (prevent drift)
    const cx = nodes.reduce((s, n) => s + pos[n.id].x, 0) / nodes.length;
    const cy = nodes.reduce((s, n) => s + pos[n.id].y, 0) / nodes.length;
    nodes.forEach(n => {
      forces[n.id].x -= (pos[n.id].x - cx) * gravity * alpha;
      forces[n.id].y -= (pos[n.id].y - cy) * gravity * alpha;
    });

    // 4. Gentle hierarchical bias (depth → vertical position tendency)
    // Not strict — just a nudge so roots tend upward and leaves downward
    nodes.forEach(n => {
      const depth = depths.get(n.id) || 0;
      const targetY = startY + depth * (idealEdgeLen * 0.75);
      const dy = targetY - pos[n.id].y;
      forces[n.id].y += dy * 0.003 * alpha;
    });

    // 5. Convergence node centering: multi-parent nodes pulled toward parent midpoint
    nodes.forEach(n => {
      const pids = getParentIds(n);
      if (pids.length >= 2) {
        const parentPos = pids.map(pid => pos[pid]).filter(Boolean);
        if (parentPos.length >= 2) {
          const midX = parentPos.reduce((s, p) => s + p.x, 0) / parentPos.length;
          const midY = parentPos.reduce((s, p) => s + p.y, 0) / parentPos.length;
          forces[n.id].x += (midX - pos[n.id].x) * 0.01 * alpha;
          forces[n.id].y += (midY + idealEdgeLen * 0.4 - pos[n.id].y) * 0.01 * alpha;
        }
      }
    });

    // 6. Update velocities and positions
    nodes.forEach(n => {
      vel[n.id].x = (vel[n.id].x + forces[n.id].x) * damping;
      vel[n.id].y = (vel[n.id].y + forces[n.id].y) * damping;

      // Clamp velocity
      const speed = Math.sqrt(vel[n.id].x ** 2 + vel[n.id].y ** 2);
      const maxSpeed = 40;
      if (speed > maxSpeed) {
        vel[n.id].x *= maxSpeed / speed;
        vel[n.id].y *= maxSpeed / speed;
      }

      pos[n.id].x += vel[n.id].x;
      pos[n.id].y += vel[n.id].y;
    });
  }

  // Update cache
  nodes.forEach(n => {
    _positionCache.set(n.id, { x: pos[n.id].x, y: pos[n.id].y });
  });
  _lastNodeCount = nodes.length;

  // Apply final positions (adjust for node anchor point)
  return nodes.map(node => ({
    ...node,
    position: {
      x: pos[node.id].x - NODE_WIDTH / 2,
      y: pos[node.id].y - nodeHeights[node.id] / 2,
    },
  }));
}

/**
 * Reset force layout position cache. Call when switching sessions or resetting canvas.
 */
export function resetForceLayoutCache() {
  _positionCache.clear();
  _lastNodeCount = 0;
}

/**
 * Detect feedback loops in the graph.
 * Returns array of { loopNodes: string[], isReinforcing: boolean, name: string }
 */
export function detectLoops(nodes, edges) {
  const adj = {};
  const edgePolarity = {};
  edges.forEach(e => {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
    edgePolarity[`${e.source}→${e.target}`] = e.label || '+';
  });

  const loops = [];
  const visited = new Set();

  function findCycles(start) {
    const stack = [{ node: start, path: [start], polarities: [] }];
    const inStack = new Set([start]);

    while (stack.length) {
      const { node, path, polarities } = stack.pop();

      for (const next of (adj[node] || [])) {
        const pol = edgePolarity[`${node}→${next}`] || '+';
        if (next === start && path.length > 1) {
          // Found a cycle back to start
          const allPolarities = [...polarities, pol];
          const negCount = allPolarities.filter(p => p === '-').length;
          const isReinforcing = negCount % 2 === 0;
          loops.push({
            loopNodes: [...path],
            isReinforcing,
            name: isReinforcing ? 'Reinforcing Loop' : 'Balancing Loop',
          });
        } else if (!inStack.has(next) && !visited.has(next)) {
          inStack.add(next);
          stack.push({ node: next, path: [...path, next], polarities: [...polarities, pol] });
        }
      }
    }
    visited.add(start);
  }

  const nodeIds = nodes.map(n => n.id);
  nodeIds.forEach(id => {
    if (!visited.has(id)) findCycles(id);
  });

  return loops;
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

  // Break cycles before passing to dagre (dagre requires DAG)
  const layoutEdges = breakCyclesForLayout(edges);
  layoutEdges.forEach((edge) => {
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
  const visited = new Set();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = allNodes.find((n) => n.id === id);
    if (node) result.push(node);
    const children = allNodes.filter((n) => getParentIds(n).includes(id));
    queue.push(...children.map((c) => c.id));
  }
  return result;
}

/**
 * Filter out descendants of collapsed nodes.
 * @param {Array} nodes - all flow nodes
 * @param {Set} collapsedSet - set of collapsed node IDs
 * @returns {Array} visible nodes (collapsed subtrees hidden)
 */
export function filterCollapsed(nodes, collapsedSet) {
  if (!collapsedSet || collapsedSet.size === 0) return nodes;

  const hiddenParents = new Set(collapsedSet);
  const visible = [];
  // BFS from root(s), skipping children of collapsed nodes
  const childMap = new Map();
  nodes.forEach((n) => {
    const pids = getParentIds(n);
    pids.forEach(pid => {
      if (!childMap.has(pid)) childMap.set(pid, []);
      childMap.get(pid).push(n);
    });
  });
  // Find root nodes (no parents or parents not in node set)
  const nodeIds = new Set(nodes.map(n => n.id));
  const roots = nodes.filter(n => {
    const pids = getParentIds(n);
    return pids.length === 0 || pids.every(pid => !nodeIds.has(pid));
  });
  const visited = new Set();
  const queue = [...roots];
  while (queue.length) {
    const node = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    visible.push(node);
    // If collapsed, don't enqueue children
    if (hiddenParents.has(node.id)) continue;
    const children = childMap.get(node.id) || [];
    queue.push(...children);
  }
  return visible;
}

/**
 * Compute depth level for each node via BFS from root.
 * Cycle-safe: uses visited set to prevent infinite loops.
 * @param {Array} nodes - all flow nodes
 * @returns {Map} nodeId → depth (0-based)
 */
export function computeDepths(nodes) {
  const depths = new Map();
  const childMap = new Map();
  nodes.forEach((n) => {
    const pids = getParentIds(n);
    pids.forEach(pid => {
      if (!childMap.has(pid)) childMap.set(pid, []);
      childMap.get(pid).push(n.id);
    });
  });
  // Find roots
  const nodeIds = new Set(nodes.map(n => n.id));
  const roots = nodes.filter(n => {
    const pids = getParentIds(n);
    return pids.length === 0 || pids.every(pid => !nodeIds.has(pid));
  });
  const queue = roots.map(n => ({ id: n.id, depth: 0 }));
  while (queue.length) {
    const { id, depth } = queue.shift();
    if (depths.has(id)) continue; // cycle guard
    depths.set(id, depth);
    const children = childMap.get(id) || [];
    children.forEach(childId => queue.push({ id: childId, depth: depth + 1 }));
  }
  return depths;
}

// Compute descendant count for every node (total nodes below it in the tree)
export function computeDescendantCounts(nodes) {
  const childMap = new Map();
  nodes.forEach((n) => {
    const pids = getParentIds(n);
    pids.forEach(pid => {
      if (!childMap.has(pid)) childMap.set(pid, []);
      childMap.get(pid).push(n.id);
    });
  });

  const counts = new Map();
  const countDescendants = (nodeId) => {
    if (counts.has(nodeId)) return counts.get(nodeId);
    const children = childMap.get(nodeId) || [];
    let total = children.length;
    for (const childId of children) {
      total += countDescendants(childId);
    }
    counts.set(nodeId, total);
    return total;
  };

  nodes.forEach(n => countDescendants(n.id));
  return counts;
}

export function buildEdges(nodes, { showCrossLinks = false, nodeConfigGetter = null } = {}) {
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Parent-child edges — one edge per parent in parentIds[]
  const parentEdges = [];
  nodes.forEach((n) => {
    const pids = getParentIds(n);
    pids.forEach(pid => {
      if (!nodeIds.has(pid)) return;
      let strokeColor = '#2a2a3a';
      let strokeOpacity = 1;
      if (nodeConfigGetter) {
        try {
          strokeColor = nodeConfigGetter(n.data.type, n.data.dynamicConfig).color;
          strokeOpacity = 0.35;
        } catch { /* fallback to default */ }
      }

      // Causal polarity edge coloring
      const polarity = n.data.polarity;
      if (polarity === '+') {
        strokeColor = '#22c55e';
        strokeOpacity = 0.7;
      } else if (polarity === '-') {
        strokeColor = '#ef4444';
        strokeOpacity = 0.7;
      }

      parentEdges.push({
        id: `e-${pid}-${n.id}`,
        source: pid,
        target: n.id,
        type: 'default',
        animated: false,
        label: polarity || undefined,
        labelStyle: polarity ? { fill: polarity === '+' ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 14 } : undefined,
        labelBgStyle: polarity ? { fill: '#0a0a0f', fillOpacity: 0.8 } : undefined,
        style: {
          stroke: strokeColor,
          strokeWidth: polarity ? 2 : 1.5,
          opacity: strokeOpacity,
        },
      });
    });
  });

  if (!showCrossLinks) return parentEdges;

  // Cross-link edges (from relatedIds)
  const crossEdges = [];
  const seenPairs = new Set();
  nodes.forEach((n) => {
    const pids = getParentIds(n);
    (n.data.relatedIds || []).forEach((relId) => {
      if (!nodeIds.has(relId)) return;
      if (pids.includes(relId)) return;
      const pairKey = [n.id, relId].sort().join('::');
      if (seenPairs.has(pairKey)) return;
      seenPairs.add(pairKey);
      crossEdges.push({
        id: `cx-${n.id}-${relId}`,
        source: n.id,
        target: relId,
        type: 'default',
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
