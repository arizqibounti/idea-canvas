// ── Yjs WebSocket Server ───────────────────────────────────
// Real-time collaboration using y-protocols sync + awareness.
// Runs on the same HTTP server at the /yjs path.
// Each room is a separate Yjs document identified by room ID.

const { WebSocketServer } = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const { verifyToken } = require('../middleware/auth');

// Message types (matching y-websocket client protocol)
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// ── Per-room shared state ────────────────────────────────

const rooms = new Map(); // docName → { ydoc, awareness, conns: Set<ws> }

function getOrCreateRoom(docName) {
  if (rooms.has(docName)) return rooms.get(docName);

  const ydoc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(ydoc);

  // Clean up awareness when clients disconnect
  awareness.on('update', ({ added, updated, removed }, origin) => {
    const room = rooms.get(docName);
    if (!room) return;
    const changedClients = [...added, ...updated, ...removed];
    const encodedAwareness = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
    const msg = createAwarenessMessage(encodedAwareness);
    broadcastToRoom(room, msg, origin);
  });

  const room = { ydoc, awareness, conns: new Set() };
  rooms.set(docName, room);
  return room;
}

function createAwarenessMessage(encodedAwareness) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodedAwareness);
  return encoding.toUint8Array(encoder);
}

function broadcastToRoom(room, msg, excludeWs) {
  room.conns.forEach((ws) => {
    if (ws !== excludeWs && ws.readyState === 1) { // OPEN
      ws.send(msg);
    }
  });
}

// ── Handle a single WebSocket connection ─────────────────

function handleConnection(ws, room) {
  const { ydoc, awareness } = room;
  room.conns.add(ws);

  // Listen for doc updates and broadcast to all other clients
  const docUpdateHandler = (update, origin) => {
    if (origin === ws) return; // Don't echo back to sender
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);
    if (ws.readyState === 1) ws.send(msg);
  };
  ydoc.on('update', docUpdateHandler);

  // Process incoming messages
  ws.on('message', (data) => {
    try {
      const msg = new Uint8Array(data);
      const decoder = decoding.createDecoder(msg);
      const msgType = decoding.readVarUint(decoder);

      switch (msgType) {
        case MESSAGE_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws);
          // If the encoder has content beyond the message type, send the response
          if (encoding.length(encoder) > 1) {
            ws.send(encoding.toUint8Array(encoder));
          }
          break;
        }
        case MESSAGE_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(awareness, update, ws);
          break;
        }
      }
    } catch (err) {
      console.error('[yjs] Error processing message:', err.message);
    }
  });

  // Clean up on disconnect
  ws.on('close', () => {
    room.conns.delete(ws);
    ydoc.off('update', docUpdateHandler);
    // Remove this client's awareness state
    awarenessProtocol.removeAwarenessStates(awareness, [ydoc.clientID], null);
    // GC room if empty
    if (room.conns.size === 0) {
      // Keep room alive for 30s in case someone reconnects
      setTimeout(() => {
        if (room.conns.size === 0) {
          ydoc.destroy();
          rooms.delete(room._docName);
        }
      }, 30000);
    }
  });

  // Send initial sync step 1 (our state vector → client sends back diff)
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, ydoc);
    ws.send(encoding.toUint8Array(encoder));
  }

  // Send current awareness states to the new client
  const awarenessStates = awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys()))
    );
    ws.send(encoding.toUint8Array(encoder));
  }
}

// ── Main init ────────────────────────────────────────────

function initYjsWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // Only handle /yjs paths — let other handlers (e.g., /ws) pass through
    if (!url.pathname.startsWith('/yjs')) return;

    // Auth: verify Firebase token if provided
    const token = url.searchParams.get('token');
    if (token) {
      try {
        const user = await verifyToken(token);
        if (!user) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    // Extract room name from path: /yjs/tc_abc123 → tc_abc123
    const docName = url.pathname.replace(/^\/yjs\/?/, '') || 'default';

    wss.handleUpgrade(request, socket, head, (ws) => {
      const room = getOrCreateRoom(docName);
      room._docName = docName; // Store for GC lookup
      handleConnection(ws, room);
    });
  });

  console.log('[yjs] WebSocket ready on /yjs');
  return wss;
}

module.exports = { initYjsWebSocket };
