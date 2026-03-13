// ── Portfolio generation engine handlers ─────────────────────
// Now includes research agent + multi-agent lens enrichment.

const {
  PORTFOLIO_GENERATE_PROMPT_MAP,
  PORTFOLIO_SCORE_PROMPT_MAP,
  PORTFOLIO_SCORE_PROMPT,
  LENS_ANALOGICAL_PROMPT,
  LENS_FIRST_PRINCIPLES_PROMPT,
  LENS_ADVERSARIAL_PROMPT,
} = require('./prompts');

const { sseHeaders, geminiStreamToSSE } = require('../utils/sse');
const { fetchPage, enrichEntities } = require('../utils/web');
const { planResearch, runResearchAgent, buildResearchBrief } = require('../utils/research');
const { getKnowledgeContext } = require('../gateway/knowledge');

const GEMINI_MODEL = 'gemini-3.1-pro-preview';

// ── POST /api/portfolio/generate ─────────────────────────────
// Streaming SSE: generate 3-5 alternative approaches with mini-trees
// Enriched with research pipeline + multi-agent lens perspectives

async function handlePortfolioGenerate(client, req, res, gemini) {
  const { idea, mode, count = 3, fetchedUrlContent, existingTitles, focus } = req.body;
  if (!idea) return res.status(400).json({ error: 'idea is required' });

  sseHeaders(res);

  try {
    // ── Phase 0: Entity enrichment ─────────────────────────
    let enrichedContent = fetchedUrlContent || [];
    try {
      const existingUrls = enrichedContent.map(u => u.url);
      const entities = await enrichEntities(gemini, idea, existingUrls);
      if (entities.length) {
        res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Researching entities...' })}\n\n`);
        const entityResults = await Promise.all(entities.map(async (e) => {
          const result = await fetchPage(e.url, 6000);
          return result ? { url: result.url, text: result.text, entityName: e.name } : null;
        }));
        const enriched = entityResults.filter(Boolean);
        if (enriched.length) enrichedContent = [...enrichedContent, ...enriched];
      }
    } catch (err) {
      console.error('Portfolio entity enrichment error:', err.message);
    }

    // ── Phase 1: Research pipeline ─────────────────────────
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Planning research for portfolio alternatives...' })}\n\n`);

    let researchBrief = '';
    try {
      const existingStr = enrichedContent
        .map(u => `${u.url}: ${u.text?.slice(0, 500)}`)
        .join('\n');
      const researchPlan = await planResearch(gemini, idea, existingStr);

      res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Researching market, technology & audience...' })}\n\n`);

      const agentTypes = ['market', 'technology', 'audience'];
      const agentResults = await Promise.all(
        agentTypes.map(agentType =>
          runResearchAgent(gemini, agentType, researchPlan, existingStr)
        )
      );
      researchBrief = buildResearchBrief(agentResults);
    } catch (err) {
      console.error('Portfolio research pipeline error:', err.message);
    }

    // ── Phase 2: Multi-agent lens analysis ─────────────────
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Analyzing from multiple perspectives...' })}\n\n`);

    let lensContext = '';
    try {
      const lensInput = `Analyze this idea for generating alternative approaches:\n\n"${idea}"${researchBrief ? `\n\n${researchBrief}` : ''}`;

      const lensPrompts = [
        { prompt: LENS_ANALOGICAL_PROMPT, name: 'analogical' },
        { prompt: LENS_FIRST_PRINCIPLES_PROMPT, name: 'first_principles' },
        { prompt: LENS_ADVERSARIAL_PROMPT, name: 'adversarial' },
      ];

      const lensResults = await Promise.all(lensPrompts.map(async (lens, i) => {
        try {
          const response = await gemini.models.generateContent({
            model: GEMINI_MODEL,
            contents: lensInput,
            config: {
              systemInstruction: lens.prompt,
              maxOutputTokens: 1500,
            },
          });
          const stageMsgs = ['Analogical analysis complete', 'First-principles analysis complete', 'Adversarial analysis complete'];
          res.write(`data: ${JSON.stringify({ _progress: true, stage: `${stageMsgs[i]} (${i + 1}/3)...` })}\n\n`);
          return `=== ${lens.name.toUpperCase()} PERSPECTIVE ===\n${response.text || ''}`;
        } catch {
          return '';
        }
      }));

      lensContext = lensResults.filter(Boolean).join('\n\n');
    } catch (err) {
      console.error('Portfolio multi-agent lens error:', err.message);
    }

    // ── Phase 3: Generate alternatives with enriched context ─
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Generating diverse alternatives...' })}\n\n`);

    let promptTemplate = PORTFOLIO_GENERATE_PROMPT_MAP[mode] || PORTFOLIO_GENERATE_PROMPT_MAP.idea;

    // Dynamic prompt: if focus is provided, adapt the prompt to the focus context
    if (focus && mode === 'codebase') {
      const focusTypes = focus.types?.join(', ') || 'all nodes';
      const focusDesc = {
        feature: 'product features and capabilities',
        component: 'system components and modules',
        api_endpoint: 'API endpoints and interfaces',
        data_model: 'data models and schemas',
        tech_debt: 'technical debt and improvement areas',
        constraint: 'constraints and limitations',
        insight: 'architectural insights and patterns',
      };
      const focusLabel = focus.types?.map(t => focusDesc[t] || t).join(' and ') || 'the full codebase';

      promptTemplate = `You are a product and technology strategist. Given a codebase analysis focused on ${focusLabel}, generate {count} genuinely DIFFERENT strategic approaches.

Think about these ${focusTypes} from multiple angles — not just technical implementation, but product positioning, user value, competitive differentiation, and build/buy/partner decisions.

Examples of genuinely different approaches: feature prioritization strategies, build vs integrate tradeoffs, user-centric vs platform-centric, incremental vs greenfield, open-source vs proprietary

For each alternative:
1. Output: {"_alternative": true, "index": N, "title": "approach name", "thesis": "1-2 sentence strategic thesis", "approach": "strategy type"}
2. Output _meta line
3. Output 8-12 analysis nodes covering both technical and product dimensions

First, output: {"_portfolio": true, "alternativeCount": {count}}
Node ids prefixed: alt{N}_
One JSON per line. No markdown.`;
    }

    const systemPrompt = promptTemplate.replace(/\{count\}/g, String(count));

    let userContent = `Input: "${idea}"`;

    // Include focus node summaries if available
    if (focus?.nodeSummaries?.length) {
      userContent += `\n\nFOCUS NODES (the user wants alternatives specifically about these):\n${focus.nodeSummaries.join('\n')}`;
    }

    if (enrichedContent?.length) {
      userContent += `\n\nReference content:\n${enrichedContent.map(u => `[${u.url}]: ${u.text?.slice(0, 500)}`).join('\n\n')}`;
    }

    // Append research brief
    if (researchBrief) {
      userContent += `\n\n${researchBrief}`;
    }

    // Append multi-agent lens insights
    if (lensContext) {
      userContent += `\n\nMULTI-PERSPECTIVE ANALYSIS (use each perspective to inform genuinely different alternative approaches):\n${lensContext}`;
    }

    if (existingTitles?.length) {
      userContent += `\n\nAlready generated alternatives (do NOT repeat these — generate DIFFERENT approaches):\n${existingTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    }

    // Zettelkasten knowledge context
    const userId = req.user?.uid || 'local';
    try {
      const knowledgeCtx = await getKnowledgeContext(userId, idea);
      if (knowledgeCtx) userContent += knowledgeCtx;
    } catch { /* non-fatal */ }

    const stream = await gemini.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: userContent,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: 'MEDIUM' },
      },
    });

    await geminiStreamToSSE(res, stream);
  } catch (err) {
    console.error('Portfolio generate error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/portfolio/score ────────────────────────────────
// Non-streaming JSON: score and rank alternatives

async function handlePortfolioScore(client, req, res, gemini) {
  const { alternatives, idea, mode, focus } = req.body;
  if (!alternatives?.length || !idea) {
    return res.status(400).json({ error: 'alternatives and idea are required' });
  }

  try {
    let scoreConfig = PORTFOLIO_SCORE_PROMPT_MAP[mode] || PORTFOLIO_SCORE_PROMPT_MAP.idea;

    // Dynamic scoring dimensions when focused on specific node types
    if (focus?.types?.length && mode === 'codebase') {
      const hasFeatures = focus.types.includes('feature');
      const hasTechDebt = focus.types.includes('tech_debt');
      if (hasFeatures) {
        scoreConfig = { dims: ['user_value', 'market_differentiation', 'execution_feasibility', 'scalability'], persona: 'product strategist' };
      } else if (hasTechDebt) {
        scoreConfig = { dims: ['risk_reduction', 'developer_velocity', 'migration_effort', 'long_term_value'], persona: 'engineering director' };
      }
    }

    const systemPrompt = PORTFOLIO_SCORE_PROMPT
      .replace('{persona}', scoreConfig.persona)
      .replace('{count}', String(alternatives.length))
      .replace('{dimensions}', scoreConfig.dims.join(', '));

    // Build compact alternative summaries for scoring
    const altSummaries = alternatives.map(alt => ({
      index: alt.index,
      title: alt.title,
      thesis: alt.thesis,
      approach: alt.approach,
      nodeCount: alt.nodes?.length || 0,
      nodes: (alt.nodes || []).slice(0, 12).map(n => ({
        type: n.type,
        label: n.label,
        reasoning: n.reasoning?.slice(0, 100),
      })),
    }));

    const userContent = `Idea: "${idea}"\n\nAlternatives to score:\n${JSON.stringify(altSummaries, null, 2)}`;

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: userContent,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 2048,
      },
    });

    const text = (response.text || '').trim();
    let result;
    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      result = JSON.parse(cleaned);
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
    console.error('Portfolio score error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  handlePortfolioGenerate,
  handlePortfolioScore,
};
