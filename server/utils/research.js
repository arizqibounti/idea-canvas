const { fetchPage } = require('./web');

const RESEARCH_PLAN_PROMPT = `You are a research planner. Given a business/product idea and optionally some reference content, identify the most valuable web research to perform across three dimensions:

1. MARKET: competitors, market size, trends, adjacent products
2. TECHNOLOGY: technical feasibility, stack choices, APIs, infrastructure
3. AUDIENCE: target users, user research, pain points, demographics

For each dimension, output:
- 2-4 specific URLs likely to contain relevant information (real company homepages, industry publications, relevant product pages — NOT search engine URLs)
- 3-5 specific research questions this agent should answer

Output ONLY a JSON object with this exact shape:
{"market":{"urls":["..."],"questions":["..."]},"technology":{"urls":["..."],"questions":["..."]},"audience":{"urls":["..."],"questions":["..."]}}`;

const RESEARCH_AGENT_PROMPTS = {
  market: `You are a market research analyst. Given web content about a business domain, answer the provided research questions and extract structured insights.

Output ONLY a JSON object:
{"dimension":"market","keyFindings":["finding 1","finding 2"],"entities":[{"name":"...","role":"competitor|partner|adjacent","detail":"..."}],"dataPoints":[{"metric":"...","value":"...","source":"..."}],"gaps":["areas where research was inconclusive"]}`,

  technology: `You are a technology analyst. Given web content about technology solutions and infrastructure, answer the provided research questions and extract structured insights.

Output ONLY a JSON object:
{"dimension":"technology","keyFindings":["finding 1","finding 2"],"technologies":[{"name":"...","category":"...","relevance":"..."}],"feasibilityNotes":["note about technical feasibility"],"gaps":["areas where research was inconclusive"]}`,

  audience: `You are a user research analyst. Given web content about users and markets, answer the provided research questions and extract structured insights.

Output ONLY a JSON object:
{"dimension":"audience","keyFindings":["finding 1","finding 2"],"segments":[{"name":"...","size":"...","painPoints":["..."],"behaviors":["..."]}],"insights":["user behavior insight"],"gaps":["areas where research was inconclusive"]}`,
};

async function planResearch(client, idea, existingContent) {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: RESEARCH_PLAN_PROMPT,
      messages: [{
        role: 'user',
        content: `Idea: "${idea}"${existingContent ? `\n\nExisting context:\n${existingContent}` : ''}\n\nPlan the research. Output ONLY the JSON object.`,
      }],
    });
    const text = message.content[0]?.text?.trim() || '{}';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const plan = JSON.parse(cleaned);
    // Validate structure
    for (const dim of ['market', 'technology', 'audience']) {
      if (!plan[dim]) plan[dim] = { urls: [], questions: [] };
      if (!Array.isArray(plan[dim].urls)) plan[dim].urls = [];
      if (!Array.isArray(plan[dim].questions)) plan[dim].questions = [];
    }
    return plan;
  } catch (err) {
    console.error('Research planning error:', err.message);
    // Fallback: empty plan — agents will synthesize from training knowledge
    return {
      market: { urls: [], questions: ['Who are the main competitors?', 'What is the market size?'] },
      technology: { urls: [], questions: ['What technologies are commonly used?', 'What are the key technical challenges?'] },
      audience: { urls: [], questions: ['Who is the target user?', 'What are their main pain points?'] },
    };
  }
}

async function runResearchAgent(client, agentType, plan, existingContent) {
  try {
    const agentPlan = plan[agentType] || { urls: [], questions: [] };

    // Fetch all URLs in parallel (with 5s timeout each)
    const fetchResults = await Promise.all(
      agentPlan.urls.map(url =>
        Promise.race([
          fetchPage(url, 8000),
          new Promise(resolve => setTimeout(() => resolve(null), 5000)),
        ]).catch(() => null)
      )
    );
    const fetchedContent = fetchResults.filter(Boolean);

    const contentBlock = fetchedContent.length
      ? fetchedContent.map(r => `--- ${r.url} ---\n${r.text}`).join('\n\n')
      : '(no web content could be fetched)';

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: RESEARCH_AGENT_PROMPTS[agentType],
      messages: [{
        role: 'user',
        content: `Research questions:\n${agentPlan.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nWeb content gathered:\n${contentBlock}${existingContent ? `\n\nAdditional context:\n${existingContent}` : ''}\n\nSynthesize your findings. Be specific — cite real names, numbers, and details from the content. Output ONLY the JSON object.`,
      }],
    });

    const text = message.content[0]?.text?.trim() || '{}';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error(`Research agent (${agentType}) error:`, err.message);
    return { dimension: agentType, keyFindings: ['Research could not be completed'], gaps: ['Agent failed: ' + err.message] };
  }
}

function buildResearchBrief(agentResults) {
  const [market, tech, audience] = agentResults;
  let brief = 'DEEP RESEARCH BRIEF — Use this to ground every node in real data:\n\n';

  brief += '=== MARKET RESEARCH ===\n';
  brief += `Key findings:\n${(market.keyFindings || []).map(f => `- ${f}`).join('\n') || '- No findings'}\n`;
  if (market.entities?.length) brief += `Entities:\n${market.entities.map(e => `- ${e.name} (${e.role}): ${e.detail}`).join('\n')}\n`;
  if (market.dataPoints?.length) brief += `Data points:\n${market.dataPoints.map(d => `- ${d.metric}: ${d.value} (${d.source})`).join('\n')}\n`;

  brief += '\n=== TECHNOLOGY RESEARCH ===\n';
  brief += `Key findings:\n${(tech.keyFindings || []).map(f => `- ${f}`).join('\n') || '- No findings'}\n`;
  if (tech.technologies?.length) brief += `Technologies:\n${tech.technologies.map(t => `- ${t.name} (${t.category}): ${t.relevance}`).join('\n')}\n`;
  if (tech.feasibilityNotes?.length) brief += `Feasibility:\n${tech.feasibilityNotes.map(n => `- ${n}`).join('\n')}\n`;

  brief += '\n=== AUDIENCE RESEARCH ===\n';
  brief += `Key findings:\n${(audience.keyFindings || []).map(f => `- ${f}`).join('\n') || '- No findings'}\n`;
  if (audience.segments?.length) brief += `Segments:\n${audience.segments.map(s => `- ${s.name}${s.size ? ` (${s.size})` : ''}: pain points = ${(s.painPoints || []).join(', ')}`).join('\n')}\n`;
  if (audience.insights?.length) brief += `Insights:\n${audience.insights.map(i => `- ${i}`).join('\n')}\n`;

  // Aggregate gaps
  const gaps = [...(market.gaps || []), ...(tech.gaps || []), ...(audience.gaps || [])].filter(Boolean);
  if (gaps.length) brief += `\n=== RESEARCH GAPS ===\n${gaps.map(g => `- ${g}`).join('\n')}\n`;

  brief += '\nINSTRUCTION: Every node you generate must reference specific findings from this research brief. Cite real competitor names, real technologies, real user segments, and real data points. If the research identified gaps, acknowledge them honestly rather than filling with assumptions.';

  return brief;
}

module.exports = {
  RESEARCH_PLAN_PROMPT,
  RESEARCH_AGENT_PROMPTS,
  planResearch,
  runResearchAgent,
  buildResearchBrief,
};
