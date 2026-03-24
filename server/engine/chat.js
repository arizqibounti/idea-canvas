// ── Chat engine handler ───────────────────────────────────────

const { CHAT_PERSONAS } = require('./prompts');
const { sseHeaders, attachAbortSignal } = require('../utils/sse');
const integrationRegistry = require('../integrations/registry');
const ai = require('../ai/providers');

// ── POST /api/chat ────────────────────────────────────────────

function handleChat(_client, req, res) {
  const { messages, treeContext, idea, mode, emailThread, focusedNode, sessionFileContext } = req.body;

  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'messages required' });
  }

  sseHeaders(res);
  attachAbortSignal(req, res);

  const persona = CHAT_PERSONAS[mode] || CHAT_PERSONAS.idea;

  let systemPrompt = persona;

  // When a node is focused, put it FIRST in the prompt so it gets primary attention
  if (focusedNode) {
    systemPrompt += `\n\n**ACTIVE FOCUS — The user has selected this specific node on the canvas. Answer about THIS node unless they clearly ask about something else.**

FOCUSED NODE:
- Type: ${focusedNode.type}
- Label: "${focusedNode.label}"
- Reasoning: ${focusedNode.reasoning || '(none)'}

${focusedNode.subtreeCount > 1 ? `This node has ${focusedNode.subtreeCount - 1} descendant(s). Its subtree:\n${focusedNode.subtree}` : 'This node has no children yet.'}

When suggesting actions (debate, refine, expand, drill), scope them to this node. When the user asks a question, assume they're asking about this focused node and its subtree unless they explicitly reference something else.`;
  }

  if (treeContext) {
    const treeLabel = focusedNode ? 'BACKGROUND — The rest of the thinking tree' : `The user has generated the following thinking tree for their input "${idea || ''}"`;
    systemPrompt += `\n\n${treeLabel}:\n\n${treeContext}\n\n${focusedNode ? 'This is background context. The focused node above takes priority.' : 'Use this tree as deep context. Reference specific nodes and insights when relevant. Your outputs should be grounded in this analysis.'}`;

    // Graph interaction instructions
    systemPrompt += `\n\nIMPORTANT — TOOL & GRAPH INTERACTION CAPABILITY:

You can directly control the app by emitting a JSON action block. To do this, end your response with <<<ACTIONS>>> followed immediately by a JSON object (same line or next line). Do NOT wrap in code fences. The delimiter and JSON are hidden from the user.

AVAILABLE ACTIONS (can combine multiple in one JSON object):

1. FILTER by type:  {"filter":{"types":["feature","constraint"]}}
2. FILTER by IDs:   {"filter":{"nodeIds":["node_abc","node_xyz"]}}
3. CLEAR filters:   {"clear":true}
4. ADD NODES:       {"addNodes":[{"id":"chat_1","type":"feature","label":"Payment Processing","reasoning":"Enables monetization","parentId":"seed"}]}
5. DEBATE:          {"debate":true}  — or scoped: {"debate":{"types":["feature"]}} or {"debate":{"nodeIds":["id1","id2"]}}
6. REFINE:          {"refine":true}  — or scoped: {"refine":{"types":["tech_debt"]}}
7. PORTFOLIO:       {"portfolio":true} — or scoped: {"portfolio":{"types":["feature"]}} or {"portfolio":{"nodeIds":["id1"]}}
8. REFINE MORE:     {"refineMore":true}  — continue refining (another 2 rounds)
9. PORTFOLIO MORE:  {"portfolioMore":true} — generate more portfolio alternatives
10. FRACTAL EXPAND:  {"fractalExpand":{"rounds":3}}
11. SCORE NODES:     {"scoreNodes":true} — or scoped: {"scoreNodes":{"types":["feature"]}}
12. DRILL:          {"drill":{"nodeId":"node_abc"}}
13. FEED TO IDEA:   {"feedToIdea":true} — or scoped: {"feedToIdea":{"types":["feature"]}}

Rules for addNodes: id MUST start with "chat_", parentId must reference an existing node, type must be one of: seed, problem, user_segment, job_to_be_done, feature, constraint, metric, insight, component, api_endpoint, data_model, tech_debt, requirement, skill_match, skill_gap, achievement, keyword, story, positioning, critique, variable, synthesis, aggregation

SCOPING: Actions 5-9 accept optional scoping. If the user says "run debate on features" or "generate portfolio for these nodes", pass types or nodeIds to scope the action. If no scope mentioned, use the plain boolean form to run on the whole tree.

WHEN TO USE ACTIONS (you MUST use them — these are TOOLS, not documents):
- "show me the features" / "only show X" → filter
- "highlight nodes about Y" → filter with nodeIds
- "add these to canvas" / "brainstorm features" → addNodes
- "clear filters" / "show all" / "reset" → clear
- "run a debate" / "critique this" / "stress test" → debate
- "refine this" / "auto-refine" / "strengthen" → refine
- "do another round of refine" / "refine again" / "keep refining" / "more refining" → refineMore
- "generate portfolio" / "portfolio" / "show alternatives" / "compare strategies" → portfolio (this is a TOOL, NOT a text document — NEVER write a portfolio as text, ALWAYS use the action)
- "do another round of portfolio" / "more alternatives" / "generate more" / "more portfolio" → portfolioMore
- "expand more" / "go deeper" / "fractal expand" → fractalExpand
- "score the nodes" / "rank these" / "prioritize" → scoreNodes
- "drill into X" / "expand X" / "zoom into X" → drill
- "feed this into idea mode" / "switch to idea mode" / "take this to idea mode" → feedToIdea (bridges CODE tree into IDEA mode as seed context)

WHEN NOT TO USE ACTIONS:
- Regular questions or explanations
- Writing documents like proposals, emails, PRDs, cover letters, tech specs

IMPORTANT DISTINCTION: "portfolio", "debate", "refine", "score" are TOOL names, not documents. When the user says any of these words, they want you to TRIGGER THE TOOL via <<<ACTIONS>>>, not write text about it. For example:
- "generate a portfolio on features" → emit {"portfolio":{"types":["feature"]}} — do NOT write a portfolio as text
- "run a debate" → emit {"debate":true} — do NOT write a debate as text
- "score the nodes" → emit {"scoreNodes":true} — do NOT write scores as text

CRITICAL: You MUST emit the <<<ACTIONS>>> block for tool requests. Write a brief 1-2 sentence summary of what you're doing, then append the action block. Do NOT write long text responses for tool actions.`;
  }

  if (emailThread) {
    // Use hook mapping template from Gmail integration if available
    const gmailHooks = integrationRegistry.getHookMappings('gmail');
    if (gmailHooks?.chatTemplate) {
      systemPrompt += gmailHooks.chatTemplate(emailThread);
    } else {
      systemPrompt += `\n\nEMAIL CONTEXT — The user has connected an email thread for reference:\n\n${emailThread}\n\nUse this email thread as additional context. Reference specific messages, senders, or details when relevant.`;
    }
  }

  // Inject session file context
  if (sessionFileContext) {
    systemPrompt += `\n\n${sessionFileContext}`;
  }

  ai.stream({
    model: 'claude:sonnet',
    system: systemPrompt,
    maxTokens: 4096,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  }).then(({ stream }) => {
    // Stream raw text chunks (not JSON nodes) for chat
    let started = false;
    let ended = false;

    // Abort the stream when client disconnects
    res.on('close', () => {
      if (!ended) {
        ended = true;
        try { stream.abort(); } catch (e) { /* already done */ }
      }
    });

    stream.on('text', (text) => {
      if (ended) return;
      started = true;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    stream.on('finalMessage', () => {
      if (ended) return;
      ended = true;
      res.write('data: [DONE]\n\n');
      res.end();
    });

    stream.on('error', (err) => {
      if (ended) return;
      ended = true;
      console.error('Chat stream error:', err);
      if (!started) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      res.end();
    });
  }).catch(err => {
    console.error('Chat stream init error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });
}

module.exports = {
  handleChat,
};
