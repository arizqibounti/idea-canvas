// ── Meta-Evolution Engine ─────────────────────────────────────
// Tracks which strategies produce the best score improvements per mode.
// Learns from outcomes to auto-select optimal strategies over time.
// Persists to Firestore with in-memory fallback (same pattern as scheduler.js).

const { v4: uuidv4 } = require('uuid');

let db = null;
let useFirestore = false;
const memoryStore = []; // in-memory fallback
const COLLECTION = 'meta_evolution';
const MAX_RECORDS = 200; // cap per user per mode

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection(COLLECTION).limit(1).get()
      .then(() => { useFirestore = true; })
      .catch(() => { /* local fallback */ });
  } catch { /* local fallback */ }
}
initFirestore();

/**
 * Record a strategy outcome after scoring.
 */
async function recordOutcome(userId, mode, strategy, scoreDelta, sessionId) {
  const record = {
    id: uuidv4(),
    userId: userId || 'local',
    mode: mode || 'idea',
    strategy,
    scoreDelta: Number(scoreDelta) || 0,
    sessionId: sessionId || null,
    timestamp: new Date().toISOString(),
  };

  if (useFirestore) {
    try {
      await db.collection(COLLECTION).doc(record.id).set(record);
    } catch (err) {
      console.warn('Meta-evolution: Firestore write failed:', err.message);
      memoryStore.push(record);
    }
  } else {
    memoryStore.push(record);
    // Trim in-memory store
    if (memoryStore.length > 1000) memoryStore.splice(0, memoryStore.length - 1000);
  }

  return record;
}

/**
 * Get the best-performing strategy for a given mode.
 * Returns the strategy with the highest average score delta.
 */
async function getBestStrategy(userId, mode, availableStrategies) {
  const records = await getRecords(userId, mode);
  if (!records.length) return null;

  // Aggregate: avg scoreDelta per strategy
  const strategyStats = {};
  for (const r of records) {
    if (!strategyStats[r.strategy]) {
      strategyStats[r.strategy] = { totalDelta: 0, count: 0 };
    }
    strategyStats[r.strategy].totalDelta += r.scoreDelta;
    strategyStats[r.strategy].count++;
  }

  // Filter to available strategies if provided
  const candidates = availableStrategies
    ? Object.entries(strategyStats).filter(([s]) => availableStrategies.includes(s))
    : Object.entries(strategyStats);

  if (!candidates.length) return null;

  // Sort by avg delta descending
  candidates.sort((a, b) => (b[1].totalDelta / b[1].count) - (a[1].totalDelta / a[1].count));

  const best = candidates[0];
  return {
    strategy: best[0],
    avgDelta: +(best[1].totalDelta / best[1].count).toFixed(2),
    count: best[1].count,
  };
}

/**
 * Get effectiveness report: avg delta per strategy for a mode.
 */
async function getEffectivenessReport(userId, mode) {
  const records = await getRecords(userId, mode);
  if (!records.length) return { strategies: {}, totalRecords: 0 };

  const strategyStats = {};
  for (const r of records) {
    if (!strategyStats[r.strategy]) {
      strategyStats[r.strategy] = { totalDelta: 0, count: 0, best: -Infinity, worst: Infinity };
    }
    const s = strategyStats[r.strategy];
    s.totalDelta += r.scoreDelta;
    s.count++;
    if (r.scoreDelta > s.best) s.best = r.scoreDelta;
    if (r.scoreDelta < s.worst) s.worst = r.scoreDelta;
  }

  const strategies = {};
  for (const [name, stats] of Object.entries(strategyStats)) {
    strategies[name] = {
      avgDelta: +(stats.totalDelta / stats.count).toFixed(2),
      count: stats.count,
      best: +stats.best.toFixed(2),
      worst: +stats.worst.toFixed(2),
    };
  }

  return { strategies, totalRecords: records.length };
}

// ── Internal helpers ──────────────────────────────────────────

async function getRecords(userId, mode) {
  if (useFirestore) {
    try {
      let query = db.collection(COLLECTION)
        .where('userId', '==', userId || 'local')
        .where('mode', '==', mode || 'idea')
        .orderBy('timestamp', 'desc')
        .limit(MAX_RECORDS);
      const snapshot = await query.get();
      return snapshot.docs.map(d => d.data());
    } catch {
      // Fall through to memory
    }
  }
  return memoryStore
    .filter(r => r.userId === (userId || 'local') && r.mode === (mode || 'idea'))
    .slice(-MAX_RECORDS);
}

module.exports = { recordOutcome, getBestStrategy, getEffectivenessReport };
