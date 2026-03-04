// ── Analyze engine handlers ───────────────────────────────────

const {
  SCORE_NODES_PROMPT,
  EXTRACT_TEMPLATE_PROMPT,
  CODEBASE_ANALYSIS_PROMPT,
  REFLECT_PROMPT,
  CRITIQUE_PROMPT,
} = require('./prompts');

const { sseHeaders, streamToSSE } = require('../utils/sse');

// ── POST /api/score-nodes ─────────────────────────────────────

async function handleScoreNodes(client, req, res) {
  const { nodes, idea } = req.body;
  if (!nodes?.length) return res.status(400).json({ error: 'nodes required' });

  try {
    const nodesSummary = nodes.map(n => ({
      id: n.id,
      type: n.type || n.data?.type,
      label: n.label || n.data?.label,
      reasoning: n.reasoning || n.data?.reasoning,
      parentId: n.parentId || n.data?.parentId,
    }));

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SCORE_NODES_PROMPT,
      messages: [{
        role: 'user',
        content: `Idea: "${idea}"\n\nTree nodes to score:\n${JSON.stringify(nodesSummary, null, 2)}`,
      }],
    });

    let text = message.content[0]?.text || '{}';
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const scores = JSON.parse(text);
    res.json({ scores });
  } catch (err) {
    console.error('Score nodes error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/extract-template ───────────────────────────────

async function handleExtractTemplate(client, req, res) {
  const { nodes, idea } = req.body;
  if (!nodes?.length) return res.status(400).json({ error: 'nodes required' });

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: EXTRACT_TEMPLATE_PROMPT,
      messages: [{
        role: 'user',
        content: `Idea: "${idea}"\n\nFinalized tree:\n${JSON.stringify(nodes, null, 2)}`,
      }],
    });

    let text = message.content[0]?.text || '{}';
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const template = JSON.parse(text);
    res.json(template);
  } catch (err) {
    console.error('Extract template error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/analyze-codebase ────────────────────────────────

async function handleAnalyzeCodebase(client, req, res) {
  const { files, analysisGoals, folderName, filesOmitted } = req.body;
  if (!files || !files.length) return res.status(400).json({ error: 'files are required' });

  sseHeaders(res);

  const goalDescriptions = {
    features: 'Extract product features: what can users actually do? Look at routes, handlers, UI components.',
    architecture: 'Extract architecture patterns, constraints, and technical debt: coupling, bottlenecks, missing error handling, vendor lock-in.',
    users: 'Infer user segments: who uses this? Look for auth middleware, role checks, permission guards, data model field names.',
  };

  const activeGoalText = (analysisGoals || ['features', 'architecture', 'users'])
    .map(g => goalDescriptions[g] || g)
    .join('\n');

  const fileBlock = files
    .map(f => `// FILE: ${f.path}\n${f.content}`)
    .join('\n\n---\n\n');

  const userMessage = `Project: "${folderName || 'Unknown'}"
${filesOmitted ? `Note: ${filesOmitted} additional files were omitted due to size constraints — focus on what is provided.` : ''}

Analysis goals:
${activeGoalText}

Codebase files (${files.length} files):
---
${fileBlock}
---

Analyze this codebase and generate the product thinking tree. Reveal what this product actually is, not just what the files contain.`;

  try {
    const stream = await client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 8192,
      system: CODEBASE_ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Analyze codebase error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/reflect (Memory Layer) ─────────────────────────

async function handleReflect(client, req, res) {
  const { sessions } = req.body;
  if (!sessions || sessions.length < 2) {
    return res.json({ patterns: [] });
  }

  const sessionSummaries = sessions.map((s, i) => ({
    index: i + 1,
    idea: s.label || s.idea || 'unknown',
    nodeCount: s.nodeCount,
    nodeTypes: s.nodeTypeCounts || {},
    topLabels: s.topLabels || [],
  }));

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: REFLECT_PROMPT,
      messages: [{ role: 'user', content: `Past sessions:\n${JSON.stringify(sessionSummaries, null, 2)}` }],
    });

    let text = message.content[0]?.text || '{}';
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error('Reflect error:', err);
    res.json({ patterns: [] });
  }
}

// ── POST /api/critique (Devil's Advocate) ─────────────────────

async function handleCritique(client, req, res) {
  const { nodes, idea } = req.body;
  if (!nodes || !nodes.length) return res.status(400).json({ error: 'nodes are required' });

  sseHeaders(res);

  const userMessage = `Idea: "${idea}"

Product thinking tree to critique:
${JSON.stringify(nodes, null, 2)}

Generate sharp, specific critique nodes challenging the assumptions in this tree.`;

  try {
    const stream = await client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: CRITIQUE_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Critique error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

module.exports = {
  handleScoreNodes,
  handleExtractTemplate,
  handleAnalyzeCodebase,
  handleReflect,
  handleCritique,
};
