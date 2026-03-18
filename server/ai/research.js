// ── Research-as-a-Tool ───────────────────────────────────────
// Centralized research pipeline that any engine can invoke.
// Supports two modes:
//   1. Gemini Grounding (new) — uses Google Search natively
//   2. Classic pipeline (fallback) — plan → 3 agents → brief

const ai = require('./providers');
const { fetchPage } = require('../utils/web');

// ── Cache ────────────────────────────────────────────────────
// Simple in-memory cache for research results (keyed by topic hash).
// Avoids re-running identical research across refine/portfolio/generate.
const _cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function cacheKey(topic, depth) {
  return `${depth}:${topic.toLowerCase().trim().slice(0, 200)}`;
}

function getCached(topic, depth) {
  const key = cacheKey(topic, depth);
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(topic, depth, data) {
  const key = cacheKey(topic, depth);
  _cache.set(key, { data, timestamp: Date.now() });
  // Evict old entries
  if (_cache.size > 100) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 20; i++) _cache.delete(oldest[i][0]);
  }
}

// ── Grounded Research (Gemini + Google Search) ───────────────

const GROUNDED_RESEARCH_PROMPT = `You are a thorough research analyst. Given a topic, use Google Search to find real, current information and synthesize a comprehensive research brief.

Structure your output as a JSON object:
{
  "marketFindings": ["finding with specific data..."],
  "technologyFindings": ["finding with specific data..."],
  "audienceFindings": ["finding with specific data..."],
  "competitors": [{"name": "...", "detail": "..."}],
  "dataPoints": [{"metric": "...", "value": "...", "source": "..."}],
  "gaps": ["areas where information was limited"]
}

Be specific — cite real names, numbers, URLs, and details. Do not fabricate data.`;

async function groundedResearch(topic, existingContext) {
  const query = existingContext
    ? `Research this topic thoroughly: "${topic}"\n\nExisting context:\n${existingContext}\n\nFind real competitors, market data, technology options, and user insights. Output ONLY the JSON object.`
    : `Research this topic thoroughly: "${topic}"\n\nFind real competitors, market data, technology options, and user insights. Output ONLY the JSON object.`;

  try {
    const { text, groundingMetadata } = await ai.callWithGrounding({
      query,
      system: GROUNDED_RESEARCH_PROMPT,
      maxTokens: 2048,
    });

    const parsed = ai.parseJSON(text);
    return {
      brief: formatBrief(parsed),
      raw: parsed,
      grounding: groundingMetadata,
      source: 'gemini-grounding',
    };
  } catch (err) {
    console.error('Grounded research error:', err.message);
    return null; // Caller should fall back to classic pipeline
  }
}

function formatBrief(data) {
  let brief = 'DEEP RESEARCH BRIEF — Use this to ground every node in real data:\n\n';

  brief += '=== MARKET RESEARCH ===\n';
  brief += `Key findings:\n${(data.marketFindings || []).map(f => `- ${f}`).join('\n') || '- No findings'}\n`;
  if (data.competitors?.length) {
    brief += `Competitors:\n${data.competitors.map(c => `- ${c.name}: ${c.detail}`).join('\n')}\n`;
  }
  if (data.dataPoints?.length) {
    brief += `Data points:\n${data.dataPoints.map(d => `- ${d.metric}: ${d.value} (${d.source})`).join('\n')}\n`;
  }

  brief += '\n=== TECHNOLOGY RESEARCH ===\n';
  brief += `Key findings:\n${(data.technologyFindings || []).map(f => `- ${f}`).join('\n') || '- No findings'}\n`;

  brief += '\n=== AUDIENCE RESEARCH ===\n';
  brief += `Key findings:\n${(data.audienceFindings || []).map(f => `- ${f}`).join('\n') || '- No findings'}\n`;

  if (data.gaps?.length) {
    brief += `\n=== RESEARCH GAPS ===\n${data.gaps.map(g => `- ${g}`).join('\n')}\n`;
  }

  brief += '\nINSTRUCTION: Every node you generate must reference specific findings from this research brief. Cite real competitor names, real technologies, real user segments, and real data points.';
  return brief;
}

// ── Classic Research Pipeline (fallback) ─────────────────────
// Uses the existing plan → 3 agents → brief flow from utils/research.js

async function classicResearch(topic, existingContext) {
  const { planResearch, runResearchAgent, buildResearchBrief } = require('../utils/research');
  const gemini = ai.getGemini();

  try {
    const plan = await planResearch(gemini, topic, existingContext);
    const [market, tech, audience] = await Promise.all([
      runResearchAgent(gemini, 'market', plan, existingContext),
      runResearchAgent(gemini, 'technology', plan, existingContext),
      runResearchAgent(gemini, 'audience', plan, existingContext),
    ]);
    const brief = buildResearchBrief([market, tech, audience]);
    return {
      brief,
      raw: { market, tech, audience },
      source: 'classic-pipeline',
    };
  } catch (err) {
    console.error('Classic research error:', err.message);
    return {
      brief: 'Research could not be completed. Generate based on domain knowledge.',
      raw: {},
      source: 'fallback',
    };
  }
}

// ── Lens Analysis ────────────────────────────────────────────
// Parallel multi-perspective analysis (analogical, first-principles, adversarial)

async function lensAnalysis(topic, treeContext, lenses = ['analogical', 'first_principles', 'adversarial']) {
  const {
    LENS_ANALOGICAL_PROMPT,
    LENS_FIRST_PRINCIPLES_PROMPT,
    LENS_ADVERSARIAL_PROMPT,
  } = require('../engine/prompts');

  const lensPrompts = {
    analogical: LENS_ANALOGICAL_PROMPT,
    first_principles: LENS_FIRST_PRINCIPLES_PROMPT,
    adversarial: LENS_ADVERSARIAL_PROMPT,
  };

  const results = await Promise.all(
    lenses.map(async (lens) => {
      const prompt = lensPrompts[lens];
      if (!prompt) return { lens, insights: [] };

      try {
        const { text } = await ai.call({
          model: 'claude:sonnet',
          system: prompt,
          messages: [{ role: 'user', content: `Topic: "${topic}"\n\n${treeContext}` }],
          maxTokens: 1500,
        });
        return { lens, text };
      } catch (err) {
        console.error(`Lens ${lens} error:`, err.message);
        return { lens, text: '' };
      }
    })
  );

  return results;
}

// ── Main Research Entry Point ────────────────────────────────

/**
 * Run research on a topic. Tries Gemini grounding first, falls back to classic.
 *
 * @param {object} opts
 * @param {string} opts.topic          - Research topic
 * @param {string} [opts.depth]        - 'quick' | 'deep' | 'exhaustive'
 * @param {string} [opts.context]      - Existing context to incorporate
 * @param {Array}  [opts.lenses]       - Lens analysis types to run
 * @param {boolean} [opts.skipCache]   - Force fresh research
 * @returns {Promise<{brief: string, lensInsights: Array, source: string}>}
 */
async function research(opts) {
  const { topic, depth = 'deep', context, lenses, skipCache = false } = opts;

  // Check cache
  if (!skipCache) {
    const cached = getCached(topic, depth);
    if (cached) {
      console.log(`Research cache hit for: ${topic.slice(0, 50)}...`);
      return cached;
    }
  }

  // Try Gemini grounding first (faster, cheaper, no URL fetching)
  let researchResult = null;
  if (depth !== 'quick') {
    researchResult = await groundedResearch(topic, context);
  }

  // Fall back to classic pipeline
  if (!researchResult) {
    researchResult = await classicResearch(topic, context);
  }

  // Run lens analysis in parallel (if requested)
  let lensInsights = [];
  if (lenses && lenses.length > 0) {
    const treeContext = context || `Idea: "${topic}"`;
    lensInsights = await lensAnalysis(topic, treeContext, lenses);
  }

  const result = {
    brief: researchResult.brief,
    lensInsights,
    source: researchResult.source,
  };

  // Cache the result
  setCache(topic, depth, result);

  return result;
}

module.exports = {
  research,
  groundedResearch,
  classicResearch,
  lensAnalysis,
  formatBrief,
};
