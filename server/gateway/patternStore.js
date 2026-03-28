// ── Pattern Store (Firestore + in-memory fallback) ───────────
// CRUD for thinking pattern definitions with versioning.
// Follows the same architecture as promptStore.js.

let db = null;
let useFirestore = false;
const memoryStore = new Map();

const COLLECTION = 'patterns';

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection(COLLECTION).limit(1).get()
      .then(() => { useFirestore = true; console.log('Pattern store: Firestore connected'); })
      .catch(() => { console.log('Pattern store: Firestore unavailable — using in-memory'); });
  } catch { console.log('Pattern store: Firestore SDK not configured — using in-memory'); }
}
initFirestore();

// ── Seed built-in patterns ──────────────────────────────────

async function seedBuiltInPatterns() {
  const builtinPatterns = require('../engine/builtinPatterns');
  let seeded = 0;
  const now = new Date().toISOString();

  for (const pattern of builtinPatterns) {
    const existing = await getPattern(pattern.id);
    if (existing) continue;

    const doc = {
      id: pattern.id,
      currentVersion: 1,
      builtIn: true,
      versions: [{
        version: 1,
        definition: pattern,
        createdAt: now,
        createdBy: 'system',
        note: 'Built-in pattern',
      }],
      createdAt: now,
      updatedAt: now,
    };

    if (useFirestore) {
      await db.collection(COLLECTION).doc(pattern.id).set(doc);
    } else {
      memoryStore.set(pattern.id, doc);
    }
    seeded++;
  }
  return seeded;
}

// ── CRUD ─────────────────────────────────────────────────────

let _patternsSeeded = false;

async function listPatterns() {
  let results;
  if (useFirestore) {
    const snapshot = await db.collection(COLLECTION).get();
    results = snapshot.docs.map(d => {
      const data = d.data();
      const def = data.versions?.[0]?.definition || {};
      return {
        id: data.id,
        name: def.name || data.id,
        description: def.description || '',
        icon: def.icon || '◈',
        color: def.color || '#6c63ff',
        builtIn: data.builtIn || false,
        currentVersion: data.currentVersion,
        updatedAt: data.updatedAt,
      };
    });
  } else {
    results = Array.from(memoryStore.values()).map(d => {
      const def = d.versions?.[0]?.definition || {};
      return {
        id: d.id,
        name: def.name || d.id,
        description: def.description || '',
        icon: def.icon || '◈',
        color: def.color || '#6c63ff',
        builtIn: d.builtIn || false,
        currentVersion: d.currentVersion,
        updatedAt: d.updatedAt,
      };
    });
  }

  // Auto-seed on first empty list (ensures patterns exist in fresh Firestore)
  if (results.length === 0 && !_patternsSeeded) {
    _patternsSeeded = true;
    try {
      const count = await seedBuiltInPatterns();
      if (count > 0) {
        console.log(`Pattern store: auto-seeded ${count} built-in patterns`);
        return listPatterns(); // re-fetch after seeding
      }
    } catch (err) {
      console.error('Pattern store: auto-seed failed:', err.message);
    }
  }

  return results;
}

async function getPattern(id) {
  if (useFirestore) {
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }
  return memoryStore.get(id) || null;
}

async function createPattern(definition, userId) {
  const now = new Date().toISOString();
  const doc = {
    id: definition.id,
    currentVersion: 1,
    builtIn: false,
    versions: [{
      version: 1,
      definition,
      createdAt: now,
      createdBy: userId || 'admin',
      note: 'Initial version',
    }],
    createdAt: now,
    updatedAt: now,
  };

  if (useFirestore) {
    await db.collection(COLLECTION).doc(definition.id).set(doc);
  } else {
    memoryStore.set(definition.id, doc);
  }
  return doc;
}

async function updatePattern(id, definition, note, userId) {
  const pattern = await getPattern(id);
  if (!pattern) return null;

  const newVersion = pattern.currentVersion + 1;
  const now = new Date().toISOString();
  const versionEntry = {
    version: newVersion,
    definition,
    createdAt: now,
    createdBy: userId || 'admin',
    note: note || '',
  };

  // Keep last 20 versions
  const versions = [versionEntry, ...pattern.versions].slice(0, 20);
  const updates = { currentVersion: newVersion, versions, updatedAt: now };

  if (useFirestore) {
    await db.collection(COLLECTION).doc(id).update(updates);
  } else {
    Object.assign(pattern, updates);
  }

  return { ...pattern, ...updates };
}

async function revertPattern(id, targetVersion) {
  const pattern = await getPattern(id);
  if (!pattern) return null;

  const target = pattern.versions.find(v => v.version === targetVersion);
  if (!target) return null;

  return updatePattern(id, target.definition, `Reverted to v${targetVersion}`, 'admin');
}

async function deletePattern(id) {
  const pattern = await getPattern(id);
  if (!pattern) return null;
  if (pattern.builtIn) return { error: 'Cannot delete built-in pattern' };

  if (useFirestore) {
    await db.collection(COLLECTION).doc(id).delete();
  } else {
    memoryStore.delete(id);
  }
  return { deleted: true };
}

module.exports = {
  seedBuiltInPatterns,
  listPatterns,
  getPattern,
  createPattern,
  updatePattern,
  revertPattern,
  deletePattern,
};
