// ── Usage Tracking ──────────────────────────────────────────────
// Persistent usage tracking in Firestore (same dual-storage pattern).
// Tracks per-user generation counts for quota enforcement.

let db = null;
let useFirestore = false;
const memoryStore = new Map();

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection('usage').limit(1).get()
      .then(() => {
        useFirestore = true;
        console.log('Firestore usage collection ready');
      })
      .catch(() => {
        console.log('Firestore unavailable for usage — using in-memory store');
      });
  } catch {
    console.log('Firestore SDK not configured for usage — using in-memory store');
  }
}

initFirestore();

function todayString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getUsage(userId) {
  const today = todayString();

  if (useFirestore) {
    const doc = await db.collection('usage').doc(userId).get();
    if (!doc.exists) return { generationsToday: 0, totalGenerations: 0, date: today };
    const data = doc.data();
    // Auto-reset if date changed
    if (data.date !== today) {
      return { generationsToday: 0, totalGenerations: data.totalGenerations || 0, date: today };
    }
    return data;
  } else {
    const usage = memoryStore.get(userId);
    if (!usage || usage.date !== today) {
      return { generationsToday: 0, totalGenerations: usage?.totalGenerations || 0, date: today };
    }
    return usage;
  }
}

async function incrementGeneration(userId) {
  const today = todayString();

  if (useFirestore) {
    const ref = db.collection('usage').doc(userId);
    const doc = await ref.get();

    if (!doc.exists || doc.data().date !== today) {
      // New day or new user — reset daily count
      await ref.set({
        generationsToday: 1,
        totalGenerations: (doc.exists ? doc.data().totalGenerations || 0 : 0) + 1,
        date: today,
      });
    } else {
      const { FieldValue } = require('@google-cloud/firestore');
      await ref.update({
        generationsToday: FieldValue.increment(1),
        totalGenerations: FieldValue.increment(1),
      });
    }
  } else {
    const existing = memoryStore.get(userId);
    if (!existing || existing.date !== today) {
      memoryStore.set(userId, {
        generationsToday: 1,
        totalGenerations: (existing?.totalGenerations || 0) + 1,
        date: today,
      });
    } else {
      existing.generationsToday++;
      existing.totalGenerations++;
    }
  }
}

module.exports = { getUsage, incrementGeneration };
