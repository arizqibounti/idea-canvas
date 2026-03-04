// ── Share Link Manager ─────────────────────────────────────────
// CRUD for shareable tree snapshots: unique ID, permissions, expiration.
// Reuses the same Firestore / in-memory pattern as sessions.js.

const crypto = require('crypto');

let db = null;
let useFirestore = false;
const memoryStore = new Map();

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection('shares').limit(1).get()
      .then(() => {
        useFirestore = true;
        console.log('Firestore shares collection ready');
      })
      .catch(() => {
        console.log('Firestore unavailable for shares — using in-memory store');
      });
  } catch {
    console.log('Firestore SDK not configured for shares — using in-memory store');
  }
}

initFirestore();

// Generate a short URL-safe ID (11 chars base64url)
function generateShareId() {
  return crypto.randomBytes(8).toString('base64url').slice(0, 11);
}

/**
 * Create a new share link.
 * @param {object} opts
 * @param {string} opts.idea - Title/prompt
 * @param {Array}  opts.nodes - Raw node array snapshot
 * @param {string} opts.permission - 'view' | 'interact'
 * @param {number} opts.expiresInHours - Hours until expiration (0 = never)
 * @param {string} [opts.createdBy] - Creator identifier
 * @returns {object} The share document
 */
async function createShare({ idea, nodes, mode, meta, permission = 'interact', expiresInHours = 0, createdBy = '' }) {
  const id = generateShareId();
  const now = new Date().toISOString();
  const expiresAt = expiresInHours > 0
    ? new Date(Date.now() + expiresInHours * 3600000).toISOString()
    : null;

  const share = {
    id,
    idea: idea || '',
    nodes: nodes || [],
    mode: mode || 'idea',
    meta: meta || null,
    permission,       // 'view' = read-only pan/zoom, 'interact' = full canvas interaction
    expiresAt,
    createdBy,
    createdAt: now,
    viewCount: 0,
  };

  if (useFirestore) {
    await db.collection('shares').doc(id).set(share);
  } else {
    memoryStore.set(id, share);
  }
  return share;
}

/**
 * Load a share by ID. Returns null if not found or expired.
 */
async function loadShare(shareId) {
  let share;
  if (useFirestore) {
    const doc = await db.collection('shares').doc(shareId).get();
    if (!doc.exists) return null;
    share = { id: doc.id, ...doc.data() };
  } else {
    share = memoryStore.get(shareId) || null;
  }
  if (!share) return null;

  // Check expiration
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return { ...share, expired: true };
  }

  // Increment view count
  try {
    if (useFirestore) {
      const { FieldValue } = require('@google-cloud/firestore');
      await db.collection('shares').doc(shareId).update({
        viewCount: FieldValue.increment(1),
      });
    } else {
      share.viewCount = (share.viewCount || 0) + 1;
    }
  } catch { /* ignore counter errors */ }

  return share;
}

/**
 * Delete a share by ID.
 */
async function deleteShare(shareId) {
  if (useFirestore) {
    await db.collection('shares').doc(shareId).delete();
  } else {
    memoryStore.delete(shareId);
  }
}

module.exports = {
  createShare,
  loadShare,
  deleteShare,
};
