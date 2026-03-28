// ── Full-Tree Prototype Builder engine ───────────────────────
// Multi-step pipeline: plan → generate screens → wire → polish
// Uses the AI provider abstraction layer.

const {
  PROTOTYPE_PLAN_PROMPT,
  PROTOTYPE_SCREEN_PROMPT,
  PROTOTYPE_WIRE_PROMPT,
  PROTOTYPE_POLISH_PROMPT,
} = require('./prompts');

const { sseHeaders, attachAbortSignal } = require('../utils/sse');
const ai = require('../ai/providers');
const { appendArtifact } = require('../gateway/sessions');
const { updateSessionBrief } = require('./sessionBrief');

// ── Helpers ──────────────────────────────────────────────────

/** Strip markdown ```html ... ``` fences from AI output */
function stripFences(text) {
  return text
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** Serialize nodes to a compact summary for AI consumption */
function serializeNodes(nodes) {
  return nodes.map(n => ({
    id: n.id || n.data?.nodeId,
    type: n.type || n.data?.type,
    label: n.label || n.data?.label,
    reasoning: n.reasoning || n.data?.reasoning,
    parentIds: n.parentIds || n.data?.parentIds || [],
  }));
}

// ── POST /api/prototype/build ────────────────────────────────
// SSE multi-step: plan → screens (parallel) → wire → polish

async function handlePrototypeBuild(_client, req, res) {
  const { nodes, idea, mode } = req.body;

  if (!nodes || nodes.length < 5) {
    return res.status(400).json({ error: 'At least 5 nodes are required to build a prototype' });
  }

  sseHeaders(res);
  attachAbortSignal(req, res);

  const nodeSummary = serializeNodes(nodes);

  try {
    // ── Step 1: PLAN ───────────────────────────────────────────
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Planning prototype screens and flows...' })}\n\n`);

    const planUserMessage = `Idea: "${idea || 'product concept'}"
Mode: ${mode || 'idea'}

Full thinking tree (${nodeSummary.length} nodes):
${JSON.stringify(nodeSummary, null, 2)}

Analyze this tree and generate the prototype plan.`;

    const { text: planText } = await ai.call({
      model: 'claude:sonnet',
      system: PROTOTYPE_PLAN_PROMPT,
      messages: [{ role: 'user', content: planUserMessage }],
      maxTokens: 2048,
      signal: req.signal,
    });

    let plan;
    try {
      plan = ai.parseJSON(planText);
    } catch {
      // Try extracting JSON object from response
      const match = planText.match(/\{[\s\S]*\}/);
      if (match) {
        plan = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse prototype plan from AI response');
      }
    }

    res.write(`data: ${JSON.stringify({ _plan: true, plan })}\n\n`);

    // ── Step 2: GENERATE SCREENS (parallel) ────────────────────
    res.write(`data: ${JSON.stringify({ _progress: true, stage: `Generating ${plan.screens.length} screens...` })}\n\n`);

    const screenPromises = plan.screens.map((screen, index) => {
      // Build navigation context for this screen
      const incomingFlows = plan.flows.filter(f => f.to === screen.id);
      const outgoingFlows = plan.flows.filter(f => f.from === screen.id);
      const mappedNodes = nodeSummary.filter(n => screen.nodeIds.includes(n.id));

      const screenUserMessage = `APP: "${plan.appName}"
VIEWPORT: ${plan.viewport}

DESIGN TOKENS:
${JSON.stringify(plan.designTokens, null, 2)}

COMPONENT INVENTORY: ${plan.componentInventory.join(', ')}

SCREEN TO GENERATE:
- ID: ${screen.id}
- Name: ${screen.name}
- Type: ${screen.screenType}
- Description: ${screen.description}

MAPPED NODES (features/concepts this screen must represent):
${mappedNodes.map(n => `- [${n.type}] ${n.label}: ${n.reasoning}`).join('\n') || '(none)'}

NAVIGATION CONTEXT:
- Incoming flows: ${incomingFlows.map(f => `from "${f.from}" via ${f.trigger}`).join('; ') || 'none (this is the entry screen)'}
- Outgoing flows: ${outgoingFlows.map(f => `to "${f.to}" via ${f.trigger} — ${f.description}`).join('; ') || 'none'}

Generate the complete HTML for this single screen. Remember: data-screen-id="${screen.id}" on the <body> tag.`;

      return ai.call({
        model: 'claude:sonnet',
        system: PROTOTYPE_SCREEN_PROMPT,
        messages: [{ role: 'user', content: screenUserMessage }],
        maxTokens: 8000,
        signal: req.signal,
      }).then(result => {
        const html = stripFences(result.text);
        // Emit screen as it completes
        res.write(`data: ${JSON.stringify({ _screen: true, screenIndex: index, screenId: screen.id, screenName: screen.name })}\n\n`);
        return { index, screenId: screen.id, html, status: 'fulfilled' };
      }).catch(err => {
        console.error(`Screen generation failed for ${screen.id}:`, err.message);
        res.write(`data: ${JSON.stringify({ _screen: true, screenIndex: index, screenId: screen.id, error: err.message })}\n\n`);
        return { index, screenId: screen.id, html: null, status: 'rejected', error: err.message };
      });
    });

    const screenResults = await Promise.allSettled(screenPromises);
    const screens = screenResults.map(r => r.status === 'fulfilled' ? r.value : r.reason);

    // Filter to only successfully generated screens
    const validScreens = screens.filter(s => s && s.html);
    if (validScreens.length === 0) {
      throw new Error('All screen generations failed');
    }

    // ── Step 3: WIRE ─────────────────────────────────────────
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Wiring screens into navigable prototype...' })}\n\n`);

    const wireUserMessage = `PLAN:
${JSON.stringify(plan, null, 2)}

GENERATED SCREENS (${validScreens.length} of ${plan.screens.length}):
${validScreens.map(s => `\n=== SCREEN: ${s.screenId} ===\n${s.html}`).join('\n')}

Wire all screens into a single navigable prototype HTML file.`;

    const { text: wireText } = await ai.call({
      model: 'claude:sonnet',
      system: PROTOTYPE_WIRE_PROMPT,
      messages: [{ role: 'user', content: wireUserMessage }],
      maxTokens: 16000,
      signal: req.signal,
    });

    const wiredHtml = stripFences(wireText);

    // ── Step 4: POLISH ───────────────────────────────────────
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Polishing prototype...' })}\n\n`);

    const polishUserMessage = `WIRED PROTOTYPE:
${wiredHtml}

PLAN (for reference):
${JSON.stringify({ appName: plan.appName, viewport: plan.viewport, designTokens: plan.designTokens, screens: plan.screens.map(s => ({ id: s.id, name: s.name })), flows: plan.flows }, null, 2)}

Polish this prototype. Ensure visual consistency, add micro-interactions, and implement the auto-demo mode.`;

    const { text: polishText } = await ai.call({
      model: 'claude:sonnet',
      system: PROTOTYPE_POLISH_PROMPT,
      messages: [{ role: 'user', content: polishUserMessage }],
      maxTokens: 16000,
      signal: req.signal,
    });

    const finalHtml = stripFences(polishText);

    // ── Emit final result ────────────────────────────────────
    res.write(`data: ${JSON.stringify({
      _result: true,
      html: finalHtml,
      plan,
      screenCount: validScreens.length,
      screens: validScreens.map(s => ({ screenId: s.screenId, html: s.html })),
    })}\n\n`);

    res.write('data: [DONE]\n\n');
    res.end();

    // Fire-and-forget: record prototype artifact
    const sessionId = req.body.sessionId;
    const userId = req.user?.uid || 'local';
    if (sessionId) {
      appendArtifact(sessionId, {
        type: 'prototype',
        title: `Prototype: ${plan.appName || 'App'} (${validScreens.length} screens)`,
        summary: `Built interactive prototype with ${validScreens.length} screens`,
      }).catch(console.error);
      updateSessionBrief(sessionId, userId, 'prototype_build', {
        appName: plan.appName,
        screenCount: validScreens.length,
        idea,
      }).catch(console.error);
    }
  } catch (err) {
    console.error('Prototype build error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/prototype/regen-screen ─────────────────────────
// Non-streaming: regenerate a single screen with user instruction

async function handlePrototypeRegenScreen(_client, req, res) {
  const { plan, screenIndex, screenHtml, nodes, instruction } = req.body;

  if (!plan || screenIndex == null) {
    return res.status(400).json({ error: 'plan and screenIndex are required' });
  }

  const screen = plan.screens[screenIndex];
  if (!screen) {
    return res.status(400).json({ error: `Invalid screenIndex: ${screenIndex}` });
  }

  try {
    const nodeSummary = serializeNodes(nodes || []);
    const mappedNodes = nodeSummary.filter(n => screen.nodeIds.includes(n.id));
    const incomingFlows = plan.flows.filter(f => f.to === screen.id);
    const outgoingFlows = plan.flows.filter(f => f.from === screen.id);

    const userMessage = `APP: "${plan.appName}"
VIEWPORT: ${plan.viewport}

DESIGN TOKENS:
${JSON.stringify(plan.designTokens, null, 2)}

COMPONENT INVENTORY: ${plan.componentInventory.join(', ')}

SCREEN TO REGENERATE:
- ID: ${screen.id}
- Name: ${screen.name}
- Type: ${screen.screenType}
- Description: ${screen.description}

MAPPED NODES:
${mappedNodes.map(n => `- [${n.type}] ${n.label}: ${n.reasoning}`).join('\n') || '(none)'}

NAVIGATION CONTEXT:
- Incoming flows: ${incomingFlows.map(f => `from "${f.from}" via ${f.trigger}`).join('; ') || 'none'}
- Outgoing flows: ${outgoingFlows.map(f => `to "${f.to}" via ${f.trigger} — ${f.description}`).join('; ') || 'none'}

${screenHtml ? `PREVIOUS VERSION (use as reference for what to improve):\n${screenHtml}\n` : ''}
USER INSTRUCTION: ${instruction || 'Regenerate this screen with improved design and content.'}

Generate the complete HTML for this screen. Remember: data-screen-id="${screen.id}" on the <body> tag.`;

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: PROTOTYPE_SCREEN_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 8000,
      signal: req.signal,
    });

    const html = stripFences(text);
    res.json({ html, screenIndex });
  } catch (err) {
    console.error('Prototype regen-screen error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  handlePrototypeBuild,
  handlePrototypeRegenScreen,
};
