// ── Forest Engine: Multi-Canvas Thinking ─────────────────────
// Decomposes complex ideas into interconnected canvases,
// generates each with shared context, detects cross-references,
// and runs cross-canvas critique.

const forests = require('../gateway/forests');
const sessions = require('../gateway/sessions');
const ai = require('../ai/providers');
const { sseHeaders, attachAbortSignal } = require('../utils/sse');
const { v4: uuidv4 } = require('uuid');
const {
  FOREST_DECOMPOSE_PROMPT,
  FOREST_CANVAS_CONTEXT_TEMPLATE,
  FOREST_CROSSREF_PROMPT,
  FOREST_CRITIQUE_PROMPT,
  SYSTEM_PROMPT,
} = require('./prompts');

// ── Summarize a canvas's nodes for cross-context injection ───
function summarizeCanvas(canvasDef, nodes) {
  if (!nodes?.length) return `[${canvasDef.title}]: No nodes generated yet.`;
  const topNodes = nodes
    .filter(n => !n._meta && !n._progress)
    .slice(0, 20)
    .map(n => `- [${n.type}] ${n.label}: ${n.reasoning || ''}`.slice(0, 150))
    .join('\n');
  return `[${canvasDef.title}] (${nodes.length} nodes):\n${topNodes}`;
}

// ── Topological sort canvases by dependencies ────────────────
function topoSort(canvasDefs) {
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(key) {
    if (visited.has(key)) return;
    if (visiting.has(key)) return; // cycle — just skip
    visiting.add(key);
    const def = canvasDefs.find(c => c.canvasKey === key);
    if (def?.dependencies) {
      for (const dep of def.dependencies) visit(dep);
    }
    visiting.delete(key);
    visited.add(key);
    sorted.push(key);
  }

  for (const c of canvasDefs) visit(c.canvasKey);
  return sorted;
}

// ── Handler 1: Decompose idea into canvas definitions ────────
async function handleForestDecompose(_client, req, res) {
  const { idea, mode } = req.body;
  if (!idea?.trim()) {
    return res.status(400).json({ error: 'idea is required' });
  }

  sseHeaders(res);
  const signal = attachAbortSignal(req, res);

  try {
    // Progress: planning
    res.write(`data: ${JSON.stringify({ _forestProgress: true, stage: 'decomposing', message: 'Analyzing complexity dimensions...' })}\n\n`);

    console.log('Forest decompose: calling Claude, provider check:', !!ai.getClaude());
    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: FOREST_DECOMPOSE_PROMPT,
      messages: [{ role: 'user', content: `Decompose this complex idea into 4-6 interconnected thinking canvases:\n\n"${idea}"` }],
      maxTokens: 4096,
    });

    // Parse JSON from response
    let plan;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (e) {
      res.write(`data: ${JSON.stringify({ error: 'Failed to parse decomposition plan' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Create forest record for listing
    const userId = req.user?.uid || 'local';
    const forest = await forests.createForest(idea, userId, null);

    // Create ONE parent session with all canvas definitions embedded
    const forestCanvases = plan.canvases.map(canvasDef => ({
      canvasKey: canvasDef.canvasKey,
      title: canvasDef.title,
      description: canvasDef.description,
      dependencies: canvasDef.dependencies || [],
      sharedContext: canvasDef.sharedContext || [],
      nodes: [],
      status: 'pending',
      nodeCount: 0,
    }));

    const parentSession = await sessions.createSession(
      idea,
      mode || 'idea',
      userId,
      null
    );
    await sessions.updateSession(parentSession.id, {
      forestId: forest.id,
      forestPlan: plan,
      forestCanvases,
    });

    // Canvas refs for the forest record (no separate sessionIds)
    const canvasRefs = plan.canvases.map(canvasDef => ({
      canvasKey: canvasDef.canvasKey,
      status: 'pending',
      nodeCount: 0,
    }));

    // Update forest with plan, canvas refs, and parent session ID
    await forests.updateForest(forest.id, {
      plan,
      canvases: canvasRefs,
      sessionId: parentSession.id,
      status: 'ready',
    });

    // Stream result
    res.write(`data: ${JSON.stringify({
      _forestResult: true,
      forestId: forest.id,
      sessionId: parentSession.id,
      plan,
      canvases: canvasRefs,
    })}\n\n`);

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (err.name !== 'AbortError') {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

// ── Handler 2: Generate all canvases in dependency order ─────
async function handleForestGenerateAll(_client, req, res) {
  const { forestId } = req.body;
  if (!forestId) return res.status(400).json({ error: 'forestId is required' });

  sseHeaders(res);
  const signal = attachAbortSignal(req, res);

  try {
    const forest = await forests.loadForest(forestId);
    if (!forest) {
      res.write(`data: ${JSON.stringify({ error: 'Forest not found' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const parentSessionId = forest.sessionId;
    const parentSession = await sessions.loadSession(parentSessionId);
    if (!parentSession || !parentSession.forestCanvases) {
      res.write(`data: ${JSON.stringify({ error: 'Parent session not found or missing forestCanvases' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    await forests.updateForest(forestId, { status: 'generating' });

    const plan = forest.plan;
    const sortedKeys = topoSort(plan.canvases);
    const completedCanvases = new Map(); // canvasKey → nodes[]

    // Generate in dependency waves
    for (const canvasKey of sortedKeys) {
      if (signal?.aborted) break;

      const canvasDef = plan.canvases.find(c => c.canvasKey === canvasKey);
      if (!canvasDef) continue;

      // Progress: starting canvas
      res.write(`data: ${JSON.stringify({
        _forestProgress: true,
        canvasKey,
        status: 'generating',
        title: canvasDef.title,
        message: `Generating ${canvasDef.title}...`,
      })}\n\n`);

      await forests.updateCanvasStatus(forestId, canvasKey, 'generating');

      // Build context from completed sibling canvases
      let siblingContext = '';
      if (canvasDef.dependencies?.length) {
        const summaries = canvasDef.dependencies
          .filter(dep => completedCanvases.has(dep))
          .map(dep => {
            const depDef = plan.canvases.find(c => c.canvasKey === dep);
            return summarizeCanvas(depDef, completedCanvases.get(dep));
          });
        if (summaries.length) {
          siblingContext = FOREST_CANVAS_CONTEXT_TEMPLATE
            .replace('{{SIBLING_SUMMARIES}}', summaries.join('\n\n'))
            .replace('{{CANVAS_TITLE}}', canvasDef.title);
        }
      }

      // Generate tree for this canvas
      const userContent = [
        `Generate a thinking tree for: "${forest.idea}"`,
        `\nFocus specifically on: ${canvasDef.title}`,
        `\nScope: ${canvasDef.description}`,
        canvasDef.sharedContext?.length
          ? `\nKey concepts to incorporate: ${canvasDef.sharedContext.join(', ')}`
          : '',
        siblingContext ? `\n\n--- CONTEXT FROM RELATED CANVASES ---\n${siblingContext}` : '',
      ].filter(Boolean).join('');

      try {
        const { stream } = await ai.stream({
          model: 'claude:sonnet',
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
          maxTokens: 8192,
        });

        // Collect nodes using event-based stream API (same pattern as streamToSSECollect)
        const collectedNodes = await new Promise((resolve, reject) => {
          let buffer = '';
          let ended = false;
          const collected = [];

          stream.on('text', (text) => {
            if (ended) return;
            buffer += text;
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const node = JSON.parse(trimmed);
                // Tag every node with the canvas key so the client knows which canvas it belongs to
                res.write(`data: ${JSON.stringify({ ...node, _canvasKey: canvasKey })}\n\n`);
                if (!node._meta && !node._progress) collected.push(node);
              } catch {}
            }
          });

          stream.on('finalMessage', () => {
            if (ended) return;
            ended = true;
            if (buffer.trim()) {
              try {
                const node = JSON.parse(buffer.trim());
                res.write(`data: ${JSON.stringify({ ...node, _canvasKey: canvasKey })}\n\n`);
                if (!node._meta && !node._progress) collected.push(node);
              } catch {}
            }
            resolve(collected);
          });

          stream.on('error', (err) => {
            if (ended) return;
            ended = true;
            reject(err);
          });
        });

        // Save nodes to parent session's forestCanvases
        if (collectedNodes.length > 0) {
          await sessions.updateForestCanvas(parentSessionId, canvasKey, {
            nodes: collectedNodes,
            status: 'ready',
            nodeCount: collectedNodes.length,
          });
        }

        completedCanvases.set(canvasKey, collectedNodes);
        await forests.updateCanvasStatus(forestId, canvasKey, 'ready', collectedNodes.length);

        res.write(`data: ${JSON.stringify({
          _forestProgress: true,
          canvasKey,
          status: 'ready',
          nodeCount: collectedNodes.length,
          title: canvasDef.title,
        })}\n\n`);

      } catch (err) {
        if (err.name === 'AbortError') break;
        await forests.updateCanvasStatus(forestId, canvasKey, 'error');
        await sessions.updateForestCanvas(parentSessionId, canvasKey, { status: 'error' });
        res.write(`data: ${JSON.stringify({
          _forestProgress: true,
          canvasKey,
          status: 'error',
          error: err.message,
        })}\n\n`);
      }
    }

    // Auto-detect cross-references
    if (!signal?.aborted && completedCanvases.size >= 2) {
      res.write(`data: ${JSON.stringify({
        _forestProgress: true,
        stage: 'crossref',
        message: 'Detecting cross-canvas connections...',
      })}\n\n`);

      try {
        const crossRefs = await detectCrossRefs(forest, completedCanvases, signal);
        await forests.setCrossRefs(forestId, crossRefs);
        res.write(`data: ${JSON.stringify({ _forestCrossRefs: true, crossRefs })}\n\n`);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Cross-ref detection error:', err.message);
        }
      }
    }

    await forests.updateForest(forestId, { status: 'ready' });
    res.write(`data: ${JSON.stringify({ _forestComplete: true, forestId })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    if (err.name !== 'AbortError') {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

// ── Handler 3: Generate single canvas with forest context ────
async function handleForestGenerate(_client, req, res) {
  const { forestId, canvasKey } = req.body;
  if (!forestId || !canvasKey) {
    return res.status(400).json({ error: 'forestId and canvasKey are required' });
  }

  const forest = await forests.loadForest(forestId);
  if (!forest) return res.status(404).json({ error: 'Forest not found' });

  // Load sibling canvases for context from parent session
  const parentSession = await sessions.loadSession(forest.sessionId);
  const siblingNodes = new Map();
  if (parentSession?.forestCanvases) {
    for (const fc of parentSession.forestCanvases) {
      if (fc.canvasKey !== canvasKey && fc.status === 'ready' && fc.nodes?.length) {
        siblingNodes.set(fc.canvasKey, fc.nodes);
      }
    }
  }

  // Build enriched request and delegate to standard generate
  const canvasDef = forest.plan.canvases.find(c => c.canvasKey === canvasKey);
  const enrichedIdea = [
    forest.idea,
    `\n\nFocus on: ${canvasDef.title} — ${canvasDef.description}`,
    siblingNodes.size > 0 ? '\n\n--- CONTEXT FROM RELATED CANVASES ---' : '',
    ...Array.from(siblingNodes.entries()).map(([key, nodes]) => {
      const def = forest.plan.canvases.find(c => c.canvasKey === key);
      return summarizeCanvas(def, nodes);
    }),
  ].filter(Boolean).join('\n');

  req.body.idea = enrichedIdea;
  req.body.mode = req.body.mode || 'idea';

  // Use existing generate handler
  const generate = require('./generate');
  await generate.handleGenerate(_client, req, res);
}

// ── Cross-reference detection ────────────────────────────────
async function detectCrossRefs(forest, canvasNodesMap, signal) {
  const summaries = [];
  for (const [canvasKey, nodes] of canvasNodesMap) {
    const def = forest.plan.canvases.find(c => c.canvasKey === canvasKey);
    summaries.push(summarizeCanvas(def, nodes));
  }

  const { text } = await ai.call({
    model: 'claude:sonnet',
    system: FOREST_CROSSREF_PROMPT,
    messages: [{
      role: 'user',
      content: `Analyze these canvases and identify cross-references:\n\n${summaries.join('\n\n---\n\n')}`,
    }],
    maxTokens: 4096,
    signal,
  });

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const refs = JSON.parse(jsonMatch ? jsonMatch[0] : '[]');
    return refs.map(r => ({ id: uuidv4(), ...r }));
  } catch {
    return [];
  }
}

// ── Handler 4: Cross-canvas critique ─────────────────────────
async function handleForestCritique(_client, req, res) {
  const { forestId } = req.body;
  if (!forestId) return res.status(400).json({ error: 'forestId is required' });

  sseHeaders(res);
  const signal = attachAbortSignal(req, res);

  try {
    const forest = await forests.loadForest(forestId);
    if (!forest) {
      res.write(`data: ${JSON.stringify({ error: 'Forest not found' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Load all canvas nodes from parent session
    const parentSession = await sessions.loadSession(forest.sessionId);
    if (!parentSession || !parentSession.forestCanvases) {
      res.write(`data: ${JSON.stringify({ error: 'Parent session not found or missing forestCanvases' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const summaries = [];
    for (const fc of parentSession.forestCanvases) {
      if (fc.status !== 'ready' || !fc.nodes?.length) continue;
      const def = forest.plan.canvases.find(d => d.canvasKey === fc.canvasKey);
      if (def) {
        summaries.push(summarizeCanvas(def, fc.nodes));
      }
    }

    if (summaries.length < 2) {
      res.write(`data: ${JSON.stringify({ error: 'Need at least 2 completed canvases for cross-canvas critique' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    res.write(`data: ${JSON.stringify({ _forestProgress: true, stage: 'critiquing', message: 'Cross-canvas analyst reviewing all canvases...' })}\n\n`);

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: FOREST_CRITIQUE_PROMPT,
      messages: [{
        role: 'user',
        content: [
          `Original idea: "${forest.idea}"`,
          `\nForest plan: ${forest.plan.canvases.map(c => `${c.canvasKey}: ${c.title}`).join(', ')}`,
          `\nExisting cross-references: ${JSON.stringify(forest.crossRefs?.slice(0, 10) || [])}`,
          `\n\n--- CANVAS SUMMARIES ---\n\n${summaries.join('\n\n---\n\n')}`,
        ].join(''),
      }],
      maxTokens: 4096,
      signal,
    });

    let critique;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      critique = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      critique = { verdict: 'UNABLE_TO_PARSE', critiques: [], suggestions: [] };
    }

    res.write(`data: ${JSON.stringify({ _forestCritique: true, ...critique })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (err.name !== 'AbortError') {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

module.exports = {
  handleForestDecompose,
  handleForestGenerateAll,
  handleForestGenerate,
  handleForestCritique,
};
