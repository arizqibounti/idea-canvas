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

=== VIEWING & FILTERING ===
1. FILTER by type:  {"filter":{"types":["feature","constraint"]}}
2. FILTER by IDs:   {"filter":{"nodeIds":["node_abc","node_xyz"]}}
3. CLEAR filters:   {"clear":true}

=== CREATING NODES ===
4. ADD NODES:       {"addNodes":[{"id":"chat_1","type":"feature","label":"Payment Processing","reasoning":"Enables monetization","parentId":"seed"}]}

=== MULTI-NODE TOOLS (support optional scoping by types/nodeIds) ===
5. DEBATE:          {"debate":true}  — or scoped: {"debate":{"types":["feature"]}} or {"debate":{"nodeIds":["id1","id2"]}}
6. REFINE:          {"refine":true}  — 5-pass deep refine (completeness, logic, evidence, actionability, so-what). Scoped: {"refine":{"types":["tech_debt"]}}
7. PORTFOLIO:       {"portfolio":true} — or scoped: {"portfolio":{"types":["feature"]}} or {"portfolio":{"nodeIds":["id1"]}}
8. REFINE MORE:     {"refineMore":true}  — run another refine pass (2 more rounds)
9. PORTFOLIO MORE:  {"portfolioMore":true} — generate more portfolio alternatives
10. FRACTAL EXPAND: {"fractalExpand":{"rounds":3}}
11. SCORE NODES:    {"scoreNodes":true} — or scoped: {"scoreNodes":{"types":["feature"]}}

=== SINGLE-NODE TOOLS ===
12. DRILL:           {"drill":{"nodeId":"node_abc"}} — deep-dive: generates 12-15 child nodes exploring that node
13. EXPAND NODE:     {"expandNode":{"nodeId":"node_abc"}} — fractal expand a specific node into 5-8 children
14. EDIT NODE:       {"editNode":{"nodeId":"node_abc","label":"New Label","reasoning":"Updated reasoning","type":"feature"}} — edit label, reasoning, and/or type (all optional)
15. REGENERATE:      {"regenerateNode":{"nodeId":"node_abc"}} — re-generate a node with AI
16. STAR NODE:       {"starNode":{"nodeId":"node_abc"}} — toggle star/favorite on a node
17. DELETE NODE:     {"deleteNode":{"nodeId":"node_abc"}} — delete node, reparent its children to parent
18. DELETE BRANCH:   {"deleteBranch":{"nodeId":"node_abc"}} — delete node AND all its descendants

=== THINKING PATTERNS ===
19. RUN PATTERN:     {"executePattern":{"patternId":"adversarial"}} — or scoped to focused node: {"executePattern":{"patternId":"portfolio-explore","nodeId":"node_abc"}}
    Available patterns: adversarial (critique/respond loop), progressive-refine (research+strengthen), portfolio-explore (generate alternatives+score), diffusion-refine, expert-committee, evolutionary-search

=== MODE TOOLS ===
20. PROTOTYPE:       {"buildPrototype":true} — build interactive prototype from the tree
21. FEED TO IDEA:    {"feedToIdea":true} — or scoped: {"feedToIdea":{"types":["feature"]}}

=== EMAIL (requires Gmail connected) ===
22. SEND EMAIL:      {"sendEmail":{"to":"recipient@email.com","subject":"Subject line","body":"Email body text"}} — optional: cc, bcc
23. DRAFT EMAIL:     {"draftEmail":{"to":"recipient@email.com","subject":"Subject line","body":"Email body text"}} — creates draft without sending
24. REPLY TO THREAD: {"replyToThread":{"threadId":"...","body":"Reply text"}} — reply to the email thread currently loaded as context

=== SCHEDULING ===
22. SCHEDULE TASK:   {"scheduleTask":{"name":"Daily research update","type":"research","prompt":"Research latest AI developments","schedule":{"cron":"0 9 * * 1-5"},"sessionId":"CURRENT_SESSION","config":{"emailTo":"user@email.com"}}}
    Types: research (web research), refine (strengthen tree nodes), debate (critique tree), pipeline (chain: research→refine→summarize), custom
    "sessionId":"CURRENT_SESSION" links the task to the current session's tree — results update the tree and appear as notifications in chat
    "config.emailTo" sends results via email
    "config.steps" for pipeline type: ["research","refine","summarize"] (any combination)
    Cron format: minute hour day-of-month month day-of-week (e.g., "0 9 * * 1-5" = weekdays at 9am)
23. LIST TASKS:      {"listTasks":true} — show all scheduled tasks with status
24. RUN TASK NOW:    {"runTask":{"taskId":"..."}} — execute a task immediately

Rules for addNodes: id MUST start with "chat_", parentId must reference an existing node, type must be one of: seed, problem, user_segment, job_to_be_done, feature, constraint, metric, insight, component, api_endpoint, data_model, tech_debt, requirement, skill_match, skill_gap, achievement, keyword, story, positioning, critique, variable, synthesis, aggregation

${focusedNode ? `\n** FOCUSED NODE ACTIONS — The user has node "${focusedNode.label}" selected. When they say:
- "expand this" / "go deeper" / "drill into this" → drill with the focused nodeId "${focusedNode.id}"
- "edit this" / "change the label" → editNode with focused nodeId
- "delete this" / "remove this" → deleteNode with focused nodeId
- "regenerate" / "redo this node" → regenerateNode with focused nodeId
- "star this" / "favorite" → starNode with focused nodeId
- "run adversarial on this" / "critique this node" → executePattern scoped to focused nodeId
- "explore alternatives for this" → portfolio scoped to focused nodeId
- "what else could this be?" → portfolio scoped to focused nodeId
Always use "${focusedNode.id}" as the nodeId for these actions.` : ''}

WHEN TO USE ACTIONS (you MUST use them — these are TOOLS, not documents):
- "show me the features" / "only show X" → filter
- "add these to canvas" / "brainstorm features" → addNodes
- "clear filters" / "show all" / "reset" → clear
- "run a debate" / "critique this" / "stress test" → debate
- "refine this" / "audit this" / "ralph wiggum" / "deep audit" / "strengthen" → refine
- "generate portfolio" / "show alternatives" → portfolio
- "expand more" / "go deeper" / "fractal expand" → fractalExpand
- "score the nodes" / "rank these" → scoreNodes
- "drill into X" / "expand X" → drill
- "edit this node" / "change the label to..." → editNode
- "delete this" / "remove this node" → deleteNode or deleteBranch
- "regenerate this" / "redo" → regenerateNode
- "star this" / "favorite" → starNode
- "run adversarial" / "run portfolio exploration" → executePattern
- "build a prototype" → buildPrototype
- "feed to idea mode" → feedToIdea
- "send an email" / "email this to" / "draft an email" → sendEmail or draftEmail
- "reply to this email" / "respond to the thread" → replyToThread
- "schedule a task" / "every morning" / "daily at 9am" → scheduleTask
- "show my tasks" / "what's scheduled" → listTasks
- "run that task now" → runTask

WHEN NOT TO USE ACTIONS:
- Regular questions or explanations
- Writing documents like proposals, emails, PRDs, cover letters, tech specs

IMPORTANT: "portfolio", "debate", "refine", "score" are TOOL names, not documents. When the user says these words, TRIGGER THE TOOL via <<<ACTIONS>>>, do NOT write text about it.

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
