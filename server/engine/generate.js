// ── Generate engine handlers ──────────────────────────────────

const {
  SYSTEM_PROMPT,
  RESUME_SYSTEM_PROMPT,
  LENS_ANALOGICAL_PROMPT,
  LENS_FIRST_PRINCIPLES_PROMPT,
  LENS_ADVERSARIAL_PROMPT,
  MULTI_AGENT_MERGE_PROMPT,
  REGENERATE_PROMPT,
  DRILL_PROMPT,
  FRACTAL_EXPAND_PROMPT,
  FRACTAL_SELECT_PROMPT,
} = require('./prompts');

const { sseHeaders, streamToSSE } = require('../utils/sse');
const { fetchPage, enrichEntities } = require('../utils/web');
const { planResearch, runResearchAgent, buildResearchBrief } = require('../utils/research');

// ── POST /api/generate ────────────────────────────────────────

async function handleGenerate(client, req, res) {
  let { idea, mode, steeringInstruction, existingNodes, jdText, resumePdf, fetchedUrlContent } = req.body;
  if (!idea && !jdText) return res.status(400).json({ error: 'idea or jdText is required' });

  sseHeaders(res);

  // ── Entity enrichment: auto-research companies/orgs mentioned in the input ──
  if (idea && !steeringInstruction && mode !== 'resume') {
    const existingUrls = (fetchedUrlContent || []).map(u => u.url);
    const entities = await enrichEntities(client, idea, existingUrls);
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
}

// ── POST /api/generate-multi (Multi-Agent: 3 Lenses + Merge) ─

async function handleGenerateMulti(client, req, res) {
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
}

// ── POST /api/generate-research ──────────────────────────────
// Deep research: 3 parallel agents investigate market/tech/audience, then generate tree

async function handleGenerateResearch(client, req, res) {
  let { idea, mode, fetchedUrlContent, templateGuidance } = req.body;
  if (!idea) return res.status(400).json({ error: 'idea is required' });

  sseHeaders(res);

  try {
    // Phase 0: Entity enrichment (reuse existing logic)
    const existingUrls = (fetchedUrlContent || []).map(u => u.url);
    const entities = await enrichEntities(client, idea, existingUrls);
    if (entities.length) {
      console.log('Research: entity enrichment found', entities.map(e => e.name));
      const enrichResults = await Promise.all(entities.map(async (e) => {
        const result = await fetchPage(e.url, 6000);
        return result ? { url: result.url, text: result.text, entityName: e.name } : null;
      }));
      const enriched = enrichResults.filter(Boolean);
      if (enriched.length) fetchedUrlContent = [...(fetchedUrlContent || []), ...enriched];
    }

    // Phase 1: Research planning
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Planning research strategy...' })}\n\n`);
    const existingContentStr = (fetchedUrlContent || [])
      .map(u => `${u.url}: ${u.text?.slice(0, 500)}`)
      .join('\n');
    const researchPlan = await planResearch(client, idea, existingContentStr);
    console.log('Research plan:', JSON.stringify(researchPlan, null, 2).slice(0, 500));

    // Phase 2: Parallel research agents
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Researching market, technology & audience...' })}\n\n`);

    const agentTypes = ['market', 'technology', 'audience'];
    const agentLabels = {
      market: 'Market research complete',
      technology: 'Technology research complete',
      audience: 'Audience research complete',
    };
    let completedCount = 0;

    const agentResults = await Promise.all(
      agentTypes.map(agentType =>
        runResearchAgent(client, agentType, researchPlan, existingContentStr).then(result => {
          completedCount++;
          res.write(`data: ${JSON.stringify({ _progress: true, stage: `${agentLabels[agentType]} (${completedCount}/3)...` })}\n\n`);
          return result;
        })
      )
    );

    // Phase 3: Build research brief
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Synthesizing research into thinking tree...' })}\n\n`);
    const researchBrief = buildResearchBrief(agentResults);

    // Phase 4: Generate tree with research context (streaming)
    let userContent;
    if (fetchedUrlContent?.length) {
      const userProvided = fetchedUrlContent.filter(u => !u.entityName);
      const enrichedUrls = fetchedUrlContent.filter(u => u.entityName);
      let contentBlock = '';
      if (userProvided.length) {
        contentBlock += 'CONTENT FROM USER-REFERENCED URLs:\n' +
          userProvided.map(u => `--- ${u.url} ---\n${u.text}`).join('\n\n');
      }
      if (enrichedUrls.length) {
        contentBlock += '\n\nAUTO-RESEARCHED CONTEXT:\n' +
          enrichedUrls.map(u => `--- ${u.entityName} (${u.url}) ---\n${u.text}`).join('\n\n');
      }
      userContent = `USER'S REQUEST: "${idea}"\n\n${contentBlock}\n\n${researchBrief}\n\nGenerate the thinking tree. Ground every node in the research findings above.`;
    } else {
      userContent = `Analyze this input and generate the appropriate thinking tree:\n\n"${idea}"\n\n${researchBrief}\n\nGenerate the thinking tree. Ground every node in the research findings above.`;
    }

    if (templateGuidance?.length) {
      userContent += `\n\nSTRUCTURAL TEMPLATES:\n${JSON.stringify(templateGuidance, null, 2)}`;
    }

    const stream = client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Research generation error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/regenerate ──────────────────────────────────────

async function handleRegenerate(client, req, res) {
  const { node, parentContext, dynamicTypes } = req.body;
  if (!node) return res.status(400).json({ error: 'node is required' });

  sseHeaders(res);

  // Build user message with ancestor chain for context
  const ancestors = (parentContext || []).map(
    (n) => `- [${n.type}] "${n.label}" (id: ${n.id})`
  ).join('\n');

  let userMessage = `Focus node to expand:\n- [${node.type}] "${node.label}" (id: ${node.id})\nReasoning: ${node.reasoning || 'N/A'}`;
  if (ancestors) {
    userMessage = `Ancestor chain (root → parent):\n${ancestors}\n\n${userMessage}`;
  }

  // Thread dynamic types if provided (adaptive mode)
  let systemPrompt = REGENERATE_PROMPT;
  if (dynamicTypes?.length) {
    const typeList = dynamicTypes.map(t => `${t.type} (${t.label})`).join(', ');
    systemPrompt += `\n\nAVAILABLE DYNAMIC TYPES for this tree: ${typeList}\nUse these types instead of the default product-thinking types listed above. You may also use "seed" if needed.`;
  }

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Regenerate error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/drill ──────────────────────────────────────────

async function handleDrill(client, req, res) {
  const { node, fullContext, dynamicTypes } = req.body;
  if (!node) return res.status(400).json({ error: 'node is required' });

  sseHeaders(res);

  // Build user message with full tree context
  const treeContext = (fullContext || []).map(
    (n) => `- [${n.type}] "${n.label}" (id: ${n.id}, parent: ${n.parentId || 'root'})`
  ).join('\n');

  let userMessage = `Focus node for deep-dive:\n- [${node.type}] "${node.label}" (id: ${node.id})\nReasoning: ${node.reasoning || 'N/A'}`;
  if (treeContext) {
    userMessage = `Full tree context:\n${treeContext}\n\n${userMessage}`;
  }

  // Thread dynamic types if provided (adaptive mode)
  let systemPrompt = DRILL_PROMPT;
  if (dynamicTypes?.length) {
    const typeList = dynamicTypes.map(t => `${t.type} (${t.label})`).join(', ');
    systemPrompt += `\n\nAVAILABLE DYNAMIC TYPES for this tree: ${typeList}\nUse these types instead of the default product-thinking types listed above. You may also use "seed" if needed.`;
  }

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Drill error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/fractal-expand ──────────────────────────────────

async function handleFractalExpand(client, req, res) {
  const { node, ancestorChain, dynamicTypes, treeSnapshot } = req.body;
  if (!node) return res.status(400).json({ error: 'node is required' });

  sseHeaders(res);

  // Build ancestor chain context
  const ancestors = (ancestorChain || []).map(
    (n) => `- [${n.type}] "${n.label}" (id: ${n.id})`
  ).join('\n');

  let userMessage = `Focus node to fractal-expand:\n- [${node.type}] "${node.label}" (id: ${node.id})\nReasoning: ${node.reasoning || 'N/A'}`;

  if (ancestors) {
    userMessage = `Ancestor chain (root → focus):\n${ancestors}\n\n${userMessage}`;
  }

  // Include tree snapshot to avoid duplicate concepts
  if (treeSnapshot?.length) {
    const snapshot = treeSnapshot.map(n => `[${n.type}] "${n.label}"`).join(', ');
    userMessage += `\n\nExisting tree concepts (DO NOT duplicate these): ${snapshot}`;
  }

  // Thread dynamic types if provided
  let systemPrompt = FRACTAL_EXPAND_PROMPT;
  if (dynamicTypes?.length) {
    const typeList = dynamicTypes.map(t => `${t.type} (${t.label})`).join(', ');
    systemPrompt += `\n\nAVAILABLE TYPES for this tree: ${typeList}\nUse these types for new nodes.`;
  }

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    await streamToSSE(res, stream);
  } catch (err) {
    console.error('Fractal expand error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// ── POST /api/fractal-select (autonomous mode) ───────────────

async function handleFractalSelect(client, req, res) {
  const { leafNodes, fullContext, idea } = req.body;
  if (!leafNodes?.length) return res.status(400).json({ error: 'leafNodes required' });

  try {
    const leafList = leafNodes.map(
      (n) => `- [${n.type}] "${n.label}" (id: ${n.id}) — ${n.reasoning || 'no reasoning'}`
    ).join('\n');

    const contextStr = (fullContext || []).map(
      (n) => `- [${n.type}] "${n.label}" (id: ${n.id}, parent: ${n.parentId || 'root'})`
    ).join('\n');

    const userMessage = `Original idea: "${idea || 'N/A'}"\n\nFull tree context:\n${contextStr}\n\nLeaf nodes (candidates for expansion):\n${leafList}\n\nSelect the one node with the highest depth potential.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: FRACTAL_SELECT_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = message.content[0]?.text || '{}';
    // Parse the JSON response
    const match = text.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { selectedNodeId: leafNodes[0].id, reasoning: 'Default selection' };
    res.json(result);
  } catch (err) {
    console.error('Fractal select error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  handleGenerate,
  handleGenerateMulti,
  handleGenerateResearch,
  handleRegenerate,
  handleDrill,
  handleFractalExpand,
  handleFractalSelect,
};
