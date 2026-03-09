// ── User Profile Manager ──────────────────────────────────────
// CRUD for user profiles. Auto-creates user + personal workspace on first auth.
// Falls back to in-memory store if Firestore is unavailable (local dev).

const { v4: uuidv4 } = require('uuid');

let db = null;
let useFirestore = false;
const memoryStore = new Map();

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection('users').limit(1).get()
      .then(() => {
        useFirestore = true;
        console.log('Firestore users collection ready');
      })
      .catch(() => {
        console.log('Firestore unavailable for users — using in-memory store');
      });
  } catch {
    console.log('Firestore SDK not configured for users — using in-memory store');
  }
}

initFirestore();

/**
 * Get existing user or create new one (idempotent).
 * On first creation, also creates a personal workspace via the callback.
 */
async function getOrCreateUser(uid, email, name, photoURL, createWorkspaceFn) {
  // Check existing
  if (useFirestore) {
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) return doc.data();
  } else {
    if (memoryStore.has(uid)) return memoryStore.get(uid);
  }

  // Create personal workspace
  let personalWorkspaceId = null;
  if (createWorkspaceFn) {
    const ws = await createWorkspaceFn(name ? `${name}'s Space` : 'Personal', null, uid, true);
    personalWorkspaceId = ws.id;
  } else {
    personalWorkspaceId = uuidv4();
  }

  const user = {
    uid,
    email: email || '',
    name: name || '',
    photoURL: photoURL || null,
    stripeCustomerId: null,
    plan: 'free',
    personalWorkspaceId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (useFirestore) {
    await db.collection('users').doc(uid).set(user);
  } else {
    memoryStore.set(uid, user);
  }

  return user;
}

async function getUser(uid) {
  if (useFirestore) {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    return doc.data();
  }
  return memoryStore.get(uid) || null;
}

async function updateUser(uid, updates) {
  const timestamped = { ...updates, updatedAt: new Date().toISOString() };
  if (useFirestore) {
    await db.collection('users').doc(uid).update(timestamped);
  } else {
    const user = memoryStore.get(uid);
    if (user) Object.assign(user, timestamped);
  }
}

async function setStripeCustomerId(uid, stripeCustomerId) {
  return updateUser(uid, { stripeCustomerId });
}

async function setPlan(uid, plan) {
  return updateUser(uid, { plan });
}

module.exports = { getOrCreateUser, getUser, updateUser, setStripeCustomerId, setPlan };
