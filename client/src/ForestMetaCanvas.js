// ── Forest Meta Canvas: Topology View ────────────────────────
// Shows the forest as a graph of canvases with dependency and cross-ref edges.
// Reads directly from forestCanvases in context (no separate sessions).

import React, { useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useForest } from './ForestContext';

const STATUS_COLORS = {
  pending: '#333',
  generating: '#6c63ff',
  ready: '#20c997',
  error: '#ff4757',
};

const STATUS_LABELS = {
  pending: 'Pending',
  generating: 'Generating...',
  ready: 'Ready',
  error: 'Error',
};

function CanvasNode({ data }) {
  const status = data.status || 'pending';
  const borderColor = STATUS_COLORS[status];

  return (
    <div
      className="forest-meta-node"
      style={{ borderColor, boxShadow: status === 'generating' ? `0 0 12px ${borderColor}40` : 'none' }}
    >
      <div className="forest-meta-node-header">
        <span className="forest-meta-node-title">{data.title}</span>
        <span className="forest-meta-node-status" style={{ color: borderColor }}>
          {STATUS_LABELS[status]}
        </span>
      </div>
      <div className="forest-meta-node-desc">{(data.description || '').slice(0, 80)}...</div>
      {data.nodeCount > 0 && (
        <div className="forest-meta-node-count">{data.nodeCount} nodes</div>
      )}
    </div>
  );
}

const nodeTypes = { canvasNode: CanvasNode };

function ForestMetaCanvasInner() {
  const ctx = useForest();

  const plan = ctx?.plan;
  const forestCanvases = ctx?.forestCanvases || [];
  const crossRefs = ctx?.crossRefs || [];
  const setActiveCanvas = ctx?.setActiveCanvas;

  // Build layout from forestCanvases directly
  const layout = useMemo(() => {
    if (!forestCanvases.length) return { nodes: [], edges: [] };

    const nodeWidth = 260;
    const nodeHeight = 140;
    const gapX = 80;
    const gapY = 60;

    // Layer-based layout by dependencies
    const layers = [];
    const assigned = new Set();

    let currentLayer = forestCanvases.filter(c => !c.dependencies?.length);
    while (currentLayer.length > 0) {
      layers.push(currentLayer.map(c => c.canvasKey));
      currentLayer.forEach(c => assigned.add(c.canvasKey));
      currentLayer = forestCanvases.filter(c =>
        !assigned.has(c.canvasKey) &&
        (c.dependencies || []).every(d => assigned.has(d))
      );
    }
    const remaining = forestCanvases.filter(c => !assigned.has(c.canvasKey));
    if (remaining.length) layers.push(remaining.map(c => c.canvasKey));

    const nodes = [];
    layers.forEach((layer, layerIdx) => {
      const totalWidth = layer.length * nodeWidth + (layer.length - 1) * gapX;
      const startX = -totalWidth / 2 + nodeWidth / 2;

      layer.forEach((key, idx) => {
        const canvas = forestCanvases.find(c => c.canvasKey === key);
        nodes.push({
          id: key,
          type: 'canvasNode',
          position: { x: startX + idx * (nodeWidth + gapX), y: layerIdx * (nodeHeight + gapY) },
          data: {
            title: canvas?.title || key,
            description: canvas?.description || '',
            status: canvas?.status || 'pending',
            nodeCount: canvas?.nodes?.length || 0,
          },
        });
      });
    });

    // Dependency edges
    const edges = [];
    forestCanvases.forEach(c => {
      (c.dependencies || []).forEach(dep => {
        edges.push({
          id: `dep-${dep}-${c.canvasKey}`,
          source: dep,
          target: c.canvasKey,
          type: 'default',
          animated: c.status === 'generating' || forestCanvases.find(d => d.canvasKey === dep)?.status === 'generating',
          style: { stroke: '#444', strokeWidth: 2 },
        });
      });
    });

    // Cross-reference edges
    const typeColors = { contradicts: '#ff4757', depends_on: '#6c63ff', supports: '#20c997', related: '#f59e0b' };
    (crossRefs || []).forEach((ref, i) => {
      edges.push({
        id: `xref-${i}`,
        source: ref.sourceCanvasKey,
        target: ref.targetCanvasKey,
        type: 'default',
        style: { stroke: typeColors[ref.type] || '#666', strokeWidth: 1.5, strokeDasharray: '5,5' },
        label: ref.label?.slice(0, 30) || ref.type,
        labelStyle: { fontSize: 8, fill: typeColors[ref.type] || '#666' },
      });
    });

    return { nodes, edges };
  }, [forestCanvases, crossRefs]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    setNodes(layout.nodes);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEdges(layout.edges);
      });
    });
  }, [layout, setNodes, setEdges]);

  const handleNodeClick = useCallback((_, node) => {
    if (setActiveCanvas) setActiveCanvas(node.id);
  }, [setActiveCanvas]);

  if (!plan && !forestCanvases.length) {
    return <div className="forest-meta-empty">No forest plan loaded.</div>;
  }

  return (
    <div className="forest-meta-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1a1a2e" />
      </ReactFlow>
    </div>
  );
}

export default function ForestMetaCanvas() {
  return (
    <ReactFlowProvider>
      <ForestMetaCanvasInner />
    </ReactFlowProvider>
  );
}
