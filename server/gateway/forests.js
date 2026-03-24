// ── Firestore Forest Manager ─────────────────────────────────
// CRUD for thinking forests: multi-canvas decompositions.
// Falls back to in-memory store if Firestore is unavailable (local dev).

const { v4: uuidv4 } = require('uuid');

let db = null;
let useFirestore = false;
const memoryStore = new Map();

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection('forests').limit(1).get()
      .then(() => { useFirestore = true; })
      .catch(() => { console.log('Firestore unavailable for forests — using in-memory store'); });
  } catch {
    console.log('Firestore unavailable for forests — using in-memory store');
  }
}

initFirestore();

function newForest(idea, userId, workspaceId) {
  return {
    id: uuidv4(),
    userId: userId || 'local',
    workspaceId: workspaceId || null,
    idea: idea || '',
    plan: null,
    canvases: [],
    crossRefs: [],
    status: 'planning',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function createForest(idea, userId, workspaceId) {
  const forest = newForest(idea, userId, workspaceId);
  if (useFirestore) {
    await db.collection('forests').doc(forest.id).set(forest);
  } else {
    memoryStore.set(forest.id, forest);
  }
  return forest;
}

async function loadForest(forestId) {
  if (useFirestore) {
    const doc = await db.collection('forests').doc(forestId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }
  return memoryStore.get(forestId) || null;
}

async function updateForest(forestId, updates) {
  const timestamped = { ...updates, updatedAt: new Date().toISOString() };
  if (useFirestore) {
    await db.collection('forests').doc(forestId).update(timestamped);
  } else {
    const forest = memoryStore.get(forestId);
    if (forest) Object.assign(forest, timestamped);
  }
}

async function listForests(userId, limit = 20) {
  if (useFirestore) {
    let query = db.collection('forests');
    if (userId) query = query.where('userId', '==', userId);
    const snapshot = await query
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .select('idea', 'status', 'createdAt', 'updatedAt', 'canvases')
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  let entries = Array.from(memoryStore.values());
  if (userId) entries = entries.filter(f => f.userId === userId);
  return entries
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map(f => ({ id: f.id, idea: f.idea, status: f.status, createdAt: f.createdAt, updatedAt: f.updatedAt, canvases: f.canvases }));
}

async function deleteForest(forestId) {
  if (useFirestore) {
    await db.collection('forests').doc(forestId).delete();
  } else {
    memoryStore.delete(forestId);
  }
}

async function addCanvasRef(forestId, canvasRef) {
  if (useFirestore) {
    const { FieldValue } = require('@google-cloud/firestore');
    await db.collection('forests').doc(forestId).update({
      canvases: FieldValue.arrayUnion(canvasRef),
      updatedAt: new Date().toISOString(),
    });
  } else {
    const forest = memoryStore.get(forestId);
    if (forest) {
      forest.canvases.push(canvasRef);
      forest.updatedAt = new Date().toISOString();
    }
  }
}

async function updateCanvasStatus(forestId, canvasKey, status, nodeCount) {
  const forest = await loadForest(forestId);
  if (!forest) return;
  const updated = forest.canvases.map(c =>
    c.canvasKey === canvasKey ? { ...c, status, ...(nodeCount != null ? { nodeCount } : {}) } : c
  );
  await updateForest(forestId, { canvases: updated });
}

async function setCrossRefs(forestId, crossRefs) {
  await updateForest(forestId, { crossRefs });
}

module.exports = {
  createForest,
  loadForest,
  updateForest,
  listForests,
  deleteForest,
  addCanvasRef,
  updateCanvasStatus,
  setCrossRefs,
};
