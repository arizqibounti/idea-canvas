// ── Undo Stack Hook ──────────────────────────────────────────
// Maintains a version timeline of canvas snapshots (up to 60).
// Ctrl+Z = undo, Ctrl+Shift+Z / Ctrl+Y = redo.
// Each snapshot is a deep clone of rawNodes at that moment.

import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_SNAPSHOTS = 60;

function cloneNodes(nodes) {
  // Structured clone for deep copy without prototype chain issues
  try {
    return structuredClone(nodes);
  } catch {
    return JSON.parse(JSON.stringify(nodes));
  }
}

export function useUndoStack({ rawNodesRef, applyLayout, drillStackRef, setNodeCount, yjsSyncRef }) {
  const stackRef = useRef([]);        // past snapshots
  const futureRef = useRef([]);       // redo snapshots
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const lastPushTimeRef = useRef(0);

  // Push a snapshot onto the stack (debounced to avoid duplicates within 300ms)
  const pushSnapshot = useCallback((label = '') => {
    const now = Date.now();
    if (now - lastPushTimeRef.current < 300) return;
    lastPushTimeRef.current = now;

    const nodes = rawNodesRef.current;
    if (!nodes || nodes.length === 0) return;

    const snapshot = {
      nodes: cloneNodes(nodes),
      label,
      timestamp: now,
    };

    stackRef.current.push(snapshot);
    if (stackRef.current.length > MAX_SNAPSHOTS) {
      stackRef.current.shift();
    }

    // Clear redo future on new action
    futureRef.current = [];
    setCanUndo(stackRef.current.length > 0);
    setCanRedo(false);
  }, [rawNodesRef]);

  // Restore a snapshot to the canvas
  const restoreSnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    const restoredNodes = cloneNodes(snapshot.nodes);
    rawNodesRef.current = restoredNodes;
    applyLayout(restoredNodes, drillStackRef.current);
    setNodeCount(restoredNodes.length);

    // Sync each node to Yjs
    if (yjsSyncRef?.current) {
      for (const n of restoredNodes) {
        yjsSyncRef.current.updateNodeInYjs?.(n);
      }
    }
  }, [rawNodesRef, applyLayout, drillStackRef, setNodeCount, yjsSyncRef]);

  // Undo — pop from stack, push current state to future
  const undo = useCallback(() => {
    if (stackRef.current.length === 0) return;

    // Save current state to future (redo)
    const currentNodes = rawNodesRef.current;
    if (currentNodes && currentNodes.length > 0) {
      futureRef.current.push({
        nodes: cloneNodes(currentNodes),
        label: 'redo-point',
        timestamp: Date.now(),
      });
    }

    const snapshot = stackRef.current.pop();
    restoreSnapshot(snapshot);

    setCanUndo(stackRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, [rawNodesRef, restoreSnapshot]);

  // Redo — pop from future, push current state to stack
  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;

    // Save current state to stack (undo)
    const currentNodes = rawNodesRef.current;
    if (currentNodes && currentNodes.length > 0) {
      stackRef.current.push({
        nodes: cloneNodes(currentNodes),
        label: 'undo-point',
        timestamp: Date.now(),
      });
    }

    const snapshot = futureRef.current.pop();
    restoreSnapshot(snapshot);

    setCanUndo(stackRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, [rawNodesRef, restoreSnapshot]);

  // Clear entire stack (e.g., on session load)
  const clearStack = useCallback(() => {
    stackRef.current = [];
    futureRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  // Get stack info for UI display
  const getStackInfo = useCallback(() => ({
    undoCount: stackRef.current.length,
    redoCount: futureRef.current.length,
    lastLabel: stackRef.current.length > 0
      ? stackRef.current[stackRef.current.length - 1].label
      : null,
  }), []);

  // Keyboard listener: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y
  useEffect(() => {
    function handler(e) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (document.activeElement?.isContentEditable) return;

      const isMac = navigator.platform?.includes('Mac');
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (mod && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [undo, redo]);

  return {
    pushSnapshot,
    undo,
    redo,
    canUndo,
    canRedo,
    clearStack,
    getStackInfo,
  };
}
