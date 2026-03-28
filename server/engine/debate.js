// ── Debate engine handlers ────────────────────────────────────
// Critique + Rebut + Finalize → Gemini 3.1 Pro
// Expand Suggestion → Claude Sonnet
// Now uses AI provider abstraction layer.

const {
  CRITIC_PROMPT_MAP,
  ARCHITECT_PROMPT_MAP,
  FINALIZE_PROMPT_MAP,
  DEBATE_CRITIC_PROMPT,
  DEBATE_ARCHITECT_PROMPT,
  DEBATE_FINALIZE_PROMPT,
  EXPAND_SUGGESTION_PROMPT,
  MODE_SERVER_META,
  buildCritiqueUserMessage,
  buildRebutUserMessage,
  buildFinalizeUserMessage,
} = require('./prompts');

const ai = require('../ai/providers');
const { sseHeaders, streamToSSE, geminiStreamToSSE, attachAbortSignal } = require('../utils/sse');
const { buildCompoundingContext } = require('./contextBuilder');
const { updateSessionBrief, generateSessionSummary } = require('./sessionBrief');
const { appendArtifact } = require('../gateway/sessions');

// ── POST /api/debate/critique ─────────────────────────────────

async function handleDebateCritique(_client, req, res, _gemini) {
  const { nodes, idea, round, priorCritiques, mode } = req.body;
  if (!nodes?.length) return res.status(400).json({ error: 'nodes required' });

  const criticPrompt = CRITIC_PROMPT_MAP[mode] || DEBATE_CRITIC_PROMPT;
  let userMessage = buildCritiqueUserMessage(mode, { idea, round, priorCritiques, nodes });

  // Inject compounding session context
  const sessionId = req.body.sessionId;
  const userId = req.user?.uid || 'local';
  if (sessionId) {
    try {
      const compoundCtx = await buildCompoundingContext(sessionId, userId, idea);
      if (compoundCtx) userMessage += compoundCtx;
    } catch { /* non-fatal */ }
  }

  try {
    const { text } = await ai.call({
      model: 'gemini:pro',
      system: criticPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 10000,
      extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } },
    });

    const parsed = ai.parseJSON(text);
    res.json(parsed);
  } catch (err) {
    console.error('Debate critique error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/debate/rebut (SSE) ──────────────────────────────

async function handleDebateRebut(_client, req, res, _gemini) {
  const { nodes, idea, round, critiques, mode } = req.body;
  if (!critiques?.length) return res.status(400).json({ error: 'critiques required' });

  sseHeaders(res);
  attachAbortSignal(req, res);

  const architectPrompt = ARCHITECT_PROMPT_MAP[mode] || DEBATE_ARCHITECT_PROMPT;
  const userMessage = buildRebutUserMessage(mode, { idea, round, critiques, nodes });

  try {
    const { stream } = await ai.stream({
      model: 'gemini:pro',
      system: architectPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 12000,
      extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } },
    });
    await geminiStreamToSSE(res, stream);
  } catch (err) {
    console.error('Debate rebut error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/debate/finalize (SSE) ───────────────────────────

async function handleDebateFinalize(_client, req, res, _gemini) {
  const { nodes, idea, debateHistory, mode } = req.body;
  if (!nodes?.length || !debateHistory?.length) {
    return res.status(400).json({ error: 'nodes and debateHistory required' });
  }

  sseHeaders(res);
  attachAbortSignal(req, res);

  const finalizePrompt = FINALIZE_PROMPT_MAP[mode] || DEBATE_FINALIZE_PROMPT;
  const responderLabel = (MODE_SERVER_META[mode] || MODE_SERVER_META.idea).responder;

  const historyText = debateHistory.map((r) => `
Round ${r.round}:
  Critiques: ${JSON.stringify(r.critiques || [])}
  Consensus blockers: ${JSON.stringify(r.blockers || [])}
  ${responderLabel} rebuttal nodes added: ${JSON.stringify((r.rebutNodes || []).map((n) => ({ id: n.id || n.data?.id, label: n.data?.label || n.label, reasoning: n.data?.reasoning || n.reasoning })))}
`).join('\n');

  const userMessage = buildFinalizeUserMessage(mode, { idea, debateHistory, nodes, historyText });

  try {
    // Inject compounding context for finalize
    const sessionId = req.body.sessionId;
    const userId = req.user?.uid || 'local';
    let finalUserMessage = userMessage;
    if (sessionId) {
      try {
        const compoundCtx = await buildCompoundingContext(sessionId, userId, idea);
        if (compoundCtx) finalUserMessage += compoundCtx;
      } catch { /* non-fatal */ }
    }

    const { stream } = await ai.stream({
      model: 'gemini:pro',
      system: finalizePrompt,
      messages: [{ role: 'user', content: finalUserMessage }],
      maxTokens: 12000,
      extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } },
    });
    await geminiStreamToSSE(res, stream);

    // Fire-and-forget: record artifact + update brief + generate summary (milestone)
    if (sessionId) {
      appendArtifact(sessionId, {
        type: 'debate_outcome',
        title: `Debate finalized (${debateHistory.length} rounds)`,
        summary: `Adversarial debate with ${debateHistory.length} rounds on "${idea?.slice(0, 60)}"`,
      }).catch(console.error);
      updateSessionBrief(sessionId, userId, 'debate_finalize', {
        rounds: debateHistory.length,
        idea,
      }).catch(console.error);
      generateSessionSummary(sessionId).catch(console.error);
    }
  } catch (err) {
    console.error('Debate finalize error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/expand-suggestion ───────────────────────────────

async function handleExpandSuggestion(_client, req, res) {
  const { suggestion, idea, nodes, mode, dynamicTypes } = req.body;
  if (!suggestion) return res.status(400).json({ error: 'suggestion is required' });

  sseHeaders(res);
  attachAbortSignal(req, res);

  const treeContext = (nodes || []).map(n =>
    `- [${n.type}] id="${n.id}" parentId="${n.parentId || 'null'}" label="${n.label}"`
  ).join('\n');

  const availableTypes = dynamicTypes?.length
    ? dynamicTypes.map(t => t.type).join(', ')
    : 'seed, problem, user_segment, job_to_be_done, feature, constraint, metric, insight';

  const userMessage = `Suggestion to expand: "${suggestion}"

Original idea: "${idea || ''}"
Mode: ${mode || 'idea'}

Available node types: ${availableTypes}

Existing tree:
${treeContext}

Place the suggestion under the most relevant existing node, then expand it with 5-8 child nodes.`;

  let prompt = EXPAND_SUGGESTION_PROMPT;
  if (dynamicTypes?.length) {
    const typeList = dynamicTypes.map(t => t.type).join(', ');
    prompt += `\n\nAvailable node types for this tree: ${typeList}`;
  }

  try {
    const { stream } = await ai.stream({
      model: 'claude:sonnet',
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 4096,
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Expand suggestion error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

module.exports = {
  handleDebateCritique,
  handleDebateRebut,
  handleDebateFinalize,
  handleExpandSuggestion,
};
