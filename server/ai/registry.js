// ── Tool Registry ────────────────────────────────────────────
// Declarative tool definitions that replace bespoke engine handlers.
// Each tool is a config object describing how to call the AI.
// The dispatcher handles model dispatch, streaming, SSE, abort, caching.

const ai = require('./providers');
const { sseHeaders, streamToSSE, streamToSSECollect, geminiStreamToSSE } = require('../utils/sse');

// ── Registry storage ────────────────────────────────────────
const _tools = new Map();

/**
 * Register a tool.
 *
 * @param {string} name - Tool name (e.g. 'learn.teach', 'refine.critique')
 * @param {object} config
 * @param {string}   config.model       - Model alias ('claude:sonnet', 'gemini:pro', etc.)
 * @param {boolean}  [config.stream]    - Whether to stream (default: false)
 * @param {string}   [config.promptKey] - Key into prompts module, or inline prompt
 * @param {number}   [config.maxTokens] - Max output tokens
 * @param {object}   [config.extra]     - Provider-specific options (thinkingConfig, etc.)
 * @param {Function} [config.buildMessages] - (req) => { system, messages } — custom message builder
 * @param {Function} [config.parseResponse] - (text) => result — custom response parser
 * @param {Function} [config.beforeCall]    - (req) => req — pre-processing hook
 * @param {Function} [config.afterCall]     - (result, req) => result — post-processing hook
 * @param {boolean}  [config.collect]   - For streaming: collect nodes and return (uses streamToSSECollect)
 */
function register(name, config) {
  _tools.set(name, config);
}

/**
 * Get a registered tool config.
 */
function get(name) {
  return _tools.get(name);
}

/**
 * List all registered tool names.
 */
function list() {
  return [..._tools.keys()];
}

// ── Dispatcher ──────────────────────────────────────────────

/**
 * Dispatch a tool call. Handles:
 * - Building messages (via config.buildMessages or default)
 * - Model dispatch via provider abstraction
 * - Streaming vs non-streaming
 * - SSE response handling
 * - Abort signal propagation
 * - Prompt caching
 * - Error handling
 *
 * @param {string} toolName - Registered tool name
 * @param {object} req      - Express request
 * @param {object} res      - Express response
 * @returns {Promise<object|void>} - For non-streaming: parsed result. For streaming: void (writes to res).
 */
async function dispatch(toolName, req, res) {
  const config = _tools.get(toolName);
  if (!config) {
    res.status(400).json({ error: `Unknown tool: ${toolName}` });
    return;
  }

  try {
    // Pre-processing hook
    if (config.beforeCall) {
      req = config.beforeCall(req) || req;
    }

    // Build system prompt + messages
    let { system, messages } = config.buildMessages
      ? config.buildMessages(req)
      : { system: config.prompt || '', messages: [{ role: 'user', content: JSON.stringify(req.body) }] };

    const model = config.model || 'claude:sonnet';
    const maxTokens = config.maxTokens || 2048;
    const extra = config.extra || {};
    const signal = req.signal || undefined;

    if (config.stream) {
      // ── Streaming path ──
      sseHeaders(res);

      const { stream: rawStream, provider } = await ai.stream({
        model, system, messages, maxTokens, signal, extra,
      });

      let result;
      if (config.collect) {
        // Stream + collect nodes
        if (provider === 'claude') {
          result = await streamToSSECollect(res, rawStream);
        } else {
          // Gemini collect — stream normally, collect via wrapper
          await geminiStreamToSSE(res, rawStream);
          result = [];
        }
      } else {
        // Stream only
        if (provider === 'claude') {
          await streamToSSE(res, rawStream);
        } else {
          await geminiStreamToSSE(res, rawStream);
        }
      }

      // Post-processing hook (for streaming, result may be collected nodes)
      if (config.afterCall && result) {
        result = config.afterCall(result, req);
      }
      return result;
    } else {
      // ── Non-streaming path ──
      const response = await ai.call({
        model, system, messages, maxTokens, signal, extra,
      });

      let result;
      if (config.parseResponse) {
        result = config.parseResponse(response.text);
      } else {
        // Default: try JSON parse, fall back to raw text
        try {
          result = ai.parseJSON(response.text);
        } catch {
          result = { text: response.text };
        }
      }

      // Post-processing hook
      if (config.afterCall) {
        result = config.afterCall(result, req);
      }

      // Include usage info
      result._usage = response.usage;

      res.json(result);
      return result;
    }
  } catch (err) {
    console.error(`Tool ${toolName} error:`, err);
    if (config.stream && res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}

/**
 * Create an Express handler from a tool name.
 * Usage: app.post('/api/learn/teach', registry.handler('learn.teach'));
 */
function handler(toolName) {
  return (req, res) => dispatch(toolName, req, res);
}

module.exports = {
  register,
  get,
  list,
  dispatch,
  handler,
};
