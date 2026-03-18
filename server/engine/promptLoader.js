// ── Prompt Loader (hot-reload cache with A/B split) ──────────
// Drop-in replacement for `require('./prompts')` — provides get() with
// in-memory cache, A/B test variant selection, and hot-reload on admin edits.
// Falls back to legacy prompts.js if store is empty or not seeded yet.

const promptStore = require('../gateway/promptStore');
const legacyPrompts = require('./prompts');

const cache = new Map(); // key -> { text, version, abTest }
let initialized = false;

// ── Init: load all prompts from store into cache ────────────

async function init() {
  try {
    const all = await promptStore.listPrompts();
    if (all.length === 0) {
      console.log('Prompt loader: no prompts in store, seeding from legacy...');
      const count = await promptStore.seedFromLegacy();
      console.log(`Prompt loader: seeded ${count} prompts`);
    }
    // Load full docs into cache
    const list = await promptStore.listPrompts();
    for (const item of list) {
      const full = await promptStore.getPrompt(item.key);
      if (full && full.versions?.length > 0) {
        cache.set(item.key, {
          text: full.versions[0].text, // newest version is first
          version: full.currentVersion,
          abTest: full.abTest,
        });
      }
    }
    initialized = true;
    console.log(`Prompt loader: cached ${cache.size} prompts`);
  } catch (err) {
    console.error('Prompt loader init error (falling back to legacy):', err.message);
  }
}

// ── Get: synchronous read with A/B variant selection ────────

function get(key) {
  const cached = cache.get(key);

  // Fallback to legacy if not in cache
  if (!cached) {
    const legacyText = legacyPrompts[key];
    if (typeof legacyText === 'string') {
      return { text: legacyText, version: 0, variant: 'legacy' };
    }
    return { text: '', version: 0, variant: 'missing' };
  }

  // A/B test split
  if (cached.abTest?.enabled && cached.abTest.variantText) {
    const isVariant = Math.random() * 100 < cached.abTest.splitPct;
    return {
      text: isVariant ? cached.abTest.variantText : cached.text,
      version: cached.version,
      variant: isVariant ? 'variant' : 'control',
    };
  }

  return { text: cached.text, version: cached.version, variant: 'control' };
}

// ── Hot-reload: refresh a single prompt after admin edit ─────

async function reload(key) {
  const full = await promptStore.getPrompt(key);
  if (full && full.versions?.length > 0) {
    cache.set(key, {
      text: full.versions[0].text,
      version: full.currentVersion,
      abTest: full.abTest,
    });
  }
}

async function reloadAll() {
  const list = await promptStore.listPrompts();
  for (const item of list) {
    await reload(item.key);
  }
}

// ── Metric recording (fire-and-forget wrapper) ──────────────

function recordMetric(key, variant, latencyMs, signal) {
  promptStore.recordMetric(key, variant, latencyMs, signal).catch(() => {});
}

// ── Legacy-compatible map getters ───────────────────────────
// These replace CRITIC_PROMPT_MAP[mode] etc.

const CRITIC_KEY_MAP = {
  resume: 'RESUME_DEBATE_CRITIC_PROMPT',
  codebase: 'CODEBASE_DEBATE_CRITIC_PROMPT',
  decision: 'DECIDE_DEBATE_CRITIC_PROMPT',
  writing: 'WRITE_DEBATE_CRITIC_PROMPT',
  plan: 'PLAN_DEBATE_CRITIC_PROMPT',
  learn: 'LEARN_DEBATE_CRITIC_PROMPT',
};

const ARCHITECT_KEY_MAP = {
  resume: 'RESUME_DEBATE_ARCHITECT_PROMPT',
  codebase: 'CODEBASE_DEBATE_ARCHITECT_PROMPT',
  decision: 'DECIDE_DEBATE_ARCHITECT_PROMPT',
  writing: 'WRITE_DEBATE_ARCHITECT_PROMPT',
  plan: 'PLAN_DEBATE_ARCHITECT_PROMPT',
  learn: 'LEARN_DEBATE_ARCHITECT_PROMPT',
};

const FINALIZE_KEY_MAP = {
  resume: 'RESUME_DEBATE_FINALIZE_PROMPT',
  codebase: 'CODEBASE_DEBATE_FINALIZE_PROMPT',
  decision: 'DECIDE_DEBATE_FINALIZE_PROMPT',
  writing: 'WRITE_DEBATE_FINALIZE_PROMPT',
  plan: 'PLAN_DEBATE_FINALIZE_PROMPT',
  learn: 'LEARN_DEBATE_FINALIZE_PROMPT',
};

function getCriticPrompt(mode) {
  const key = CRITIC_KEY_MAP[mode] || 'DEBATE_CRITIC_PROMPT';
  return get(key);
}

function getArchitectPrompt(mode) {
  const key = ARCHITECT_KEY_MAP[mode] || 'DEBATE_ARCHITECT_PROMPT';
  return get(key);
}

function getFinalizePrompt(mode) {
  const key = FINALIZE_KEY_MAP[mode] || 'DEBATE_FINALIZE_PROMPT';
  return get(key);
}

module.exports = {
  init,
  get,
  reload,
  reloadAll,
  recordMetric,
  getCriticPrompt,
  getArchitectPrompt,
  getFinalizePrompt,
  // Re-export legacy non-string helpers (functions, objects) for backward compat
  buildCritiqueUserMessage: legacyPrompts.buildCritiqueUserMessage,
  buildRebutUserMessage: legacyPrompts.buildRebutUserMessage,
  buildFinalizeUserMessage: legacyPrompts.buildFinalizeUserMessage,
  MODE_SERVER_META: legacyPrompts.MODE_SERVER_META,
  CHAT_PERSONAS: legacyPrompts.CHAT_PERSONAS,
};
