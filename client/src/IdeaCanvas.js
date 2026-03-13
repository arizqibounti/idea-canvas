import React, { useCallback, useEffect, useRef } from 'react';
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
import { getNodeConfig } from './nodeConfig';

const nodeTypes = { ideaNode: IdeaNode };
const proOptions = { hideAttribution: true };

// Bridge: exposes useReactFlow() instance to parent via callback ref
function ReactFlowBridge({ onReady }) {
  const instance = useReactFlow();
  useEffect(() => {
    if (onReady) onReady(instance);
  }, [instance, onReady]);
  return null;
}

// Auto fit-view after generation completes
function AutoFitView({ isGenerating, nodeCount }) {
  const { fitView } = useReactFlow();
  const prevGenerating = useRef(isGenerating);
  useEffect(() => {
    if (prevGenerating.current && !isGenerating && nodeCount > 0) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.15, duration: 500, maxZoom: 1.2 });
      }, 300);
      return () => clearTimeout(timer);
    }
    prevGenerating.current = isGenerating;
  }, [isGenerating, nodeCount, fitView]);
  return null;
}

// Toolbar inside ReactFlow so useReactFlow() is available
function CanvasToolbar({ searchQuery = '', onSearchChange, nodeCount, onCollapseAll, onExpandAll, hasCollapsed, drillStack, onExitDrill, onJumpToBreadcrumb }) {
  const { fitView } = useReactFlow();
  const handleFit = useCallback(() => {
    fitView({ padding: 0.2, duration: 400 });
  }, [fitView]);

  return (
    <Panel position="top-left" style={{ margin: 12, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
      {/* Drill breadcrumb — inside the Panel so it's always visible */}
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
      <div className="canvas-toolbar">
        <button
          type="button"
          className="canvas-toolbar-fit"
          onClick={handleFit}
          title="Fit entire tree in view"
        >
          ⊡ Fit view
        </button>
        {hasCollapsed ? (
          <button
            type="button"
            className="canvas-toolbar-fit"
            onClick={onExpandAll}
            title="Expand all collapsed branches"
          >
            ⊞ Expand all
          </button>
        ) : (
          <button
            type="button"
            className="canvas-toolbar-fit"
            onClick={onCollapseAll}
            title="Collapse all branches to top level"
          >
            ⊟ Collapse all
          </button>
        )}
        <input
          type="text"
          className="canvas-toolbar-search"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
          title="Filter by label or reasoning"
        />
        {nodeCount > 0 && (
          <span className="canvas-toolbar-count">{nodeCount} nodes</span>
        )}
      </div>
    </Panel>
  );
}

export default function IdeaCanvas({
  nodes,
  edges,
  isGenerating,
  isScoring,
  progressText,
  onNodeClick,
  onNodeContextMenu,
  onCloseContextMenu,
  onNodeDoubleClick,
  drillStack,
  onExitDrill,
  onJumpToBreadcrumb,
  searchQuery,
  onSearchChange,
  onReactFlowReady,
  onCollapseAll,
  onExpandAll,
  hasCollapsed,
  isCinematic = false,
}) {
  const onNodesChange = useCallback(() => {}, []);
  const onEdgesChange = useCallback(() => {}, []);

  const miniMapNodeColor = useCallback((node) => {
    const config = getNodeConfig(node.data?.type);
    return config.color;
  }, []);

  const handleNodeContextMenu = useCallback(
    (event, node) => {
      event.preventDefault();
      onNodeContextMenu(node.id, event.clientX, event.clientY);
    },
    [onNodeContextMenu]
  );

  const handleNodeClick = useCallback(
    (_, node) => {
      onNodeClick(node);
    },
    [onNodeClick]
  );

  const handleNodeDoubleClick = useCallback(
    (_, node) => {
      if (onNodeDoubleClick) onNodeDoubleClick(node.id);
    },
    [onNodeDoubleClick]
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView={!isCinematic}
        fitViewOptions={{ padding: 0.2, duration: 400 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={proOptions}
        style={{ background: '#0a0a0f' }}
        nodesDraggable={!isGenerating && !isCinematic}
        panOnDrag={!isCinematic}
        zoomOnScroll={!isCinematic}
        zoomOnPinch={!isCinematic}
        zoomOnDoubleClick={!isCinematic}
        elementsSelectable={!isCinematic}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={onCloseContextMenu}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="#1e1e2e"
        />
        <ReactFlowBridge onReady={onReactFlowReady} />
        {!isCinematic && <AutoFitView isGenerating={isGenerating} nodeCount={nodes.length} />}
        {!isCinematic && (
          <CanvasToolbar
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
        )}
        {!isCinematic && (
          <Controls
            style={{
              background: '#16161f',
              border: '1px solid #2a2a3a',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          />
        )}
        {!isCinematic && (
          <MiniMap
            nodeColor={miniMapNodeColor}
            maskColor="rgba(10,10,15,0.85)"
            style={{
              background: '#111118',
              border: '1px solid #2a2a3a',
              borderRadius: '8px',
            }}
          />
        )}
      </ReactFlow>

      {/* DrillBreadcrumb now integrated into CanvasToolbar panel above */}

      {isGenerating && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#16161f',
            border: '1px solid #2a2a3a',
            borderRadius: '20px',
            padding: '8px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '11px',
            color: '#8888aa',
            letterSpacing: '0.06em',
            zIndex: 10,
          }}
        >
          <PulsingDot />
          {progressText || 'AGENT THINKING...'}
        </div>
      )}
      {isScoring && !isGenerating && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#16161f',
            border: '1px solid #2a2a3a',
            borderRadius: '20px',
            padding: '8px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '11px',
            color: '#8888aa',
            letterSpacing: '0.06em',
            zIndex: 10,
          }}
        >
          <PulsingDot />
          SCORING NODES...
        </div>
      )}
    </div>
  );
}

function PulsingDot() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: '#6c63ff',
        animation: 'pulse 1.2s ease-in-out infinite',
      }}
    />
  );
}
