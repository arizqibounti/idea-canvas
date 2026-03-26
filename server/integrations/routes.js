// ── Integration Routes ────────────────────────────────────────
// Pattern: openclaw gateway hooks routing — generic integration endpoints
// plus integration-specific API routes.

const registry = require('./registry');

function mountIntegrationRoutes(app) {

  // ── Generic: List all integrations ──────────────────────────
  app.get('/api/integrations', async (req, res) => {
    try {
      const list = await registry.listAll();
      res.json({ integrations: list });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Generic: Get integration status ─────────────────────────
  app.get('/api/integrations/:id/status', async (req, res) => {
    const integration = registry.get(req.params.id);
    if (!integration) return res.status(404).json({ error: 'Integration not found' });
    try {
      const s = integration.status ? await integration.status() : { configured: false, connected: false };
      res.json(s);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Generic: Connect (start auth flow) ──────────────────────
  app.post('/api/integrations/:id/connect', async (req, res) => {
    const integration = registry.get(req.params.id);
    if (!integration) return res.status(404).json({ error: 'Integration not found' });
    try {
      const result = await integration.connect(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Generic: Disconnect ─────────────────────────────────────
  app.post('/api/integrations/:id/disconnect', async (req, res) => {
    const integration = registry.get(req.params.id);
    if (!integration) return res.status(404).json({ error: 'Integration not found' });
    try {
      await integration.disconnect();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Gmail-specific: OAuth callback ──────────────────────────
  app.get('/api/integrations/gmail/callback', async (req, res) => {
    const integration = registry.get('gmail');
    if (!integration) return res.status(404).json({ error: 'Gmail integration not registered' });
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Missing code');
    try {
      const result = await integration.handleCallback(code, state);
      // Post message to opener window and close popup
      res.send(`<html><body><script>
        window.opener?.postMessage({ type: 'gmail-connected', email: '${result.email.replace(/'/g, "\\'")}' }, '*');
        window.close();
      </script><p>Connected! You can close this window.</p></body></html>`);
    } catch (err) {
      res.status(400).send(`<html><body><p>Error: ${err.message}</p></body></html>`);
    }
  });

  // ── Gmail-specific: List threads ────────────────────────────
  app.get('/api/integrations/gmail/threads', async (req, res) => {
    const integration = registry.get('gmail');
    if (!integration) return res.status(404).json({ error: 'Gmail integration not registered' });
    try {
      const { q, maxResults } = req.query;
      const threads = await integration.api.listThreads(q || '', parseInt(maxResults) || 10);
      res.json({ threads });
    } catch (err) {
      if (err.message.includes('Not connected')) return res.status(401).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Gmail-specific: Get thread with formatted context ───────
  app.get('/api/integrations/gmail/thread/:id', async (req, res) => {
    const integration = registry.get('gmail');
    if (!integration) return res.status(404).json({ error: 'Gmail integration not registered' });
    try {
      const { mode } = req.query;
      const thread = await integration.api.getThread(req.params.id);
      const formatted = integration.api.formatThreadForContext(thread, mode);
      res.json({ thread, formatted });
    } catch (err) {
      if (err.message.includes('Not connected')) return res.status(401).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Gmail-specific: Get hook mappings ───────────────────────
  app.get('/api/integrations/gmail/hooks', (req, res) => {
    const mappings = registry.getHookMappings('gmail');
    if (!mappings) return res.status(404).json({ error: 'No hook mappings for gmail' });
    res.json({
      modes: Object.keys(mappings.modeTemplates || {}),
      description: 'Hook preset mappings for Gmail — templates for formatting email context per mode',
    });
  });

  // ── Backward-compatible legacy routes ───────────────────────
  // Keep old /api/gmail/* routes working during transition.

  app.get('/api/gmail/status', async (req, res) => {
    const integration = registry.get('gmail');
    if (!integration) return res.json({ configured: false, connected: false });
    try {
      const s = await integration.status();
      res.json(s);
    } catch {
      res.json({ configured: false, connected: false });
    }
  });

  app.get('/api/gmail/auth-url', async (req, res) => {
    const integration = registry.get('gmail');
    if (!integration) return res.status(501).json({ error: 'Gmail not registered' });
    try {
      const { authUrl } = await integration.connect();
      res.json({ url: authUrl });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/gmail/callback', async (req, res) => {
    // Redirect to new route
    const { code, state } = req.query;
    res.redirect(`/api/integrations/gmail/callback?code=${encodeURIComponent(code || '')}&state=${encodeURIComponent(state || '')}`);
  });

  app.get('/api/gmail/threads', async (req, res) => {
    const integration = registry.get('gmail');
    if (!integration) return res.status(404).json({ error: 'Gmail not registered' });
    try {
      const { q, maxResults } = req.query;
      const threads = await integration.api.listThreads(q || '', parseInt(maxResults) || 10);
      res.json({ threads });
    } catch (err) {
      if (err.message.includes('Not connected')) return res.status(401).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/gmail/thread/:id', async (req, res) => {
    const integration = registry.get('gmail');
    if (!integration) return res.status(404).json({ error: 'Gmail not registered' });
    try {
      const thread = await integration.api.getThread(req.params.id);
      const formatted = integration.api.formatThreadForContext(thread);
      res.json({ thread, formatted });
    } catch (err) {
      if (err.message.includes('Not connected')) return res.status(401).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/gmail/disconnect', async (req, res) => {
    const integration = registry.get('gmail');
    if (!integration) return res.json({ ok: true });
    try {
      await integration.disconnect();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Claude Code specific routes ──────────────────────────────

  app.get('/api/integrations/claude-code/projects', (req, res) => {
    const integration = registry.get('claude-code');
    if (!integration) return res.json([]);
    try {
      res.json(integration.api.listProjects());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/integrations/claude-code/sessions', (req, res) => {
    const integration = registry.get('claude-code');
    if (!integration) return res.json([]);
    try {
      const { project } = req.query;
      res.json(integration.api.listSessions(project));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/integrations/claude-code/context', (req, res) => {
    const integration = registry.get('claude-code');
    if (!integration) return res.status(404).json({ error: 'Claude Code integration not available' });
    try {
      const { projectPath, sessionFilePaths, includeMemory, includePlans } = req.body;
      const context = integration.api.buildContext({ projectPath, sessionFilePaths, includeMemory, includePlans });
      res.json({ context, sessionCount: sessionFilePaths?.length || 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/integrations/claude-ai/import', (req, res) => {
    const integration = registry.get('claude-code');
    if (!integration) return res.status(404).json({ error: 'Claude Code integration not available' });
    try {
      const { conversationJson } = req.body;
      const result = integration.api.parseClaudeAiExport(conversationJson);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GitHub specific routes ───────────────────────────────────

  app.get('/api/integrations/github/callback', async (req, res) => {
    const integration = registry.get('github');
    if (!integration) return res.status(404).send('GitHub integration not available');
    try {
      const { code, state } = req.query;
      const result = await integration.handleCallback(code, state);
      res.send(`<html><body><script>
        window.opener?.postMessage({ type: 'github-connected', login: '${(result.login || '').replace(/'/g, "\\'")}' }, '*');
        window.close();
      </script></body></html>`);
    } catch (err) {
      res.status(400).send(`<html><body><p>GitHub connection failed: ${err.message}</p></body></html>`);
    }
  });

  app.get('/api/integrations/github/repos', async (req, res) => {
    const integration = registry.get('github');
    if (!integration) return res.json([]);
    try {
      const { q, perPage } = req.query;
      const repos = await integration.api.listRepos(q || '', parseInt(perPage) || 20);
      res.json({ repos });
    } catch (err) {
      if (err.message.includes('Not connected')) return res.status(401).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { mountIntegrationRoutes };
