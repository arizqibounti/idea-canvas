// ── Debate engine handlers ────────────────────────────────────
// Critique + Rebut + Finalize → Gemini 3.1 Pro
// Expand Suggestion → Anthropic (unchanged)

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

const { sseHeaders, streamToSSE, geminiStreamToSSE } = require('../utils/sse');

const GEMINI_MODEL = 'gemini-3.1-pro-preview';

// ── POST /api/debate/critique ─────────────────────────────────
// Critic evaluates the tree and returns structured critique + verdict

async function handleDebateCritique(client, req, res, gemini) {
  const { nodes, idea, round, priorCritiques, mode } = req.body;
  if (!nodes?.length) return res.status(400).json({ error: 'nodes required' });

  const criticPrompt = CRITIC_PROMPT_MAP[mode] || DEBATE_CRITIC_PROMPT;
  const userMessage = buildCritiqueUserMessage(mode, { idea, round, priorCritiques, nodes });

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: userMessage,
      config: {
        systemInstruction: criticPrompt,
        maxOutputTokens: 10000,
        thinkingConfig: { thinkingLevel: 'MEDIUM' },
      },
    });

    let text = response.text || '{}';
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error('Debate critique error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/debate/rebut (SSE) ──────────────────────────────
// Architect addresses critiques by streaming new/updated nodes

async function handleDebateRebut(client, req, res, gemini) {
  const { nodes, idea, round, critiques, mode } = req.body;
  if (!critiques?.length) return res.status(400).json({ error: 'critiques required' });

  sseHeaders(res);

  const architectPrompt = ARCHITECT_PROMPT_MAP[mode] || DEBATE_ARCHITECT_PROMPT;
  const userMessage = buildRebutUserMessage(mode, { idea, round, critiques, nodes });

  try {
    const stream = await gemini.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: userMessage,
      config: {
        systemInstruction: architectPrompt,
        maxOutputTokens: 12000,
        thinkingConfig: { thinkingLevel: 'MEDIUM' },
      },
    });
    await geminiStreamToSSE(res, stream);
  } catch (err) {
    console.error('Debate rebut error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/debate/finalize (SSE) ───────────────────────────
// After consensus, architect synthesizes the debate into refined tree updates

async function handleDebateFinalize(client, req, res, gemini) {
  const { nodes, idea, debateHistory, mode } = req.body;
  if (!nodes?.length || !debateHistory?.length) {
    return res.status(400).json({ error: 'nodes and debateHistory required' });
  }

  sseHeaders(res);

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
    const stream = await gemini.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: userMessage,
      config: {
        systemInstruction: finalizePrompt,
        maxOutputTokens: 12000,
        thinkingConfig: { thinkingLevel: 'MEDIUM' },
      },
    });
    await geminiStreamToSSE(res, stream);
  } catch (err) {
    console.error('Debate finalize error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/expand-suggestion ───────────────────────────────
// (Still uses Anthropic — not part of debate rate-limit issue)

async function handleExpandSuggestion(client, req, res) {
  const { suggestion, idea, nodes, mode, dynamicTypes } = req.body;
  if (!suggestion) return res.status(400).json({ error: 'suggestion is required' });

  sseHeaders(res);

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
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
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
