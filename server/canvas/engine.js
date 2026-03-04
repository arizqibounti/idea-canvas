// ── A2UI Canvas Engine ────────────────────────────────────────
// Generates interactive HTML artifacts from thinking tree data.
// Each artifact is a self-contained HTML document rendered in an iframe.

const { v4: uuidv4 } = require('uuid');
const {
  CANVAS_LANDSCAPE_PROMPT,
  CANVAS_TIMELINE_PROMPT,
  CANVAS_DASHBOARD_PROMPT,
} = require('./prompts');

const { MOCKUP_PROMPT } = require('../engine/prompts');

const ARTIFACT_PROMPTS = {
  landscape: CANVAS_LANDSCAPE_PROMPT,
  timeline: CANVAS_TIMELINE_PROMPT,
  dashboard: CANVAS_DASHBOARD_PROMPT,
  mockup: MOCKUP_PROMPT,
};

// Node types that suggest each artifact type
const ARTIFACT_TRIGGERS = {
  landscape: ['competitor', 'market', 'data_point', 'comparison', 'alternative'],
  timeline: ['milestone', 'phase', 'plan', 'roadmap', 'timeline', 'step'],
  dashboard: ['metric', 'kpi', 'data_point', 'target', 'goal'],
  mockup: ['feature', 'ui', 'screen', 'interaction', 'workflow'],
};

// Determine which artifacts can be auto-generated from a set of nodes
function detectArtifactTypes(nodes) {
  const nodeTypes = nodes.map(n => (n.type || n.data?.type || '').toLowerCase());
  const nodeLabels = nodes.map(n => (n.label || n.data?.label || '').toLowerCase());
  const allText = [...nodeTypes, ...nodeLabels].join(' ');

  const detected = [];
  for (const [artifactType, triggers] of Object.entries(ARTIFACT_TRIGGERS)) {
    const matches = triggers.filter(t =>
      nodeTypes.includes(t) || allText.includes(t)
    );
    if (matches.length >= 1) {
      detected.push({ type: artifactType, confidence: Math.min(matches.length / 2, 1) });
    }
  }

  return detected.sort((a, b) => b.confidence - a.confidence);
}

// Generate a single canvas artifact
async function generateCanvasArtifact(client, artifactType, nodes, idea) {
  const prompt = ARTIFACT_PROMPTS[artifactType];
  if (!prompt) throw new Error(`Unknown artifact type: ${artifactType}`);

  const nodesSummary = nodes.map(n => ({
    type: n.type || n.data?.type,
    label: n.label || n.data?.label,
    reasoning: n.reasoning || n.data?.reasoning,
    parentId: n.parentId || n.data?.parentId,
  }));

  const userMessage = `IDEA/CONTEXT: "${idea}"

THINKING TREE DATA (${nodes.length} nodes):
${JSON.stringify(nodesSummary, null, 2)}

Generate the interactive HTML visualization now. Output ONLY the HTML — no markdown, no explanation.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: prompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  let html = message.content[0]?.text || '';
  html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html') && !html.startsWith('<HTML')) {
    throw new Error('Model did not return valid HTML');
  }

  const TITLES = {
    landscape: 'Competitive Landscape',
    timeline: 'Roadmap Timeline',
    dashboard: 'Metrics Dashboard',
    mockup: 'Feature Mockup',
  };

  return {
    id: uuidv4(),
    type: artifactType,
    title: TITLES[artifactType] || artifactType,
    html,
    generatedAt: new Date().toISOString(),
  };
}

// Handler for POST /api/canvas/generate (REST) and WebSocket canvas:generate
async function handleCanvasGenerate(client, req, res) {
  const { artifactType, nodes, idea } = req.body;

  if (!artifactType) return res.status(400).json({ error: 'artifactType is required' });
  if (!nodes?.length) return res.status(400).json({ error: 'nodes are required' });

  try {
    const artifact = await generateCanvasArtifact(client, artifactType, nodes, idea);
    res.json(artifact);
  } catch (err) {
    console.error('Canvas generate error:', err);
    res.status(500).json({ error: err.message });
  }
}

// Auto-generate artifacts after tree generation completes
async function autoGenerateArtifacts(client, nodes, idea) {
  const detected = detectArtifactTypes(nodes);
  if (!detected.length) return [];

  // Generate top 2 most confident artifact types in parallel
  const toGenerate = detected.slice(0, 2);
  const results = await Promise.allSettled(
    toGenerate.map(d => generateCanvasArtifact(client, d.type, nodes, idea))
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

module.exports = {
  detectArtifactTypes,
  generateCanvasArtifact,
  handleCanvasGenerate,
  autoGenerateArtifacts,
};
