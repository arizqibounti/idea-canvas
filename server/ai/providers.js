// ── AI Provider Abstraction Layer ─────────────────────────────
// Unified interface for Claude and Gemini API calls.
// Handles: model dispatch, streaming, prompt caching, abort signals,
//          response normalization, and batch API.

const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI } = require('@google/genai');

// ── Singleton clients ────────────────────────────────────────
let _claude = null;
let _gemini = null;

function initProviders() {
  _claude = new Anthropic();
  _gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return { claude: _claude, gemini: _gemini };
}

function getClaude() { return _claude; }
function getGemini() { return _gemini; }

// ── Model aliases ────────────────────────────────────────────
const MODEL_ALIASES = {
  'claude:opus':   'claude-opus-4-5',
  'claude:sonnet': 'claude-sonnet-4-20250514',
  'gemini:pro':    'gemini-3.1-pro-preview',
  'gemini:flash':  'gemini-3.1-flash-lite-preview',
  'gemini:veo':    'veo-3.0-generate-001',
};

function resolveModel(alias) {
  return MODEL_ALIASES[alias] || alias;
}

function getProvider(alias) {
  if (alias.startsWith('claude:') || alias.startsWith('claude-')) return 'claude';
  if (alias.startsWith('gemini:') || alias.startsWith('gemini-') || alias.startsWith('veo-')) return 'gemini';
  throw new Error(`Unknown provider for model: ${alias}`);
}

// ── Prompt caching support ───────────────────────────────────
// Claude supports cache_control on system prompt blocks.
// We mark system prompts for caching to get 90% discount on
// repeated identical prompts.
function buildCacheableSystem(systemPrompt) {
  if (!systemPrompt) return undefined;
  // Single text block with cache_control: ephemeral
  // This tells Claude to cache this block across requests
  return [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

// ── Unified call interface ───────────────────────────────────

/**
 * Make a non-streaming AI call. Returns parsed text response.
 *
 * @param {object} opts
 * @param {string} opts.model      - Model alias (e.g. 'claude:sonnet') or full model string
 * @param {string} opts.system     - System prompt text
 * @param {Array}  opts.messages   - Message array [{role, content}]
 * @param {number} opts.maxTokens  - Max output tokens
 * @param {object} [opts.signal]   - AbortSignal for cancellation
 * @param {boolean} [opts.cache]   - Enable prompt caching (default: true for Claude)
 * @param {object} [opts.extra]    - Provider-specific options
 * @returns {Promise<{text: string, usage: object}>}
 */
async function call(opts) {
  const { model, system, messages, maxTokens, signal, cache = true, extra = {}, requestOptions } = opts;
  const provider = getProvider(model);
  const resolvedModel = resolveModel(model);

  if (provider === 'claude') {
    const params = {
      model: resolvedModel,
      max_tokens: maxTokens || 2048,
      messages,
      ...extra,
    };
    // Apply prompt caching for system prompt
    if (system) {
      params.system = cache ? buildCacheableSystem(system) : system;
    }
    if (signal) params.signal = signal;

    const response = await _claude.messages.create(params, requestOptions);
    const text = response.content.map(c => c.text || '').join('');
    return {
      text,
      usage: response.usage,
      stopReason: response.stop_reason,
    };
  }

  if (provider === 'gemini') {
    const config = {
      maxOutputTokens: maxTokens || 2048,
      ...extra,
    };
    if (system) config.systemInstruction = system;

    const userContent = messages.length === 1 && messages[0].role === 'user'
      ? messages[0].content
      : messages.map(m => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }));

    const response = await _gemini.models.generateContent({
      model: resolvedModel,
      contents: userContent,
      config,
    });

    return {
      text: response.text || '',
      usage: response.usageMetadata || {},
      stopReason: response.candidates?.[0]?.finishReason,
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Make a streaming AI call. Returns a stream adapter.
 *
 * @param {object} opts - Same as call(), plus:
 * @returns {Promise<{stream: object, provider: string}>} - Stream with unified events
 */
async function stream(opts) {
  const { model, system, messages, maxTokens, signal, cache = true, extra = {}, requestOptions } = opts;
  const provider = getProvider(model);
  const resolvedModel = resolveModel(model);

  if (provider === 'claude') {
    const params = {
      model: resolvedModel,
      max_tokens: maxTokens || 4096,
      messages,
      ...extra,
    };
    if (system) {
      params.system = cache ? buildCacheableSystem(system) : system;
    }

    const claudeStream = _claude.messages.stream(params, requestOptions);
    return { stream: claudeStream, provider: 'claude' };
  }

  if (provider === 'gemini') {
    const config = {
      maxOutputTokens: maxTokens || 4096,
      ...extra,
    };
    if (system) config.systemInstruction = system;

    const userContent = messages.length === 1 && messages[0].role === 'user'
      ? messages[0].content
      : messages.map(m => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }));

    const geminiStream = await _gemini.models.generateContentStream({
      model: resolvedModel,
      contents: userContent,
      config,
    });

    return { stream: geminiStream, provider: 'gemini' };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// ── Batch API (Claude only) ──────────────────────────────────
// For non-interactive operations like scoring — 50% cost reduction.

/**
 * Submit a batch of requests. Returns batch ID for polling.
 *
 * @param {Array<{customId: string, model: string, system: string, messages: Array, maxTokens: number}>} requests
 * @returns {Promise<{batchId: string}>}
 */
async function submitBatch(requests) {
  const batchRequests = requests.map(req => ({
    custom_id: req.customId,
    params: {
      model: resolveModel(req.model),
      max_tokens: req.maxTokens || 2048,
      system: req.system ? buildCacheableSystem(req.system) : undefined,
      messages: req.messages,
    },
  }));

  const batch = await _claude.messages.batches.create({
    requests: batchRequests,
  });

  return { batchId: batch.id, status: batch.processing_status };
}

/**
 * Poll batch status.
 * @param {string} batchId
 * @returns {Promise<{status: string, results: Array|null}>}
 */
async function pollBatch(batchId) {
  const batch = await _claude.messages.batches.retrieve(batchId);

  if (batch.processing_status === 'ended') {
    const results = [];
    for await (const result of _claude.messages.batches.results(batchId)) {
      results.push({
        customId: result.custom_id,
        text: result.result?.message?.content?.map(c => c.text || '').join('') || '',
        usage: result.result?.message?.usage,
      });
    }
    return { status: 'ended', results };
  }

  return {
    status: batch.processing_status,
    results: null,
    counts: batch.request_counts,
  };
}

// ── Gemini Grounding (Google Search) ─────────────────────────
// Use Gemini's built-in search grounding instead of custom Serper pipeline.

/**
 * Call Gemini with Google Search grounding enabled.
 *
 * @param {object} opts
 * @param {string} opts.query     - Research query
 * @param {string} opts.system    - System prompt
 * @param {number} opts.maxTokens - Max output tokens
 * @returns {Promise<{text: string, groundingMetadata: object}>}
 */
async function callWithGrounding(opts) {
  const { query, system, maxTokens = 2048 } = opts;

  const config = {
    maxOutputTokens: maxTokens,
    tools: [{ googleSearch: {} }],
  };
  if (system) config.systemInstruction = system;

  const response = await _gemini.models.generateContent({
    model: resolveModel('gemini:pro'),
    contents: query,
    config,
  });

  return {
    text: response.text || '',
    groundingMetadata: response.candidates?.[0]?.groundingMetadata || {},
  };
}

// ── JSON parse helper ────────────────────────────────────────
function parseJSON(text) {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

module.exports = {
  initProviders,
  getClaude,
  getGemini,
  resolveModel,
  getProvider,
  call,
  stream,
  submitBatch,
  pollBatch,
  callWithGrounding,
  parseJSON,
  MODEL_ALIASES,
};
