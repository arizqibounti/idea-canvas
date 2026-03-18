// ── Learn mode engine handlers ──────────────────────────────
// Comprehension loop: teach → probe → evaluate → adapt → socratic
// Now uses the AI provider abstraction layer.

const {
  LEARN_TEACH_PROMPT,
  LEARN_PROBE_PROMPT,
  LEARN_EVALUATE_PROMPT,
  LEARN_ADAPT_PROMPT,
  LEARN_SOCRATIC_PROMPT,
} = require('./prompts');

const ai = require('../ai/providers');
const { sseHeaders, streamToSSE, attachAbortSignal } = require('../utils/sse');

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

// JSON extractor helper
function extractJSON(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

// ── POST /api/learn/teach ──────────────────────────────────
// Non-streaming JSON: generate a rich teaching explanation for a concept

async function handleLearnTeach(_client, req, res) {
  const { nodes, topic, conceptId } = req.body;
  if (!nodes?.length || !topic || !conceptId) {
    return res.status(400).json({ error: 'nodes, topic, and conceptId are required' });
  }

  try {
    const compactNodes = nodeSummary(nodes);
    const targetNode = compactNodes.find(n => n.id === conceptId);
    if (!targetNode) {
      return res.status(400).json({ error: `Concept ${conceptId} not found in nodes` });
    }

    const parentNodes = compactNodes.filter(n => targetNode.parentIds?.includes(n.id));

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: LEARN_TEACH_PROMPT,
      messages: [{ role: 'user', content: `Topic: "${topic}"\n\nConcept to teach:\n${JSON.stringify(targetNode, null, 2)}\n\nPrerequisite concepts the student has already learned:\n${JSON.stringify(parentNodes, null, 2)}\n\nGenerate a rich, clear teaching explanation for this concept.` }],
      maxTokens: 2048,
      signal: req.signal,
    });

    res.json(extractJSON(text));
  } catch (err) {
    console.error('Learn teach error:', err.message);
    res.status(500).json({ error: 'Failed to generate teaching content: ' + err.message });
  }
}

// ── POST /api/learn/probe ──────────────────────────────────

async function handleLearnProbe(_client, req, res) {
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

    const parentNodes = compactNodes.filter(n => targetNode.parentIds?.includes(n.id));

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: LEARN_PROBE_PROMPT,
      messages: [{ role: 'user', content: `Topic: "${topic}"\n\nConcept to probe:\n${JSON.stringify(targetNode, null, 2)}\n\nParent/prerequisite concepts:\n${JSON.stringify(parentNodes, null, 2)}\n\nStudent's current mastery for this concept: ${mastery || 0}/10\n\n${priorProbes?.length ? `Prior probes for this concept (avoid repeating):\n${JSON.stringify(priorProbes)}\n` : ''}Generate ONE probe question appropriate for the student's current mastery level.` }],
      maxTokens: 1024,
      signal: req.signal,
    });

    res.json(extractJSON(text));
  } catch (err) {
    console.error('Learn probe error:', err.message);
    res.status(500).json({ error: 'Failed to generate probe: ' + err.message });
  }
}

// ── POST /api/learn/evaluate ───────────────────────────────

async function handleLearnEvaluate(_client, req, res) {
  const { nodes, topic, conceptId, probe, answer, currentMastery } = req.body;
  if (!topic || !conceptId || !probe || !answer) {
    return res.status(400).json({ error: 'topic, conceptId, probe, and answer are required' });
  }

  try {
    const compactNodes = nodeSummary(nodes || []);
    const targetNode = compactNodes.find(n => n.id === conceptId);

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: LEARN_EVALUATE_PROMPT,
      messages: [{ role: 'user', content: `Topic: "${topic}"\n\nConcept being assessed:\n${JSON.stringify(targetNode || { id: conceptId }, null, 2)}\n\nProbe question:\n${JSON.stringify(probe, null, 2)}\n\nStudent's answer:\n"${answer}"\n\nCurrent mastery level: ${currentMastery || 0}/10\n\nEvaluate the student's understanding honestly but encouragingly.` }],
      maxTokens: 1024,
      signal: req.signal,
    });

    res.json(extractJSON(text));
  } catch (err) {
    console.error('Learn evaluate error:', err.message);
    res.status(500).json({ error: 'Failed to evaluate answer: ' + err.message });
  }
}

// ── POST /api/learn/adapt ──────────────────────────────────

async function handleLearnAdapt(_client, req, res) {
  const { nodes, topic, conceptId, evaluation, mastery } = req.body;
  if (!topic || !conceptId) {
    return res.status(400).json({ error: 'topic and conceptId are required' });
  }

  sseHeaders(res);
  attachAbortSignal(req, res);

  try {
    const compactNodes = nodeSummary(nodes || []);
    const targetNode = compactNodes.find(n => n.id === conceptId);

    const { stream: rawStream } = await ai.stream({
      model: 'claude:sonnet',
      system: LEARN_ADAPT_PROMPT,
      messages: [{ role: 'user', content: `Topic: "${topic}"\n\nConcept the student is struggling with:\n${JSON.stringify(targetNode || { id: conceptId }, null, 2)}\n\nEvaluation of their last answer:\n${JSON.stringify(evaluation || {}, null, 2)}\n\nCurrent mastery: ${mastery || 0}/10\n\n${evaluation?.misconceptions?.length ? `Identified misconceptions: ${evaluation.misconceptions.join(', ')}` : ''}\n\nExisting tree context (first 15 nodes):\n${JSON.stringify(compactNodes.slice(0, 15), null, 2)}\n\nGenerate 2-4 adaptive learning nodes to help the student understand this concept better.` }],
      maxTokens: 2048,
    });

    await streamToSSE(res, rawStream);
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

async function handleLearnSocratic(_client, req, res) {
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

    const coveredConcepts = compactNodes
      .filter(n => milestone.parentIds?.includes(n.id))
      .map(n => ({
        ...n,
        currentMastery: masteryMap?.[n.id]?.score || 0,
      }));

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: LEARN_SOCRATIC_PROMPT,
      messages: [{ role: 'user', content: `Topic: "${topic}"\n\nMilestone checkpoint:\n${JSON.stringify(milestone, null, 2)}\n\nConcepts this milestone covers:\n${JSON.stringify(coveredConcepts, null, 2)}\n\n${priorChallenges?.length ? `Prior Socratic challenges (avoid repeating):\n${JSON.stringify(priorChallenges)}\n` : ''}Generate a deep, multi-concept Socratic challenge for this milestone.` }],
      maxTokens: 1024,
      signal: req.signal,
    });

    res.json(extractJSON(text));
  } catch (err) {
    console.error('Learn socratic error:', err.message);
    res.status(500).json({ error: 'Failed to generate Socratic challenge: ' + err.message });
  }
}

module.exports = {
  handleLearnTeach,
  handleLearnProbe,
  handleLearnEvaluate,
  handleLearnAdapt,
  handleLearnSocratic,
};
