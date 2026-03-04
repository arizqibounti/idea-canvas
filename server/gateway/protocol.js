// ── Gateway WebSocket Protocol ───────────────────────────────
// Message type definitions and helpers for client ↔ server communication.

// Client → Server message types
const CLIENT_TYPES = {
  GENERATE:          'generate',
  GENERATE_MULTI:    'generate-multi',
  GENERATE_RESEARCH: 'generate-research',
  DEBATE_CRITIQUE:   'debate:critique',
  DEBATE_REBUT:      'debate:rebut',
  DEBATE_FINALIZE:   'debate:finalize',
  EXPAND_SUGGESTION: 'expand-suggestion',
  SCORE:             'score',
  EXTRACT_TEMPLATE:  'extract-template',
  CRITIQUE:          'critique',
  CHAT:              'chat',
  MOCKUP:            'mockup',
  CANVAS_GENERATE:   'canvas:generate',
  SESSION_LOAD:      'session:load',
  SESSION_LIST:      'session:list',
  SESSION_CREATE:    'session:create',
  STOP:              'stop',
};

// Server → Client message types
const SERVER_TYPES = {
  CONNECTED:        'connected',
  NODE:             'node',
  META:             'meta',
  PROGRESS:         'progress',
  TEXT:             'text',
  RESULT:           'result',
  CANVAS_ARTIFACT:  'canvas:artifact',
  DONE:             'done',
  ERROR:            'error',
  SESSION_LOADED:   'session:loaded',
  SESSION_SAVED:    'session:saved',
  SESSION_LIST:     'session:list',
  SESSION_CREATED:  'session:created',
};

// Helper: create server message
function serverMsg(type, requestId, data) {
  return JSON.stringify({ type, requestId, data });
}

// Helper: parse client message
function parseClientMsg(raw) {
  try {
    const msg = JSON.parse(raw);
    if (!msg.type) return null;
    return { type: msg.type, id: msg.id || null, params: msg.params || {} };
  } catch {
    return null;
  }
}

module.exports = { CLIENT_TYPES, SERVER_TYPES, serverMsg, parseClientMsg };
