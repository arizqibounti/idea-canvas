// ── Prompt Improvement Engine ────────────────────────────────
// AI-powered tools for critiquing, refining, experimenting with,
// and chatting about system prompts. Used from the Prompts admin tab.

const ai = require('../ai/providers');
const { sseHeaders, attachAbortSignal } = require('../utils/sse');

// ── System prompts (hardcoded — not from prompt store to avoid circularity) ──

const CRITIQUE_SYSTEM = `You are an expert prompt engineer reviewing a system prompt for an AI application.
Analyze the prompt for:
1. **Clarity** — Are instructions unambiguous? Could the AI misinterpret anything?
2. **Specificity** — Are constraints concrete enough? Are there vague phrases like "be helpful" without specifying how?
3. **Completeness** — Are edge cases handled? Are output formats specified?
4. **Consistency** — Do any instructions contradict each other?
5. **Safety** — Could the prompt lead to harmful or off-topic outputs?
6. **Efficiency** — Is there redundant text that could be cut without losing meaning?

Return JSON (no markdown fences):
{
  "weaknesses": [
    { "area": "clarity|specificity|completeness|consistency|safety|efficiency", "severity": "high|medium|low", "issue": "...", "suggestion": "..." }
  ],
  "strengths": ["..."],
  "overallScore": 1-10,
  "summary": "1-2 sentence overall assessment"
}`;

const REFINE_LENS_CLARITY = `You are a clarity-focused prompt editor. Given a system prompt and its weaknesses, rewrite ONLY the unclear or ambiguous sections to be precise and unambiguous. Return JSON: { "changes": [{ "area": "...", "before": "quote original", "after": "improved version", "reason": "..." }] }`;

const REFINE_LENS_STRUCTURE = `You are a structure-focused prompt editor. Given a system prompt and its weaknesses, improve the organization, formatting, and flow. Consider: header sections, bullet lists, numbered steps, consistent formatting. Return JSON: { "changes": [{ "area": "...", "before": "quote original", "after": "improved version", "reason": "..." }] }`;

const REFINE_LENS_COVERAGE = `You are a coverage-focused prompt editor. Given a system prompt and its weaknesses, add missing constraints, edge case handling, and output format specifications. Return JSON: { "changes": [{ "area": "...", "before": "quote original or 'N/A' if new addition", "after": "new or improved section", "reason": "..." }] }`;

const REFINE_SYNTHESIZE = `You are an expert prompt engineer. You have received three sets of targeted improvements to a system prompt (from clarity, structure, and coverage perspectives).

Synthesize all improvements into a single, final improved prompt. Apply all non-conflicting changes. When changes conflict, prefer the one that most improves the prompt's effectiveness.

Return JSON (no markdown fences):
{
  "improvedText": "the full improved prompt text",
  "changesSummary": [{ "area": "...", "description": "what changed and why" }]
}`;

const EXPERIMENT_MUTATE = `You are an expert prompt engineer. Rewrite the given system prompt using the specified strategy while preserving its core intent and functionality.

Return JSON (no markdown fences):
{
  "text": "the full rewritten prompt",
  "rationale": "1-2 sentences explaining what you changed and why this strategy improves the prompt"
}`;

const EXPERIMENT_SCORE = `You are an expert prompt evaluator. Score each prompt variant on these dimensions (1-10 each):
- **clarity**: How unambiguous are the instructions?
- **specificity**: How concrete and actionable are the constraints?
- **coverage**: How well are edge cases and output formats handled?
- **conciseness**: How efficiently does it communicate (less redundancy = higher)?
- **safety**: How well does it prevent harmful or off-topic outputs?

Return JSON (no markdown fences):
{
  "scores": [
    { "index": 0, "clarity": N, "specificity": N, "coverage": N, "conciseness": N, "safety": N, "composite": N, "note": "..." }
  ],
  "winner": 0,
  "analysis": "1-2 sentence comparison"
}
Where index 0 is the original, and subsequent indices are variants in order.`;

const CHAT_SYSTEM_PREFIX = `You are an expert prompt engineer helping the user iterate on a system prompt for an AI application. The prompt being edited is shown below.

When you suggest an improved version of the prompt, output the FULL improved prompt text between <<<IMPROVED>>> and <<<END>>> delimiters so the user can apply it with one click.

Be specific about what you changed and why. Ask clarifying questions if the user's request is ambiguous.

--- PROMPT BEING EDITED ---
`;

// ── Handlers ─────────────────────────────────────────────────

async function handlePromptCritique(req, res) {
  const { promptText, promptKey } = req.body;
  if (!promptText) return res.status(400).json({ error: 'promptText is required' });

  try {
    const result = await ai.call({
      model: 'claude:sonnet',
      system: CRITIQUE_SYSTEM,
      messages: [{ role: 'user', content: `Review this system prompt (key: ${promptKey || 'unknown'}):\n\n${promptText}` }],
      maxTokens: 4096,
    });
    const parsed = ai.parseJSON(result.text);
    res.json(parsed);
  } catch (err) {
    console.error('Prompt critique error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function handlePromptRefine(req, res) {
  const { promptText, promptKey, weaknesses } = req.body;
  if (!promptText) return res.status(400).json({ error: 'promptText is required' });

  sseHeaders(res);
  attachAbortSignal(req, res);

  try {
    // Phase 1: Critique if no weaknesses provided
    let critiqueResult = weaknesses;
    if (!critiqueResult) {
      res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Analyzing prompt weaknesses...' })}\n\n`);
      const critiqueResp = await ai.call({
        model: 'claude:sonnet',
        system: CRITIQUE_SYSTEM,
        messages: [{ role: 'user', content: `Review this system prompt:\n\n${promptText}` }],
        maxTokens: 4096,
      });
      critiqueResult = ai.parseJSON(critiqueResp.text).weaknesses || [];
    }

    const weaknessContext = JSON.stringify(critiqueResult, null, 2);

    // Phase 2: Multi-lens analysis (parallel)
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Running multi-lens analysis (clarity, structure, coverage)...' })}\n\n`);

    const lensPrompt = (lens) => `Weaknesses identified:\n${weaknessContext}\n\nSystem prompt to improve:\n${promptText}`;

    const [clarity, structure, coverage] = await Promise.all([
      ai.call({ model: 'claude:sonnet', system: REFINE_LENS_CLARITY, messages: [{ role: 'user', content: lensPrompt('clarity') }], maxTokens: 4096 }),
      ai.call({ model: 'claude:sonnet', system: REFINE_LENS_STRUCTURE, messages: [{ role: 'user', content: lensPrompt('structure') }], maxTokens: 4096 }),
      ai.call({ model: 'claude:sonnet', system: REFINE_LENS_COVERAGE, messages: [{ role: 'user', content: lensPrompt('coverage') }], maxTokens: 4096 }),
    ]);

    const lensResults = {
      clarity: ai.parseJSON(clarity.text),
      structure: ai.parseJSON(structure.text),
      coverage: ai.parseJSON(coverage.text),
    };

    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Synthesizing improvements...', lensResults })}\n\n`);

    // Phase 3: Synthesize
    const synthesizeResp = await ai.call({
      model: 'claude:sonnet',
      system: REFINE_SYNTHESIZE,
      messages: [{
        role: 'user',
        content: `Original prompt:\n${promptText}\n\nClarity improvements:\n${JSON.stringify(lensResults.clarity)}\n\nStructure improvements:\n${JSON.stringify(lensResults.structure)}\n\nCoverage improvements:\n${JSON.stringify(lensResults.coverage)}`,
      }],
      maxTokens: 8192,
    });

    const synthesized = ai.parseJSON(synthesizeResp.text);
    res.write(`data: ${JSON.stringify({ _result: true, ...synthesized })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Prompt refine error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

async function handlePromptExperiment(req, res) {
  const { promptText, promptKey, numVariants = 3 } = req.body;
  if (!promptText) return res.status(400).json({ error: 'promptText is required' });

  const strategies = [
    { id: 'more_structured', label: 'More Structured', instruction: 'Reorganize with clear sections, numbered steps, and explicit output format. Add headers and bullet points.' },
    { id: 'more_concise', label: 'More Concise', instruction: 'Cut all redundancy. Make every sentence load-bearing. Aim for 50-70% of original length while preserving all constraints.' },
    { id: 'more_explicit', label: 'More Explicit', instruction: 'Add explicit edge case handling, concrete examples, and very specific output format instructions. Be extremely prescriptive.' },
  ];

  sseHeaders(res);
  attachAbortSignal(req, res);

  try {
    const variants = [];

    // Generate variants sequentially
    for (let i = 0; i < Math.min(numVariants, strategies.length); i++) {
      const strategy = strategies[i];
      res.write(`data: ${JSON.stringify({ _progress: true, stage: `Generating variant: ${strategy.label}...` })}\n\n`);

      const result = await ai.call({
        model: 'claude:sonnet',
        system: EXPERIMENT_MUTATE,
        messages: [{
          role: 'user',
          content: `Strategy: ${strategy.instruction}\n\nOriginal prompt to rewrite:\n${promptText}`,
        }],
        maxTokens: 8192,
      });

      const parsed = ai.parseJSON(result.text);
      variants.push({ index: i + 1, strategy: strategy.id, label: strategy.label, ...parsed });
      res.write(`data: ${JSON.stringify({ _variant: true, index: i + 1, strategy: strategy.id, label: strategy.label, text: parsed.text, rationale: parsed.rationale })}\n\n`);
    }

    // Score all variants + original
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Scoring all variants...' })}\n\n`);

    const scoreInput = [
      `[0] ORIGINAL:\n${promptText}`,
      ...variants.map((v, i) => `[${i + 1}] ${v.label}:\n${v.text}`),
    ].join('\n\n---\n\n');

    const scoreResp = await ai.call({
      model: 'claude:sonnet',
      system: EXPERIMENT_SCORE,
      messages: [{ role: 'user', content: `Score these prompt variants:\n\n${scoreInput}` }],
      maxTokens: 4096,
    });

    const scores = ai.parseJSON(scoreResp.text);
    res.write(`data: ${JSON.stringify({ _scores: true, ...scores })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Prompt experiment error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

async function handlePromptChat(req, res) {
  const { promptText, promptKey, messages } = req.body;
  if (!promptText || !messages?.length) return res.status(400).json({ error: 'promptText and messages required' });

  sseHeaders(res);
  attachAbortSignal(req, res);

  try {
    const systemPrompt = CHAT_SYSTEM_PREFIX + promptText;
    const { stream: aiStream, provider } = await ai.stream({
      model: 'claude:sonnet',
      system: systemPrompt,
      messages,
      maxTokens: 8192,
    });

    // Stream raw text chunks as SSE
    let ended = false;
    res.on('close', () => { ended = true; try { aiStream.abort(); } catch {} });

    aiStream.on('text', (text) => {
      if (ended) return;
      res.write(`data: ${JSON.stringify({ _text: true, text })}\n\n`);
    });

    aiStream.on('finalMessage', () => {
      if (ended) return;
      ended = true;
      res.write('data: [DONE]\n\n');
      res.end();
    });

    aiStream.on('error', (err) => {
      if (ended) return;
      ended = true;
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });
  } catch (err) {
    console.error('Prompt chat error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

module.exports = { handlePromptCritique, handlePromptRefine, handlePromptExperiment, handlePromptChat };
