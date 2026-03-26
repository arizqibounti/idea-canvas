// ── Auto-Refine engine handlers ──────────────────────────────
// Now includes research agent + multi-agent lens enrichment.
// Uses the AI provider abstraction layer.

const {
  REFINE_CRITIQUE_PROMPT_MAP,
  REFINE_STRENGTHEN_PROMPT,
  REFINE_SCORE_PROMPT,
  LENS_ANALOGICAL_PROMPT,
  LENS_FIRST_PRINCIPLES_PROMPT,
  LENS_ADVERSARIAL_PROMPT,
} = require('./prompts');

const { sseHeaders, streamToSSE, attachAbortSignal } = require('../utils/sse');
const { planResearch, runResearchAgent, buildResearchBrief } = require('../utils/research');
const { getKnowledgeContext } = require('../gateway/knowledge');
const ai = require('../ai/providers');

// Fallback to idea mode critique if mode not found
function getCritiquePrompt(mode) {
  return REFINE_CRITIQUE_PROMPT_MAP[mode] || REFINE_CRITIQUE_PROMPT_MAP.idea;
}

// ── Research + multi-agent helper ──────────────────────────────
// Runs research pipeline + 3 lens analyses on weaknesses, returns enrichment context
async function buildRefineEnrichment(idea, weaknesses, existingContent) {
  const results = { researchBrief: '', lensInsights: '' };

  try {
    // Phase 1: Research planning + 3 parallel research agents
    // Research utils still use raw Gemini client
    const gemini = ai.getGemini();
    const existingStr = existingContent || '';
    const researchPlan = await planResearch(gemini, idea, existingStr);

    const agentTypes = ['market', 'technology', 'audience'];
    const agentResults = await Promise.all(
      agentTypes.map(agentType =>
        runResearchAgent(gemini, agentType, researchPlan, existingStr)
      )
    );
    results.researchBrief = buildResearchBrief(agentResults);
  } catch (err) {
    console.error('Refine research pipeline error:', err.message);
    // Non-fatal — continue without research
  }

  try {
    // Phase 2: Multi-agent lens analysis of weaknesses
    const weaknessSummary = weaknesses.map(w =>
      `- [${w.severity}/10] "${w.nodeLabel}": ${w.reason} (approach: ${w.approach})`
    ).join('\n');

    const lensInput = `Idea: "${idea}"\n\nWeaknesses identified in the thinking tree:\n${weaknessSummary}\n\nAnalyze these weaknesses and suggest concrete improvements.`;

    const lensPrompts = [
      { prompt: LENS_ANALOGICAL_PROMPT, name: 'analogical' },
      { prompt: LENS_FIRST_PRINCIPLES_PROMPT, name: 'first_principles' },
      { prompt: LENS_ADVERSARIAL_PROMPT, name: 'adversarial' },
    ];

    const lensResults = await Promise.all(lensPrompts.map(async (lens) => {
      try {
        const { text } = await ai.call({
          model: 'claude:sonnet',
          system: lens.prompt,
          messages: [{ role: 'user', content: lensInput }],
          maxTokens: 1500,
        });
        return `=== ${lens.name.toUpperCase()} PERSPECTIVE ===\n${text}`;
      } catch {
        return '';
      }
    }));

    results.lensInsights = lensResults.filter(Boolean).join('\n\n');
  } catch (err) {
    console.error('Refine multi-agent lens error:', err.message);
  }

  return results;
}

// ── POST /api/refine/critique ────────────────────────────────
// Lightweight non-streaming critique: identify 2-3 weakest nodes

async function handleRefineCritique(_client, req, res) {
  const { nodes, idea, mode, round, priorWeaknesses } = req.body;
  if (!nodes?.length || !idea) {
    return res.status(400).json({ error: 'nodes and idea are required' });
  }

  try {
    const systemPrompt = getCritiquePrompt(mode || 'idea');

    // Build node summary (compact — just id, type, label, reasoning)
    const nodeSummary = nodes.map(n => ({
      id: n.id || n.data?.nodeId,
      type: n.type || n.data?.type,
      label: n.label || n.data?.label,
      reasoning: n.reasoning || n.data?.reasoning,
      parentIds: n.parentIds || n.data?.parentIds || [],
    }));

    let userContent = `Idea: "${idea}"
Round: ${round || 1}

Tree (${nodeSummary.length} nodes):
${JSON.stringify(nodeSummary, null, 2)}`;

    if (priorWeaknesses?.length) {
      userContent += `\n\nPrior weaknesses identified (check if already addressed):
${JSON.stringify(priorWeaknesses, null, 2)}`;
    }

    // Inject Zettelkasten knowledge context (non-fatal)
    const userId = req.user?.uid || 'local';
    try {
      const knowledgeCtx = await getKnowledgeContext(userId, idea);
      if (knowledgeCtx) userContent += knowledgeCtx;
    } catch { /* non-fatal */ }

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1024,
      signal: req.signal,
    });

    // Extract JSON from response (handle potential markdown wrapping)
    let result;
    try {
      result = JSON.parse(text.trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        result = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse critique response');
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Refine critique error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/refine/strengthen ──────────────────────────────
// Streaming SSE: generate new/updated nodes to fix weaknesses
// Now enriched with research agents + multi-agent lenses

async function handleRefineStrengthen(_client, req, res) {
  const { nodes, idea, mode, weaknesses, gaps, contradictions, dynamicTypes, round } = req.body;
  if (!nodes?.length || (!weaknesses?.length && !gaps?.length && !contradictions?.length)) {
    return res.status(400).json({ error: 'nodes and at least one issue type required' });
  }

  sseHeaders(res);

  try {
    // ── Phase 1: Research + Multi-agent enrichment ───────────
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Researching context for strengthening...' })}\n\n`);
    const enrichment = await buildRefineEnrichment(idea, weaknesses);

    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Strengthening weak nodes with enriched context...' })}\n\n`);

    // Build compact node summary
    const nodeSummary = nodes.map(n => ({
      id: n.id || n.data?.nodeId,
      type: n.type || n.data?.type,
      label: n.label || n.data?.label,
      reasoning: n.reasoning || n.data?.reasoning,
      parentIds: n.parentIds || n.data?.parentIds || [],
    }));

    let userContent = `Idea: "${idea}"
Round: ${round || 1}

${weaknesses?.length ? `=== WEAKNESSES TO FIX (${weaknesses.length}) ===\n${JSON.stringify(weaknesses, null, 2)}` : ''}

${gaps?.length ? `=== STRUCTURAL GAPS TO FILL (${gaps.length}) ===\n${JSON.stringify(gaps, null, 2)}` : ''}

${contradictions?.length ? `=== CONTRADICTIONS TO RESOLVE (${contradictions.length}) ===\n${JSON.stringify(contradictions, null, 2)}` : ''}

Full tree context (${nodeSummary.length} nodes — do NOT re-output unchanged nodes):
${JSON.stringify(nodeSummary, null, 2)}`;

    // Append research brief
    if (enrichment.researchBrief) {
      userContent += `\n\n${enrichment.researchBrief}`;
    }

    // Append multi-agent lens insights
    if (enrichment.lensInsights) {
      userContent += `\n\nMULTI-PERSPECTIVE ANALYSIS (use these insights to strengthen nodes with diverse, grounded reasoning):\n${enrichment.lensInsights}`;
    }

    if (dynamicTypes?.length) {
      userContent += `\n\nAvailable node types: ${dynamicTypes.map(t => t.type).join(', ')}`;
    }

    // Zettelkasten context
    const userId = req.user?.uid || 'local';
    try {
      const knowledgeCtx = await getKnowledgeContext(userId, idea);
      if (knowledgeCtx) userContent += knowledgeCtx;
    } catch { /* non-fatal */ }

    const { stream } = await ai.stream({
      model: 'claude:sonnet',
      system: REFINE_STRENGTHEN_PROMPT.replace('{round}', round || 1),
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 4096,
    });

    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Refine strengthen error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/refine/score ───────────────────────────────────
// Quick non-streaming re-evaluation after strengthening

async function handleRefineScore(_client, req, res) {
  const { nodes, idea, mode } = req.body;
  if (!nodes?.length || !idea) {
    return res.status(400).json({ error: 'nodes and idea are required' });
  }

  try {
    const nodeSummary = nodes.map(n => ({
      id: n.id || n.data?.nodeId,
      type: n.type || n.data?.type,
      label: n.label || n.data?.label,
      reasoning: n.reasoning || n.data?.reasoning,
    }));

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: REFINE_SCORE_PROMPT,
      messages: [{
        role: 'user',
        content: `Idea: "${idea}"\nMode: ${mode || 'idea'}\n\nTree (${nodeSummary.length} nodes):\n${JSON.stringify(nodeSummary, null, 2)}`,
      }],
      maxTokens: 512,
      signal: req.signal,
    });

    let result;
    try {
      result = JSON.parse(text.trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        result = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse score response');
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Refine score error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  handleRefineCritique,
  handleRefineStrengthen,
  handleRefineScore,
};
