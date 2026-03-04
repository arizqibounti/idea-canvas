// ── Chat engine handler ───────────────────────────────────────

const { CHAT_PERSONAS } = require('./prompts');
const { sseHeaders } = require('../utils/sse');

// ── POST /api/chat ────────────────────────────────────────────

function handleChat(client, req, res) {
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
}

module.exports = {
  handleChat,
};
