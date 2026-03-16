// ── Learn mode engine handlers ──────────────────────────────
// Comprehension loop: probe → evaluate → adapt
// Follows the refine.js 3-phase pattern.

const {
  LEARN_PROBE_PROMPT,
  LEARN_EVALUATE_PROMPT,
  LEARN_ADAPT_PROMPT,
  LEARN_SOCRATIC_PROMPT,
} = require('./prompts');

const { sseHeaders, streamToSSE } = require('../utils/sse');

// Helper: compact node summary for prompt context
function nodeSummary(nodes) {
  return (nodes || []).map(n => ({
    id: n.id || n.data?.nodeId,
    type: n.type || n.data?.type,
    label: n.label || n.data?.label,
    reasoning: n.reasoning || n.data?.reasoning,
    parentIds: n.parentIds || n.data?.parentIds || [],
    difficulty: n.difficulty || n.data?.difficulty,
  }));
}

// ── POST /api/learn/probe ──────────────────────────────────
// Non-streaming JSON: generate a comprehension probe for a concept

async function handleLearnProbe(client, req, res) {
  const { nodes, topic, conceptId, mastery, priorProbes } = req.body;
  if (!nodes?.length || !topic || !conceptId) {
    return res.status(400).json({ error: 'nodes, topic, and conceptId are required' });
  }

  try {
    const compactNodes = nodeSummary(nodes);
    const targetNode = compactNodes.find(n => n.id === conceptId);
    if (!targetNode) {
      return res.status(400).json({ error: `Concept ${conceptId} not found in nodes` });
    }

    // Find parent concepts for context
    const parentNodes = compactNodes.filter(n => targetNode.parentIds?.includes(n.id));

    const userContent = `Topic: "${topic}"

Concept to probe:
${JSON.stringify(targetNode, null, 2)}

Parent/prerequisite concepts:
${JSON.stringify(parentNodes, null, 2)}

Student's current mastery for this concept: ${mastery || 0}/10

${priorProbes?.length ? `Prior probes for this concept (avoid repeating):\n${JSON.stringify(priorProbes)}\n` : ''}

Generate ONE probe question appropriate for the student's current mastery level.`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: LEARN_PROBE_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = msg.content[0]?.text || '{}';
    // Try to parse JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const probe = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    res.json(probe);
  } catch (err) {
    console.error('Learn probe error:', err.message);
    res.status(500).json({ error: 'Failed to generate probe: ' + err.message });
  }
}

// ── POST /api/learn/evaluate ───────────────────────────────
// Non-streaming JSON: evaluate student's answer

async function handleLearnEvaluate(client, req, res) {
  const { nodes, topic, conceptId, probe, answer, currentMastery } = req.body;
  if (!topic || !conceptId || !probe || !answer) {
    return res.status(400).json({ error: 'topic, conceptId, probe, and answer are required' });
  }

  try {
    const compactNodes = nodeSummary(nodes || []);
    const targetNode = compactNodes.find(n => n.id === conceptId);

    const userContent = `Topic: "${topic}"

Concept being assessed:
${JSON.stringify(targetNode || { id: conceptId }, null, 2)}

Probe question:
${JSON.stringify(probe, null, 2)}

Student's answer:
"${answer}"

Current mastery level: ${currentMastery || 0}/10

Evaluate the student's understanding honestly but encouragingly.`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: LEARN_EVALUATE_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = msg.content[0]?.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const evaluation = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    res.json(evaluation);
  } catch (err) {
    console.error('Learn evaluate error:', err.message);
    res.status(500).json({ error: 'Failed to evaluate answer: ' + err.message });
  }
}

// ── POST /api/learn/adapt ──────────────────────────────────
// SSE streaming: generate adaptive content for struggling student

async function handleLearnAdapt(client, req, res) {
  const { nodes, topic, conceptId, evaluation, mastery, dynamicTypes } = req.body;
  if (!topic || !conceptId) {
    return res.status(400).json({ error: 'topic and conceptId are required' });
  }

  sseHeaders(res);

  try {
    const compactNodes = nodeSummary(nodes || []);
    const targetNode = compactNodes.find(n => n.id === conceptId);

    const userContent = `Topic: "${topic}"

Concept the student is struggling with:
${JSON.stringify(targetNode || { id: conceptId }, null, 2)}

Evaluation of their last answer:
${JSON.stringify(evaluation || {}, null, 2)}

Current mastery: ${mastery || 0}/10

${evaluation?.misconceptions?.length ? `Identified misconceptions: ${evaluation.misconceptions.join(', ')}` : ''}

Existing tree context (first 15 nodes):
${JSON.stringify(compactNodes.slice(0, 15), null, 2)}

Generate 2-4 adaptive learning nodes to help the student understand this concept better.`;

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: LEARN_ADAPT_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Learn adapt error:', err.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

// ── POST /api/learn/socratic ───────────────────────────────
// Non-streaming JSON: milestone Socratic challenge

async function handleLearnSocratic(client, req, res) {
  const { nodes, topic, milestoneId, masteryMap, priorChallenges } = req.body;
  if (!topic || !milestoneId) {
    return res.status(400).json({ error: 'topic and milestoneId are required' });
  }

  try {
    const compactNodes = nodeSummary(nodes || []);
    const milestone = compactNodes.find(n => n.id === milestoneId);
    if (!milestone) {
      return res.status(400).json({ error: `Milestone ${milestoneId} not found` });
    }

    // Find concepts covered by this milestone (its parents)
    const coveredConcepts = compactNodes
      .filter(n => milestone.parentIds?.includes(n.id))
      .map(n => ({
        ...n,
        currentMastery: masteryMap?.[n.id]?.score || 0,
      }));

    const userContent = `Topic: "${topic}"

Milestone checkpoint:
${JSON.stringify(milestone, null, 2)}

Concepts this milestone covers:
${JSON.stringify(coveredConcepts, null, 2)}

${priorChallenges?.length ? `Prior Socratic challenges (avoid repeating):\n${JSON.stringify(priorChallenges)}\n` : ''}

Generate a deep, multi-concept Socratic challenge for this milestone.`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: LEARN_SOCRATIC_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = msg.content[0]?.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const challenge = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    res.json(challenge);
  } catch (err) {
    console.error('Learn socratic error:', err.message);
    res.status(500).json({ error: 'Failed to generate Socratic challenge: ' + err.message });
  }
}

module.exports = {
  handleLearnProbe,
  handleLearnEvaluate,
  handleLearnAdapt,
  handleLearnSocratic,
};
