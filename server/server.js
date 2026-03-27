// ── Idea Canvas Gateway ─────────────────────────────────────
// Slim entrypoint: Express setup, route mounting, server start.
// All logic lives in engine/, gateway/, canvas/, utils/ modules.

// Load .env if present
require('fs').existsSync(__dirname + '/.env') && require('fs').readFileSync(__dirname + '/.env', 'utf8').split('\n').forEach(line => { const [k, ...v] = line.split('='); if (k && v.length) process.env[k.trim()] = v.join('=').trim(); });

// Prevent unhandled rejections from crashing the server
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err?.message || err);
  // Don't exit — keep serving other requests
});

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
const { GoogleGenAI } = require('@google/genai');

const { requireAuth, optionalAuth } = require('./middleware/auth');
const { generationLimit, generalLimit, getGenerationCount, getGenerationLimitForUser, GENERATION_LIMIT } = require('./middleware/rateLimit');
const usage = require('./gateway/usage');

const app = express();
const PORT = process.env.PORT || 5001;

// CORS: restrict origins in production, allow all in dev
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null; // null = allow all (dev mode)
app.use(cors(allowedOrigins ? { origin: allowedOrigins, credentials: true } : undefined));

// ── Stripe webhook (raw body, BEFORE express.json) ───────────
const billing = require('./gateway/billing');
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const event = billing.constructWebhookEvent(req.body, sig);
    await billing.handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.use(express.json({ limit: '10mb' }));

// ── AI Provider Abstraction ─────────────────────────────────
const { initProviders, getClaude, getGemini } = require('./ai/providers');
const { claude: _providerClaude, gemini: _providerGemini } = initProviders();

// Backward-compatible aliases — existing engine handlers use `client` and `gemini`
const client = _providerClaude;
const gemini = _providerGemini;

// ── Engine handlers ──────────────────────────────────────────

const { handleGenerate, handleGenerateMulti, handleGenerateResearch, handleRegenerate, handleDrill, handleFractalExpand, handleFractalSelect } = require('./engine/generate');
const { handleDebateCritique, handleDebateRebut, handleDebateFinalize, handleExpandSuggestion } = require('./engine/debate');
const { handleScoreNodes, handleExtractTemplate, handleAnalyzeCodebase, handleReflect, handleCritique } = require('./engine/analyze');
const { handleChat } = require('./engine/chat');
const { handleMockup, handleResumeChanges, handleExportGithub, handleFetchUrl, handleCrawlSite } = require('./engine/specialty');
const { handlePrototypeBuild, handlePrototypeRegenScreen } = require('./engine/prototype');
const { handleForestDecompose, handleForestGenerateAll, handleForestGenerate, handleForestCritique } = require('./engine/forest');

// ── Auto-refine + Portfolio engines ──────────────────────────
const { handleRefineCritique, handleRefineStrengthen, handleRefineScore } = require('./engine/refine');
const { handlePortfolioGenerate, handlePortfolioScore } = require('./engine/portfolio');
const { handleSplitNode, handleMergeNodes } = require('./engine/nodeTools');

// ── Node action execution engine ─────────────────────────────
const { handleExecuteAction, stopExecution } = require('./engine/execute');

// ── Canvas engine ───────────────────────────────────────────
const { handleCanvasGenerate } = require('./canvas/engine');

// ── Gateway (WebSocket + Sessions) ──────────────────────────
const { initWebSocket } = require('./gateway/websocket');
const { initYjsWebSocket } = require('./yjs/yjsServer');
const sessions = require('./gateway/sessions');
const forestsGw = require('./gateway/forests');
const shares = require('./gateway/shares');
const users = require('./gateway/users');
const workspaces = require('./gateway/workspaces');
const { resolveWorkspace, requireRole } = require('./middleware/workspace');

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

// ── OAuth callbacks (public — no auth, redirected from external providers) ──
app.get('/api/integrations/github/callback', (req, res) => {
  const integration = require('./integrations/registry').get('github');
  if (!integration) return res.status(404).send('GitHub not configured');
  const { code, state } = req.query;
  integration.handleCallback(code, state)
    .then(result => {
      res.send(`<html><body><script>window.opener?.postMessage({type:'github-connected',username:'${(result.username||'').replace(/'/g,"\\'")}'},'*');window.close();</script>Connected as @${result.username}. You can close this window.</body></html>`);
    })
    .catch(err => res.status(400).send(`GitHub auth failed: ${err.message}`));
});
app.get('/api/integrations/gmail/callback', (req, res) => {
  const integration = require('./integrations/registry').get('gmail');
  if (!integration) return res.status(404).send('Gmail not configured');
  const { code, state } = req.query;
  integration.handleCallback(code, state)
    .then(result => {
      res.send(`<html><body><script>window.opener?.postMessage({type:'gmail-connected',email:'${(result.email||'').replace(/'/g,"\\'")}'},'*');window.close();</script>Connected. You can close this window.</body></html>`);
    })
    .catch(err => res.status(400).send(`Gmail auth failed: ${err.message}`));
});

// ── All routes below require authentication ─────────────────────
app.use('/api', requireAuth);
// generalLimit disabled during dev — re-enable for production
// app.use('/api', generalLimit);

// ── Prompt Admin API ────────────────────────────────────────────
app.use('/api/prompt-improve', require('./routes/promptImprove'));
app.use('/api/prompts', require('./routes/prompts'));

// ── Pattern Admin API + Execution ──────────────────────────────
app.use('/api/patterns', require('./routes/patterns'));
const { handlePatternExecute, handlePatternResume, handlePatternExecuteStage, handlePatternRecommend, handlePatternRecommendNext, handlePatternGenerate, handlePatternAutoGenerate } = require('./engine/patternHandler');
app.post('/api/pattern/execute', generationLimit, (req, res) => handlePatternExecute(client, req, res));
app.post('/api/pattern/resume', (req, res) => handlePatternResume(client, req, res));
app.post('/api/pattern/execute-stage', (req, res) => handlePatternExecuteStage(client, req, res));
app.post('/api/pattern/recommend', (req, res) => handlePatternRecommend(client, req, res));
app.post('/api/pattern/recommend-next', (req, res) => handlePatternRecommendNext(client, req, res));
app.post('/api/pattern/generate', generationLimit, (req, res) => handlePatternGenerate(client, req, res));
app.post('/api/pattern/auto-generate', generationLimit, (req, res) => handlePatternAutoGenerate(client, req, res));

// ── Usage endpoint ──────────────────────────────────────────────
app.get('/api/usage', async (req, res) => {
  try {
    const u = await usage.getUsage(req.user.uid);
    const planLimit = getGenerationLimitForUser(req.user);
    const inMemory = getGenerationCount(req.user.uid, req.user.plan);
    const used = Math.max(u.generationsToday, inMemory.used);
    res.json({
      generationsToday: used,
      totalGenerations: u.totalGenerations || 0,
      limit: planLimit.max,
      remaining: Math.max(0, planLimit.max - used),
      plan: req.user.plan || 'free',
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
const { handleAnalyzeGithub } = require('./engine/github');
app.post('/api/analyze-github',   generationLimit, (req, res) => handleAnalyzeGithub(client, req, res));
app.post('/api/reflect',           (req, res) => handleReflect(client, req, res));
app.post('/api/critique',          (req, res) => handleCritique(client, req, res));

// Debate (rate-limited: expensive AI calls)
app.post('/api/debate/critique',   generationLimit, (req, res) => handleDebateCritique(client, req, res, gemini));
app.post('/api/debate/rebut',      generationLimit, (req, res) => handleDebateRebut(client, req, res, gemini));
app.post('/api/debate/finalize',   generationLimit, (req, res) => handleDebateFinalize(client, req, res, gemini));
app.post('/api/expand-suggestion', (req, res) => handleExpandSuggestion(client, req, res));

// Auto-refine (critique/score lightweight, strengthen rate-limited)
app.post('/api/refine/critique',    (req, res) => handleRefineCritique(client, req, res));
app.post('/api/refine/strengthen',  generationLimit, (req, res) => handleRefineStrengthen(client, req, res));
app.post('/api/refine/score',       (req, res) => handleRefineScore(client, req, res));

// Portfolio (generate rate-limited, score lightweight) — uses Gemini
app.post('/api/portfolio/generate', generationLimit, (req, res) => handlePortfolioGenerate(client, req, res, gemini));
app.post('/api/portfolio/score',    (req, res) => handlePortfolioScore(client, req, res, gemini));

// Learn mode (probe/evaluate lightweight, adapt rate-limited)
const { handleLearnTeach, handleLearnProbe, handleLearnEvaluate, handleLearnAdapt, handleLearnSocratic } = require('./engine/learn');
app.post('/api/learn/teach',      (req, res) => handleLearnTeach(client, req, res));
app.post('/api/learn/probe',       (req, res) => handleLearnProbe(client, req, res));
app.post('/api/learn/evaluate',    (req, res) => handleLearnEvaluate(client, req, res));
app.post('/api/learn/adapt',       generationLimit, (req, res) => handleLearnAdapt(client, req, res));
app.post('/api/learn/socratic',    (req, res) => handleLearnSocratic(client, req, res));

// Mnemonic video (generate rate-limited, poll lightweight) — uses Gemini Veo 3
const { handleMnemonicGenerate, handleMnemonicPoll } = require('./engine/mnemonic');
app.post('/api/learn/mnemonic/generate', generationLimit, (req, res) => handleMnemonicGenerate(client, req, res, gemini));
app.post('/api/learn/mnemonic/poll',     (req, res) => handleMnemonicPoll(req, res, gemini));

// Experiment (mutate rate-limited, score/analyze lightweight)
const { handleExperimentMutate, handleExperimentScore, handleExperimentAnalyze } = require('./engine/experiment');
app.post('/api/experiment/mutate',  generationLimit, (req, res) => handleExperimentMutate(client, req, res));
app.post('/api/experiment/score',   (req, res) => handleExperimentScore(client, req, res, gemini));
app.post('/api/experiment/analyze', (req, res) => handleExperimentAnalyze(client, req, res));

// Node tools (split/merge)
app.post('/api/split-node',  generationLimit, (req, res) => handleSplitNode(client, req, res));
app.post('/api/merge-nodes', generationLimit, (req, res) => handleMergeNodes(client, req, res));

// Specialty
app.post('/api/mockup',            (req, res) => handleMockup(client, req, res));
app.post('/api/prototype/build',   generationLimit, (req, res) => handlePrototypeBuild(client, req, res));
app.post('/api/prototype/regen-screen', (req, res) => handlePrototypeRegenScreen(client, req, res));
app.post('/api/resume/changes',    (req, res) => handleResumeChanges(client, req, res));
app.post('/api/export/github',     (req, res) => handleExportGithub(client, req, res));

// Utilities
app.post('/api/fetch-url',         (req, res) => handleFetchUrl(client, req, res));
app.post('/api/crawl-site',        (req, res) => handleCrawlSite(client, req, res));

// Chat
app.post('/api/chat',              (req, res) => handleChat(client, req, res));
app.post('/api/execute-action',    (req, res) => handleExecuteAction(client, req, res));
app.post('/api/stop-execution',    (req, res) => { const stopped = stopExecution(); res.json({ stopped }); });

// ── Integration System (pattern: openclaw plugin registry) ───
// Register integrations, init on start, mount routes.
require('./integrations/gmail'); // Self-registers with registry
require('./integrations/claude-code'); // Self-registers with registry
require('./integrations/github'); // Self-registers with registry
require('./integrations/github'); // Self-registers with registry
const integrationRegistry = require('./integrations/registry');
const { mountIntegrationRoutes } = require('./integrations/routes');
mountIntegrationRoutes(app);
const { mountSchedulerRoutes } = require('./engine/scheduler');
mountSchedulerRoutes(app);

// Canvas artifacts
app.post('/api/canvas/generate',   generationLimit, (req, res) => handleCanvasGenerate(client, req, res));

// Zettelkasten knowledge graph
const knowledge = require('./gateway/knowledge');
app.get('/api/knowledge/clusters', async (req, res) => {
  try {
    const userId = req.user?.uid || 'local';
    const clusters = await knowledge.getNodeClusters(userId);
    res.json(clusters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/knowledge/similar', async (req, res) => {
  try {
    const userId = req.user?.uid || 'local';
    const { tags } = req.body;
    if (!tags?.length) return res.json([]);
    const similar = await knowledge.findSimilar(userId, tags, 10);
    res.json(similar);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── User Profile endpoints ──────────────────────────────────
app.get('/api/me', async (req, res) => {
  try {
    const profile = await users.getUser(req.user.uid);
    if (!profile) return res.status(404).json({ error: 'User not found' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/me', async (req, res) => {
  try {
    const { name, photoURL } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (photoURL !== undefined) updates.photoURL = photoURL;
    await users.updateUser(req.user.uid, updates);
    const profile = await users.getUser(req.user.uid);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workspace endpoints ──────────────────────────────────────
app.get('/api/workspaces', async (req, res) => {
  try {
    const list = await workspaces.listUserWorkspaces(req.user.uid);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workspaces', async (req, res) => {
  try {
    if (req.user.plan !== 'pro') {
      return res.status(403).json({ error: 'Pro plan required to create additional workspaces' });
    }
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Workspace name is required' });
    const ws = await workspaces.createWorkspace(name.trim(), null, req.user.uid, false);
    res.json(ws);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspaces/:workspaceId', resolveWorkspace, async (req, res) => {
  res.json(req.workspace);
});

app.put('/api/workspaces/:workspaceId', resolveWorkspace, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, settings } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (settings !== undefined) updates.settings = settings;
    await workspaces.updateWorkspace(req.params.workspaceId, updates);
    const ws = await workspaces.getWorkspace(req.params.workspaceId);
    res.json(ws);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workspace Members endpoints ──────────────────────────────
const invitations = require('./gateway/invitations');

app.get('/api/workspaces/:workspaceId/members', resolveWorkspace, async (req, res) => {
  try {
    const members = await workspaces.listMembers(req.params.workspaceId);
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workspaces/:workspaceId/members/invite', resolveWorkspace, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { email, role } = req.body;
    const inv = await invitations.createInvitation(req.params.workspaceId, email, role || 'member', req.user.uid);
    const baseUrl = req.headers.origin || 'https://thoughtclaw.com';
    res.json({ ...inv, inviteUrl: `${baseUrl}/invite/${inv.token}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/workspaces/:workspaceId/members/:userId/role', resolveWorkspace, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'member', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    // Can't change the owner's role
    const target = await workspaces.getWorkspaceMember(req.params.workspaceId, req.params.userId);
    if (target?.role === 'owner') return res.status(403).json({ error: 'Cannot change owner role' });
    await workspaces.updateMemberRole(req.params.workspaceId, req.params.userId, role);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workspaces/:workspaceId/members/:userId', resolveWorkspace, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const target = await workspaces.getWorkspaceMember(req.params.workspaceId, req.params.userId);
    if (target?.role === 'owner') return res.status(403).json({ error: 'Cannot remove workspace owner' });
    await workspaces.removeMember(req.params.workspaceId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspaces/:workspaceId/invitations', resolveWorkspace, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const pending = await invitations.listPendingInvitations(req.params.workspaceId);
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workspaces/:workspaceId/invitations/:id', resolveWorkspace, requireRole('owner', 'admin'), async (req, res) => {
  try {
    await invitations.revokeInvitation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Invitation acceptance (no workspace context needed) ──────
app.get('/api/invitations/check', async (req, res) => {
  try {
    const inv = await invitations.getInvitationByToken(req.query.token);
    if (!inv) return res.status(404).json({ error: 'Invalid or expired invitation' });
    const ws = await workspaces.getWorkspace(inv.workspaceId);
    res.json({ workspaceName: ws?.name, role: inv.role, email: inv.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invitations/accept', async (req, res) => {
  try {
    const inv = await invitations.acceptInvitation(req.body.token, req.user.uid);
    res.json({ workspaceId: inv.workspaceId, role: inv.role });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Billing endpoints ────────────────────────────────────────
app.post('/api/billing/checkout', async (req, res) => {
  try {
    const result = await billing.createCheckoutSession(req.user, req.body.workspaceId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/billing/portal', async (req, res) => {
  try {
    const result = await billing.createPortalSession(req.user);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/billing/status', async (req, res) => {
  try {
    const status = await billing.getBillingStatus(req.user);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// ── Chat messages persistence ─────────────────────────────────
app.put('/api/sessions/:id/chat', async (req, res) => {
  try {
    const { chatMessages } = req.body;
    if (!chatMessages) return res.status(400).json({ error: 'chatMessages required' });
    await sessions.updateSession(req.params.id, { chatMessages });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Session Files endpoints ───────────────────────────────────
const sessionFiles = require('./engine/sessionFiles');

// Upload files to a session
app.post('/api/sessions/:sessionId/files', sessionFiles.upload.array('files', 10), async (req, res) => {
  try {
    const results = [];
    for (const file of (req.files || [])) {
      const record = await sessionFiles.addSessionFile(req.params.sessionId, file);
      results.push(record);
    }
    res.json({ files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List files for a session
app.get('/api/sessions/:sessionId/files', (req, res) => {
  const files = sessionFiles.getSessionFiles(req.params.sessionId);
  res.json({ files: files.map(f => ({ id: f.id, name: f.name, size: f.size, type: f.type, textLength: f.extractedText?.length || 0, uploadedAt: f.uploadedAt })) });
});

// Remove a file from a session
app.delete('/api/sessions/:sessionId/files/:fileId', (req, res) => {
  const removed = sessionFiles.removeSessionFile(req.params.sessionId, req.params.fileId);
  res.json({ ok: removed });
});

// Get file context for injection
app.get('/api/sessions/:sessionId/files/context', (req, res) => {
  const context = sessionFiles.buildFileContext(req.params.sessionId);
  res.json({ context });
});

// ── Forest REST endpoints ─────────────────────────────────────
app.get('/api/forests', async (req, res) => {
  try {
    const list = await forestsGw.listForests(req.user?.uid, parseInt(req.query.limit) || 20);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/forests/:id', async (req, res) => {
  try {
    const forest = await forestsGw.loadForest(req.params.id);
    if (!forest) return res.status(404).json({ error: 'Forest not found' });
    res.json(forest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/forest/decompose', async (req, res) => {
  try {
    await handleForestDecompose(client, req, res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.post('/api/forest/generate-all', async (req, res) => {
  try {
    await handleForestGenerateAll(client, req, res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.post('/api/forest/critique', async (req, res) => {
  try {
    await handleForestCritique(client, req, res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.delete('/api/forests/:id', async (req, res) => {
  try {
    await forestsGw.deleteForest(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Prototype persistence ─────────────────────────────────────
app.put('/api/sessions/:id/prototype', async (req, res) => {
  try {
    const { prototype } = req.body;
    if (!prototype) return res.status(400).json({ error: 'prototype is required' });
    await sessions.updateSession(req.params.id, { prototype });
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

const server = app.listen(PORT, async () => {
  console.log(`Gateway running on port ${PORT}`);
  // Initialize prompt loader (seeds from legacy on first run, builds cache)
  const promptLoader = require('./engine/promptLoader');
  promptLoader.init().catch(err => console.error('Prompt loader init error:', err));
  // Initialize pattern loader (seeds built-in patterns on first run)
  const patternLoader = require('./engine/patternLoader');
  patternLoader.init().catch(err => console.error('Pattern loader init error:', err));
  // Initialize all registered integrations (restore sessions, validate config)
  await integrationRegistry.initAll().catch(err => console.error('Integration init error:', err));
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
  handleRefineCritique,
  handleRefineStrengthen,
  handleRefineScore,
  handlePortfolioGenerate,
  handlePortfolioScore,
  handleExecuteAction,
  // Forest-of-Trees
  handleForestDecompose,
  handleForestGenerateAll,
  handleForestGenerate,
  handleForestCritique,
};

initWebSocket(server, client, engineHandlers, gemini);
initYjsWebSocket(server);

module.exports = { app, server, client };
