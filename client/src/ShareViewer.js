// ── Share Viewer ─────────────────────────────────────────────
// Standalone view for shared tree links. Fetches snapshot from
// /api/shares/:id and renders it in a read-only ReactFlow canvas.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import IdeaNode from './IdeaNode';
import { getNodeConfig } from './nodeConfig';
import { computeLayout, buildEdges } from './layoutUtils';

const API_URL = process.env.REACT_APP_API_URL || '';
const nodeTypes = { ideaNode: IdeaNode };
const proOptions = { hideAttribution: true };

function ShareViewerInner({ share }) {
  const isViewOnly = share.permission === 'view';

  // Build layout and edges from stored flow nodes
  const { flowNodes, flowEdges } = useMemo(() => {
    const storedNodes = share.nodes || [];
    if (storedNodes.length === 0) return { flowNodes: [], flowEdges: [] };

    // Nodes are already in flow format ({ id, type:'ideaNode', data:{...} })
    // Build edges first so dagre can create the hierarchy layout
    const edges = buildEdges(storedNodes, { nodeConfigGetter: getNodeConfig });
    const laid = computeLayout(storedNodes, edges);
    return { flowNodes: laid, flowEdges: edges };
  }, [share.nodes]);

  const miniMapNodeColor = useCallback((node) => {
    const config = getNodeConfig(node.data?.type);
    return config.color;
  }, []);

  const onNodesChange = useCallback(() => {}, []);
  const onEdgesChange = useCallback(() => {}, []);

  return (
    <div className="share-viewer">
      <div className="share-viewer-header">
        <div className="share-viewer-brand">
          <span className="share-viewer-logo">◈</span>
          <span className="share-viewer-title">Idea Canvas</span>
        </div>
        <div className="share-viewer-info">
          <span className="share-viewer-idea">{share.idea}</span>
          <span className="share-viewer-meta">
            {(share.nodes || []).length} nodes
            {isViewOnly && <span className="share-viewer-badge">VIEW ONLY</span>}
          </span>
        </div>
      </div>
      <div className="share-viewer-canvas">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, duration: 400 }}
          minZoom={0.05}
          maxZoom={2}
          proOptions={proOptions}
          style={{ background: '#0a0a0f' }}
          nodesDraggable={!isViewOnly}
          elementsSelectable={!isViewOnly}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={28}
            size={1}
            color="#1e1e2e"
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
      </div>
    </div>
  );
}

export default function ShareViewer({ shareId }) {
  const [share, setShare] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shareId) return;
    setLoading(true);
    fetch(`${API_URL}/api/shares/${shareId}`)
      .then((res) => {
        if (res.status === 410) return res.json().then((d) => { throw new Error('This share link has expired'); });
        if (res.status === 404) throw new Error('Share not found');
        if (!res.ok) throw new Error(`Error loading share (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setShare(data);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [shareId]);

  if (loading) {
    return (
      <div className="share-viewer-status">
        <div className="share-spinner" />
        <span>Loading shared tree...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="share-viewer-status">
        <div className="share-error-icon">✕</div>
        <span className="share-error-text">{error}</span>
        <a href="/" className="share-back-link">Go to Idea Canvas</a>
      </div>
    );
  }

  if (!share) return null;

  return (
    <ReactFlowProvider>
      <ShareViewerInner share={share} />
    </ReactFlowProvider>
  );
}
