// Load .env if present
require('fs').existsSync(__dirname + '/.env') && require('fs').readFileSync(__dirname + '/.env', 'utf8').split('\n').forEach(line => { const [k, ...v] = line.split('='); if (k && v.length) process.env[k.trim()] = v.join('=').trim(); });

// Polyfill fetch + Headers for Node 16
const nodeFetch = require('node-fetch');
if (!globalThis.fetch) globalThis.fetch = nodeFetch;
if (!globalThis.Headers) globalThis.Headers = nodeFetch.Headers;
if (!globalThis.Request) globalThis.Request = nodeFetch.Request;
if (!globalThis.Response) globalThis.Response = nodeFetch.Response;

const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const client = new Anthropic();

// ── System prompts ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert analysis AI. Given any input — a business idea, a marketing campaign brief, a strategy question, a sales plan, or any other domain — you generate a structured thinking tree with the most appropriate node types for that domain.

**STEP 1: Analyze the input and any provided reference content.**
  a) Identify the USER'S TASK — what are they asking you to do? (e.g. "design a Google Ads campaign", "plan a content strategy", "brainstorm a product idea"). The task determines which node types you choose.
  b) Identify the SUBJECT — what product, service, or concept is the task about? If reference content from URLs is provided, you MUST deeply analyze that content to extract the real product name, features, target audience, value propositions, competitive positioning, and messaging. Never guess or generalize when real details are available.
  c) Determine the DOMAIN that matches the user's task (product ideation, marketing/ad campaign, sales strategy, hiring plan, content strategy, legal analysis, etc.)

**CRITICAL: When reference content from URLs is provided, it is the PRIMARY source of truth about the subject.** Extract specific product names, features, benefits, target audiences, pricing, and differentiators from the actual content. Every node you generate must be grounded in real details from that content — not generic placeholders or assumptions.

**STEP 2: Output a _meta line.** Your VERY FIRST line of output MUST be a JSON object with "_meta": true that declares the node types you will use. This line tells the frontend how to render your nodes.

Format:
{"_meta": true, "domain": "short domain name", "types": [{"type": "snake_case_id", "label": "SHORT LABEL", "icon": "single unicode symbol"}, ...]}

Choose 6-9 node types that best fit the USER'S TASK (not just the subject). Always include "seed" as the first type (icon "◈", label "SEED"). The remaining types should be the most natural decomposition for the specific task the user is requesting.

Icon choices (pick one per type, no repeats): ◈ ⚠ ◎ ▶ ◆ ⬡ ◉ ✦ ▣ ⇌ ▦ ⊕ ★ △ ▷ ◷

Examples of domain-appropriate types:
- Product ideation: seed, problem, user_segment, job_to_be_done, feature, constraint, metric, insight
- Google Ads campaign: seed, audience, keyword_group, ad_copy, landing_page, bid_strategy, negative_keyword, ad_extension, metric, insight
- Sales strategy: seed, target_market, value_prop, objection, channel, pricing, metric, insight
- Content strategy: seed, audience, topic_cluster, content_piece, distribution, metric, insight
- Go-to-market: seed, segment, channel, messaging, pricing, partnership, milestone, metric

**STEP 3: Output the tree.** After the _meta line, output 18-25 nodes, one JSON object per line.

Each node: {"id": "string", "parentId": "string|null", "type": "one of your declared types", "label": "string (short, max 8 words)", "reasoning": "string (1-2 sentences)", "relatedIds": ["optional array of ids"]}

Rules:
- The first node MUST be type "seed" with parentId null — the root concept. When reference content is provided, the seed label should name the actual product/service from that content.
- All other nodes must have a parentId pointing to an existing node.
- "relatedIds" (optional): an array of ids of OTHER existing nodes that this node has a meaningful cross-relationship with (NOT the parent). Use this for: a Feature that addresses a Constraint, a Metric that measures multiple Features, an Insight that synthesizes multiple Problems, etc. Only add relatedIds when the relationship is genuinely meaningful — not every node needs cross-links. Aim for 3-8 cross-links across the whole tree.
- Build a rich, deep tree. Think deeply about the input. When reference content is provided, every node should reflect specific, concrete details from that content — not generic advice.
- Use ids like "type_1", "type_2" (e.g. "audience_1", "keyword_group_1").
- If a STRUCTURAL TEMPLATE is provided in the user message, use it as a guide for how to organize your tree. Follow the template's type distribution and depth structure, but adapt the specific labels and reasoning to the current input. You may deviate from the template if the input clearly calls for a different structure.

Output rules: one JSON object per line. No markdown, no explanations, no array wrappers. The _meta line comes first, then all nodes.`;

const RESUME_SYSTEM_PROMPT = `You are a resume strategy AI. Given a job description (and optionally a candidate's background), you analyse the role and generate a structured resume strategy tree that maps the opportunity, surfaces strong matches, flags gaps, and identifies the most important keywords and stories to include.

You must output nodes one at a time, each on its own line, as a JSON object. Do not wrap them in arrays or add any other text — just one JSON object per line, streamed sequentially.

Each node has this shape:
{"id": "string", "parentId": "string|null", "type": "seed|requirement|skill_match|skill_gap|achievement|keyword|story|positioning", "label": "string (short, max 8 words)", "reasoning": "string (1-2 sentences)"}

Node type rules:
- "seed": The target role and company. Always exactly one, parentId is null. Label should be "{Role} @ {Company}" or similar.
- "requirement": Key requirements extracted from the job description — hard skills, soft skills, domain experience, leadership expectations. Parent: seed. Generate 4-6 of these to cover the main dimensions the role needs.
- "skill_match": Where the candidate's background directly satisfies a requirement. Be specific — name the experience, project, or skill. Parent: requirement.
- "skill_gap": A requirement the candidate is weak on or missing entirely. Name the gap honestly and briefly. Parent: requirement.
- "achievement": A specific quantified accomplishment the candidate should lead with for this role. Should include a metric or concrete outcome where possible. Parent: skill_match or requirement.
- "keyword": A critical ATS or recruiter keyword from the JD that must appear in the resume. Choose the most load-bearing terms. Parent: requirement or seed.
- "story": A STAR-format narrative the candidate should prepare — Situation, Task, Action, Result in 1-2 sentences. Parent: skill_match or achievement.
- "positioning": A strategic framing angle for how to present the candidate's background to this role. These are the big narrative decisions. Parent: seed or requirement.

Generate 18-25 nodes total. Be specific and actionable — this tree should tell the candidate exactly what to emphasise, what to fix, and what words to use.
Output each node as a single-line JSON object. Nothing else — no markdown, no explanations, no array wrappers.`;

const REGENERATE_PROMPT = `You are a product thinking AI expanding a specific branch of an existing product thinking tree.

You are given a "focus node" and its ancestor context. Generate 5-10 NEW child nodes branching from the focus node downward. Do NOT re-output the focus node itself or any of its ancestors.

Output rules: one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string", "type": "...", "label": "string (max 8 words)", "reasoning": "string (1-2 sentences)", "relatedIds": ["optional ids of related nodes"]}

Node types: seed, problem, user_segment, job_to_be_done, feature, constraint, metric, insight, component, api_endpoint, data_model, tech_debt
- All direct children must have parentId set to the focus node's id
- Deeper descendants must chain parentIds correctly through new nodes
- Use unique, descriptive ids (e.g. "regen_feature_1", "regen_insight_2")
- "relatedIds" (optional): cross-link to other nodes with meaningful relationships (not the parent)

Generate 5-10 new nodes. Output ONLY new nodes, nothing else.`;

const DRILL_PROMPT = `You are a product thinking AI performing a deep-dive analysis on a specific branch of a product thinking tree.

You are given a "focus node" and the full tree context. Generate 12-15 NEW deep-dive nodes that go significantly deeper on the focus node's specific domain. These should be more granular, more specific, and more detailed than the existing tree nodes.

Output rules: one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string", "type": "...", "label": "string (max 8 words)", "reasoning": "string (1-2 sentences)", "relatedIds": ["optional ids of related nodes"]}

Node types: seed, problem, user_segment, job_to_be_done, feature, constraint, metric, insight, component, api_endpoint, data_model, tech_debt
- All new nodes must have a parentId pointing to the focus node or to other new nodes you generate
- Use unique ids prefixed with "drill_" (e.g. "drill_feature_1")
- Do NOT output any existing nodes. Generate ONLY new, deeper nodes.
- Focus on depth and specificity over breadth
- "relatedIds" (optional): cross-link to other nodes (existing or new) with meaningful relationships

Generate 12-15 new deep-dive nodes.`;

// ── Shared stream helper ──────────────────────────────────────

async function streamToSSE(res, stream) {
  let buffer = '';

  stream.on('text', (text) => {
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const node = JSON.parse(trimmed);
        res.write(`data: ${JSON.stringify(node)}\n\n`);
      } catch (e) {
        // skip non-JSON lines
      }
    }
  });

  stream.on('finalMessage', () => {
    if (buffer.trim()) {
      try {
        const node = JSON.parse(buffer.trim());
        res.write(`data: ${JSON.stringify(node)}\n\n`);
      } catch (e) { /* ignore */ }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  stream.on('error', (err) => {
    console.error('Stream error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

// ── Entity enrichment helper ─────────────────────────────────
// Uses a fast Claude call to identify companies/entities in the input
// that aren't already covered by provided URLs, then auto-fetches their sites.

async function enrichEntities(idea, existingUrls = []) {
  const existingDomains = existingUrls.map(u => {
    try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
  }).filter(Boolean);

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Extract company, organization, or product names from this text that would benefit from website research. Only include names where visiting their website would provide useful context. Do NOT include any entity whose website domain is already in this list: ${existingDomains.join(', ')}

Text: "${idea}"

Return ONLY a JSON array of objects: [{"name": "Entity Name", "url": "https://likely-website.com"}]
If no entities need research, return []. No explanation, just the JSON array.`,
      }],
    });

    const text = message.content[0]?.text?.trim() || '[]';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const entities = JSON.parse(cleaned);
    if (!Array.isArray(entities)) return [];
    return entities.filter(e => e.url && e.name);
  } catch (err) {
    console.error('Entity enrichment error:', err.message);
    return [];
  }
}

// ── POST /api/generate ────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  let { idea, mode, steeringInstruction, existingNodes, jdText, resumePdf, fetchedUrlContent } = req.body;
  if (!idea && !jdText) return res.status(400).json({ error: 'idea or jdText is required' });

  sseHeaders(res);

  // ── Entity enrichment: auto-research companies/orgs mentioned in the input ──
  if (idea && !steeringInstruction && mode !== 'resume') {
    const existingUrls = (fetchedUrlContent || []).map(u => u.url);
    const entities = await enrichEntities(idea, existingUrls);
    if (entities.length) {
      console.log('Entity enrichment: researching', entities.map(e => e.name));
      const enrichResults = await Promise.all(entities.map(async (e) => {
        const result = await fetchPage(e.url, 6000);
        return result ? { url: result.url, text: result.text, entityName: e.name } : null;
      }));
      const enriched = enrichResults.filter(Boolean);
      if (enriched.length) {
        fetchedUrlContent = [...(fetchedUrlContent || []), ...enriched];
      }
    }
  }

  // Select system prompt based on the active mode
  const systemPrompt = mode === 'resume' ? RESUME_SYSTEM_PROMPT : SYSTEM_PROMPT;

  // userContent can be a string or an array of content blocks (for PDF)
  let userContent;

  if (steeringInstruction && existingNodes?.length) {
    userContent = `Input: "${idea}"

Existing nodes already in the tree (DO NOT re-output these — they are already visible to the user):
${JSON.stringify(existingNodes, null, 2)}

Steering instruction from user: "${steeringInstruction}"

Continue building the tree. Generate only NEW nodes not already listed above.
Respect the steering instruction — shift focus accordingly.
All new nodes must reference valid parentIds from the existing nodes or from new nodes you generate.
Use unique ids not present in the existing nodes (e.g. prefix with "s_").
Generate 8-15 new nodes.`;
  } else if (mode === 'resume' && (jdText || resumePdf)) {
    // Rich resume analysis: optionally include a PDF resume document block
    const parts = [];
    if (resumePdf) {
      parts.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: resumePdf,
        },
      });
    }
    const textParts = [];
    if (jdText) textParts.push(`JOB DESCRIPTION:\n${jdText}`);
    textParts.push(
      resumePdf
        ? "The document above is the candidate's resume. Analyse the job description and resume together, then generate a comprehensive resume strategy tree showing matches, gaps, key achievements to highlight, and positioning recommendations."
        : 'Analyse this job description and generate a resume strategy tree.'
    );
    parts.push({ type: 'text', text: textParts.join('\n\n') });
    userContent = parts;
  } else if (mode === 'resume') {
    userContent = `Analyse this job description and generate a resume strategy tree:\n\n${idea}`;
  } else {
    if (fetchedUrlContent?.length) {
      // Separate user-provided URL content from auto-enriched entity content
      const userProvided = fetchedUrlContent.filter(u => !u.entityName);
      const enriched = fetchedUrlContent.filter(u => u.entityName);

      let contentBlock = '';
      if (userProvided.length) {
        contentBlock += 'CONTENT FROM USER-REFERENCED URLs (primary source of truth):\n' +
          userProvided.map(u => `--- ${u.url} ---\n${u.text}`).join('\n\n');
      }
      if (enriched.length) {
        contentBlock += '\n\nAUTO-RESEARCHED CONTEXT (additional background on entities mentioned in the request):\n' +
          enriched.map(u => `--- ${u.entityName} (${u.url}) ---\n${u.text}`).join('\n\n');
      }

      userContent = `USER'S REQUEST: "${idea}"

Below is content we've gathered to help you fulfill this request. Analyze it deeply — extract real product names, features, target audiences, value props, competitive positioning, and any relevant details. Then fulfill the user's request using these real details.

${contentBlock}

Now generate the thinking tree that fulfills the user's request above. Ground every node in the specific details from the reference content. When the request involves positioning, strategy, or integration between multiple entities, use details from ALL sources to build a comprehensive, actionable tree.`;
    } else {
      userContent = `Analyze this input and generate the appropriate thinking tree:\n\n"${idea}"`;
    }
  }

  // Inject template guidance if provided
  const { templateGuidance } = req.body;
  if (templateGuidance?.length && typeof userContent === 'string') {
    userContent += `\n\nSTRUCTURAL TEMPLATES (from successful past sessions — use as structural guidance if the domain matches):\n${JSON.stringify(templateGuidance, null, 2)}`;
  }

  try {
    const streamParams = {
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    };
    // When a PDF document block is included, pass the beta header for PDF support
    const streamOptions = resumePdf
      ? { headers: { 'anthropic-beta': 'pdfs-2024-09-25' } }
      : undefined;

    const stream = client.messages.stream(streamParams, streamOptions);
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── POST /api/regenerate ──────────────────────────────────────

app.post('/api/regenerate', async (req, res) => {
  const { node, parentContext, dynamicTypes } = req.body;
  if (!node) return res.status(400).json({ error: 'node is required' });

  sseHeaders(res);

  const userMessage = `Focus node (generate children for this):
${JSON.stringify(node, null, 2)}

Ancestor context (for reference — do NOT re-output these):
${JSON.stringify(parentContext || [], null, 2)}

Generate 5-10 new child nodes branching from the focus node.`;

  let prompt = REGENERATE_PROMPT;
  if (dynamicTypes?.length) {
    const typeList = dynamicTypes.map(t => t.type).join(', ');
    prompt = prompt.replace(
      /Node types: .*/,
      `Node types: ${typeList}`
    );
  }

  try {
    const stream = await client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── POST /api/drill ───────────────────────────────────────────

app.post('/api/drill', async (req, res) => {
  const { node, fullContext, dynamicTypes } = req.body;
  if (!node) return res.status(400).json({ error: 'node is required' });

  sseHeaders(res);

  const userMessage = `Focus node (drill deeper into this specific area):
${JSON.stringify(node, null, 2)}

Full tree context (existing nodes — do NOT re-output any of these):
${JSON.stringify(fullContext || [], null, 2)}

Generate 12-15 new deep-dive nodes that go significantly deeper on the focus node's domain.`;

  let prompt = DRILL_PROMPT;
  if (dynamicTypes?.length) {
    const typeList = dynamicTypes.map(t => t.type).join(', ');
    prompt = prompt.replace(
      /Node types: .*/,
      `Node types: ${typeList}`
    );
  }

  try {
    const stream = await client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── POST /api/score-nodes ─────────────────────────────────────

const SCORE_NODES_PROMPT = `You are an expert evaluator scoring nodes in a structured thinking tree. For each node, assign a composite quality score from 1 to 10 based on three dimensions:

1. **Relevance** (to the parent node and the overall seed idea): Is this node clearly connected to its parent? Does it serve the overall goal?
2. **Specificity** (concrete vs vague): Does the node name something specific and actionable, or is it a generic placeholder anyone could have written?
3. **Actionability** (can someone act on this?): Could a team member read this node and know what to do next?

Scoring guide:
- 9-10: Exceptional — specific, directly relevant, immediately actionable with concrete details
- 7-8: Strong — clearly relevant and specific, minor gaps in actionability
- 5-6: Adequate — relevant but somewhat vague or generic
- 3-4: Weak — tangentially relevant or very vague
- 1-2: Poor — irrelevant, contradictory, or meaningless

Output a JSON object mapping node id to score:
{"node_id_1": 8, "node_id_2": 5, ...}

Score EVERY node provided. Output ONLY the JSON object. No markdown, no explanation.`;

app.post('/api/score-nodes', async (req, res) => {
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
});

// ── POST /api/extract-template ───────────────────────────────

const EXTRACT_TEMPLATE_PROMPT = `You are a meta-cognitive analyst. Given a finalized product thinking tree (one that has survived critique and been refined), extract its underlying structural pattern as a reusable template.

Your job: abstract the tree into a domain-agnostic structural pattern that captures HOW this tree was organized, not WHAT it was about.

For each node in the abstracted template, output:
- type: the node type (as-is from the tree)
- label_pattern: an abstract description of what kind of content goes here (e.g., "primary user segment", "core technical constraint", "key success metric")
- parentType: the type of its parent node (null for root)
- depth: how deep in the tree (0 for seed, 1 for direct children, etc.)

Also provide:
- domain: the domain this template is best suited for (e.g. "product ideation", "marketing campaign", "sales strategy")
- idea_summary: a one-line abstracted description of the original idea

Output a JSON object:
{
  "domain": "string",
  "idea_summary": "string (1 sentence)",
  "structure": [
    { "type": "string", "label_pattern": "string", "parentType": "string|null", "depth": 0 }
  ]
}

Output ONLY the JSON object. No markdown, no explanation.`;

app.post('/api/extract-template', async (req, res) => {
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
});

// ── POST /api/mockup ──────────────────────────────────────────

const MOCKUP_PROMPT = `You are an expert UI engineer and product storyteller. Your job is to generate a single self-contained HTML file that plays an auto-animated demo of a specific product feature functioning — not a wireframe, not placeholder boxes, but the REAL UI of that feature in action.

CRITICAL RULES:
1. Output ONLY the raw HTML. No markdown fences, no explanation, no preamble. Start with <!DOCTYPE html>.
2. No external dependencies (no CDN, no fonts, no images). Everything inline.
3. The demo MUST auto-play on load. No user interaction required to start.
4. It MUST loop — restart automatically after finishing.
5. The viewport is exactly 320×568px (phone). Design for that. No scrollbars.
6. Dark theme: background #0d0d12, surfaces #151520, borders #252535, green accent #51cf66, text #e2e2f0, dim text #7070a0.
7. Font: monospace everywhere (font-family: 'Courier New', Courier, monospace).

WHAT TO BUILD — THE FEATURE DEMO:
- Study the feature carefully. Understand what UI elements it needs: text inputs, buttons, lists, cards, toggles, chips, modals, etc.
- Build the ACTUAL UI of that feature. If it's a smart reply feature, show a real email compose screen. If it's a kanban board, show real columns and cards. If it's a search feature, show a real search input with results.
- Animate it as a scripted demo: simulate a real user using the feature step by step. Use setTimeout chains to sequence actions.
- Show state changes: empty → filled, loading → loaded, before → after. Make it feel alive.
- Simulate typing by appending characters one at a time with setInterval.
- Simulate taps by briefly adding a CSS highlight class to an element, then triggering the result.
- Show the feature's KEY MOMENT — the exact moment it solves the user's pain. That's what gets emphasis.

STRUCTURE (use this exact flow, adapt UI per feature):
Phase 1 (0–3s): Show the user's BEFORE state — the problem. The UI looks incomplete/broken/manual.
Phase 2 (3–8s): The feature ACTIVATES. Animate it working. Show the mechanism.
Phase 3 (8–12s): The RESULT. Show the improved/solved state. Brief success indicator.
Phase 4 (12–13s): Fade out, then loop back to Phase 1.

TECHNICAL PATTERNS:
- Use CSS transitions and keyframe animations for smooth movement.
- Use a master timeline: const timeline = [ {t: 0, fn: ...}, {t: 1500, fn: ...}, ... ]; setTimeout each entry.
- For typing simulation: use a typeText(el, text, speed) helper with setInterval.
- For tap simulation: el.classList.add('tapped'); setTimeout(() => el.classList.remove('tapped'), 200);
- CSS .tapped { background: rgba(81,207,102,0.3) !important; transform: scale(0.97); }
- For fading elements in: el.style.opacity = '0'; then transition to '1'.
- For sliding elements in: start with transform: translateY(20px); opacity: 0; transition to translateY(0); opacity: 1.
- The loop: after all phases, setTimeout(init, 1000) where init() resets all DOM to initial state and replays.

PERSONA CONTEXT: Use the actor name and pain point to write realistic placeholder content. Real names, real-sounding emails, real task names — not "Lorem ipsum" or "User 1".`;

app.post('/api/mockup', async (req, res) => {
  const { featureNode, ancestorContext } = req.body;
  if (!featureNode) return res.status(400).json({ error: 'featureNode is required' });

  // Build a rich description of the feature from the tree context
  const contextSummary = (ancestorContext || []).map(n =>
    `[${n.type}] ${n.label}: ${n.reasoning}`
  ).join('\n');

  const userMessage = `FEATURE TO DEMO:
Label: "${featureNode.label}"
Reasoning: ${featureNode.reasoning}

PRODUCT TREE CONTEXT (ancestors — understand what problem this solves and for whom):
${contextSummary || '(no additional context)'}

Generate the complete HTML demo file for this feature. The demo should show this specific feature — "${featureNode.label}" — actually working, with realistic UI and real simulated interactions. Not wireframe boxes. The actual feature UI.`;

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 6000,
      system: MOCKUP_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    let html = message.content[0]?.text || '';
    // Strip any accidental markdown fences
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
      throw new Error('Model did not return valid HTML');
    }

    res.json({ html });
  } catch (err) {
    console.error('Mockup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/analyze-codebase ────────────────────────────────

const CODEBASE_ANALYSIS_PROMPT = `You are a product intelligence AI performing bottom-up analysis of a real software codebase.

You will be given actual file contents from a codebase. Your job is to reverse-engineer the product thinking behind it — extracting features, architecture patterns, constraints, user segments, and technical debt — and output a structured product thinking tree that reveals what this product actually is and does.

Output rules: one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string|null", "type": "...", "label": "string (max 8 words)", "reasoning": "string (1-2 sentences)"}

Node types:
- "seed": The root — the product's core purpose as inferred from the codebase. Exactly one, parentId null.
- "feature": A user-facing capability inferred from routes, handlers, or UI components.
- "component": A significant UI component, module, or code unit worth highlighting.
- "api_endpoint": A route, handler, or API surface area with meaningful behaviour.
- "data_model": A schema, model, or significant data structure that reveals domain logic.
- "tech_debt": An identified code smell, coupling issue, missing pattern, or bottleneck.
- "constraint": A technical, scaling, or architectural constraint evident in the code.
- "user_segment": An inferred user type from auth roles, permission checks, data shapes, or naming.
- "problem": A core problem the software appears to be solving.
- "metric": Success metrics implied by analytics, tracking, or business logic in the code.
- "insight": A strategic or architectural insight about how the codebase is structured.

Analysis focus — include only what is requested:
- "features": Surface routes, handlers, and UI components as feature and component nodes. What can a user actually do?
- "architecture": Surface coupling, missing patterns, bottlenecks, and smells as tech_debt, constraint, and api_endpoint nodes.
- "users": Infer user_segment nodes from auth middleware, role checks, permission logic, and data model field names.

IMPORTANT: Do not mechanically describe files. Think like a product person reading code — infer intent, extract user value, identify what is missing. The tree should tell a product story, not a code tour.

Generate 20-30 nodes total. Output each node as a single-line JSON object. Nothing else.`;

app.post('/api/analyze-codebase', async (req, res) => {
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
});

// ── POST /api/reflect (Memory Layer) ─────────────────────────

const REFLECT_PROMPT = `You are a product thinking coach analyzing a user's idea exploration history.

You will receive a list of past idea sessions, each with the idea text and a summary of node types and labels generated.

Your job: identify 2-3 sharp, specific patterns in how this person thinks about product ideas. Focus on:
- Blind spots: types of nodes they consistently under-generate (e.g. always skips metrics, rarely thinks about constraints)
- Biases: domains, user types, or solution patterns they gravitate toward
- Strengths: where their thinking is consistently rich and deep

Output a JSON object with this shape:
{
  "patterns": [
    { "type": "blindspot" | "bias" | "strength", "insight": "string (1 concise sentence, max 15 words)", "detail": "string (1-2 sentences elaborating)" }
  ]
}

Output ONLY the JSON object. No markdown, no explanation.`;

app.post('/api/reflect', async (req, res) => {
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
});

// ── POST /api/critique (Devil's Advocate) ─────────────────────

const CRITIQUE_PROMPT = `You are a sharp, contrarian product critic. You have been given a product thinking tree that someone generated for their idea.

Your job: generate 8-12 critique nodes that aggressively challenge the assumptions in this tree. These are NOT gentle suggestions — they are pointed, specific challenges to the idea's viability, logic, and assumptions.

Output rules: one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string", "type": "critique", "label": "string (max 8 words, punchy)", "reasoning": "string (1-2 sentences, specific and direct)"}

Critique focus areas — cover all of these:
- Challenge the core problem assumptions (is this actually a painful problem?)
- Challenge user segment viability (will these users actually pay/change behavior?)
- Challenge feature necessity (is this feature needed or is it complexity for complexity's sake?)
- Surface competitive threats or existing solutions the tree ignores
- Identify the most likely single reason this idea fails

Rules:
- Each critique node must reference a SPECIFIC node from the existing tree by mentioning its label
- parentId should point to the most relevant existing node being challenged (use its actual id from the tree)
- All ids must be prefixed with "crit_"
- Be specific. "This won't work" is bad. "Enterprise procurement cycles make 6-month sales timelines likely, killing runway" is good.

Generate 8-12 critique nodes. Nothing else.`;

app.post('/api/critique', async (req, res) => {
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
});

// ── Resume-mode debate prompts ────────────────────────────────

const RESUME_DEBATE_CRITIC_PROMPT = `You are a senior hiring manager at a competitive tech company. You have reviewed hundreds of resumes and immediately spot vague positioning, missing proof, and keyword gaps. You are evaluating a resume strategy tree that maps how a candidate plans to present themselves for a specific role.

Your job: generate 6-10 critique nodes that stress-test this strategy with the same sharp eye you bring to real screening decisions.

**EVALUATION FRAMEWORK — assess the strategy based on:**

1. **MATCH QUALITY**: Do the skill_match nodes demonstrate what the JD actually requires? Or are they tangential, vague, or overselling adjacent experience?

2. **GAP HONESTY**: Are the skill_gap nodes identifying the right weaknesses? Are there glaring gaps the tree is glossing over that a hiring manager would immediately flag?

3. **STORY STRENGTH**: Are the story nodes (STAR format) concrete and specific, or generic "led a team, delivered results" non-answers? Would these stories survive a behavioral interview?

4. **IMPACT EVIDENCE**: Do the achievement nodes have real numbers — percentages, revenue, users, latency, scale? Empty claims with no proof are an automatic red flag.

5. **KEYWORD COVERAGE**: Are the most critical ATS/recruiter keywords from the JD present? Missing load-bearing terms is an immediate screen-out at most companies.

6. **POSITIONING COHERENCE**: Does the overall narrative tell a clear, compelling story for THIS specific role? Or is it generic, unfocused, or pointing to the wrong angle entirely?

**Output format — valid JSON object, nothing else:**
{
  "verdict": "NO" | "YES",
  "round_summary": "string (2-3 sentences on whether this resume strategy would pass the screen)",
  "critiques": [
    {
      "id": "string (e.g. dc_1, dc_2)",
      "targetNodeId": "string (real id from the tree)",
      "targetNodeLabel": "string (label of that node)",
      "category": "match" | "gap" | "clarity" | "impact" | "keywords" | "positioning",
      "challenge": "string (1 punchy sentence, max 12 words, names the specific problem)",
      "reasoning": "string (2-3 sentences with specifics — name the gap, missing metric, or wrong angle)"
    }
  ],
  "suggestions": ["string (specific, actionable improvements to the resume strategy)"]
}

**Verdict rules:**
- "YES" = This resume strategy is strong enough to advance to a phone screen. The candidate has a compelling, specific, credible pitch for this role.
- "NO" = This strategy has significant weaknesses — vague positioning, missing proof, critical keyword gaps, or a disconnect between the candidate's background and what the role actually needs.
- Judge the STRATEGY in the tree, not the underlying facts. A good strategy surfaces the best evidence clearly; a poor strategy buries the lead or leaves obvious questions unanswered.
- You CAN say "YES" in round 1 if the strategy is genuinely strong and well-targeted.

Output ONLY the JSON object. No markdown fences, no explanation.`;

const RESUME_DEBATE_ARCHITECT_PROMPT = `You are an experienced career coach who specializes in translating a candidate's background into compelling, specific, targeted resume copy. A skeptical hiring manager has critiqued this resume strategy. Your job: address each critique by generating new nodes that strengthen the strategy with concrete evidence, sharp stories, and precise keywords.

**FOR EACH CRITIQUE — respond with the right type of node:**

1. **For "match" or "gap" critiques**: Generate a \`skill_match\` node with a specific, concrete example — name the project, company, technology, or outcome that closes the gap. Or a \`positioning\` node that reframes existing experience more compellingly for this role.

2. **For "impact" critiques**: Generate an \`achievement\` node with a specific metric format: "[verb] [metric] by [amount] via [method]" — e.g. "Reduced API latency 40% by migrating to async workers, cutting p99 from 800ms to 480ms."

3. **For "clarity" or "story" critiques**: Generate a \`story\` node with a tight STAR narrative — Situation (1 sentence), Task (1 sentence), Action (specific actions taken), Result (quantified outcome). Real specifics, not vague summaries.

4. **For "keywords" critiques**: Generate \`keyword\` nodes for the exact missing terms — precise JD phrases in ATS-optimized form. One keyword per node.

5. **For "positioning" critiques**: Generate a \`positioning\` node with a specific narrative hook — e.g. "Lead with 'infrastructure-first engineer' framing to own the reliability angle, not the feature delivery angle."

**Output rules:** one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string", "type": "string", "label": "string (max 8 words)", "reasoning": "string (2-3 sentences with specifics — real examples, numbers, phrases)"}

**Node types to use:** skill_match, story, achievement, keyword, positioning

**Rules:**
- parentId must be the targetNodeId from the critique being addressed (or another new node you generate)
- All new ids must be prefixed with "rebut_r{round}_"
- Be ruthlessly concrete. "Highlight leadership skills" is rejected. "Add STAR story: led migration of 3-service monolith to microservices, reducing deploy time from 45min to 8min across team of 12" is accepted.
- Do NOT re-output existing nodes. Only generate new ones.

Generate enough nodes to address all critiques. Output ONLY node JSON objects, one per line.`;

const RESUME_DEBATE_FINALIZE_PROMPT = `You are a career strategist synthesizing a completed hiring-manager critique session into a refined resume strategy tree. After multiple rounds of challenge and rebuttal, crystallize the insights directly into the strategy nodes.

**WHAT TO DO:**
1. Review which original nodes were challenged and what specific evidence was established in the rebuttals
2. For challenged nodes that were successfully defended: UPDATE them so their reasoning is sharper, more specific, and reflects the strengthened strategy established in the debate
3. For positioning gaps the debate surfaced but no rebuttal node covers: ADD new synthesis nodes with clear strategic direction
4. Focus on making the core strategy (seed, requirement, skill_match, achievement, story, keyword, positioning nodes) reflect the post-debate consensus with all specifics embedded

**OUTPUT FORMAT — one JSON object per line:**
- To UPDATE an existing node: {"_update": true, "id": "exact-existing-node-id", "type": "original-type", "label": "updated label max 8 words", "reasoning": "2-3 sentences embedding the specific stories, metrics, or keywords established during the debate"}
- To ADD a new synthesis node: {"id": "final_N", "parentId": "parent-id", "type": "type", "label": "label max 8 words", "reasoning": "2-3 sentences synthesizing the debate insight"}

**STRICT RULES:**
- Only update nodes that were directly challenged. Do not touch unchallenged nodes.
- Only add new nodes for gaps the debate revealed that rebuttal nodes don't already cover.
- Updated/new reasoning MUST embed the specific evidence from the debate (concrete stories, metrics, keywords, positioning angles).
- Do NOT output critique nodes or rebuttal nodes — they already exist.
- Do NOT output nodes that need no changes.
- Output 3-8 nodes total (mix of updates and additions).

Output ONLY node JSON objects, one per line. No markdown, no explanation.`;

// ── Codebase-mode debate prompts ──────────────────────────────

const CODEBASE_DEBATE_CRITIC_PROMPT = `You are a senior security auditor and code quality reviewer. You have seen codebases with hidden vulnerabilities, compounding tech debt, and architectural traps that derail teams. You are evaluating a codebase analysis tree that maps the structure, components, and technical decisions of a software system.

Your job: generate 6-10 critique nodes that stress-test this architecture with the sharpness of a rigorous code review.

**EVALUATION FRAMEWORK — assess based on:**

1. **SECURITY**: Are there exposed attack surfaces, missing input validation, insecure data flows, or authentication gaps? Name the specific vulnerability class (OWASP Top 10, supply chain, secrets exposure, etc.).

2. **TECH DEBT**: Which components show evidence of mounting complexity — unclear responsibilities, legacy patterns, missing abstractions, or code that no one wants to touch? Name the debt specifically.

3. **SCALABILITY**: Where does this architecture break under load? Identify specific bottlenecks: synchronous choke points, shared mutable state, N+1 query patterns, missing caching layers, or unbounded queues.

4. **TEST COVERAGE**: What critical paths, edge cases, or failure modes are untested? Which components are too tightly coupled to test in isolation?

5. **COUPLING**: Where is the coupling so tight it blocks independent deployment, safe refactoring, or team ownership? Identify circular dependencies, god objects, or leaky abstractions.

6. **PERFORMANCE**: What specific hotspots — algorithmic complexity, I/O blocking, memory leaks, or inefficient transforms — will cause problems at real scale?

**Output format — valid JSON object, nothing else:**
{
  "verdict": "NO" | "YES",
  "round_summary": "string (2-3 sentences: is this codebase architecture sound enough to build on or does it need structural work first?)",
  "critiques": [
    {
      "id": "string (e.g. dc_1, dc_2)",
      "targetNodeId": "string (real id from the tree)",
      "targetNodeLabel": "string (label of that node)",
      "category": "security" | "debt" | "scalability" | "coverage" | "coupling" | "performance",
      "challenge": "string (1 punchy sentence, max 12 words, names the specific issue)",
      "reasoning": "string (2-3 sentences with specifics — name the vulnerability class, pattern, or failure mode)"
    }
  ],
  "suggestions": ["string (specific, actionable improvements to the architecture)"]
}

**Verdict rules:**
- "YES" = This codebase architecture is sound enough to build on. Major risks are addressed and tech debt is manageable.
- "NO" = This architecture has structural issues that will compound — security gaps, unchecked debt, or design flaws blocking scaling.
- You CAN say "YES" in round 1 if the architecture is genuinely strong.

Output ONLY the JSON object. No markdown fences, no explanation.`;

const CODEBASE_DEBATE_ARCHITECT_PROMPT = `You are a senior tech lead and systems architect. A security auditor has flagged issues in this codebase analysis tree. Your job: address each critique by generating new nodes with specific architectural improvements, refactoring strategies, and technical solutions.

**FOR EACH CRITIQUE — respond with the right type of node:**

1. **For "security" critiques**: Generate an \`insight\` node with the specific control — authentication middleware, input sanitization function, encryption pattern, CSP headers, or dependency audit tool. Name the exact implementation approach.

2. **For "debt" critiques**: Generate a \`feature\` node with a specific refactoring strategy — extract-method, strangler fig, bounded context split, or interface introduction. Name the files or components to touch first.

3. **For "scalability" critiques**: Generate a \`metric\` or \`feature\` node with a specific fix — connection pooling config, cache invalidation strategy, async queue setup (name the queue: Redis, SQS, RabbitMQ), or read replica configuration.

4. **For "coverage" critiques**: Generate a \`constraint\` node with specific test cases — the exact edge case, integration test for the failure mode, or property-based test strategy. Name the framework and approach.

5. **For "coupling" critiques**: Generate a \`feature\` node with a specific decoupling pattern — event bus, dependency injection, anti-corruption layer, or bounded context boundary with the refactoring sequence.

6. **For "performance" critiques**: Generate a \`metric\` node with a specific optimization — index strategy, query optimization, memoization point, or async I/O refactor with expected perf impact.

**Output rules:** one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string", "type": "string", "label": "string (max 8 words)", "reasoning": "string (2-3 sentences with the specific pattern, tool, or implementation)"}

**Node types to use:** feature, insight, metric, constraint, job_to_be_done

**Rules:**
- parentId must be the targetNodeId from the critique being addressed (or another new node you generate)
- All new ids must be prefixed with "rebut_r{round}_"
- Be ruthlessly concrete. "Improve security" is rejected. "Add JWT rotation with 15min access tokens + refresh token in httpOnly cookie, invalidating on logout via Redis blocklist" is accepted.
- Do NOT re-output existing nodes. Only generate new ones.

Generate enough nodes to address all critiques. Output ONLY node JSON objects, one per line.`;

const CODEBASE_DEBATE_FINALIZE_PROMPT = `You are a senior tech lead synthesizing a completed code audit into a refined codebase analysis tree. The security auditor and you have reached consensus. Crystallize the findings directly into the analysis nodes.

**WHAT TO DO:**
1. Review which architecture nodes were challenged and what specific solutions were established in the responses
2. For challenged nodes: UPDATE them so their reasoning reflects the specific technical solution established in the audit
3. For gaps the debate surfaced but no response node covers: ADD new synthesis nodes with clear technical direction
4. Focus on making the core architecture nodes reflect the post-audit consensus with all specifics embedded

**OUTPUT FORMAT — one JSON object per line:**
- To UPDATE an existing node: {"_update": true, "id": "exact-existing-node-id", "type": "original-type", "label": "updated label max 8 words", "reasoning": "2-3 sentences embedding the specific patterns, tools, or strategies established during the audit"}
- To ADD a new synthesis node: {"id": "final_N", "parentId": "parent-id", "type": "type", "label": "label max 8 words", "reasoning": "2-3 sentences synthesizing the audit finding"}

**STRICT RULES:**
- Only update nodes that were directly challenged. Do not touch unchallenged nodes.
- Only add new nodes for gaps the audit revealed that response nodes don't already cover.
- Updated/new reasoning MUST embed the specific technical solutions from the debate.
- Do NOT output critique or rebuttal nodes — they already exist.
- Output 3-8 nodes total.

Output ONLY node JSON objects, one per line. No markdown, no explanation.`;

// ── Decide-mode debate prompts ──────────────────────────────

const DECIDE_DEBATE_CRITIC_PROMPT = `You are a rigorous devil's advocate and decision analyst. You surface the cognitive biases, hidden assumptions, overlooked alternatives, and second-order consequences that rational decision-makers miss. You are evaluating a decision analysis tree that maps a complex choice, its options, tradeoffs, and implications.

Your job: generate 6-10 critique nodes that challenge this decision framework with intellectual rigor.

**EVALUATION FRAMEWORK — assess based on:**

1. **COGNITIVE BIAS**: What biases are shaping this decision tree — confirmation bias, sunk cost fallacy, anchoring to the first option, availability heuristic, or overconfidence? Name the specific bias and where it appears in the tree.

2. **HIDDEN ASSUMPTIONS**: What is this decision tree taking for granted that isn't stated or examined? Surface the unstated assumptions about how the world works, what other actors will do, or what constraints are fixed vs. changeable.

3. **OVERLOOKED ALTERNATIVES**: What options are missing entirely? What combination of partial options, phased approaches, or radically different framings weren't considered?

4. **SECOND-ORDER CONSEQUENCES**: What happens AFTER the decision is made? What feedback loops, unintended consequences, or reactions from affected parties does this tree not account for?

5. **TRADEOFF CLARITY**: Are the real tradeoffs — not just benefits — of each option made explicit? Is this decision hiding a values conflict behind neutral-sounding criteria?

6. **REVERSIBILITY BLINDSPOT**: Is the decision being treated as more reversible (or more permanent) than it actually is? What's the real cost of being wrong?

**Output format — valid JSON object, nothing else:**
{
  "verdict": "NO" | "YES",
  "round_summary": "string (2-3 sentences: is this decision framework sound and well-reasoned or does it have significant analytical blind spots?)",
  "critiques": [
    {
      "id": "string (e.g. dc_1, dc_2)",
      "targetNodeId": "string (real id from the tree)",
      "targetNodeLabel": "string (label of that node)",
      "category": "bias" | "tradeoff" | "alternative" | "consequence" | "assumption" | "blindspot",
      "challenge": "string (1 punchy sentence, max 12 words, names the specific analytical gap)",
      "reasoning": "string (2-3 sentences with specifics — name the bias, assumption, or consequence)"
    }
  ],
  "suggestions": ["string (specific analytical improvements to strengthen the decision framework)"]
}

**Verdict rules:**
- "YES" = This decision framework is rigorous — biases are acknowledged, tradeoffs are explicit, alternatives are considered, and second-order effects are mapped.
- "NO" = This framework has significant analytical gaps — hidden assumptions, unconsidered alternatives, or unexamined consequences that would change the decision.
- You CAN say "YES" in round 1 if the analysis is genuinely thorough.

Output ONLY the JSON object. No markdown fences, no explanation.`;

const DECIDE_DEBATE_ARCHITECT_PROMPT = `You are an experienced strategic advisor and decision strategist. A devil's advocate has challenged this decision analysis. Your job: address each critique by generating new nodes that strengthen the framework with structured reasoning, historical precedents, and evidence-based analysis.

**FOR EACH CRITIQUE — respond with the right approach:**

1. **For "bias" critiques**: Generate an \`insight\` node that acknowledges the bias and shows how the analysis accounts for or corrects for it. Reference a specific debiasing technique (pre-mortem, reference class forecasting, consider-the-opposite).

2. **For "assumption" critiques**: Generate a \`constraint\` node that makes the assumption explicit and examines it — is it load-bearing? What changes if it's wrong? Provide evidence for why the assumption is defensible.

3. **For "alternative" critiques**: Generate a \`feature\` node describing the alternative with its specific tradeoffs and why it was not selected or should be added to the analysis.

4. **For "consequence" critiques**: Generate an \`insight\` node mapping the second-order effect — its likelihood, magnitude, and what signal would indicate it's occurring. Include a specific mitigation.

5. **For "tradeoff" critiques**: Generate a \`metric\` node that makes the tradeoff quantitative — what specifically is being given up, at what magnitude, over what timeframe.

6. **For "blindspot" critiques**: Generate a \`problem\` or \`constraint\` node that directly surfaces the missed dimension and how it affects the decision.

**Output rules:** one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string", "type": "string", "label": "string (max 8 words)", "reasoning": "string (2-3 sentences with specific frameworks, precedents, or evidence)"}

**Node types to use:** feature, insight, metric, constraint, problem, user_segment

**Rules:**
- parentId must be the targetNodeId from the critique being addressed (or another new node you generate)
- All new ids must be prefixed with "rebut_r{round}_"
- Be concrete. "Consider the tradeoffs" is rejected. "Speed-to-market tradeoff: Option A saves 6 weeks but creates 18 months of refactoring debt — analogous to Stripe's 2018 API versioning decision where speed cost $2M in migration work two years later" is accepted.
- Do NOT re-output existing nodes. Only generate new ones.

Generate enough nodes to address all critiques. Output ONLY node JSON objects, one per line.`;

const DECIDE_DEBATE_FINALIZE_PROMPT = `You are a decision strategist synthesizing a completed decision debate into a refined analysis tree. The devil's advocate and you have reached consensus. Crystallize the insights directly into the decision nodes.

**WHAT TO DO:**
1. Review which decision nodes were challenged and what specific reasoning was established in the responses
2. For challenged nodes: UPDATE them so their reasoning reflects the stronger, evidence-backed analysis with specific frameworks and precedents
3. For gaps the debate surfaced but no response node covers: ADD new synthesis nodes with clear analytical direction
4. Focus on making the core decision framework reflect the post-debate consensus with all specifics embedded

**OUTPUT FORMAT — one JSON object per line:**
- To UPDATE an existing node: {"_update": true, "id": "exact-existing-node-id", "type": "original-type", "label": "updated label max 8 words", "reasoning": "2-3 sentences embedding the specific frameworks, precedents, or evidence established during the debate"}
- To ADD a new synthesis node: {"id": "final_N", "parentId": "parent-id", "type": "type", "label": "label max 8 words", "reasoning": "2-3 sentences synthesizing the debate insight"}

**STRICT RULES:**
- Only update nodes that were directly challenged.
- Only add new nodes for gaps the debate revealed.
- Updated/new reasoning MUST embed the specific analysis from the debate.
- Do NOT output critique or rebuttal nodes.
- Output 3-8 nodes total.

Output ONLY node JSON objects, one per line. No markdown, no explanation.`;

// ── Write-mode debate prompts ──────────────────────────────

const WRITE_DEBATE_CRITIC_PROMPT = `You are a senior editor at a respected publication. You've edited thousands of pieces — you immediately spot muddled logic, weak structure, unsupported claims, audience misalignment, and writing that buries the lead. You are reviewing a writing structure and content plan tree.

Your job: generate 6-10 critique nodes that challenge this writing plan with editorial rigor.

**EVALUATION FRAMEWORK — assess based on:**

1. **CLARITY**: Where is the writing unclear — jargon without explanation, mixed metaphors, sentences that require multiple reads, or points that could be read multiple ways? Name the specific section or node.

2. **STRUCTURE**: Does the piece flow logically from opening to conclusion? Are there gaps in the argument, sections that could be cut, or key points buried in the wrong place? Is the opening compelling enough to hold the reader?

3. **AUDIENCE FIT**: Is this piece written for the right audience at the right level? Is it too technical, too simplistic, or assuming knowledge the reader doesn't have? Does the tone match the platform and reader expectations?

4. **ARGUMENT STRENGTH**: Are the claims backed by evidence? Are there logical leaps, false equivalences, or strawman versions of opposing views? Is the core thesis defensible and differentiated?

5. **VOICE CONSISTENCY**: Does the voice stay consistent throughout? Does it shift register unexpectedly? Is it authentically the writer's voice or does it sound like committee writing?

6. **EVIDENCE QUALITY**: Are the examples, data, and citations specific and credible? Are there claims that need sourcing? Is the evidence recent and relevant to the audience?

**Output format — valid JSON object, nothing else:**
{
  "verdict": "NO" | "YES",
  "round_summary": "string (2-3 sentences: is this writing plan ready to draft or does it need structural revision first?)",
  "critiques": [
    {
      "id": "string (e.g. dc_1, dc_2)",
      "targetNodeId": "string (real id from the tree)",
      "targetNodeLabel": "string (label of that node)",
      "category": "clarity" | "structure" | "audience" | "argument" | "voice" | "evidence",
      "challenge": "string (1 punchy sentence, max 12 words, names the specific editorial issue)",
      "reasoning": "string (2-3 sentences with specifics — quote the weak point or explain the structural problem)"
    }
  ],
  "suggestions": ["string (specific editorial improvements to strengthen the writing)"]
}

**Verdict rules:**
- "YES" = This writing plan is ready to draft — structure is sound, argument is defensible, and the audience is clearly served.
- "NO" = This plan has editorial issues that would make the piece ineffective — structural gaps, unsupported claims, or audience misalignment.
- You CAN say "YES" in round 1 if the plan is genuinely strong.

Output ONLY the JSON object. No markdown fences, no explanation.`;

const WRITE_DEBATE_ARCHITECT_PROMPT = `You are an experienced writer and developmental editor. A senior editor has critiqued this writing plan. Your job: address each critique by generating new nodes with specific rewrites, structural improvements, and editorial solutions.

**FOR EACH CRITIQUE — respond with the right approach:**

1. **For "clarity" critiques**: Generate a \`feature\` node with a specific rewrite — provide the actual improved sentence or paragraph, not a general instruction. Show the before/after.

2. **For "structure" critiques**: Generate a \`feature\` node with a specific structural change — move this section before that one, cut this paragraph, open with this hook. Be specific about where things move.

3. **For "audience" critiques**: Generate an \`insight\` node that reframes the piece for the right audience — adjust the assumed knowledge level, change the tone register, add/remove context that bridges the gap.

4. **For "argument" critiques**: Generate a \`constraint\` or \`insight\` node with the specific evidence, counterargument acknowledgment, or refined thesis that closes the gap.

5. **For "voice" critiques**: Generate an \`insight\` node with the voice direction — provide 2-3 example sentences that demonstrate the target register and explain what to avoid.

6. **For "evidence" critiques**: Generate a \`metric\` node with the specific data point, citation, or example that shores up the claim — include the source, date, and why it's credible.

**Output rules:** one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string", "type": "string", "label": "string (max 8 words)", "reasoning": "string (2-3 sentences with the specific rewrite, structural fix, or supporting evidence)"}

**Node types to use:** feature, insight, metric, constraint, job_to_be_done

**Rules:**
- parentId must be the targetNodeId from the critique being addressed (or another new node you generate)
- All new ids must be prefixed with "rebut_r{round}_"
- Be concrete. "Improve the opening" is rejected. "Rewrite opening to: 'In 2019, three Google teams built the same product independently — not because of poor communication, but because the incentive structure made duplication rational'" is accepted.
- Do NOT re-output existing nodes. Only generate new ones.

Generate enough nodes to address all critiques. Output ONLY node JSON objects, one per line.`;

const WRITE_DEBATE_FINALIZE_PROMPT = `You are a developmental editor synthesizing a completed editorial debate into a refined writing structure tree. The editor and writer have reached consensus. Crystallize the insights directly into the writing plan nodes.

**WHAT TO DO:**
1. Review which writing nodes were challenged and what specific improvements were established in the responses
2. For challenged nodes: UPDATE them so their reasoning reflects the stronger, clearer editorial direction with specific rewrites embedded
3. For gaps the debate surfaced but no response node covers: ADD new synthesis nodes with specific writing direction
4. Focus on making the core writing structure reflect the post-debate consensus with all specifics embedded

**OUTPUT FORMAT — one JSON object per line:**
- To UPDATE an existing node: {"_update": true, "id": "exact-existing-node-id", "type": "original-type", "label": "updated label max 8 words", "reasoning": "2-3 sentences embedding the specific rewrites, structural fixes, or editorial direction established during the debate"}
- To ADD a new synthesis node: {"id": "final_N", "parentId": "parent-id", "type": "type", "label": "label max 8 words", "reasoning": "2-3 sentences synthesizing the editorial insight"}

**STRICT RULES:**
- Only update nodes that were directly challenged.
- Only add new nodes for gaps the debate revealed.
- Updated/new reasoning MUST embed the specific editorial improvements from the debate.
- Do NOT output critique or rebuttal nodes.
- Output 3-8 nodes total.

Output ONLY node JSON objects, one per line. No markdown, no explanation.`;

// ── Plan-mode debate prompts ──────────────────────────────

const PLAN_DEBATE_CRITIC_PROMPT = `You are an experienced risk analyst and project skeptic. You've seen enough plans to know which patterns derail projects — optimistic timelines, unidentified dependencies, resource gaps, and scope that expands without bound. You are evaluating a project plan tree.

Your job: generate 6-10 critique nodes that stress-test this plan with the rigor of a pre-mortem.

**EVALUATION FRAMEWORK — assess based on:**

1. **TIMELINE REALISM**: Where is the plan optimistic? Which tasks are underestimated, which dependencies create critical path bottlenecks, and what single delay cascades into a missed deadline? Apply Hofstadter's Law.

2. **DEPENDENCY RISK**: What external dependencies — vendors, APIs, teams, regulatory approvals, technical unknowns — could block progress? Are there circular dependencies or tasks that can't start until unknowns are resolved?

3. **RESOURCE GAPS**: Is the team staffed for this? Are there skill gaps, context-switching costs, or key-person dependencies where one person's absence derails the plan? Is the budget accounting for real costs?

4. **SCOPE MANAGEMENT**: Where is the scope fuzzy? What MVP compromises will need to be made, and have those been made explicit? What's clearly in vs. out of scope?

5. **RISK MITIGATION**: What are the top failure modes for this plan, and does the tree have mitigation strategies? Or is the plan assuming everything will go right?

6. **MILESTONE CLARITY**: Are the milestones measurable and binary (done/not done), or are they vague progress indicators? Are there clear decision points where the plan should pivot or stop?

**Output format — valid JSON object, nothing else:**
{
  "verdict": "NO" | "YES",
  "round_summary": "string (2-3 sentences: is this plan executable or does it have structural risks that need addressing?)",
  "critiques": [
    {
      "id": "string (e.g. dc_1, dc_2)",
      "targetNodeId": "string (real id from the tree)",
      "targetNodeLabel": "string (label of that node)",
      "category": "timeline" | "dependency" | "resource" | "scope" | "risk" | "milestone",
      "challenge": "string (1 punchy sentence, max 12 words, names the specific planning gap)",
      "reasoning": "string (2-3 sentences with specifics — name the bottleneck, gap, or failure mode)"
    }
  ],
  "suggestions": ["string (specific, actionable improvements to make the plan more executable)"]
}

**Verdict rules:**
- "YES" = This plan is executable — risks are identified and mitigated, timelines are realistic, dependencies are mapped, and milestones are clear.
- "NO" = This plan has structural risks that will likely cause it to fail — optimistic timelines, hidden dependencies, or unmitigated failure modes.
- You CAN say "YES" in round 1 if the plan is genuinely solid.

Output ONLY the JSON object. No markdown fences, no explanation.`;

const PLAN_DEBATE_ARCHITECT_PROMPT = `You are a seasoned project manager and delivery lead. A risk analyst has flagged concerns with this project plan. Your job: address each critique by generating new nodes with specific mitigation strategies, realistic contingencies, and concrete solutions.

**FOR EACH CRITIQUE — respond with the right approach:**

1. **For "timeline" critiques**: Generate a \`metric\` node with a realistic revised estimate — break the task into sub-tasks with estimates for each, identify parallel vs. sequential work, and build in explicit buffer. Show the math.

2. **For "dependency" critiques**: Generate a \`constraint\` node that maps the dependency explicitly — who owns it, what the trigger condition is, what the fallback is if it's late, and whether there's a way to de-risk or parallelize.

3. **For "resource" critiques**: Generate a \`feature\` node with a specific staffing solution — hire, contract, redistribute scope, or reduce parallelism. Name the role, timeline to fill it, and cost/tradeoff.

4. **For "scope" critiques**: Generate a \`constraint\` node with a specific scope decision — what's explicitly out of scope, what the MVP boundary is, and what the criteria are for adding things back.

5. **For "risk" critiques**: Generate an \`insight\` node with a specific mitigation plan — the early warning indicator, the trigger condition, the pre-planned response, and who owns it.

6. **For "milestone" critiques**: Generate a \`metric\` node with a specific, binary milestone definition — what "done" means with a measurable acceptance criterion and a clear owner.

**Output rules:** one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string", "type": "string", "label": "string (max 8 words)", "reasoning": "string (2-3 sentences with the specific mitigation, estimate, or contingency)"}

**Node types to use:** feature, insight, metric, constraint, job_to_be_done

**Rules:**
- parentId must be the targetNodeId from the critique being addressed (or another new node you generate)
- All new ids must be prefixed with "rebut_r{round}_"
- Be concrete. "Add buffer time" is rejected. "Backend API: 2-week buffer after 4-week estimate, triggered if integration tests not green by week 3 — owner: tech-lead, escalation path: PM within 24h" is accepted.
- Do NOT re-output existing nodes. Only generate new ones.

Generate enough nodes to address all critiques. Output ONLY node JSON objects, one per line.`;

const PLAN_DEBATE_FINALIZE_PROMPT = `You are a delivery lead synthesizing a completed risk review into a refined project plan tree. The risk analyst and you have reached consensus. Crystallize the findings directly into the plan nodes.

**WHAT TO DO:**
1. Review which plan nodes were challenged and what specific mitigations were established in the responses
2. For challenged nodes: UPDATE them so their reasoning reflects the hardened, risk-aware plan with specific contingencies embedded
3. For gaps the debate surfaced but no response node covers: ADD new synthesis nodes with clear planning direction
4. Focus on making the core plan reflect the post-review consensus with all mitigations and realistic estimates embedded

**OUTPUT FORMAT — one JSON object per line:**
- To UPDATE an existing node: {"_update": true, "id": "exact-existing-node-id", "type": "original-type", "label": "updated label max 8 words", "reasoning": "2-3 sentences embedding the specific mitigations, estimates, or contingencies established during the review"}
- To ADD a new synthesis node: {"id": "final_N", "parentId": "parent-id", "type": "type", "label": "label max 8 words", "reasoning": "2-3 sentences synthesizing the planning insight"}

**STRICT RULES:**
- Only update nodes that were directly challenged.
- Only add new nodes for gaps the review revealed.
- Updated/new reasoning MUST embed the specific risk mitigations from the debate.
- Do NOT output critique or rebuttal nodes.
- Output 3-8 nodes total.

Output ONLY node JSON objects, one per line. No markdown, no explanation.`;

// ── Debate prompt maps + helpers ───────────────────────────────

const CRITIC_PROMPT_MAP = {
  resume:   RESUME_DEBATE_CRITIC_PROMPT,
  codebase: CODEBASE_DEBATE_CRITIC_PROMPT,
  decision: DECIDE_DEBATE_CRITIC_PROMPT,
  writing:  WRITE_DEBATE_CRITIC_PROMPT,
  plan:     PLAN_DEBATE_CRITIC_PROMPT,
};

const ARCHITECT_PROMPT_MAP = {
  resume:   RESUME_DEBATE_ARCHITECT_PROMPT,
  codebase: CODEBASE_DEBATE_ARCHITECT_PROMPT,
  decision: DECIDE_DEBATE_ARCHITECT_PROMPT,
  writing:  WRITE_DEBATE_ARCHITECT_PROMPT,
  plan:     PLAN_DEBATE_ARCHITECT_PROMPT,
};

const FINALIZE_PROMPT_MAP = {
  resume:   RESUME_DEBATE_FINALIZE_PROMPT,
  codebase: CODEBASE_DEBATE_FINALIZE_PROMPT,
  decision: DECIDE_DEBATE_FINALIZE_PROMPT,
  writing:  WRITE_DEBATE_FINALIZE_PROMPT,
  plan:     PLAN_DEBATE_FINALIZE_PROMPT,
};

const MODE_SERVER_META = {
  idea:     { label: 'Idea',          treeLabel: 'product thinking tree',  responder: 'Architect',        priorCheck: 'Has the architect strengthened the product based on prior feedback?',          rebutInstruction: 'Generate new nodes that directly address each critique. Be specific and grounded.',                                                                                   historyIntro: 'Full debate history',    satisfied: 'consensus reached' },
  resume:   { label: 'Role / JD',     treeLabel: 'resume strategy tree',   responder: 'Career coach',     priorCheck: 'Has the career coach strengthened the strategy based on prior feedback?',      rebutInstruction: 'Generate new resume strategy nodes that directly address each critique. Be specific, use concrete stories, metrics, and keywords.',                                  historyIntro: 'Full debate history',    satisfied: 'hiring manager satisfied' },
  codebase: { label: 'Codebase',      treeLabel: 'codebase analysis tree', responder: 'Tech lead',        priorCheck: 'Has the tech lead addressed the flagged issues in the tree?',                  rebutInstruction: 'Generate new architectural nodes that directly address each concern. Be specific with patterns, tools, and solutions.',                                               historyIntro: 'Full audit history',     satisfied: 'auditor satisfied' },
  decision: { label: 'Decision',      treeLabel: 'decision analysis tree', responder: 'Strategic advisor',priorCheck: 'Has the strategic advisor addressed the raised concerns in the tree?',          rebutInstruction: 'Generate new decision framework nodes that address each concern. Use frameworks, precedents, and evidence-based reasoning.',                                         historyIntro: 'Full debate history',    satisfied: 'consensus reached' },
  writing:  { label: 'Writing piece', treeLabel: 'writing structure tree', responder: 'Writer',           priorCheck: 'Has the writer addressed the editorial critiques in the tree?',                 rebutInstruction: 'Generate new content nodes that address each editorial critique. Provide concrete rewrites, structural improvements, or supporting evidence.',                       historyIntro: 'Full editorial review',  satisfied: 'editor satisfied' },
  plan:     { label: 'Project',       treeLabel: 'project plan tree',      responder: 'Project manager',  priorCheck: 'Has the project manager mitigated the flagged risks in the tree?',               rebutInstruction: 'Generate new plan nodes that address each risk. Provide mitigation strategies, contingencies, and realistic solutions.',                                             historyIntro: 'Full risk review',       satisfied: 'risk analyst satisfied' },
};

function buildCritiqueUserMessage(mode, { idea, round, priorCritiques, nodes }) {
  const m = MODE_SERVER_META[mode] || MODE_SERVER_META.idea;
  const priorSection = priorCritiques?.length
    ? `Prior suggestions you raised (check if ${m.responder.toLowerCase()} addressed these in the tree):\n${JSON.stringify(priorCritiques, null, 2)}\n\n`
    : '';
  return `${m.label}: "${idea}"
Round: ${round} of max 5

${priorSection}Current ${m.treeLabel} (${nodes.length} nodes):
${JSON.stringify(nodes, null, 2)}

Evaluate this ${m.treeLabel}. ${m.priorCheck} Generate your verdict and new critiques.`;
}

function buildRebutUserMessage(mode, { idea, round, critiques, nodes }) {
  const m = MODE_SERVER_META[mode] || MODE_SERVER_META.idea;
  return `${m.label}: "${idea}"
Round: ${round}

Critiques to address:
${JSON.stringify(critiques, null, 2)}

Current ${m.treeLabel} context (do NOT re-output these — only generate new nodes):
${JSON.stringify(nodes, null, 2)}

${m.rebutInstruction}`;
}

function buildFinalizeUserMessage(mode, { idea, debateHistory, nodes, historyText }) {
  const m = MODE_SERVER_META[mode] || MODE_SERVER_META.idea;
  return `${m.label}: "${idea}"

${m.historyIntro} (${debateHistory.length} rounds, ${m.satisfied}):
${historyText}

Current ${m.treeLabel} after debate (${nodes.length} nodes — includes original nodes + critique nodes + rebuttal nodes):
${JSON.stringify(nodes, null, 2)}

Now synthesize the debate into tree updates. Update challenged nodes with debate-validated reasoning and add any missing synthesis nodes.`;
}

// ── POST /api/debate/critique ─────────────────────────────────
// VC-mode critic evaluates the tree and returns structured critique + verdict

const DEBATE_CRITIC_PROMPT = `You are a seasoned venture capitalist evaluating a startup idea's product thinking tree for potential investment. You are skeptical but fair — you judge the idea ON ITS MERITS based on the proposed feature set, target market, and business model. You do NOT demand external evidence, customer interviews, or revenue proof — those come after funding. Your job is to assess whether the idea, as architected in the tree, is investable.

**EVALUATION FRAMEWORK — assess the idea based on:**

1. **COMPETITIVE LANDSCAPE**: Identify 2-3 direct competitors. For each: what's their key advantage, and what gap does THIS idea exploit that they don't? Is the proposed differentiation real or superficial?

2. **ARCHITECTURE QUALITY**: Does the product thinking tree form a coherent, buildable product? Are there obvious missing pieces, contradictions, or features that don't serve the stated users?

3. **MARKET FIT LOGIC**: Given the proposed target users and their stated problems, does the feature set actually solve those problems? Would a reasonable person in that segment pay for this?

4. **RISK SURFACE**: What are the 2-3 biggest risks? Think: technical feasibility, go-to-market complexity, timing, regulatory, or dependency risks. Be specific — name the risk, not vague hand-waving.

Make your critiques surgically specific. Vague critiques like "market is competitive" or "moat is unclear" are not acceptable — name the competitor, explain the specific gap or overlap, and say why it matters.

**Output format — you MUST output a valid JSON object, nothing else:**
{
  "verdict": "NO" | "YES",
  "round_summary": "string (2-3 sentences summarizing your assessment of the idea's strength)",
  "critiques": [
    {
      "id": "string (e.g. dc_1, dc_2)",
      "targetNodeId": "string (id of the node being challenged — must be a real id from the tree)",
      "targetNodeLabel": "string (label of that node)",
      "category": "obsolescence" | "market" | "moat" | "execution" | "gtm" | "model",
      "challenge": "string (1 punchy sentence, max 12 words, names a specific concern)",
      "reasoning": "string (2-3 sentences explaining the critique with specifics)"
    }
  ],
  "suggestions": ["string (specific, actionable improvements that would strengthen the idea)"]
}

**suggestions**: List 2-4 specific, actionable improvements the architect should consider. These are RECOMMENDATIONS, not blockers — things like "Add an offline mode for field sales reps" or "Consider a freemium tier to reduce acquisition friction" or "The data model should account for multi-tenant isolation." Frame them as product suggestions, not evidence-gathering tasks.

**Verdict rules:**
- Judge the idea based on the PROPOSED feature set, market logic, and architecture — make reasonable assumptions about execution
- Say "YES" when the product thinking tree describes a coherent, differentiated product that plausibly serves its target users with a viable business model
- Say "NO" when there are fundamental gaps in the product logic, the differentiation is weak, or critical features are missing
- Do NOT demand customer interviews, revenue data, paying users, or experiments — that's post-funding work
- "YES" means: "This is a well-thought-out product with a credible path to value. I'd invest based on the team and this plan."
- You CAN say "YES" in any round, including round 1, if the tree is genuinely strong

Output ONLY the JSON object. No markdown fences, no explanation.`;

app.post('/api/debate/critique', async (req, res) => {
  const { nodes, idea, round, priorCritiques, mode } = req.body;
  if (!nodes?.length) return res.status(400).json({ error: 'nodes required' });

  const criticPrompt = CRITIC_PROMPT_MAP[mode] || DEBATE_CRITIC_PROMPT;
  const userMessage = buildCritiqueUserMessage(mode, { idea, round, priorCritiques, nodes });

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 10000,
      thinking: { type: 'enabled', budget_tokens: 8000 },
      system: criticPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    // With extended thinking enabled, content[0] is a thinking block; find the text block
    const textBlock = message.content.find((b) => b.type === 'text');
    let text = textBlock?.text || '{}';
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error('Debate critique error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/debate/rebut (SSE) ──────────────────────────────
// Architect addresses critiques by streaming new/updated nodes

const DEBATE_ARCHITECT_PROMPT = `You are an experienced startup founder and idea architect. You have received pointed critiques from a skeptical VC. Your job: address each critique by generating new nodes backed by deep, specific research.

**MANDATORY DEEP RESEARCH — complete all four steps before forming rebuttals:**

1. **PRECEDENT RESEARCH**: For each critique, name a specific company that faced the identical challenge and solved it. How exactly did they solve it? (e.g. "Superhuman faced the 'Gmail will copy this' critique — they survived by embedding into power-user workflows so deeply that switching cost outweighed any native feature parity")

2. **TECHNICAL SPECIFICITY**: For each rebuttal, identify the precise technical mechanism — not "use AI" but the exact API, integration point, latency budget, and cost structure (e.g. "Use Claude streaming API with 200ms debounce on keystroke events, ~$0.003 per session at current pricing, creating a $8/user/month gross margin floor at 40 sessions/month")

3. **VALIDATION BLUEPRINT**: For each rebuttal node, embed a concrete validation approach: target persona, specific channel, dollar budget, timeline, and binary success metric (e.g. "Post in Lenny's Newsletter job board targeting B2B SaaS PMs, $400 spend, success = 12+ qualified demo requests within 3 weeks")

4. **EXISTING SIGNALS**: What published data, funded comparable, or public market signal already validates your position? Name it with specifics (e.g. "Linear raised $35M Series B in 2022 proving developer-tool bottoms-up PLG works at enterprise scale")

**Output rules:** one JSON object per line, no markdown, no arrays.
Each node shape: {"id": "string", "parentId": "string", "type": "string", "label": "string (max 8 words)", "reasoning": "string (2-3 sentences embedding the specific precedent, technical mechanism, validation approach, or market signal)"}

**Node types to use:** feature, insight, metric, constraint, user_segment, job_to_be_done

**Rules:**
- For each critique, generate 1-3 nodes that directly address it with the research above embedded
- parentId must be the targetNodeId from the critique being addressed (or another new node you generate)
- All new ids must be prefixed with "rebut_r{round}_"
- Be ruthlessly concrete. "We have a defensible moat" is rejected. "We embed into the Figma plugin API creating a 6-month workflow migration cost — Figma's own plugin marketplace has 1.2M weekly active users proving the integration surface is real" is accepted.
- Do NOT re-output existing nodes. Only generate new ones.

Generate enough nodes to address all critiques. Output ONLY node JSON objects, one per line.`;

app.post('/api/debate/rebut', async (req, res) => {
  const { nodes, idea, round, critiques, mode } = req.body;
  if (!critiques?.length) return res.status(400).json({ error: 'critiques required' });

  sseHeaders(res);

  const architectPrompt = ARCHITECT_PROMPT_MAP[mode] || DEBATE_ARCHITECT_PROMPT;
  const userMessage = buildRebutUserMessage(mode, { idea, round, critiques, nodes });

  try {
    const stream = await client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 12000,
      thinking: { type: 'enabled', budget_tokens: 8000 },
      system: architectPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Debate rebut error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── POST /api/debate/finalize (SSE) ───────────────────────────
// After consensus, architect synthesizes the debate into refined tree updates

const DEBATE_FINALIZE_PROMPT = `You are an architect synthesizing a completed VC debate into a refined product thinking tree. The VC critic and you have reached consensus after multiple rounds of challenge and rebuttal. Now crystallize the insights from the debate directly into the product tree.

**WHAT TO DO:**
1. Review which original nodes were challenged and what specific evidence was established in the rebuttals
2. For challenged nodes that were successfully defended: UPDATE them so their reasoning reflects the stronger, evidence-backed position established in the debate
3. For gaps that the debate surfaced but no rebuttal node covers: ADD new synthesis nodes
4. Focus on making the core tree (seed, problem, user_segment, feature, metric, insight nodes) reflect the post-debate, consensus-validated understanding with all the specific evidence embedded

**OUTPUT FORMAT — one JSON object per line:**
- To UPDATE an existing node: {"_update": true, "id": "exact-existing-node-id", "type": "original-type", "label": "updated label max 8 words", "reasoning": "2-3 sentences embedding the specific competitors, validation approaches, or technical specifics established during the debate"}
- To ADD a new synthesis node: {"id": "final_N", "parentId": "parent-id", "type": "type", "label": "label max 8 words", "reasoning": "2-3 sentences synthesizing the debate insight"}

**STRICT RULES:**
- Only update nodes that were directly challenged. Do not touch unchallenged nodes.
- Only add new nodes for gaps the debate revealed that rebuttal nodes don't already cover.
- Updated/new reasoning MUST embed the specific evidence from the debate (named competitors, cited failure cases, concrete validation blueprints, market signals).
- Do NOT output critique nodes or rebuttal nodes — they already exist.
- Do NOT output nodes that need no changes.
- Output 3-8 nodes total (mix of updates and additions).

Output ONLY node JSON objects, one per line. No markdown, no explanation.`;

app.post('/api/debate/finalize', async (req, res) => {
  const { nodes, idea, debateHistory, mode } = req.body;
  if (!nodes?.length || !debateHistory?.length) {
    return res.status(400).json({ error: 'nodes and debateHistory required' });
  }

  sseHeaders(res);

  const finalizePrompt = FINALIZE_PROMPT_MAP[mode] || DEBATE_FINALIZE_PROMPT;
  const responderLabel = (MODE_SERVER_META[mode] || MODE_SERVER_META.idea).responder;

  const historyText = debateHistory.map((r) => `
Round ${r.round}:
  Critiques: ${JSON.stringify(r.critiques || [])}
  Consensus blockers: ${JSON.stringify(r.blockers || [])}
  ${responderLabel} rebuttal nodes added: ${JSON.stringify((r.rebutNodes || []).map((n) => ({ id: n.id || n.data?.id, label: n.data?.label || n.label, reasoning: n.data?.reasoning || n.reasoning })))}
`).join('\n');

  const userMessage = buildFinalizeUserMessage(mode, { idea, debateHistory, nodes, historyText });

  try {
    const stream = await client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 12000,
      thinking: { type: 'enabled', budget_tokens: 8000 },
      system: finalizePrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Debate finalize error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── POST /api/export/github ─────────────────────────────────────
// Creates a new GitHub repo and pushes markdown files via the Contents API
// Uses PUT /repos/:owner/:repo/contents/:path which works with both classic
// and fine-grained PATs (requires Contents read/write permission)

app.post('/api/export/github', async (req, res) => {
  const { token, repoName, repoDescription, isPrivate, files } = req.body;

  if (!token) return res.status(400).json({ error: 'GitHub token is required' });
  if (!repoName) return res.status(400).json({ error: 'Repository name is required' });
  if (!files || !Object.keys(files).length) return res.status(400).json({ error: 'At least one file is required' });

  const ghFetch = (url, opts = {}) => nodeFetch(url, {
    ...opts,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });

  try {
    // Step 1: Create repo (no auto_init — we'll push files directly)
    const createRes = await ghFetch('https://api.github.com/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        description: repoDescription || 'Product spec exported from Idea Graph',
        private: isPrivate !== false,
        auto_init: false,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      if (createRes.status === 401) return res.status(401).json({ error: 'Invalid GitHub token. Please check your Personal Access Token.' });
      if (createRes.status === 422) return res.status(422).json({ error: `Repository "${repoName}" already exists. Choose a different name.` });
      if (createRes.status === 403) return res.status(403).json({ error: 'GitHub rate limit or permissions issue. Try again later.' });
      return res.status(createRes.status).json({ error: err.message || `GitHub error: ${createRes.status}` });
    }

    const repo = await createRes.json();
    const owner = repo.owner.login;
    const repoFullName = `${owner}/${repoName}`;

    // Step 2: Push files sequentially via Contents API
    // The first file creates the initial commit; subsequent files chain on it
    const fileEntries = Object.entries(files);
    for (let i = 0; i < fileEntries.length; i++) {
      const [filename, content] = fileEntries[i];
      const encoded = Buffer.from(content, 'utf-8').toString('base64');

      const putRes = await ghFetch(`https://api.github.com/repos/${repoFullName}/contents/${filename}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: i === 0
            ? 'Export product spec from Idea Graph'
            : `Add ${filename}`,
          content: encoded,
        }),
      });

      if (!putRes.ok) {
        const putErr = await putRes.json().catch(() => ({}));
        console.error(`Failed to push ${filename}:`, putRes.status, putErr);
        if (putRes.status === 403) {
          throw new Error(`Permission denied. If using a fine-grained PAT, add "Contents" read & write permission. Or use a classic PAT with "repo" scope.`);
        }
        throw new Error(`Failed to push ${filename}: ${putErr.message || putRes.status}`);
      }
    }

    res.json({
      repoUrl: repo.html_url,
      repoFullName,
    });
  } catch (err) {
    console.error('GitHub export error:', err);
    res.status(500).json({ error: err.message || 'Failed to export to GitHub' });
  }
});

// ── POST /api/resume/changes ──────────────────────────────────
// Generates a precise change manifest from the debate output

const RESUME_CHANGES_PROMPT = `You are a precise resume editor. You have been given the candidate's original resume (as a PDF), job context, and a complete record of a debate between a hiring manager and career coach that identified specific improvements.

Your job: generate an actionable change manifest — a structured list of specific text changes to make to the resume, grounded in the debate findings.

**OUTPUT FORMAT — a single JSON object:**
{
  "summary": "string (2-3 sentences: what the debate revealed about the resume's main strengths and what needed the most work)",
  "changes": [
    {
      "id": "chg_1",
      "section": "string (e.g. 'Professional Summary', 'Work Experience — Acme Corp', 'Skills', 'Education')",
      "type": "strengthen_bullet" | "add_keyword" | "update_summary" | "add_bullet" | "reframe_role",
      "original": "string (4-12 words verbatim from the resume — distinctive enough to locate uniquely)",
      "replacement": "string (the improved text to use)",
      "category": "impact" | "keywords" | "match" | "gap" | "clarity" | "positioning",
      "reason": "string (1 sentence: what was weak and why this replacement is stronger)"
    }
  ]
}

**RULES FOR "original":**
- Must be a phrase that appears VERBATIM in the resume — do not paraphrase
- 4-12 words — short enough to match reliably, specific enough to appear only once
- For new additions (add_bullet, add_keyword): use the last 5-7 words of the section or preceding line as the anchor
- Never use the full bullet — just the first 6-8 words

**RULES FOR "replacement":**
- strengthen_bullet: full improved bullet with quantified metric (format: "[verb] [result] by [amount] via [method]")
- add_keyword: exact keyword phrase to add to Skills (ATS-optimized form from the JD)
- update_summary: complete rewritten summary paragraph
- add_bullet: the complete new bullet point to insert after "original"
- reframe_role: the improved job title or role description

**PRIORITY ORDER — address in this order:**
1. Missing ATS keywords from the JD (immediate screen-out risk)
2. Vague bullet points without metrics (unquantified claims get skipped)
3. Positioning / summary misalignment with the target role
4. Missing STAR stories or weak evidence for key requirements

Ground every change in what the debate identified — the hiring manager's specific critiques and the career coach's concrete recommendations. Each change should trace back to a specific debate finding.

Generate 6-15 high-impact changes. Output ONLY the JSON object. No markdown fences, no explanation.`;

app.post('/api/resume/changes', async (req, res) => {
  const { resumePdf, nodes, debateHistory, idea } = req.body;
  if (!nodes?.length) return res.status(400).json({ error: 'nodes required' });

  const historyText = (debateHistory || []).map((r) => `
Round ${r.round} — Hiring Manager Verdict: ${r.verdict}
Summary: ${r.summary || ''}
Critiques: ${JSON.stringify((r.critiques || []).map(c => ({ category: c.category, challenge: c.challenge, reasoning: c.reasoning, targetNode: c.targetNodeLabel })))}
Career Coach Responses: ${JSON.stringify((r.rebutNodes || []).map(n => ({ label: n.data?.label || n.label, reasoning: n.data?.reasoning || n.reasoning })))}
`).join('\n');

  const contentParts = [];

  if (resumePdf) {
    contentParts.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: resumePdf },
    });
  }

  contentParts.push({
    type: 'text',
    text: `Role / JD context: "${idea || 'target role'}"

Final resume strategy tree (${nodes.length} nodes — represents the full picture of what the resume should convey):
${JSON.stringify(nodes, null, 2)}

Debate history (${debateHistory?.length || 0} rounds — hiring manager critique + career coach responses):
${historyText || '(no debate history provided)'}

${resumePdf
  ? 'The PDF above is the candidate\'s current resume. Cross-reference it with the debate findings to generate the change manifest.'
  : 'No PDF resume was provided — generate changes based on the strategy tree and debate findings alone, framing them as recommendations rather than direct text replacements.'}

Generate the change manifest now.`,
  });

  try {
    const streamOptions = resumePdf ? { headers: { 'anthropic-beta': 'pdfs-2024-09-25' } } : undefined;
    const message = await client.messages.create(
      {
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        system: RESUME_CHANGES_PROMPT,
        messages: [{ role: 'user', content: contentParts }],
      },
      streamOptions
    );

    let text = message.content.find(b => b.type === 'text')?.text || '{}';
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error('Resume changes error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Shared fetch helpers ──────────────────────────────────────

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; IdeaGraphBot/1.0)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractInternalLinks(html, baseUrl) {
  const { origin } = new URL(baseUrl);
  const linkRegex = /<a[^>]+href=["']([^"'#]+)["']/gi;
  const seen = new Set();
  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const href = match[1];
      // Skip mailto, tel, javascript, anchors, external links, assets
      if (/^(mailto:|tel:|javascript:)/.test(href)) continue;
      const resolved = new URL(href, baseUrl).href.split('#')[0].split('?')[0];
      if (!resolved.startsWith(origin)) continue;
      if (seen.has(resolved)) continue;
      if (/\.(png|jpg|jpeg|gif|svg|css|js|ico|pdf|zip|mp4|webp|woff|ttf)$/i.test(resolved)) continue;
      seen.add(resolved);
      links.push(resolved);
    } catch { /* skip malformed URLs */ }
  }
  return links;
}

async function fetchPage(url, maxChars = 12000) {
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS });
    if (!response.ok) return null;
    const html = await response.text();
    const text = stripHtml(html).slice(0, maxChars);
    return { url, text, html };
  } catch {
    return null;
  }
}

// ── POST /api/fetch-url ────────────────────────────────────────
// Proxy-fetches a URL and returns stripped plain text (for JD scraping)

app.post('/api/fetch-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const result = await fetchPage(url);
    if (!result) throw new Error('Failed to fetch page');
    res.json({ text: result.text });
  } catch (err) {
    console.error('fetch-url error:', err.message);
    res.status(500).json({ error: `Failed to fetch URL: ${err.message}` });
  }
});

// ── POST /api/crawl-site ──────────────────────────────────────
// Crawls a website: fetches the root page, discovers internal links,
// then fetches the most important subpages. Returns all page content.

app.post('/api/crawl-site', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const MAX_PAGES = 8;
  const PER_PAGE_CHARS = 6000;

  try {
    // 1. Fetch the root page
    const root = await fetchPage(url, PER_PAGE_CHARS);
    if (!root) throw new Error('Failed to fetch root page');

    // 2. Extract internal links
    const internalLinks = extractInternalLinks(root.html, url);

    // 3. Prioritize important pages — common high-value paths first
    const priorityPatterns = [
      /\/(about|company|team)/i,
      /\/(solution|product|service|feature)/i,
      /\/(pricing|plan)/i,
      /\/(platform|technology|how-it-works)/i,
      /\/(integrat|partner|api)/i,
      /\/(case-stud|customer|testimonial|success)/i,
      /\/(blog|resource|whitepaper)/i,
      /\/(contact|demo|trial)/i,
    ];

    const scored = internalLinks.map(link => {
      let score = 0;
      for (const p of priorityPatterns) {
        if (p.test(link)) { score += 10; break; }
      }
      // Shorter paths tend to be more important top-level pages
      const pathDepth = (new URL(link).pathname.match(/\//g) || []).length;
      score -= pathDepth;
      return { link, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const topLinks = scored.slice(0, MAX_PAGES - 1).map(s => s.link);

    // 4. Fetch subpages in parallel
    const subResults = await Promise.all(topLinks.map(link => fetchPage(link, PER_PAGE_CHARS)));
    const pages = [
      { url: root.url, text: root.text },
      ...subResults.filter(Boolean).map(r => ({ url: r.url, text: r.text })),
    ];

    console.log(`crawl-site: fetched ${pages.length} pages from ${url}`);
    res.json({ pages });
  } catch (err) {
    console.error('crawl-site error:', err.message);
    res.status(500).json({ error: `Failed to crawl site: ${err.message}` });
  }
});

// ── POST /api/generate-multi (Multi-Agent: 3 Lenses + Merge) ─

const LENS_ANALOGICAL_PROMPT = SYSTEM_PROMPT + `

REASONING LENS: ANALOGICAL THINKING
Your approach: For this input, first identify the 2-3 most structurally similar existing systems, products, or solutions (from any domain). Map their architecture, user flows, and key decisions onto this idea. Your tree should be grounded in proven patterns — what worked elsewhere and how it translates here.

For each node, your reasoning should reference the specific analogy.

Mark every node with "lens": "analogical" in the JSON output.`;

const LENS_FIRST_PRINCIPLES_PROMPT = SYSTEM_PROMPT + `

REASONING LENS: FIRST-PRINCIPLES DECOMPOSITION
Your approach: Ignore existing solutions entirely. Decompose this idea to its fundamental truths — what are the atomic facts, constraints, and user needs? Then rebuild the solution from scratch based only on those fundamentals.

For each node, your reasoning should trace back to a fundamental truth.

Mark every node with "lens": "first_principles" in the JSON output.`;

const LENS_ADVERSARIAL_PROMPT = SYSTEM_PROMPT + `

REASONING LENS: ADVERSARIAL / FAILURE-MODE THINKING
Your approach: Start from the assumption that this idea will fail. Identify the 3-5 most likely failure modes, then work backwards — what would the idea need to look like to survive each failure mode? Your tree should be a pre-mortem turned into a solution.

For each node, your reasoning should reference the failure mode it defends against.

Mark every node with "lens": "adversarial" in the JSON output.`;

const MULTI_AGENT_MERGE_PROMPT = `You are a synthesis AI merging three independent analyses of the same idea into a single, unified thinking tree. Each analysis used a different reasoning lens:

1. **Analogical**: Drew on existing systems and products as structural templates
2. **First-principles**: Decomposed to fundamental truths and rebuilt from scratch
3. **Adversarial**: Started from failure modes and worked backwards to a resilient design

Your job: create a SINGLE coherent tree that takes the best insights from all three lenses. Rules:
- Output a _meta line first (same format as the individual analyses)
- Prefer nodes that appear (in different forms) across multiple lenses — these are convergent insights
- Include unique high-value nodes from any single lens if they add genuinely new dimensions
- Resolve contradictions by picking the more specific/actionable version
- Preserve the "lens" field on each node so the UI can show which lens(es) contributed
- If a node synthesizes insights from multiple lenses, use "lens": "synthesis"
- Target 18-25 nodes total (don't just concatenate — merge and synthesize)

Each node: {"id": "string", "parentId": "string|null", "type": "one of your declared types", "label": "string (max 8 words)", "reasoning": "string (1-2 sentences referencing which lens(es) informed this)", "relatedIds": [], "lens": "analogical|first_principles|adversarial|synthesis"}

Output rules: one JSON object per line. _meta line first, then nodes. No markdown, no arrays.`;

app.post('/api/generate-multi', async (req, res) => {
  let { idea, mode, fetchedUrlContent, templateGuidance } = req.body;
  if (!idea) return res.status(400).json({ error: 'idea is required' });

  sseHeaders(res);

  // Build the base user content (reuse logic from /api/generate)
  let baseUserContent;
  if (fetchedUrlContent?.length) {
    const userProvided = fetchedUrlContent.filter(u => !u.entityName);
    const enriched = fetchedUrlContent.filter(u => u.entityName);
    let contentBlock = '';
    if (userProvided.length) {
      contentBlock += 'CONTENT FROM USER-REFERENCED URLs:\n' +
        userProvided.map(u => `--- ${u.url} ---\n${u.text}`).join('\n\n');
    }
    if (enriched.length) {
      contentBlock += '\n\nAUTO-RESEARCHED CONTEXT:\n' +
        enriched.map(u => `--- ${u.entityName} (${u.url}) ---\n${u.text}`).join('\n\n');
    }
    baseUserContent = `USER'S REQUEST: "${idea}"\n\n${contentBlock}\n\nGenerate the thinking tree.`;
  } else {
    baseUserContent = `Analyze this input and generate the appropriate thinking tree:\n\n"${idea}"`;
  }

  if (templateGuidance?.length) {
    baseUserContent += `\n\nSTRUCTURAL TEMPLATES:\n${JSON.stringify(templateGuidance, null, 2)}`;
  }

  try {
    // Phase 1: Run 3 lenses in parallel
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Lens 1/3: Analogical thinking...' })}\n\n`);

    const lensPrompts = [
      { prompt: LENS_ANALOGICAL_PROMPT, name: 'analogical' },
      { prompt: LENS_FIRST_PRINCIPLES_PROMPT, name: 'first_principles' },
      { prompt: LENS_ADVERSARIAL_PROMPT, name: 'adversarial' },
    ];

    const lensResults = await Promise.all(lensPrompts.map(async (lens, i) => {
      const message = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        system: lens.prompt,
        messages: [{ role: 'user', content: baseUserContent }],
      });
      // Send progress after each lens completes
      if (i === 0) res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Lens 2/3: First-principles thinking...' })}\n\n`);
      if (i === 1) res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Lens 3/3: Adversarial thinking...' })}\n\n`);
      return message.content[0]?.text || '';
    }));

    // Phase 2: Merge
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Merging 3 perspectives into unified tree...' })}\n\n`);

    const mergeInput = lensResults.map((result, i) =>
      `=== ${lensPrompts[i].name.toUpperCase()} LENS OUTPUT ===\n${result}`
    ).join('\n\n');

    const mergeMessage = `Original idea: "${idea}"\n\nThree independent analyses to merge:\n\n${mergeInput}\n\nMerge these into a single unified tree. Output _meta line first, then nodes.`;

    const mergeStream = client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: MULTI_AGENT_MERGE_PROMPT,
      messages: [{ role: 'user', content: mergeMessage }],
    });

    await streamToSSE(res, mergeStream);
  } catch (err) {
    console.error('Multi-agent error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── Chat Companion ────────────────────────────────────────────

const CHAT_PERSONAS = {
  idea:     'You are a product strategist. Help the user turn their thinking tree into actionable outputs — proposals, emails, PRDs, pitch decks. Be specific, concise, and grounded in the tree analysis.',
  codebase: 'You are a senior software engineer. Help the user turn their codebase analysis into actionable outputs — technical specs, architecture docs, READMEs, migration plans. Be specific and grounded in the tree analysis.',
  resume:   'You are a career coach. Help the user turn their resume strategy tree into actionable outputs — cover letters, LinkedIn summaries, interview prep, and targeted resume bullets. Be specific and grounded in the tree analysis.',
  decision: 'You are a decision analyst. Help the user turn their decision tree into actionable outputs — decision briefs, pros/cons summaries, stakeholder emails, recommendation memos. Be specific and grounded in the tree analysis.',
  writing:  'You are a writing editor. Help the user turn their writing analysis tree into actionable outputs — blog posts, article outlines, social threads, essay drafts. Be specific and grounded in the tree analysis.',
  plan:     'You are a project manager. Help the user turn their project plan tree into actionable outputs — project plans, timelines, resource briefs, status updates. Be specific and grounded in the tree analysis.',
};

app.post('/api/chat', (req, res) => {
  const { messages, treeContext, idea, mode } = req.body;

  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'messages required' });
  }

  sseHeaders(res);

  const persona = CHAT_PERSONAS[mode] || CHAT_PERSONAS.idea;

  let systemPrompt = persona;
  if (treeContext) {
    systemPrompt += `\n\nThe user has generated the following thinking tree for their input "${idea || ''}":\n\n${treeContext}\n\nUse this tree as deep context. Reference specific nodes and insights when relevant. Your outputs should be grounded in this analysis.`;
  }

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });

  // Stream raw text chunks (not JSON nodes) for chat
  let started = false;
  stream.on('text', (text) => {
    started = true;
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
  });

  stream.on('finalMessage', () => {
    res.write('data: [DONE]\n\n');
    res.end();
  });

  stream.on('error', (err) => {
    console.error('Chat stream error:', err);
    if (!started) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
    res.end();
  });
});

// ── Expand Suggestion ─────────────────────────────────────────

const EXPAND_SUGGESTION_PROMPT = `You are a product thinking AI. You receive a suggestion from a debate critique round and a full existing tree. Your job:

1. FIRST, output a single "anchor" node that represents this suggestion, placed under the most appropriate existing parent node.
2. THEN, output 5-8 child nodes that expand on the suggestion — concrete sub-points, implementation details, metrics, constraints, or related features.

Output rules: one JSON object per line. No markdown, no explanations, no array wrappers.

Each node: {"id": "string", "parentId": "string", "type": "string", "label": "string (max 8 words)", "reasoning": "string (1-2 sentences)", "relatedIds": ["optional ids"]}

The FIRST node (the anchor) MUST have:
- parentId set to the id of the most relevant existing node in the tree
- An id starting with "sug_"
- A type that fits the suggestion's nature (feature, constraint, metric, insight, etc.)

All subsequent nodes MUST have parentId pointing to either the anchor node or another new node you created.
Use ids like "sug_1", "sug_detail_1", "sug_detail_2", etc.`;

app.post('/api/expand-suggestion', async (req, res) => {
  const { suggestion, idea, nodes, mode, dynamicTypes } = req.body;
  if (!suggestion) return res.status(400).json({ error: 'suggestion is required' });

  sseHeaders(res);

  const treeContext = (nodes || []).map(n =>
    `- [${n.type}] id="${n.id}" parentId="${n.parentId || 'null'}" label="${n.label}"`
  ).join('\n');

  const availableTypes = dynamicTypes?.length
    ? dynamicTypes.map(t => t.type).join(', ')
    : 'seed, problem, user_segment, job_to_be_done, feature, constraint, metric, insight';

  const userMessage = `Suggestion to expand: "${suggestion}"

Original idea: "${idea || ''}"
Mode: ${mode || 'idea'}

Available node types: ${availableTypes}

Existing tree:
${treeContext}

Place the suggestion under the most relevant existing node, then expand it with 5-8 child nodes.`;

  let prompt = EXPAND_SUGGESTION_PROMPT;
  if (dynamicTypes?.length) {
    const typeList = dynamicTypes.map(t => t.type).join(', ');
    prompt += `\n\nAvailable node types for this tree: ${typeList}`;
  }

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Expand suggestion error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── Health check ──────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
