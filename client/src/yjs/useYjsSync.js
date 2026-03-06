// ── Yjs Sync Hook ──────────────────────────────────────────
// Core hook that creates/manages a Yjs document, providers,
// and bridge functions for the ThoughtClaw canvas.

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

const API_URL = process.env.REACT_APP_API_URL || '';
const YJS_WS_URL = API_URL
  ? API_URL.replace(/^http/, 'ws') + '/yjs'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/yjs`;

// ── Node serialization helpers ─────────────────────────────

// Fields stored as JSON strings (arrays/objects)
const JSON_FIELDS = ['relatedIds', 'dynamicConfig'];

function flowNodeToYMap(flowNode, ydoc) {
  const ymap = new Y.Map();
  const d = flowNode.data || {};
  ymap.set('id', flowNode.id);
  ymap.set('type', d.type || 'insight');
  ymap.set('label', d.label || '');
  ymap.set('reasoning', d.reasoning || '');
  ymap.set('parentId', d.parentId || null);
  ymap.set('score', d.score ?? null);
  ymap.set('lens', d.lens || null);
  ymap.set('starred', d.starred || false);
  ymap.set('expanded', d.expanded || false);
  ymap.set('autoExplored', d.autoExplored || false);
  ymap.set('relatedIds', JSON.stringify(d.relatedIds || []));
  if (d.dynamicConfig) {
    ymap.set('dynamicConfig', JSON.stringify(d.dynamicConfig));
  }
  return ymap;
}

function yMapToFlowNode(ymap, nodeId) {
  const dynamicConfigStr = ymap.get('dynamicConfig');
  return {
    id: nodeId,
    type: 'ideaNode',
    position: { x: 0, y: 0 }, // Layout will recompute
    data: {
      type: ymap.get('type') || 'insight',
      label: ymap.get('label') || '',
      reasoning: ymap.get('reasoning') || '',
      parentId: ymap.get('parentId') || null,
      relatedIds: safeJsonParse(ymap.get('relatedIds'), []),
      score: ymap.get('score') ?? null,
      lens: ymap.get('lens') || null,
      starred: ymap.get('starred') || false,
      expanded: ymap.get('expanded') || false,
      autoExplored: ymap.get('autoExplored') || false,
      dynamicConfig: dynamicConfigStr ? safeJsonParse(dynamicConfigStr, undefined) : undefined,
    },
  };
}

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function readAllNodes(nodesMap) {
  const result = [];
  nodesMap.forEach((ymap, nodeId) => {
    result.push(yMapToFlowNode(ymap, nodeId));
  });
  return result;
}

// ── Main Hook ──────────────────────────────────────────────

export function useYjsSync({ roomId, userName, userColor, getToken }) {
  const ydocRef = useRef(null);
  const providerRef = useRef(null);
  const idbRef = useRef(null);
  const nodesCallbackRef = useRef(null);
  const observerRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [collaborators, setCollaborators] = useState([]);

  // Compute sync status
  const syncStatus = !connected ? 'offline' : synced ? 'synced' : 'connecting';

  // ── Initialize Yjs doc + providers ───────────────────────
  useEffect(() => {
    if (!roomId) return;

    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // IndexedDB persistence — works offline
    const idb = new IndexeddbPersistence(roomId, ydoc);
    idbRef.current = idb;

    // WebSocket provider — real-time sync
    const token = getToken ? getToken() : null;
    const provider = new WebsocketProvider(YJS_WS_URL, roomId, ydoc, {
      params: token ? { token } : {},
    });
    providerRef.current = provider;

    // Connection status
    provider.on('status', ({ status }) => {
      setConnected(status === 'connected');
    });

    provider.on('sync', (isSynced) => {
      setSynced(isSynced);
    });

    // Awareness — track collaborators
    const awareness = provider.awareness;
    awareness.setLocalStateField('user', {
      name: userName || 'Anonymous',
      color: userColor || '#6c63ff',
      isGenerating: false,
    });

    const updateCollaborators = () => {
      const states = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === ydoc.clientID) return;
        states.push({
          clientId,
          name: state.user?.name || 'Anonymous',
          color: state.user?.color || '#888',
          isGenerating: state.user?.isGenerating || false,
        });
      });
      setCollaborators(states);
    };
    awareness.on('change', updateCollaborators);

    // Observe nodes map for changes (local + remote)
    const nodesMap = ydoc.getMap('nodes');
    let debounceTimer = null;
    const observer = () => {
      // Debounce to avoid layout thrashing during rapid node additions
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (nodesCallbackRef.current) {
          nodesCallbackRef.current(readAllNodes(nodesMap));
        }
      }, 50);
    };
    nodesMap.observeDeep(observer);
    observerRef.current = observer;

    return () => {
      clearTimeout(debounceTimer);
      nodesMap.unobserveDeep(observer);
      awareness.off('change', updateCollaborators);
      provider.destroy();
      idb.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      idbRef.current = null;
    };
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update awareness when userName/color change
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    provider.awareness.setLocalStateField('user', {
      name: userName || 'Anonymous',
      color: userColor || '#6c63ff',
      isGenerating: provider.awareness.getLocalState()?.user?.isGenerating || false,
    });
  }, [userName, userColor]);

  // ── Bridge: Write to Yjs ─────────────────────────────────

  const addNodeToYjs = useCallback((flowNode) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const nodesMap = ydoc.getMap('nodes');
    const ymap = flowNodeToYMap(flowNode, ydoc);
    nodesMap.set(flowNode.id, ymap);
  }, []);

  const updateNodeInYjs = useCallback((nodeId, updates) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const nodesMap = ydoc.getMap('nodes');
    const ymap = nodesMap.get(nodeId);
    if (!ymap) return;
    ydoc.transact(() => {
      Object.entries(updates).forEach(([key, value]) => {
        if (JSON_FIELDS.includes(key)) {
          ymap.set(key, JSON.stringify(value));
        } else {
          ymap.set(key, value);
        }
      });
    });
  }, []);

  const removeNodesFromYjs = useCallback((nodeIds) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const nodesMap = ydoc.getMap('nodes');
    ydoc.transact(() => {
      nodeIds.forEach(id => nodesMap.delete(id));
    });
  }, []);

  const writeNodesToYjs = useCallback((rawNodes) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const nodesMap = ydoc.getMap('nodes');
    ydoc.transact(() => {
      // Clear existing
      nodesMap.forEach((_, key) => nodesMap.delete(key));
      // Write all nodes
      rawNodes.forEach(n => {
        const ymap = flowNodeToYMap(n, ydoc);
        nodesMap.set(n.id, ymap);
      });
    });
  }, []);

  const writeMetaToYjs = useCallback((meta) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const metaMap = ydoc.getMap('meta');
    ydoc.transact(() => {
      Object.entries(meta).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          metaMap.set(key, JSON.stringify(value));
        } else {
          metaMap.set(key, value);
        }
      });
    });
  }, []);

  const setLocalGenerating = useCallback((isGenerating) => {
    const provider = providerRef.current;
    if (!provider) return;
    const currentUser = provider.awareness.getLocalState()?.user || {};
    provider.awareness.setLocalStateField('user', {
      ...currentUser,
      isGenerating,
    });
  }, []);

  // ── Bridge: Read from Yjs ────────────────────────────────

  const readNodesFromYjs = useCallback(() => {
    const ydoc = ydocRef.current;
    if (!ydoc) return [];
    return readAllNodes(ydoc.getMap('nodes'));
  }, []);

  const readMetaFromYjs = useCallback(() => {
    const ydoc = ydocRef.current;
    if (!ydoc) return {};
    const metaMap = ydoc.getMap('meta');
    const result = {};
    metaMap.forEach((value, key) => {
      result[key] = typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))
        ? safeJsonParse(value, value)
        : value;
    });
    return result;
  }, []);

  // ── Subscribe to remote changes ──────────────────────────

  const onNodesChanged = useCallback((callback) => {
    nodesCallbackRef.current = callback;
    return () => { nodesCallbackRef.current = null; };
  }, []);

  return {
    ydoc: ydocRef.current,
    connected,
    synced,
    syncStatus,
    collaborators,

    // Write
    addNodeToYjs,
    updateNodeInYjs,
    removeNodesFromYjs,
    writeNodesToYjs,
    writeMetaToYjs,
    setLocalGenerating,

    // Read
    readNodesFromYjs,
    readMetaFromYjs,

    // Subscribe
    onNodesChanged,
  };
}
