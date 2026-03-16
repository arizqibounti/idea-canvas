// ── Node Tools: Split & Merge AI handlers ────────────────────
// Precision editing operations that use AI to transform nodes.

const { sseHeaders, streamToSSE } = require('../utils/sse');

// ── POST /api/split-node ──────────────────────────────────────
// Takes a single node and splits it into two more specific nodes.
async function handleSplitNode(client, req, res) {
  const { node, idea, mode } = req.body;
  if (!node?.label) return res.status(400).json({ error: 'node with label is required' });

  sseHeaders(res);

  const parentId = node.id || 'seed';
  const nodeType = node.type || 'feature';

  const prompt = `You are a precision editor for an AI thinking tree about: "${idea || 'general topic'}"

The user wants to SPLIT this node into two more specific, complementary nodes:

NODE TO SPLIT:
- Type: ${nodeType}
- Label: "${node.label}"
- Reasoning: "${node.reasoning || ''}"

Split this into exactly TWO nodes that together cover the same ground as the original but are each more specific and actionable. Each new node should be a distinct aspect of the original.

Output exactly 2 JSON objects, one per line. Each must have:
{"id": "split_1", "parentId": "${parentId}", "type": "${nodeType}", "label": "max 8 words", "reasoning": "2-3 sentences explaining this specific aspect"}
{"id": "split_2", "parentId": "${parentId}", "type": "${nodeType}", "label": "max 8 words", "reasoning": "2-3 sentences explaining this specific aspect"}

Output ONLY the two JSON lines, nothing else.`;

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    await streamToSSE(res, stream);
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    console.error('Split node error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Split failed' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

// ── POST /api/merge-nodes ─────────────────────────────────────
// Takes two nodes and synthesizes them into one.
async function handleMergeNodes(client, req, res) {
  const { nodes, idea, mode } = req.body;
  if (!nodes?.length || nodes.length < 2) return res.status(400).json({ error: 'two nodes required' });

  sseHeaders(res);

  const [n1, n2] = nodes;

  const prompt = `You are a precision editor for an AI thinking tree about: "${idea || 'general topic'}"

The user wants to MERGE these two nodes into a single synthesis node:

NODE 1:
- Type: ${n1.type || 'unknown'}
- Label: "${n1.label}"
- Reasoning: "${n1.reasoning || ''}"

NODE 2:
- Type: ${n2.type || 'unknown'}
- Label: "${n2.label}"
- Reasoning: "${n2.reasoning || ''}"

Create exactly ONE synthesis node that captures the essence and key insights of both nodes. The merged node should be more powerful than either individual node.

Output exactly 1 JSON object on a single line:
{"id": "merged_1", "parentIds": ["${n1.id}", "${n2.id}"], "type": "synthesis", "label": "max 8 words", "reasoning": "2-3 sentences synthesizing both perspectives"}

Output ONLY the JSON line, nothing else.`;

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    await streamToSSE(res, stream);
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    console.error('Merge nodes error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Merge failed' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

module.exports = { handleSplitNode, handleMergeNodes };
