// ── Share Viewer ─────────────────────────────────────────────
// Standalone view for shared tree links. Fetches snapshot from
// /api/shares/:id and renders it in a ReactFlow canvas.
// Now with node inspection, search, and export capabilities.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import IdeaNode from './IdeaNode';
import { getNodeConfig } from './nodeConfig';
import { computeLayout, buildEdges } from './layoutUtils';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';
const nodeTypes = { ideaNode: IdeaNode };
const proOptions = { hideAttribution: true };

function NodeDetailPanel({ node, onClose }) {
  if (!node) return null;
  const d = node.data || node;
  const config = getNodeConfig(d.type);

  return (
    <div className="share-detail-panel">
      <div className="share-detail-header">
        <span className="share-detail-type" style={{ color: config.color }}>
          {config.icon} {(d.type || 'node').toUpperCase()}
        </span>
        <button className="share-detail-close" onClick={onClose}>✕</button>
      </div>
      <div className="share-detail-label">{d.label}</div>
      {d.reasoning && (
        <div className="share-detail-reasoning">{d.reasoning}</div>
      )}
      {d.score != null && (
        <div className="share-detail-score">Score: {d.score}/10</div>
      )}
    </div>
  );
}

function ShareViewerInner({ share }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const isViewOnly = share.permission === 'view';

  // Build layout and edges from stored flow nodes
  const { flowNodes, flowEdges } = useMemo(() => {
    const storedNodes = share.nodes || [];
    if (storedNodes.length === 0) return { flowNodes: [], flowEdges: [] };
    const edges = buildEdges(storedNodes, { nodeConfigGetter: getNodeConfig });
    const laid = computeLayout(storedNodes, edges);
    return { flowNodes: laid, flowEdges: edges };
  }, [share.nodes]);

  // Filter nodes by search
  const displayNodes = useMemo(() => {
    if (!searchQuery.trim()) return flowNodes;
    const q = searchQuery.toLowerCase();
    return flowNodes.map(n => ({
      ...n,
      data: {
        ...n.data,
        dimmed: !(
          (n.data?.label || '').toLowerCase().includes(q) ||
          (n.data?.type || '').toLowerCase().includes(q) ||
          (n.data?.reasoning || '').toLowerCase().includes(q)
        ),
      },
    }));
  }, [flowNodes, searchQuery]);

  const miniMapNodeColor = useCallback((node) => {
    return getNodeConfig(node.data?.type).color;
  }, []);

  const handleNodeClick = useCallback((_, node) => {
    setSelectedNode(node);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Export as markdown
  const handleExport = useCallback(() => {
    const nodes = share.nodes || [];
    let md = `# ${share.idea || 'Thinking Tree'}\n\n`;
    md += `> ${nodes.length} nodes · Shared via ThoughtClaw\n\n`;

    // Group by type
    const byType = {};
    for (const n of nodes) {
      const d = n.data || n;
      const type = d.type || 'node';
      if (!byType[type]) byType[type] = [];
      byType[type].push(d);
    }

    for (const [type, items] of Object.entries(byType)) {
      const config = getNodeConfig(type);
      md += `## ${config.icon} ${type.toUpperCase()} (${items.length})\n\n`;
      for (const d of items) {
        md += `### ${d.label}\n`;
        if (d.reasoning) md += `${d.reasoning}\n`;
        md += '\n';
      }
    }

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(share.idea || 'tree').slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [share]);

  // Copy link
  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setSelectedNode(null);
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="share-viewer">
      <div className="share-viewer-header">
        <div className="share-viewer-brand">
          <a href="/" className="share-viewer-logo-link">
            <span className="share-viewer-logo">◈</span>
            <span className="share-viewer-title">ThoughtClaw</span>
          </a>
        </div>
        <div className="share-viewer-info">
          <span className="share-viewer-idea">{share.idea}</span>
          <span className="share-viewer-meta">
            {(share.nodes || []).length} nodes
            {share.mode && <span className="share-viewer-mode">{share.mode}</span>}
          </span>
        </div>
        <div className="share-viewer-actions">
          <button className="share-action-btn" onClick={() => setShowSearch(v => !v)} title="Search (⌘F)">
            ⌕
          </button>
          <button className="share-action-btn" onClick={handleExport} title="Export as Markdown">
            ↓
          </button>
          <button className="share-action-btn" onClick={handleCopyLink} title="Copy link">
            🔗
          </button>
        </div>
      </div>

      <div className="share-viewer-canvas">
        <ReactFlow
          nodes={displayNodes}
          edges={flowEdges}
          onNodesChange={() => {}}
          onEdgesChange={() => {}}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, duration: 400 }}
          minZoom={0.05}
          maxZoom={2}
          proOptions={proOptions}
          style={{ background: '#0a0a0f' }}
          nodesDraggable={!isViewOnly}
          elementsSelectable
          panOnDrag
          zoomOnScroll
          zoomOnPinch
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#1e1e2e" />
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

          {/* Search bar */}
          {showSearch && (
            <Panel position="top-left" style={{ margin: 12 }}>
              <div className="share-search-bar">
                <input
                  type="text"
                  className="share-search-input"
                  placeholder="Search nodes..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchQuery && (
                  <button className="share-search-clear" onClick={() => setSearchQuery('')}>✕</button>
                )}
              </div>
            </Panel>
          )}
        </ReactFlow>

        {/* Node detail panel */}
        <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      </div>
    </div>
  );
}

export default function ShareViewer({ shareId }) {
  const [share, setShare] = useState(null);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shareId) return;
    setLoading(true);
    authFetch(`${API_URL}/api/shares/${shareId}`)
      .then((res) => {
        if (res.status === 401) { setErrorCode(401); throw new Error('Sign in to view this shared tree'); }
        if (res.status === 403) { setErrorCode(403); throw new Error('Your account is not authorized to view this content'); }
        if (res.status === 410) return res.json().then(() => { throw new Error('This share link has expired'); });
        if (res.status === 404) throw new Error('Share not found');
        if (!res.ok) throw new Error(`Error loading share (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setShare(data);
        setError(null);
        setErrorCode(null);
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
        <div className="share-error-icon">{errorCode === 403 ? '🔒' : '✕'}</div>
        <span className="share-error-text">{error}</span>
        <a href="/" className="share-back-link">Go to ThoughtClaw</a>
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
