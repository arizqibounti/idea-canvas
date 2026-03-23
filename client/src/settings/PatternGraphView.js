// ── Pattern Graph View ────────────────────────────────────────
// Visual DAG renderer for thinking pattern stages.
// Uses positioned divs + SVG arrows (no heavy graph library).

import React, { useMemo } from 'react';

const STAGE_TYPE_ICONS = {
  generate: '⚡',
  transform: '⚙',
  score: '📊',
  branch: '⑂',
  loop: '↻',
  merge: '⊕',
  filter: '⧩',
  enrich: '🔍',
  fan_out: '⤡',
};

const STAGE_TYPE_COLORS = {
  generate: '#6c63ff',
  transform: '#f59e0b',
  score: '#22c55e',
  branch: '#ff4757',
  loop: '#cc5de8',
  merge: '#0ea5e9',
  filter: '#f97316',
  enrich: '#14b8a6',
  fan_out: '#ec4899',
};

function layoutStages(stages, graph) {
  if (!stages || !graph?.entrypoint) return [];

  const stageNames = Object.keys(stages);
  const edges = graph.edges || [];

  // BFS from entrypoint to assign levels
  const levels = {};
  const visited = new Set();
  const queue = [{ name: graph.entrypoint, level: 0 }];

  while (queue.length > 0) {
    const { name, level } = queue.shift();
    if (visited.has(name)) continue;
    visited.add(name);
    levels[name] = Math.max(levels[name] || 0, level);

    // Follow edges
    const outgoing = edges.filter(e => e.from === name);
    for (const edge of outgoing) {
      if (!visited.has(edge.to)) {
        queue.push({ name: edge.to, level: level + 1 });
      }
    }

    // Branch targets
    const stageDef = stages[name];
    if (stageDef?.type === 'branch') {
      if (stageDef.onTrue && !visited.has(stageDef.onTrue)) queue.push({ name: stageDef.onTrue, level: level + 1 });
      if (stageDef.onFalse && !visited.has(stageDef.onFalse)) queue.push({ name: stageDef.onFalse, level: level + 1 });
    }
    if (stageDef?.type === 'fan_out') {
      (stageDef.branches || []).forEach(b => {
        if (!visited.has(b)) queue.push({ name: b, level: level + 1 });
      });
    }
  }

  // Add unvisited stages at the end
  for (const name of stageNames) {
    if (!levels[name]) levels[name] = Object.keys(levels).length;
  }

  // Group by level, assign x positions
  const byLevel = {};
  for (const [name, level] of Object.entries(levels)) {
    if (!byLevel[level]) byLevel[level] = [];
    byLevel[level].push(name);
  }

  const NODE_W = 160;
  const NODE_H = 56;
  const GAP_X = 40;
  const GAP_Y = 80;

  const positions = {};
  for (const [level, names] of Object.entries(byLevel)) {
    const totalWidth = names.length * NODE_W + (names.length - 1) * GAP_X;
    const startX = -totalWidth / 2 + NODE_W / 2;
    names.forEach((name, i) => {
      positions[name] = {
        x: startX + i * (NODE_W + GAP_X),
        y: Number(level) * (NODE_H + GAP_Y),
      };
    });
  }

  return { positions, NODE_W, NODE_H };
}

export default function PatternGraphView({ stages, graph, activeStage, onStageClick }) {
  const layout = useMemo(() => layoutStages(stages, graph), [stages, graph]);

  if (!stages || !graph) {
    return <div className="patterns-graph-empty">No stages defined</div>;
  }

  const { positions, NODE_W, NODE_H } = layout;
  const stageNames = Object.keys(stages);
  const edges = graph.edges || [];

  // Calculate SVG bounds
  const allX = Object.values(positions).map(p => p.x);
  const allY = Object.values(positions).map(p => p.y);
  const minX = Math.min(...allX) - NODE_W / 2 - 20;
  const maxX = Math.max(...allX) + NODE_W / 2 + 20;
  const minY = -20;
  const maxY = Math.max(...allY) + NODE_H + 40;
  const svgW = maxX - minX;
  const svgH = maxY - minY;

  // Build edge lines
  const edgeLines = [];
  for (const edge of edges) {
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) continue;

    const x1 = from.x - minX;
    const y1 = from.y + NODE_H - minY;
    const x2 = to.x - minX;
    const y2 = to.y - minY;

    // Check if this is a back-edge (loop)
    const isBack = to.y <= from.y;

    edgeLines.push({
      key: `${edge.from}-${edge.to}`,
      x1, y1, x2, y2,
      isBack,
      label: edge.condition || '',
    });
  }

  // Also draw branch edges
  for (const [name, stageDef] of Object.entries(stages)) {
    if (stageDef.type === 'branch') {
      for (const target of [stageDef.onTrue, stageDef.onFalse]) {
        if (!target || !positions[target]) continue;
        const alreadyDrawn = edgeLines.some(e => e.key === `${name}-${target}`);
        if (alreadyDrawn) continue;
        const from = positions[name];
        const to = positions[target];
        edgeLines.push({
          key: `${name}-${target}`,
          x1: from.x - minX,
          y1: from.y + NODE_H - minY,
          x2: to.x - minX,
          y2: to.y - minY,
          isBack: to.y <= from.y,
          label: target === stageDef.onTrue ? '✓' : '✗',
        });
      }
    }
  }

  return (
    <div className="patterns-graph">
      <svg width={svgW} height={svgH} style={{ overflow: 'visible' }}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" fill="#555" />
          </marker>
          <marker id="arrow-back" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" fill="#ff4757" />
          </marker>
        </defs>
        {edgeLines.map(edge => {
          if (edge.isBack) {
            // Draw curved back-edge (loop)
            const midX = Math.min(edge.x1, edge.x2) - 40;
            const path = `M${edge.x1},${edge.y1} C${midX},${edge.y1} ${midX},${edge.y2} ${edge.x2},${edge.y2}`;
            return (
              <g key={edge.key}>
                <path d={path} fill="none" stroke="#ff4757" strokeWidth={1.5} strokeDasharray="4,4" markerEnd="url(#arrow-back)" />
                {edge.label && (
                  <text x={midX - 5} y={(edge.y1 + edge.y2) / 2} fill="#ff4757" fontSize={10} textAnchor="end">{edge.label}</text>
                )}
              </g>
            );
          }
          return (
            <g key={edge.key}>
              <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
                stroke="#555" strokeWidth={1.5} markerEnd="url(#arrow)" />
              {edge.label && (
                <text x={(edge.x1 + edge.x2) / 2 + 8} y={(edge.y1 + edge.y2) / 2} fill="#888" fontSize={10}>{edge.label}</text>
              )}
            </g>
          );
        })}
      </svg>

      {stageNames.map(name => {
        const pos = positions[name];
        if (!pos) return null;
        const stageDef = stages[name];
        const isActive = activeStage === name;
        const color = STAGE_TYPE_COLORS[stageDef.type] || '#888';

        return (
          <div
            key={name}
            className={`patterns-graph-node ${isActive ? 'patterns-graph-node--active' : ''}`}
            style={{
              left: pos.x - minX - NODE_W / 2,
              top: pos.y - minY,
              width: NODE_W,
              height: NODE_H,
              borderColor: isActive ? color : '#333',
            }}
            onClick={() => onStageClick?.(name)}
            title={`${stageDef.type} — ${stageDef.model || 'auto'}`}
          >
            <span className="patterns-graph-node-icon" style={{ color }}>{STAGE_TYPE_ICONS[stageDef.type] || '◈'}</span>
            <span className="patterns-graph-node-name">{name}</span>
            {stageDef.model && (
              <span className="patterns-graph-node-model">{stageDef.model.split(':')[1] || stageDef.model}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
