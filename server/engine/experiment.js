// ── AutoIdea experiment engine handlers ──────────────────────
// Autonomous idea experimentation loop: mutate → score → analyze
// Now uses the AI provider abstraction layer.

const {
  EXPERIMENT_MUTATE_PROMPT,
  EXPERIMENT_ANALYZE_PROMPT,
  PORTFOLIO_SCORE_PROMPT_MAP,
  PORTFOLIO_SCORE_PROMPT,
} = require('./prompts');

const { sseHeaders, streamToSSE } = require('../utils/sse');
const ai = require('../ai/providers');
const { recordOutcome, getBestStrategy } = require('./meta-evolution');

// Helper: compact node summary for prompt context
function nodeSummary(nodes) {
  return (nodes || []).map(n => ({
    id: n.id || n.data?.nodeId,
    type: n.type || n.data?.type,
    label: n.label || n.data?.label,
    reasoning: n.reasoning || n.data?.reasoning,
    parentIds: n.parentIds || n.data?.parentIds || [],
  }));
}

// ── POST /api/experiment/mutate ─────────────────────────────
// SSE streaming: generate a complete alternative tree using mutation strategy

async function handleExperimentMutate(_client, req, res) {
  const { nodes, idea, mode, mutationStrategy, weakDimensions, iteration, priorMutations, dynamicTypes } = req.body;
  if (!nodes?.length || !idea || !mutationStrategy) {
    return res.status(400).json({ error: 'nodes, idea, and mutationStrategy are required' });
  }

  sseHeaders(res);

  try {
    const compactNodes = nodeSummary(nodes);

    res.write(`data: ${JSON.stringify({ _progress: true, stage: `Generating ${mutationStrategy.replace('_', ' ')} variant...` })}\n\n`);

    const userContent = `Original idea: "${idea}"
Mode: ${mode || 'idea'}

Current baseline tree (${compactNodes.length} nodes):
${JSON.stringify(compactNodes.slice(0, 20), null, 2)}

Mutation strategy: ${mutationStrategy}
Iteration: ${iteration || 1}

${weakDimensions?.length ? `Weak dimensions to target (scored lowest):\n${weakDimensions.map(d => `- ${d.name}: ${d.score}/10`).join('\n')}\n` : ''}
${priorMutations?.length ? `Prior mutations (avoid repeating these approaches):\n${JSON.stringify(priorMutations.map(m => ({ strategy: m.strategy, title: m.title, kept: m.kept })))}` : ''}

Generate a COMPLETE alternative tree using the "${mutationStrategy}" strategy. Remember: this must be a genuinely different approach, not a refinement.`;

    const { stream } = await ai.stream({
      model: 'claude:sonnet',
      maxTokens: 4096,
      system: EXPERIMENT_MUTATE_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Experiment mutate error:', err.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

// ── POST /api/experiment/score ──────────────────────────────
// Non-streaming JSON: score baseline vs candidate side-by-side

async function handleExperimentScore(_client, req, res, _gemini) {
  const { baselineTree, candidateTree, idea, mode } = req.body;
  if (!baselineTree || !candidateTree || !idea) {
    return res.status(400).json({ error: 'baselineTree, candidateTree, and idea are required' });
  }

  try {
    const scoreConfig = PORTFOLIO_SCORE_PROMPT_MAP[mode] || PORTFOLIO_SCORE_PROMPT_MAP.idea;

    const systemPrompt = PORTFOLIO_SCORE_PROMPT
      .replace('{persona}', scoreConfig.persona)
      .replace('{count}', '2')
      .replace('{dimensions}', scoreConfig.dims.join(', '));

    const alternatives = [
      {
        index: 0,
        title: baselineTree.title || 'Current Best',
        thesis: baselineTree.thesis || idea,
        approach: 'baseline',
        nodeCount: baselineTree.nodes?.length || 0,
        nodes: (baselineTree.nodes || []).slice(0, 12).map(n => ({
          type: n.type, label: n.label, reasoning: n.reasoning?.slice(0, 100),
        })),
      },
      {
        index: 1,
        title: candidateTree.title || 'Candidate',
        thesis: candidateTree.thesis || '',
        approach: candidateTree.strategy || 'mutation',
        nodeCount: candidateTree.nodes?.length || 0,
        nodes: (candidateTree.nodes || []).slice(0, 12).map(n => ({
          type: n.type, label: n.label, reasoning: n.reasoning?.slice(0, 100),
        })),
      },
    ];

    const userContent = `Idea: "${idea}"\n\nAlternatives to score:\n${JSON.stringify(alternatives, null, 2)}`;

    // Try Gemini first, fall back to Claude
    let text;
    try {
      const geminiResult = await ai.call({
        model: 'gemini:pro',
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        maxTokens: 2048,
      });
      text = geminiResult.text.trim();
    } catch (geminiErr) {
      console.error('Experiment score Gemini error, falling back to Claude:', geminiErr.message);
      text = null;
    }

    if (!text) {
      const claudeResult = await ai.call({
        model: 'claude:sonnet',
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        maxTokens: 2048,
      });
      text = claudeResult.text;
    }

    // Parse JSON
    let result;
    try {
      result = ai.parseJSON(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          result = JSON.parse(match[0]);
        } catch {
          let repaired = match[0].replace(/,\s*([}\]])/g, '$1');
          try { result = JSON.parse(repaired); } catch {
            result = { scores: [], recommendation: 'Scoring failed.' };
          }
        }
      } else {
        result = { scores: [], recommendation: 'Scoring failed.' };
      }
    }

    // Transform portfolio score format into baseline/candidate comparison
    const scores = result.scores || [];
    const baselineScore = scores.find(s => s.alternativeIndex === 0) || { composite: 5, dimensions: {} };
    const candidateScore = scores.find(s => s.alternativeIndex === 1) || { composite: 5, dimensions: {} };

    const winner = (candidateScore.composite || 0) > (baselineScore.composite || 0) ? 'candidate' : 'baseline';
    const scoreDelta = (candidateScore.composite || 0) - (baselineScore.composite || 0);

    // Record outcome for meta-evolution learning
    const strategy = candidateTree.strategy || 'mutation';
    const userId = req.user?.uid || 'local';
    recordOutcome(userId, mode || 'idea', strategy, scoreDelta, req.body.sessionId).catch(() => {});

    res.json({
      baseline: { dimensions: baselineScore.dimensions || {}, total: baselineScore.composite || 5 },
      candidate: { dimensions: candidateScore.dimensions || {}, total: candidateScore.composite || 5 },
      winner,
      analysis: result.recommendation || '',
    });
  } catch (err) {
    console.error('Experiment score error:', err.message);
    res.status(500).json({ error: 'Failed to score experiment: ' + err.message });
  }
}

// ── POST /api/experiment/analyze ────────────────────────────
// Non-streaming JSON: recommend next mutation strategy

async function handleExperimentAnalyze(_client, req, res) {
  const { currentScores, idea, mode, history } = req.body;
  if (!idea) {
    return res.status(400).json({ error: 'idea is required' });
  }

  try {
    // Query meta-evolution for historically best strategy
    const userId = req.user?.uid || 'local';
    const strategies = ['pivot_market', 'change_monetization', 'simplify', 'differentiate', 'scale', 'wildcard'];
    const metaBest = await getBestStrategy(userId, mode || 'idea', strategies).catch(() => null);

    let metaHint = '';
    if (metaBest) {
      metaHint = `\n\nMeta-evolution data: "${metaBest.strategy}" has historically produced the best results for this mode (avg delta: ${metaBest.avgDelta > 0 ? '+' : ''}${metaBest.avgDelta} over ${metaBest.count} runs). Consider this when recommending.`;
    }

    const userContent = `Idea: "${idea}"
Mode: ${mode || 'idea'}

Current best scores per dimension:
${JSON.stringify(currentScores || {}, null, 2)}

Experiment history (${(history || []).length} prior iterations):
${JSON.stringify((history || []).map(h => ({
  iteration: h.iteration,
  strategy: h.strategy,
  candidateTotal: h.candidateTotal,
  kept: h.kept,
})), null, 2)}${metaHint}

Recommend the best mutation strategy for the next iteration.`;

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: EXPERIMENT_ANALYZE_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 512,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const analysis = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    res.json(analysis);
  } catch (err) {
    console.error('Experiment analyze error:', err.message);
    // Fallback: pick a random strategy
    const strategies = ['pivot_market', 'change_monetization', 'simplify', 'differentiate', 'scale', 'wildcard'];
    const tried = (req.body.history || []).map(h => h.strategy);
    const untried = strategies.filter(s => !tried.includes(s));
    res.json({
      nextStrategy: untried.length ? untried[0] : 'wildcard',
      rationale: 'Fallback selection due to analysis error.',
      focusAreas: [],
    });
  }
}

module.exports = {
  handleExperimentMutate,
  handleExperimentScore,
  handleExperimentAnalyze,
};
