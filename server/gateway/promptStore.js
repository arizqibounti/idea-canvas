// ── Prompt Store (Firestore + in-memory fallback) ────────────
// CRUD for managed prompts with versioning and A/B test config.
// Follows the same pattern as sessions.js.

let db = null;
let useFirestore = false;
const memoryStore = new Map();

const COLLECTION = 'prompts';

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection(COLLECTION).limit(1).get()
      .then(() => { useFirestore = true; console.log('Prompt store: Firestore connected'); })
      .catch(() => { console.log('Prompt store: Firestore unavailable — using in-memory'); });
  } catch { console.log('Prompt store: Firestore SDK not configured — using in-memory'); }
}
initFirestore();

// ── Seed from legacy prompts.js ─────────────────────────────

// Category inference from prompt key
function inferCategory(key) {
  if (/^LEARN_/.test(key)) return 'learn';
  if (/^RESUME_/.test(key)) return 'resume';
  if (/^CODEBASE_/.test(key)) return 'codebase';
  if (/^DECIDE_/.test(key)) return 'decision';
  if (/^WRITE_/.test(key)) return 'writing';
  if (/^PLAN_/.test(key)) return 'plan';
  if (/^PORTFOLIO_/.test(key)) return 'portfolio';
  if (/^REFINE_/.test(key)) return 'refine';
  if (/^DEBATE_|CRITIC_|ARCHITECT_|FINALIZE_/.test(key)) return 'debate';
  if (/^LENS_|MULTI_AGENT|AGGREGATE|CAUSAL/.test(key)) return 'multi-agent';
  if (/^EXPERIMENT_/.test(key)) return 'experiment';
  if (/^FRACTAL_/.test(key)) return 'fractal';
  if (/CHAT/.test(key)) return 'chat';
  if (/MNEMONIC/.test(key)) return 'learn';
  return 'generate';
}

function inferMode(key) {
  if (/^RESUME_/.test(key)) return 'resume';
  if (/^CODEBASE_/.test(key)) return 'codebase';
  if (/^DECIDE_/.test(key)) return 'decision';
  if (/^WRITE_/.test(key)) return 'writing';
  if (/^PLAN_/.test(key)) return 'plan';
  if (/^LEARN_/.test(key)) return 'learn';
  return null; // mode-agnostic
}

async function seedFromLegacy() {
  const legacyPrompts = require('../engine/prompts');
  let seeded = 0;
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(legacyPrompts)) {
    // Skip non-string exports (functions, maps/objects)
    if (typeof value !== 'string') continue;
    // Skip if already exists
    const existing = await getPrompt(key);
    if (existing) continue;

    const doc = {
      key,
      category: inferCategory(key),
      mode: inferMode(key),
      currentVersion: 1,
      versions: [{
        version: 1,
        text: value,
        createdAt: now,
        createdBy: 'system',
        note: 'Seeded from legacy prompts.js',
      }],
      abTest: null,
      createdAt: now,
      updatedAt: now,
    };

    if (useFirestore) {
      await db.collection(COLLECTION).doc(key).set(doc);
    } else {
      memoryStore.set(key, doc);
    }
    seeded++;
  }
  return seeded;
}

// ── CRUD ─────────────────────────────────────────────────────

async function listPrompts() {
  if (useFirestore) {
    const snapshot = await db.collection(COLLECTION).orderBy('category').get();
    return snapshot.docs.map(d => {
      const data = d.data();
      return {
        key: data.key,
        category: data.category,
        mode: data.mode,
        currentVersion: data.currentVersion,
        abTestActive: !!data.abTest?.enabled,
        updatedAt: data.updatedAt,
      };
    });
  }
  return Array.from(memoryStore.values()).map(d => ({
    key: d.key,
    category: d.category,
    mode: d.mode,
    currentVersion: d.currentVersion,
    abTestActive: !!d.abTest?.enabled,
    updatedAt: d.updatedAt,
  })).sort((a, b) => (a.category || '').localeCompare(b.category || ''));
}

async function getPrompt(key) {
  if (useFirestore) {
    const doc = await db.collection(COLLECTION).doc(key).get();
    if (!doc.exists) return null;
    return { key: doc.id, ...doc.data() };
  }
  return memoryStore.get(key) || null;
}

async function updatePromptText(key, text, note, userId) {
  const prompt = await getPrompt(key);
  if (!prompt) return null;

  const newVersion = prompt.currentVersion + 1;
  const now = new Date().toISOString();
  const versionEntry = {
    version: newVersion,
    text,
    createdAt: now,
    createdBy: userId || 'admin',
    note: note || '',
  };

  // Keep last 20 versions
  const versions = [versionEntry, ...prompt.versions].slice(0, 20);

  const updates = {
    currentVersion: newVersion,
    versions,
    updatedAt: now,
  };

  if (useFirestore) {
    await db.collection(COLLECTION).doc(key).update(updates);
  } else {
    Object.assign(prompt, updates);
  }

  return { ...prompt, ...updates };
}

async function revertPrompt(key, targetVersion) {
  const prompt = await getPrompt(key);
  if (!prompt) return null;

  const target = prompt.versions.find(v => v.version === targetVersion);
  if (!target) return null;

  // Create a new version with the reverted text
  return updatePromptText(key, target.text, `Reverted to v${targetVersion}`, 'admin');
}

async function updateAbTest(key, abConfig) {
  const prompt = await getPrompt(key);
  if (!prompt) return null;

  const now = new Date().toISOString();
  const abTest = abConfig.enabled ? {
    enabled: true,
    variantText: abConfig.variantText || '',
    splitPct: abConfig.splitPct ?? 50,
    startedAt: now,
    metrics: {
      control: { calls: 0, totalLatencyMs: 0, thumbsUp: 0, thumbsDown: 0 },
      variant: { calls: 0, totalLatencyMs: 0, thumbsUp: 0, thumbsDown: 0 },
    },
  } : null;

  const updates = { abTest, updatedAt: now };

  if (useFirestore) {
    await db.collection(COLLECTION).doc(key).update(updates);
  } else {
    Object.assign(prompt, updates);
  }

  return { ...prompt, ...updates };
}

async function recordMetric(key, variant, latencyMs, signal) {
  const prompt = await getPrompt(key);
  if (!prompt?.abTest?.enabled) return;

  const bucket = variant === 'variant' ? prompt.abTest.metrics.variant : prompt.abTest.metrics.control;
  bucket.calls++;
  if (latencyMs) bucket.totalLatencyMs += latencyMs;
  if (signal === 'thumbsUp') bucket.thumbsUp++;
  if (signal === 'thumbsDown') bucket.thumbsDown++;

  if (useFirestore) {
    await db.collection(COLLECTION).doc(key).update({
      'abTest.metrics': prompt.abTest.metrics,
    });
  }
}

module.exports = {
  seedFromLegacy,
  listPrompts,
  getPrompt,
  updatePromptText,
  revertPrompt,
  updateAbTest,
  recordMetric,
};
