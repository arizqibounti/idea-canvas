// ── Idea Canvas Gateway ─────────────────────────────────────
// Slim entrypoint: Express setup, route mounting, server start.
// All logic lives in engine/, gateway/, canvas/, utils/ modules.

// Load .env if present
require('fs').existsSync(__dirname + '/.env') && require('fs').readFileSync(__dirname + '/.env', 'utf8').split('\n').forEach(line => { const [k, ...v] = line.split('='); if (k && v.length) process.env[k.trim()] = v.join('=').trim(); });

// Polyfill fetch + Headers for Node 16
const nodeFetch = require('node-fetch');
if (!globalThis.fetch) globalThis.fetch = nodeFetch;
if (!globalThis.Headers) globalThis.Headers = nodeFetch.Headers;
if (!globalThis.Request) globalThis.Request = nodeFetch.Request;
if (!globalThis.Response) globalThis.Response = nodeFetch.Response;

const path = require('path');
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const { requireAuth, optionalAuth } = require('./middleware/auth');
const { generationLimit, generalLimit, getGenerationCount, GENERATION_LIMIT } = require('./middleware/rateLimit');
const usage = require('./gateway/usage');

const app = express();
const PORT = process.env.PORT || 5001;

// CORS: restrict origins in production, allow all in dev
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null; // null = allow all (dev mode)
app.use(cors(allowedOrigins ? { origin: allowedOrigins, credentials: true } : undefined));
app.use(express.json({ limit: '10mb' }));

const client = new Anthropic();

// ── Engine handlers ──────────────────────────────────────────

const { handleGenerate, handleGenerateMulti, handleGenerateResearch, handleRegenerate, handleDrill, handleFractalExpand, handleFractalSelect } = require('./engine/generate');
const { handleDebateCritique, handleDebateRebut, handleDebateFinalize, handleExpandSuggestion } = require('./engine/debate');
const { handleScoreNodes, handleExtractTemplate, handleAnalyzeCodebase, handleReflect, handleCritique } = require('./engine/analyze');
const { handleChat } = require('./engine/chat');
const { handleMockup, handleResumeChanges, handleExportGithub, handleFetchUrl, handleCrawlSite } = require('./engine/specialty');

// ── Canvas engine ───────────────────────────────────────────
const { handleCanvasGenerate } = require('./canvas/engine');

// ── Gateway (WebSocket + Sessions) ──────────────────────────
const { initWebSocket } = require('./gateway/websocket');
const { initYjsWebSocket } = require('./yjs/yjsServer');
const sessions = require('./gateway/sessions');
const shares = require('./gateway/shares');

// ── Public Routes (no auth needed) ──────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Share links require auth + allowlist in production (locked down)
app.get('/api/shares/:id', requireAuth, async (req, res) => {
  try {
    const share = await shares.loadShare(req.params.id);
    if (!share) return res.status(404).json({ error: 'Share not found' });
    if (share.expired) return res.status(410).json({ error: 'Share link has expired', share });
    res.json(share);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── All routes below require authentication ─────────────────────
app.use('/api', requireAuth);
app.use('/api', generalLimit);

// ── Usage endpoint ──────────────────────────────────────────────
app.get('/api/usage', async (req, res) => {
  try {
    const u = await usage.getUsage(req.user.uid);
    const inMemory = getGenerationCount(req.user.uid);
    res.json({
      generationsToday: Math.max(u.generationsToday, inMemory.used),
      totalGenerations: u.totalGenerations || 0,
      limit: GENERATION_LIMIT.max,
      remaining: Math.max(0, GENERATION_LIMIT.max - Math.max(u.generationsToday, inMemory.used)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Core generation (rate-limited: expensive AI calls)
app.post('/api/generate',          generationLimit, (req, res) => handleGenerate(client, req, res));
app.post('/api/generate-multi',    generationLimit, (req, res) => handleGenerateMulti(client, req, res));
app.post('/api/generate-research', generationLimit, (req, res) => handleGenerateResearch(client, req, res));
app.post('/api/regenerate',        generationLimit, (req, res) => handleRegenerate(client, req, res));
app.post('/api/drill',             generationLimit, (req, res) => handleDrill(client, req, res));
app.post('/api/fractal-expand',    generationLimit, (req, res) => handleFractalExpand(client, req, res));
app.post('/api/fractal-select',    (req, res) => handleFractalSelect(client, req, res));

// Analysis & evaluation
app.post('/api/score-nodes',       (req, res) => handleScoreNodes(client, req, res));
app.post('/api/extract-template',  (req, res) => handleExtractTemplate(client, req, res));
app.post('/api/analyze-codebase',  generationLimit, (req, res) => handleAnalyzeCodebase(client, req, res));
app.post('/api/reflect',           (req, res) => handleReflect(client, req, res));
app.post('/api/critique',          (req, res) => handleCritique(client, req, res));

// Debate (rate-limited: expensive AI calls)
app.post('/api/debate/critique',   generationLimit, (req, res) => handleDebateCritique(client, req, res));
app.post('/api/debate/rebut',      generationLimit, (req, res) => handleDebateRebut(client, req, res));
app.post('/api/debate/finalize',   generationLimit, (req, res) => handleDebateFinalize(client, req, res));
app.post('/api/expand-suggestion', (req, res) => handleExpandSuggestion(client, req, res));

// Specialty
app.post('/api/mockup',            (req, res) => handleMockup(client, req, res));
app.post('/api/resume/changes',    (req, res) => handleResumeChanges(client, req, res));
app.post('/api/export/github',     (req, res) => handleExportGithub(client, req, res));

// Utilities
app.post('/api/fetch-url',         (req, res) => handleFetchUrl(client, req, res));
app.post('/api/crawl-site',        (req, res) => handleCrawlSite(client, req, res));

// Chat
app.post('/api/chat',              (req, res) => handleChat(client, req, res));

// Canvas artifacts
app.post('/api/canvas/generate',   generationLimit, (req, res) => handleCanvasGenerate(client, req, res));

// ── Session REST endpoints (user-scoped) ──────────────────────
app.get('/api/sessions', async (req, res) => {
  try {
    const list = await sessions.listSessions(req.user.uid, parseInt(req.query.limit) || 20);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await sessions.loadSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await sessions.deleteSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Share REST endpoints ──────────────────────────────────────
app.post('/api/shares', async (req, res) => {
  try {
    const { idea, nodes, mode, meta, permission, expiresInHours } = req.body;
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return res.status(400).json({ error: 'nodes array is required' });
    }
    const share = await shares.createShare({
      idea,
      nodes,
      mode: mode || 'idea',
      meta: meta || null,
      permission: permission || 'interact',
      expiresInHours: expiresInHours || 0,
      createdBy: req.user.uid,
    });
    res.json(share);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/shares/:id', async (req, res) => {
  try {
    await shares.deleteShare(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Static file serving (production) ────────────────────────

const clientBuildPath = path.join(__dirname, '..', 'client', 'build');
if (require('fs').existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(clientBuildPath, 'index.html'));
    }
  });
}

// ── Start server ─────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`Gateway running on port ${PORT}`);
});

// ── Attach WebSocket Gateway ────────────────────────────────
const engineHandlers = {
  handleGenerate,
  handleGenerateMulti,
  handleGenerateResearch,
  handleDebateCritique,
  handleDebateRebut,
  handleDebateFinalize,
  handleExpandSuggestion,
  handleScoreNodes,
  handleExtractTemplate,
  handleCritique,
  handleChat,
  handleMockup,
  handleCanvasGenerate,
};

initWebSocket(server, client, engineHandlers);
initYjsWebSocket(server);

module.exports = { app, server, client };
