// ── Agent Flow View ──────────────────────────────────────────
// Visualizes the AI execution graph: which agents ran, what tools
// were called, how many nodes were generated at each stage.
// Uses ReactFlow with dagre layout (same pattern as FlowchartView).

import React, { useMemo, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  Panel,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

// ── Custom node component ────────────────────────────────────
function AgentNode({ data }) {
  const statusColor = {
    done: '#20c997',
    active: '#6c63ff',
    pending: '#444',
    error: '#ff4757',
  }[data.status] || '#444';

  const typeIcon = {
    agent: '◈',
    stage: '◎',
    tool: '⟡',
    result: '◇',
  }[data.nodeType] || '○';

  return (
    <div className={`agent-flow-node agent-flow-node--${data.nodeType} agent-flow-node--${data.status}`}>
      <div className="agent-flow-node-header">
        <span className="agent-flow-node-icon" style={{ color: statusColor }}>{typeIcon}</span>
        <span className="agent-flow-node-label">{data.label}</span>
        {data.status === 'active' && <span className="refine-pulse agent-flow-pulse">●</span>}
      </div>
      {data.model && <div className="agent-flow-node-model">{data.model}</div>}
      {data.nodeCount > 0 && <div className="agent-flow-node-badge">{data.nodeCount} nodes</div>}
      {data.elapsed && <div className="agent-flow-node-time">{data.elapsed}</div>}
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode };
const proOptions = { hideAttribution: true };

// ── Dagre layout ─────────────────────────────────────────────
function layoutNodes(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 80 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 200, height: 70 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map(node => {
    const pos = g.node(node.id);
    return { ...node, position: { x: pos.x - 100, y: pos.y - 35 } };
  });
}

// ── Main component ───────────────────────────────────────────
export default function AgentFlowView({ agentFlowLog, onNodeClick }) {
  // Build ReactFlow nodes + edges from the execution log
  const { flowNodes, flowEdges } = useMemo(() => {
    if (!agentFlowLog?.length) {
      return {
        flowNodes: [{
          id: 'empty',
          type: 'agentNode',
          position: { x: 0, y: 0 },
          data: { label: 'No execution data yet', nodeType: 'agent', status: 'pending' },
        }],
        flowEdges: [],
      };
    }

    const nodesMap = new Map();
    const edges = [];

    // Always add a root "Claude" agent node
    nodesMap.set('root', {
      id: 'root',
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: { label: 'Claude (Agent Core)', nodeType: 'agent', status: 'done' },
    });

    for (const event of agentFlowLog) {
      if (event.event === 'stage_start') {
        nodesMap.set(event.id, {
          id: event.id,
          type: 'agentNode',
          position: { x: 0, y: 0 },
          data: {
            label: event.label || event.id,
            nodeType: event.parallel ? 'tool' : 'stage',
            status: 'active',
            model: event.model,
          },
        });
        const parentId = event.parentId || 'root';
        edges.push({
          id: `e-${parentId}-${event.id}`,
          source: parentId,
          target: event.id,
          animated: true,
          style: { stroke: '#6c63ff', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6c63ff', width: 12, height: 12 },
        });
      }

      if (event.event === 'stage_done') {
        const existing = nodesMap.get(event.id);
        if (existing) {
          existing.data = { ...existing.data, status: 'done', nodeCount: event.nodeCount };
        }
      }

      if (event.event === 'agent_done') {
        nodesMap.set(event.id, {
          id: event.id,
          type: 'agentNode',
          position: { x: 0, y: 0 },
          data: { label: event.label || event.id, nodeType: 'result', status: 'done' },
        });
        if (event.parentId) {
          edges.push({
            id: `e-${event.parentId}-${event.id}`,
            source: event.parentId,
            target: event.id,
            style: { stroke: '#20c997', strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#20c997', width: 10, height: 10 },
          });
        }
      }
    }

    const nodesList = Array.from(nodesMap.values());
    const laidOut = layoutNodes(nodesList, edges);

    return { flowNodes: laidOut, flowEdges: edges };
  }, [agentFlowLog]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    setNodes(flowNodes);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEdges(flowEdges);
      });
    });
  }, [flowNodes, flowEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback((_, node) => {
    onNodeClick?.(node);
  }, [onNodeClick]);

  return (
    <div className="agent-flow-view" style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        proOptions={proOptions}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#1e1e2e" />
        <Controls style={{ background: '#16161f', border: '1px solid #2a2a3a', borderRadius: '8px' }} />
        <Panel position="top-left" style={{ margin: 12 }}>
          <div className="agent-flow-legend">
            <span className="agent-flow-legend-item"><span style={{ color: '#6c63ff' }}>◈</span> Agent</span>
            <span className="agent-flow-legend-item"><span style={{ color: '#20c997' }}>◎</span> Stage</span>
            <span className="agent-flow-legend-item"><span style={{ color: '#f59e0b' }}>⟡</span> Tool</span>
            <span className="agent-flow-legend-item"><span style={{ color: '#888' }}>◇</span> Result</span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
