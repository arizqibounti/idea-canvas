// ── Pattern Loader (hot-reload cache) ─────────────────────────
// In-memory cache for thinking pattern definitions with hot-reload
// on admin edits. Mirrors promptLoader.js architecture.

const patternStore = require('../gateway/patternStore');

const cache = new Map(); // id -> pattern definition (resolved)
let initialized = false;

// ── Init: seed + load all patterns into cache ────────────────

async function init() {
  try {
    let list = await patternStore.listPatterns();
    if (list.length === 0) {
      console.log('Pattern loader: no patterns in store, seeding built-ins...');
      const count = await patternStore.seedBuiltInPatterns();
      console.log(`Pattern loader: seeded ${count} built-in patterns`);
      list = await patternStore.listPatterns();
    }

    for (const item of list) {
      const full = await patternStore.getPattern(item.id);
      if (full && full.versions?.length > 0) {
        cache.set(item.id, full.versions[0].definition);
      }
    }
    initialized = true;
    console.log(`Pattern loader: cached ${cache.size} patterns`);
  } catch (err) {
    console.error('Pattern loader init error:', err.message);
  }
}

// ── Get: synchronous read from cache ─────────────────────────

function get(id) {
  return cache.get(id) || null;
}

function getAll() {
  return Array.from(cache.values());
}

// ── Auto-select hints: lightweight list for generation prompt ─

function getAutoSelectHints() {
  return getAll().map(p => ({
    id: p.id,
    name: p.name,
    keywords: p.autoSelect?.keywords || [],
    domainHints: p.autoSelect?.domainHints || [],
    description: p.autoSelect?.description || '',
  }));
}

// ── Hot-reload: refresh a single pattern after admin edit ─────

async function reload(id) {
  const full = await patternStore.getPattern(id);
  if (full && full.versions?.length > 0) {
    cache.set(id, full.versions[0].definition);
  }
}

async function reloadAll() {
  const list = await patternStore.listPatterns();
  for (const item of list) {
    await reload(item.id);
  }
}

// ── Remove from cache (after delete) ─────────────────────────

function remove(id) {
  cache.delete(id);
}

module.exports = {
  init,
  get,
  getAll,
  getAutoSelectHints,
  reload,
  reloadAll,
  remove,
};
