// ── Node Tools Hook ──────────────────────────────────────────
// Precision editing: Razor (split), Merge, Ripple Delete, Slip Edit.

import { useState, useCallback, useEffect, useRef } from 'react';
import { buildFlowNode, readSSEStream } from './useCanvasMode';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

export function useNodeTools({
  rawNodesRef,
  applyLayout,
  drillStackRef,
  setNodeCount,
  yjsSyncRef,
  selectedNode,
  handleNodeClick,
  deleteNodeBranch,
  handleSaveNodeEdit,
  idea,
  mode,
}) {
  const [isSplitting, setIsSplitting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState(null); // first node in merge pair
  const [slipEditNodeId, setSlipEditNodeId] = useState(null);

  // Ref to avoid stale closures in keyboard handler
  const selectedRef = useRef(selectedNode);
  selectedRef.current = selectedNode;
  const mergeTargetRef = useRef(mergeTarget);
  mergeTargetRef.current = mergeTarget;

  // ── Razor: Split node into two ────────────────────────────
  const handleRazor = useCallback(async (targetNode) => {
    const node = targetNode || selectedRef.current;
    if (!node || isSplitting) return;

    setIsSplitting(true);
    const nodeData = node.data || node;
    const nodeId = node.id;

    // Get the node's parent for re-parenting
    const parentIds = nodeData.parentIds || (nodeData.parentId ? [nodeData.parentId] : []);

    try {
      const res = await authFetch(`${API_URL}/api/split-node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node: {
            id: nodeId,
            label: nodeData.label,
            reasoning: nodeData.reasoning,
            type: nodeData.type,
          },
          idea,
          mode,
        }),
      });

      const newNodes = [];
      await readSSEStream(res, (data) => {
        // Ensure split nodes connect to the original node's parent
        if (parentIds.length > 0) {
          data.parentId = parentIds[0];
          data.parentIds = parentIds;
        }
        // Unique IDs
        data.id = `split_${nodeId}_${Date.now()}_${newNodes.length}`;
        const flowNode = buildFlowNode(data);
        newNodes.push(flowNode);
        rawNodesRef.current = [...rawNodesRef.current, flowNode];
        yjsSyncRef?.current?.addNodeToYjs(flowNode);
      });

      if (newNodes.length > 0) {
        // Re-parent children of original node to first split node
        const firstSplitId = newNodes[0].id;
        rawNodesRef.current = rawNodesRef.current.map(n => {
          const pids = n.data.parentIds || (n.data.parentId ? [n.data.parentId] : []);
          if (pids.includes(nodeId)) {
            const newPids = pids.map(p => p === nodeId ? firstSplitId : p);
            return {
              ...n,
              data: { ...n.data, parentId: newPids[0], parentIds: newPids },
            };
          }
          return n;
        });

        // Remove original node
        rawNodesRef.current = rawNodesRef.current.filter(n => n.id !== nodeId);
        yjsSyncRef?.current?.removeNodesFromYjs([nodeId]);

        applyLayout(rawNodesRef.current, drillStackRef.current);
        setNodeCount(rawNodesRef.current.length);

        // Select first split node
        handleNodeClick(newNodes[0]);
      }
    } catch (err) {
      console.error('Razor split failed:', err);
    } finally {
      setIsSplitting(false);
    }
  }, [idea, mode, rawNodesRef, applyLayout, drillStackRef, setNodeCount, yjsSyncRef, handleNodeClick, isSplitting]);

  // ── Merge: Combine two nodes ──────────────────────────────
  const handleStartMerge = useCallback((targetNode) => {
    const node = targetNode || selectedRef.current;
    if (!node) return;

    if (!mergeTargetRef.current) {
      // First selection — enter merge mode
      setMergeTarget(node);
      setIsMerging(true);
    } else {
      // Second selection — execute merge
      executeMerge(mergeTargetRef.current, node);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const executeMerge = useCallback(async (node1, node2) => {
    if (node1.id === node2.id) {
      setMergeTarget(null);
      setIsMerging(false);
      return;
    }

    try {
      const res = await authFetch(`${API_URL}/api/merge-nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: [
            { id: node1.id, label: node1.data?.label || node1.label, reasoning: node1.data?.reasoning, type: node1.data?.type },
            { id: node2.id, label: node2.data?.label || node2.label, reasoning: node2.data?.reasoning, type: node2.data?.type },
          ],
          idea,
          mode,
        }),
      });

      await readSSEStream(res, (data) => {
        data.id = `merged_${Date.now()}`;
        data.parentIds = [node1.id, node2.id];
        data.parentId = node1.id;
        const flowNode = buildFlowNode(data);
        rawNodesRef.current = [...rawNodesRef.current, flowNode];
        applyLayout(rawNodesRef.current, drillStackRef.current);
        setNodeCount(rawNodesRef.current.length);
        yjsSyncRef?.current?.addNodeToYjs(flowNode);
        handleNodeClick(flowNode);
      });
    } catch (err) {
      console.error('Merge failed:', err);
    } finally {
      setMergeTarget(null);
      setIsMerging(false);
    }
  }, [idea, mode, rawNodesRef, applyLayout, drillStackRef, setNodeCount, yjsSyncRef, handleNodeClick]);

  const cancelMerge = useCallback(() => {
    setMergeTarget(null);
    setIsMerging(false);
  }, []);

  // ── Ripple Delete ─────────────────────────────────────────
  const handleRippleDelete = useCallback((targetNode) => {
    const node = targetNode || selectedRef.current;
    if (!node) return;

    // Don't delete the seed node
    const nodeData = node.data || node;
    if (nodeData.type === 'seed') return;

    // Re-parent: nodes whose only parent is this node → re-parent to this node's parent
    const nodeId = node.id;
    const nodeParentIds = nodeData.parentIds || (nodeData.parentId ? [nodeData.parentId] : []);

    // Find direct children (not descendants — just immediate children)
    const directChildren = rawNodesRef.current.filter(n => {
      const pids = n.data.parentIds || (n.data.parentId ? [n.data.parentId] : []);
      return pids.includes(nodeId);
    });

    // Re-parent direct children to deleted node's parent
    if (nodeParentIds.length > 0 && directChildren.length > 0) {
      rawNodesRef.current = rawNodesRef.current.map(n => {
        const pids = n.data.parentIds || (n.data.parentId ? [n.data.parentId] : []);
        if (pids.includes(nodeId)) {
          const newPids = pids.map(p => p === nodeId ? nodeParentIds[0] : p);
          const updated = { ...n, data: { ...n.data, parentId: newPids[0], parentIds: newPids } };
          yjsSyncRef?.current?.updateNodeInYjs(n.id, { parentId: newPids[0], parentIds: newPids });
          return updated;
        }
        return n;
      });
    }

    // Now remove just the single node (children have been re-parented)
    rawNodesRef.current = rawNodesRef.current.filter(n => n.id !== nodeId);
    yjsSyncRef?.current?.removeNodesFromYjs([nodeId]);
    applyLayout(rawNodesRef.current, drillStackRef.current);
    setNodeCount(rawNodesRef.current.length);
  }, [rawNodesRef, applyLayout, drillStackRef, setNodeCount, yjsSyncRef]);

  // ── Delete entire branch (node + all descendants) ─────────
  const handleDeleteBranch = useCallback((targetNode) => {
    const node = targetNode || selectedRef.current;
    if (!node) return;
    if ((node.data || node).type === 'seed') return;
    deleteNodeBranch(node.id);
  }, [deleteNodeBranch]);

  // ── Keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    function handler(e) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (document.activeElement?.isContentEditable) return;

      const node = selectedRef.current;
      if (!node) return;

      switch (e.key.toLowerCase()) {
        case 'r':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            handleRazor();
          }
          break;
        case 'delete':
        case 'backspace':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) {
              handleDeleteBranch();
            } else {
              handleRippleDelete();
            }
          }
          break;
        case 'escape':
          if (mergeTargetRef.current) {
            cancelMerge();
          }
          break;
        default:
          break;
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleRazor, handleRippleDelete, handleDeleteBranch, cancelMerge]);

  return {
    // Razor
    handleRazor,
    isSplitting,
    // Merge
    handleStartMerge,
    cancelMerge,
    isMerging,
    mergeTarget,
    // Delete
    handleRippleDelete,
    handleDeleteBranch,
    // Slip Edit
    slipEditNodeId,
    setSlipEditNodeId,
  };
}
