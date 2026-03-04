// ── Firestore Session Manager ────────────────────────────────
// CRUD for thinking sessions: trees, debates, chats, canvas artifacts.
// Falls back to in-memory store if Firestore is unavailable (local dev).

const { v4: uuidv4 } = require('uuid');

let db = null;
let useFirestore = false;
const memoryStore = new Map();

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    // Test connection with a simple operation
    db.collection('sessions').limit(1).get()
      .then(() => {
        useFirestore = true;
        console.log('Firestore connected');
      })
      .catch(() => {
        console.log('Firestore unavailable — using in-memory session store');
      });
  } catch (err) {
    console.log('Firestore SDK not configured — using in-memory session store');
  }
}

// Initialize on load
initFirestore();

function newSession(idea, mode, userId) {
  return {
    id: uuidv4(),
    idea: idea || '',
    mode: mode || 'idea',
    userId: userId || 'local',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    meta: null,
    nodes: [],
    debates: [],
    chatMessages: [],
    canvasArtifacts: [],
    surfaces: ['web'],
  };
}

async function createSession(idea, mode, userId) {
  const session = newSession(idea, mode, userId);
  if (useFirestore) {
    await db.collection('sessions').doc(session.id).set(session);
  } else {
    memoryStore.set(session.id, session);
  }
  return session;
}

async function loadSession(sessionId) {
  if (useFirestore) {
    const doc = await db.collection('sessions').doc(sessionId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  } else {
    return memoryStore.get(sessionId) || null;
  }
}

async function updateSession(sessionId, updates) {
  const timestamped = { ...updates, updatedAt: new Date().toISOString() };
  if (useFirestore) {
    await db.collection('sessions').doc(sessionId).update(timestamped);
  } else {
    const session = memoryStore.get(sessionId);
    if (session) Object.assign(session, timestamped);
  }
}

async function updateNodes(sessionId, nodes) {
  return updateSession(sessionId, { nodes, nodeCount: nodes.length });
}

async function updateMeta(sessionId, meta) {
  return updateSession(sessionId, { meta });
}

async function appendDebateRound(sessionId, round) {
  if (useFirestore) {
    const { FieldValue } = require('@google-cloud/firestore');
    await db.collection('sessions').doc(sessionId).update({
      debates: FieldValue.arrayUnion(round),
      updatedAt: new Date().toISOString(),
    });
  } else {
    const session = memoryStore.get(sessionId);
    if (session) {
      session.debates.push(round);
      session.updatedAt = new Date().toISOString();
    }
  }
}

async function appendChatMessage(sessionId, message) {
  if (useFirestore) {
    const { FieldValue } = require('@google-cloud/firestore');
    await db.collection('sessions').doc(sessionId).update({
      chatMessages: FieldValue.arrayUnion(message),
      updatedAt: new Date().toISOString(),
    });
  } else {
    const session = memoryStore.get(sessionId);
    if (session) {
      session.chatMessages.push(message);
      session.updatedAt = new Date().toISOString();
    }
  }
}

async function appendCanvasArtifact(sessionId, artifact) {
  const stamped = { ...artifact, id: artifact.id || uuidv4(), generatedAt: new Date().toISOString() };
  if (useFirestore) {
    const { FieldValue } = require('@google-cloud/firestore');
    await db.collection('sessions').doc(sessionId).update({
      canvasArtifacts: FieldValue.arrayUnion(stamped),
      updatedAt: new Date().toISOString(),
    });
  } else {
    const session = memoryStore.get(sessionId);
    if (session) {
      session.canvasArtifacts.push(stamped);
      session.updatedAt = new Date().toISOString();
    }
  }
  return stamped;
}

async function listSessions(limitOrUserId, limit = 20) {
  // Support both old signature listSessions(limit) and new listSessions(userId, limit)
  let userId = null;
  if (typeof limitOrUserId === 'string') {
    userId = limitOrUserId;
  } else if (typeof limitOrUserId === 'number') {
    limit = limitOrUserId;
  }

  if (useFirestore) {
    let query = db.collection('sessions');
    if (userId) query = query.where('userId', '==', userId);
    const snapshot = await query
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .select('idea', 'mode', 'createdAt', 'updatedAt', 'userId', 'nodeCount')
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } else {
    let entries = Array.from(memoryStore.values());
    if (userId) entries = entries.filter(s => s.userId === userId);
    return entries
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(s => ({ id: s.id, idea: s.idea, mode: s.mode, createdAt: s.createdAt, updatedAt: s.updatedAt, nodeCount: s.nodes?.length || s.nodeCount || 0 }));
  }
}

async function deleteSession(sessionId) {
  if (useFirestore) {
    await db.collection('sessions').doc(sessionId).delete();
  } else {
    memoryStore.delete(sessionId);
  }
}

module.exports = {
  createSession,
  loadSession,
  updateSession,
  updateNodes,
  updateMeta,
  appendDebateRound,
  appendChatMessage,
  appendCanvasArtifact,
  listSessions,
  deleteSession,
};
