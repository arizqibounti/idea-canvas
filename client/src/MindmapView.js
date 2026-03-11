import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import IdeaNode from './IdeaNode';
import DrillBreadcrumb from './DrillBreadcrumb';
import { getNodeConfig } from './nodeConfig';
import { computeRadialLayout, buildEdges } from './layoutUtils';
import './MindmapView.css';

const nodeTypes = { ideaNode: IdeaNode };
const proOptions = { hideAttribution: true };

/* ── AutoFitView — refits on node count change ──────────── */
function AutoFitView({ nodeCount }) {
  const { fitView } = useReactFlow();
  const prevCount = useRef(nodeCount);
  useEffect(() => {
    if (nodeCount !== prevCount.current) {
      fitView({ padding: 0.15, duration: 500, maxZoom: 1.0 });
      prevCount.current = nodeCount;
    }
  }, [nodeCount, fitView]);
  // Fit on first mount
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 400, maxZoom: 1.0 }), 200);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/* ── Toolbar ────────────────────────────────────────────── */
function MindmapToolbar({ searchQuery, onSearchChange, nodeCount, onCollapseAll, onExpandAll, hasCollapsed }) {
  const { fitView } = useReactFlow();
  const handleFit = useCallback(() => fitView({ padding: 0.2, duration: 400 }), [fitView]);

  return (
    <Panel position="top-left" style={{ margin: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="mindmap-toolbar">
        <button onClick={handleFit} title="Fit entire mindmap in view">⊡ Fit</button>
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

/* ── MindmapView ────────────────────────────────────────── */
export default function MindmapView({
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
  // Compute radial layout from displayNodes
  const { nodes, edges } = useMemo(() => {
    if (!displayNodes || !displayNodes.length) return { nodes: [], edges: [] };
    const laidOut = computeRadialLayout(displayNodes);
    const edgeList = buildEdges(displayNodes, { nodeConfigGetter: getNodeConfig });
    return { nodes: laidOut, edges: edgeList };
  }, [displayNodes]);

  const onNodesChange = useCallback(() => {}, []);
  const onEdgesChange = useCallback(() => {}, []);

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
        fitViewOptions={{ padding: 0.15, duration: 400 }}
        minZoom={0.02}
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
        <MindmapToolbar
          searchQuery={searchQuery ?? ''}
          onSearchChange={onSearchChange}
          nodeCount={nodes.length}
          onCollapseAll={onCollapseAll}
          onExpandAll={onExpandAll}
          hasCollapsed={hasCollapsed}
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

      <DrillBreadcrumb
        drillStack={drillStack}
        onExit={onExitDrill}
        onJump={onJumpToBreadcrumb}
      />
    </div>
  );
}
