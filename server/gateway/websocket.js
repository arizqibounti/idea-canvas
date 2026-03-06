// ── Gateway WebSocket Server ─────────────────────────────────
// Attaches to the HTTP server, handles bidirectional messaging,
// routes requests to engine handlers, streams results via WebSocket.

const { WebSocketServer } = require('ws');
const { SERVER_TYPES, serverMsg, parseClientMsg } = require('./protocol');
const sessions = require('./sessions');
const { verifyToken } = require('../middleware/auth');

// Engine handlers (imported in init)
let engine = null;

// Active connections: ws → { sessionId, surface, userId, abortControllers: Map<requestId, AbortController> }
const connections = new Map();

function initWebSocket(httpServer, anthropicClient, engineHandlers) {
  engine = engineHandlers;

  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade — verify auth token before upgrading
  httpServer.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/ws') {
      return; // Let other upgrade handlers (e.g., /yjs) handle this
    }

    // Verify auth token if provided
    const token = url.searchParams.get('token');
    let userId = 'local';
    if (token) {
      const user = await verifyToken(token);
      if (user) {
        userId = user.uid;
      } else {
        // Token provided but invalid — reject connection
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const surface = url.searchParams.get('surface') || 'web';
      const sessionId = url.searchParams.get('session') || null;
      wss.emit('connection', ws, { surface, sessionId, userId });
    });
  });

  wss.on('connection', async (ws, { surface, sessionId, userId }) => {
    const connState = { sessionId, surface, userId, abortControllers: new Map() };
    connections.set(ws, connState);

    // If sessionId provided, load it; otherwise create new
    let session;
    if (sessionId) {
      session = await sessions.loadSession(sessionId);
    }
    if (!session) {
      session = await sessions.createSession('', 'idea', userId);
      connState.sessionId = session.id;
    }

    ws.send(serverMsg(SERVER_TYPES.CONNECTED, null, {
      sessionId: connState.sessionId,
      surfaces: [surface],
    }));

    ws.on('message', (raw) => handleMessage(ws, anthropicClient, raw.toString()));
    ws.on('close', () => {
      // Abort any in-flight requests
      const state = connections.get(ws);
      if (state) {
        for (const ctrl of state.abortControllers.values()) ctrl.abort();
      }
      connections.delete(ws);
    });
  });

  console.log('WebSocket Gateway ready on /ws');
  return wss;
}

async function handleMessage(ws, client, raw) {
  const msg = parseClientMsg(raw);
  if (!msg) {
    ws.send(serverMsg(SERVER_TYPES.ERROR, null, { message: 'Invalid message format' }));
    return;
  }

  const state = connections.get(ws);
  const requestId = msg.id;

  // Handle stop
  if (msg.type === 'stop') {
    const targetCtrl = state.abortControllers.get(msg.params?.targetId);
    if (targetCtrl) targetCtrl.abort();
    return;
  }

  // Session operations
  if (msg.type === 'session:load') {
    const session = await sessions.loadSession(msg.params.sessionId);
    if (session) {
      state.sessionId = session.id;
      ws.send(serverMsg(SERVER_TYPES.SESSION_LOADED, requestId, session));
    } else {
      ws.send(serverMsg(SERVER_TYPES.ERROR, requestId, { message: 'Session not found' }));
    }
    return;
  }

  if (msg.type === 'session:list') {
    const list = await sessions.listSessions(state.userId, msg.params?.limit || 20);
    ws.send(serverMsg(SERVER_TYPES.SESSION_LIST, requestId, list));
    return;
  }

  if (msg.type === 'session:create') {
    const session = await sessions.createSession(msg.params?.idea || '', msg.params?.mode || 'idea', state.userId);
    state.sessionId = session.id;
    ws.send(serverMsg(SERVER_TYPES.SESSION_CREATED, requestId, { sessionId: session.id }));
    return;
  }

  // Create a fake Express req/res to reuse existing engine handlers
  const abortController = new AbortController();
  state.abortControllers.set(requestId, abortController);

  const fakeReq = {
    body: msg.params,
    signal: abortController.signal,
  };

  // Collect nodes for session persistence
  const collectedNodes = [];
  let sessionMeta = null;

  const fakeRes = createFakeRes(ws, requestId, state, collectedNodes, (meta) => { sessionMeta = meta; });

  try {
    switch (msg.type) {
      case 'generate':
        await engine.handleGenerate(client, fakeReq, fakeRes);
        break;
      case 'generate-multi':
        await engine.handleGenerateMulti(client, fakeReq, fakeRes);
        break;
      case 'generate-research':
        await engine.handleGenerateResearch(client, fakeReq, fakeRes);
        break;
      case 'debate:critique':
        await engine.handleDebateCritique(client, fakeReq, fakeRes);
        break;
      case 'debate:rebut':
        await engine.handleDebateRebut(client, fakeReq, fakeRes);
        break;
      case 'debate:finalize':
        await engine.handleDebateFinalize(client, fakeReq, fakeRes);
        break;
      case 'expand-suggestion':
        await engine.handleExpandSuggestion(client, fakeReq, fakeRes);
        break;
      case 'score':
        await engine.handleScoreNodes(client, fakeReq, fakeRes);
        break;
      case 'extract-template':
        await engine.handleExtractTemplate(client, fakeReq, fakeRes);
        break;
      case 'critique':
        await engine.handleCritique(client, fakeReq, fakeRes);
        break;
      case 'chat':
        await engine.handleChat(client, fakeReq, fakeRes);
        break;
      case 'mockup':
        await engine.handleMockup(client, fakeReq, fakeRes);
        break;
      case 'canvas:generate':
        if (engine.handleCanvasGenerate) {
          await engine.handleCanvasGenerate(client, fakeReq, fakeRes);
        } else {
          ws.send(serverMsg(SERVER_TYPES.ERROR, requestId, { message: 'Canvas engine not available' }));
        }
        break;
      default:
        ws.send(serverMsg(SERVER_TYPES.ERROR, requestId, { message: `Unknown type: ${msg.type}` }));
    }

    // Persist nodes to session after generation completes
    if (collectedNodes.length > 0 && state.sessionId) {
      await sessions.updateNodes(state.sessionId, collectedNodes).catch(() => {});
      if (sessionMeta) await sessions.updateMeta(state.sessionId, sessionMeta).catch(() => {});
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      ws.send(serverMsg(SERVER_TYPES.ERROR, requestId, { message: err.message }));
    }
  } finally {
    state.abortControllers.delete(requestId);
  }
}

// Create a fake Express response that translates SSE writes to WebSocket messages
function createFakeRes(ws, requestId, state, collectedNodes, onMeta) {
  let headersSent = false;

  return {
    // SSE header setting (no-op for WebSocket)
    setHeader() {},
    flushHeaders() { headersSent = true; },

    // The key method: intercept SSE writes and convert to WebSocket messages
    write(chunk) {
      if (ws.readyState !== 1) return false; // WebSocket.OPEN
      const str = typeof chunk === 'string' ? chunk : chunk.toString();

      // Parse SSE data lines
      const lines = str.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();

        if (payload === '[DONE]') {
          ws.send(serverMsg(SERVER_TYPES.DONE, requestId));
          return true;
        }

        try {
          const data = JSON.parse(payload);

          if (data._progress) {
            ws.send(serverMsg(SERVER_TYPES.PROGRESS, requestId, { stage: data.stage }));
          } else if (data._meta) {
            onMeta(data);
            ws.send(serverMsg(SERVER_TYPES.META, requestId, data));
          } else if (data.error) {
            ws.send(serverMsg(SERVER_TYPES.ERROR, requestId, { message: data.error }));
          } else if (data.text !== undefined) {
            // Chat text chunk
            ws.send(serverMsg(SERVER_TYPES.TEXT, requestId, data));
          } else {
            // Node data
            collectedNodes.push(data);
            ws.send(serverMsg(SERVER_TYPES.NODE, requestId, data));
          }
        } catch {
          // Non-JSON line, skip
        }
      }
      return true;
    },

    // Called when SSE stream ends
    end(chunk) {
      if (chunk) this.write(chunk);
      // Don't close WebSocket — it's persistent
    },

    // JSON response (for non-streaming endpoints like score-nodes)
    json(data) {
      ws.send(serverMsg(SERVER_TYPES.RESULT, requestId, data));
    },

    // Status code handling
    status(code) {
      return {
        json: (data) => {
          ws.send(serverMsg(SERVER_TYPES.ERROR, requestId, { message: data.error || `Status ${code}` }));
        },
      };
    },

    headersSent,
  };
}

module.exports = { initWebSocket };
