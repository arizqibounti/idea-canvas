// ── Pattern Execution Handlers ────────────────────────────────
// Express handlers for pattern execute, resume, recommend, generate.

const { PatternExecutor, interpolate } = require('./patternExecutor');
const { validatePattern, applyDefaults } = require('./patternSchema');
const patternLoader = require('./patternLoader');
const ai = require('../ai/providers');
const { sseHeaders, attachAbortSignal } = require('../utils/sse');

// In-memory store for active executions (for resume/checkpoint)
const activeExecutors = new Map();

// Clean up old executors after 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, entry] of activeExecutors) {
    if (entry.createdAt < cutoff) activeExecutors.delete(id);
  }
}, 60 * 1000);

// ── POST /api/pattern/execute (SSE) ──────────────────────────

async function handlePatternExecute(_client, req, res) {
  const { patternId, idea, nodes, mode, config, domain, resolvedFramework } = req.body;
  if (!patternId) return res.status(400).json({ error: 'patternId is required' });

  const pattern = patternLoader.get(patternId);
  if (!pattern) return res.status(404).json({ error: `Pattern "${patternId}" not found` });

  sseHeaders(res);
  const { signal } = attachAbortSignal(req, res);

  const initialContext = {
    idea: idea || '',
    nodes: nodes || [],
    mode: mode || 'idea',
    domain: domain || '',
    resolvedFramework: resolvedFramework || null,
    userId: req.uid,
    ...(config || {}),
  };

  const executor = new PatternExecutor(pattern, initialContext, res, signal);

  // Store for potential resume
  activeExecutors.set(executor.executionId, { executor, createdAt: Date.now() });

  try {
    await executor.execute();
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Pattern execution error:', err);
      res.write(`data: ${JSON.stringify({ _patternError: true, error: err.message, fatal: true })}\n\n`);
    }
  } finally {
    activeExecutors.delete(executor.executionId);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ── POST /api/pattern/resume ─────────────────────────────────

async function handlePatternResume(_client, req, res) {
  const { executionId, decision } = req.body;
  if (!executionId) return res.status(400).json({ error: 'executionId required' });

  const entry = activeExecutors.get(executionId);
  if (!entry) return res.status(404).json({ error: 'Execution not found or expired' });

  // For now, resume is handled by the checkpoint auto-continue mechanism
  // Future: implement pause/resume via checkpointResolve promise
  res.json({ ok: true, decision });
}

// ── POST /api/pattern/execute-stage (JSON or SSE) ────────────
// Execute a single stage in isolation — for admin test runner.

async function handlePatternExecuteStage(_client, req, res) {
  const { patternId, stageName, context } = req.body;
  if (!patternId || !stageName) return res.status(400).json({ error: 'patternId and stageName required' });

  const pattern = patternLoader.get(patternId);
  if (!pattern) return res.status(404).json({ error: `Pattern "${patternId}" not found` });

  const stageDef = pattern.stages[stageName];
  if (!stageDef) return res.status(404).json({ error: `Stage "${stageName}" not found in pattern` });

  // For streaming stages, use SSE
  if (stageDef.stream) {
    sseHeaders(res);
    const { signal } = attachAbortSignal(req, res);

    const executor = new PatternExecutor(pattern, context || {}, res, signal);
    try {
      const result = await executor.executeStage(stageDef, stageName);
      res.write(`data: ${JSON.stringify({ _patternStageResult: true, stage: stageName, data: result })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ _patternError: true, stage: stageName, error: err.message })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    // Non-streaming: return JSON
    const executor = new PatternExecutor(pattern, context || {}, res, null);
    try {
      const result = await executor.executeStage(stageDef, stageName);
      res.json({ stage: stageName, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

// ── POST /api/pattern/recommend ──────────────────────────────
// Given user input, recommend the best thinking pattern.

async function handlePatternRecommend(_client, req, res) {
  const { idea, mode } = req.body;
  if (!idea) return res.status(400).json({ error: 'idea is required' });

  const hints = patternLoader.getAutoSelectHints();
  if (hints.length === 0) return res.json({ recommended: 'adversarial', alternatives: [], reasoning: 'Default pattern' });

  try {
    const { text } = await ai.call({
      model: 'gemini:flash',
      system: `You are a thinking pattern selector. Given a user's input, recommend the best thinking pattern from the available options.

Available patterns:
${hints.map(h => `- ${h.id}: "${h.name}" — ${h.description}. Keywords: ${h.keywords.join(', ')}`).join('\n')}

Output JSON: { "recommended": "pattern_id", "alternatives": ["id1", "id2"], "reasoning": "1-2 sentences" }`,
      messages: [{ role: 'user', content: `User input: "${idea}"\nMode: ${mode || 'auto'}` }],
      maxTokens: 512,
    });

    const result = ai.parseJSON(text);
    res.json(result);
  } catch (err) {
    res.json({ recommended: 'adversarial', alternatives: [], reasoning: 'Default fallback' });
  }
}

// ── POST /api/pattern/generate (SSE) ─────────────────────────
// Generate a pattern definition from natural language description.

async function handlePatternGenerate(_client, req, res) {
  const { description, existingPatterns } = req.body;
  if (!description) return res.status(400).json({ error: 'description is required' });

  const existingHints = (existingPatterns || []).map(id => {
    const p = patternLoader.get(id);
    return p ? `${p.id}: ${p.description}` : null;
  }).filter(Boolean);

  try {
    const { text } = await ai.call({
      model: 'claude:opus',
      system: `You are an expert thinking pattern designer. Generate a complete thinking pattern definition in JSON format.

A thinking pattern defines a processing graph for how an AI brain transforms input into refined output. Each pattern has:
- Metadata (id, name, description, icon, color)
- autoSelect hints (keywords, domainHints)
- framework (critic/responder personas, evaluation dimensions, chat persona, quick actions)
- stages (a graph of processing steps: generate, transform, score, branch, merge, filter, enrich, fan_out)
- graph (entrypoint + edges connecting stages)
- config (maxRounds, abortable)

Stage types:
- "generate": Stream new nodes via LLM (outputFormat: "node-stream", stream: true)
- "transform": Call LLM, parse JSON result (outputFormat: "json")
- "score": Like transform but returns scores with aggregation
- "branch": Evaluate condition, route to onTrue/onFalse (no LLM call)
- "merge": Combine results from multiple parallel stages
- "filter": Prune nodes based on scores or classification
- "enrich": Research or knowledge context injection
- "fan_out": Launch parallel branch stages

${existingHints.length > 0 ? `\nExisting patterns for reference:\n${existingHints.join('\n')}` : ''}

Output ONLY the JSON pattern definition. No markdown fences, no explanation.`,
      messages: [{ role: 'user', content: `Design a thinking pattern for: ${description}` }],
      maxTokens: 8000,
    });

    const generated = ai.parseJSON(text);
    const withDefaults = applyDefaults(generated);
    const validation = validatePattern(withDefaults);

    res.json({ pattern: withDefaults, validation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Framework resolution ─────────────────────────────────────
// Resolves pattern framework templates with runtime context.

function resolveFramework(patternDef, metaSkeleton, domain) {
  const fw = patternDef.framework || {};
  const ctx = {
    domain: domain || 'general',
    treeLabel: `${domain || 'thinking'} tree`,
    criticRole: metaSkeleton?.criticRole || 'critic',
    responderRole: metaSkeleton?.responderRole || 'architect',
    chatRole: metaSkeleton?.chatRole || 'advisor',
  };

  return {
    criticPersona: interpolate(fw.criticPersonaTemplate || '', ctx),
    responderPersona: interpolate(fw.responderPersonaTemplate || '', ctx),
    evaluationDimensions: fw.evaluationDimensions || [],
    chatPersona: interpolate(fw.chatPersonaTemplate || '', ctx),
    quickActions: (fw.quickActionTemplates || []).map(a => ({
      label: a.label,
      prompt: interpolate(a.prompt, ctx),
    })),
    debateLabels: {
      panelTitle: interpolate(fw.debateLabels?.panelTitle || 'PATTERN', ctx),
      panelIcon: fw.debateLabels?.panelIcon || '◈',
      startLabel: interpolate(fw.debateLabels?.startLabel || 'START', ctx),
      responderLabel: interpolate(fw.debateLabels?.responderLabel || 'RESPONDER', ctx),
    },
  };
}

module.exports = {
  handlePatternExecute,
  handlePatternResume,
  handlePatternExecuteStage,
  handlePatternRecommend,
  handlePatternGenerate,
  resolveFramework,
};
