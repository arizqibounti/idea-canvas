import React, { useMemo, useState, useCallback, memo } from 'react';
import { getNodeConfig } from './nodeConfig';
import './OutlineView.css';

/* ── Toolbar ────────────────────────────────────────── */

function OutlineToolbar({ searchQuery, onSearchChange, nodeCount, onCollapseAll, onExpandAll, hasCollapsed }) {
  return (
    <div className="outline-toolbar">
      <input
        type="text"
        className="outline-search"
        placeholder="Search nodes..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {hasCollapsed ? (
        <button className="outline-toolbar-btn" onClick={onExpandAll}>⊞ Expand all</button>
      ) : (
        <button className="outline-toolbar-btn" onClick={onCollapseAll}>⊟ Collapse all</button>
      )}
      <span className="outline-node-count">{nodeCount} nodes</span>
    </div>
  );
}

/* ── Single Node Row (recursive) ────────────────────── */

const OutlineNode = memo(function OutlineNode({
  node, childrenMap, depth, selectedNodeId,
  onNodeClick, onNodeDoubleClick,
  collapsedSet, onToggleLocalCollapse,
  searchQuery,
}) {
  const config = getNodeConfig(node.data?.type, node.data?.dynamicConfig);
  const children = childrenMap.get(node.id) || [];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsedSet.has(node.id);
  const isSelected = node.id === selectedNodeId;

  // Search filtering
  const searchTrim = (searchQuery || '').trim().toLowerCase();
  const searchActive = searchTrim.length > 0;
  const searchMatch = !searchActive || (() => {
    const label = (node.data?.label || '').toLowerCase();
    const reasoning = (node.data?.reasoning || '').toLowerCase();
    return label.includes(searchTrim) || reasoning.includes(searchTrim);
  })();
  const dimmed = searchActive && !searchMatch;

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    onNodeClick({ id: node.id, data: node.data });
  }, [node.id, node.data, onNodeClick]);

  const handleDoubleClick = useCallback((e) => {
    e.stopPropagation();
    onNodeDoubleClick(node.id);
  }, [node.id, onNodeDoubleClick]);

  const handleChevron = useCallback((e) => {
    e.stopPropagation();
    onToggleLocalCollapse(node.id);
  }, [node.id, onToggleLocalCollapse]);

  const score = node.data?.score;
  const scoreClass = score != null ? (score >= 8 ? 'high' : score >= 5 ? 'mid' : 'low') : null;
  const reasoning = node.data?.reasoning || '';

  return (
    <div className={`outline-node${isSelected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}>
      <div
        className="outline-node-row"
        style={{ paddingLeft: depth * 20 }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {/* Collapse chevron or leaf dot */}
        {hasChildren ? (
          <button className="outline-collapse-btn" onClick={handleChevron}>
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="outline-leaf-dot" style={{ color: config.color }}>{'·'}</span>
        )}

        {/* Type badge */}
        <span className="outline-type-badge" style={{ color: config.color }}>
          <span className="outline-type-icon">{config.icon}</span>
          <span>{config.label}</span>
        </span>

        {/* Label */}
        <span className="outline-label">{node.data?.label || node.id}</span>

        {/* Lens badge */}
        {node.data?.lens && (
          <span className="outline-lens">{node.data.lens}</span>
        )}

        {/* Score */}
        {score != null && (
          <span className={`outline-score ${scoreClass}`}>{score}/10</span>
        )}

        {/* Star */}
        {node.data?.starred && <span className="outline-star">★ FOCUS</span>}
      </div>

      {/* Reasoning preview */}
      {reasoning && (
        <div className="outline-reasoning" style={{ marginLeft: depth * 20 + 22 }}>
          {reasoning.length > 200 ? reasoning.slice(0, 200) + '...' : reasoning}
        </div>
      )}

      {/* Children */}
      {hasChildren && !isCollapsed && (
        <div className="outline-children">
          {children.map(child => (
            <OutlineNode
              key={child.id}
              node={child}
              childrenMap={childrenMap}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              collapsedSet={collapsedSet}
              onToggleLocalCollapse={onToggleLocalCollapse}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/* ── Main OutlineView ───────────────────────────────── */

export default function OutlineView({
  rawNodes,
  displayNodes,
  onNodeClick,
  onNodeDoubleClick,
  searchQuery,
  onSearchChange,
  selectedNodeId,
}) {
  // Build tree hierarchy from rawNodes (full set, not filtered by collapse)
  const { roots, childrenMap } = useMemo(() => {
    if (!rawNodes || rawNodes.length === 0) return { roots: [], childrenMap: new Map() };

    const nodeMap = new Map(rawNodes.map(n => [n.id, n]));
    const cMap = new Map();
    const childIds = new Set();

    rawNodes.forEach(n => {
      // Support both parentIds array and legacy parentId
      const pids = n.data?.parentIds || (n.data?.parentId ? [n.data.parentId] : []);
      pids.forEach(pid => {
        if (nodeMap.has(pid)) {
          if (!cMap.has(pid)) cMap.set(pid, []);
          cMap.get(pid).push(n);
          childIds.add(n.id);
        }
      });
    });

    // Roots = nodes that are not children of any other node
    const r = rawNodes.filter(n => !childIds.has(n.id));
    return { roots: r, childrenMap: cMap };
  }, [rawNodes]);

  // Local collapse state (independent from graph's collapse)
  const [collapsedSet, setCollapsedSet] = useState(() => new Set());

  const handleToggleLocalCollapse = useCallback((nodeId) => {
    setCollapsedSet(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    // Collapse all nodes that have children
    const parents = new Set();
    for (const [pid] of childrenMap) parents.add(pid);
    setCollapsedSet(parents);
  }, [childrenMap]);

  const handleExpandAll = useCallback(() => {
    setCollapsedSet(new Set());
  }, []);

  const hasCollapsed = collapsedSet.size > 0;
  const totalNodes = rawNodes?.length || 0;

  if (totalNodes === 0) {
    return (
      <div className="outline-container">
        <div className="outline-empty">No nodes yet. Generate a thinking tree first.</div>
      </div>
    );
  }

  return (
    <div className="outline-container">
      <OutlineToolbar
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        nodeCount={totalNodes}
        onCollapseAll={handleCollapseAll}
        onExpandAll={handleExpandAll}
        hasCollapsed={hasCollapsed}
      />
      {roots.map(root => (
        <OutlineNode
          key={root.id}
          node={root}
          childrenMap={childrenMap}
          depth={0}
          selectedNodeId={selectedNodeId}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          collapsedSet={collapsedSet}
          onToggleLocalCollapse={handleToggleLocalCollapse}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  );
}
