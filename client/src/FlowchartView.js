import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  useNodesState,
  useEdgesState,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import IdeaNode from './IdeaNode';
import { getNodeConfig } from './nodeConfig';
import { computeLayout, buildEdges } from './layoutUtils';
import './FlowchartView.css';

const nodeTypes = { ideaNode: IdeaNode };
const proOptions = { hideAttribution: true };
const fitViewOpts = { padding: 0.2, duration: 400 };

/* ── AutoFitView — refits on node count change ──────────── */
function AutoFitView({ nodeCount }) {
  const { fitView } = useReactFlow();
  const prevCount = useRef(nodeCount);
  const mountedRef = useRef(false);
  useEffect(() => {
    // Skip the first render (mount) to avoid double-fit with ReactFlow's fitView prop
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (nodeCount !== prevCount.current) {
      fitView({ padding: 0.15, duration: 400, maxZoom: 1.2 });
      prevCount.current = nodeCount;
    }
  }, [nodeCount, fitView]);
  return null;
}

/* ── Toolbar ────────────────────────────────────────────── */
function FlowchartToolbar({ searchQuery, onSearchChange, nodeCount, onCollapseAll, onExpandAll, hasCollapsed, drillStack, onExitDrill, onJumpToBreadcrumb }) {
  const { fitView } = useReactFlow();
  const handleFit = useCallback(() => fitView({ padding: 0.2, duration: 400 }), [fitView]);

  return (
    <Panel position="top-left" style={{ margin: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Drill breadcrumb */}
      {drillStack && drillStack.length > 0 && (
        <div className="drill-breadcrumb-bar">
          <button className="drill-back-btn" onClick={onExitDrill} title="Back to full tree">
            ← ROOT
          </button>
          {drillStack.map((entry, i) => (
            <React.Fragment key={entry.nodeId}>
              <span className="drill-crumb-sep">›</span>
              <button
                className="drill-crumb-label"
                onClick={() => onJumpToBreadcrumb(i)}
                style={{ fontWeight: i === drillStack.length - 1 ? 700 : 400 }}
                title={entry.nodeLabel}
              >
                {entry.nodeLabel}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="flowchart-toolbar">
        <button onClick={handleFit} title="Fit entire tree in view">⊡ Fit</button>
        {hasCollapsed ? (
          <button onClick={onExpandAll} title="Expand all collapsed branches">⊞ Expand</button>
        ) : (
          <button onClick={onCollapseAll} title="Collapse all branches">⊟ Collapse</button>
        )}
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchQuery || ''}
          onChange={e => onSearchChange?.(e.target.value)}
          title="Filter by label or reasoning"
        />
        {nodeCount > 0 && <span className="node-count">{nodeCount} nodes</span>}
      </div>
    </Panel>
  );
}

/* ── FlowchartView ──────────────────────────────────────── */
export default function FlowchartView({
  displayNodes,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  onCloseContextMenu,
  drillStack,
  onExitDrill,
  onJumpToBreadcrumb,
  searchQuery,
  onSearchChange,
  onCollapseAll,
  onExpandAll,
  hasCollapsed,
  onReactFlowReady,
}) {
  // Compute dagre top-down layout from displayNodes
  const layoutResult = useMemo(() => {
    if (!displayNodes || !displayNodes.length) return { nodes: [], edges: [] };
    const edgeList = buildEdges(displayNodes, { nodeConfigGetter: getNodeConfig });
    const laidOut = computeLayout(displayNodes, edgeList);
    return { nodes: laidOut, edges: edgeList };
  }, [displayNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutResult.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Sync layout results — set nodes first, defer edges so RF can measure nodes
  useEffect(() => {
    setNodes(layoutResult.nodes);
    // Two-frame delay: first frame renders nodes, second frame RF measures them
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEdges(layoutResult.edges);
      });
    });
  }, [layoutResult, setNodes, setEdges]);

  const miniMapNodeColor = useCallback((node) => {
    return getNodeConfig(node.data?.type).color;
  }, []);

  const handleNodeClick = useCallback((_, node) => {
    onNodeClick(node);
  }, [onNodeClick]);

  const handleNodeDoubleClick = useCallback((_, node) => {
    if (onNodeDoubleClick) onNodeDoubleClick(node.id);
  }, [onNodeDoubleClick]);

  const handleNodeContextMenu = useCallback((event, node) => {
    event.preventDefault();
    if (onNodeContextMenu) onNodeContextMenu(node.id, event.clientX, event.clientY);
  }, [onNodeContextMenu]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={fitViewOpts}
        minZoom={0.05}
        maxZoom={2}
        proOptions={proOptions}
        style={{ background: '#0a0a0f' }}
        nodesDraggable
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={onCloseContextMenu}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#1e1e2e" />
        <AutoFitView nodeCount={nodes.length} />
        <FlowchartToolbar
          searchQuery={searchQuery ?? ''}
          onSearchChange={onSearchChange}
          nodeCount={nodes.length}
          onCollapseAll={onCollapseAll}
          onExpandAll={onExpandAll}
          hasCollapsed={hasCollapsed}
          drillStack={drillStack}
          onExitDrill={onExitDrill}
          onJumpToBreadcrumb={onJumpToBreadcrumb}
        />
        <Controls
          style={{
            background: '#16161f',
            border: '1px solid #2a2a3a',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        />
        <MiniMap
          nodeColor={miniMapNodeColor}
          maskColor="rgba(10,10,15,0.85)"
          style={{
            background: '#111118',
            border: '1px solid #2a2a3a',
            borderRadius: '8px',
          }}
        />
      </ReactFlow>

      {/* DrillBreadcrumb now integrated into FlowchartToolbar panel above */}
    </div>
  );
}
