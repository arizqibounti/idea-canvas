import React, { useCallback } from 'react';
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

const nodeTypes = { ideaNode: IdeaNode };
const proOptions = { hideAttribution: true };

// Toolbar inside ReactFlow so useReactFlow() is available
function CanvasToolbar({ searchQuery = '', onSearchChange, nodeCount }) {
  const { fitView } = useReactFlow();
  const handleFit = useCallback(() => {
    fitView({ padding: 0.2, duration: 400 });
  }, [fitView]);

  return (
    <Panel position="top-left" style={{ margin: 12, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
      <div className="canvas-toolbar">
        <button
          type="button"
          className="canvas-toolbar-fit"
          onClick={handleFit}
          title="Fit entire tree in view"
        >
          ⊡ Fit view
        </button>
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
  onNodeClick,
  onNodeContextMenu,
  onCloseContextMenu,
  drillStack,
  onExitDrill,
  onJumpToBreadcrumb,
  searchQuery,
  onSearchChange,
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

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, duration: 400 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={proOptions}
        style={{ background: '#0a0a0f' }}
        nodesDraggable={!isGenerating}
        elementsSelectable={true}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={onCloseContextMenu}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="#1e1e2e"
        />
        <CanvasToolbar
          searchQuery={searchQuery ?? ''}
          onSearchChange={onSearchChange}
          nodeCount={nodes.length}
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
          AGENT THINKING...
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
