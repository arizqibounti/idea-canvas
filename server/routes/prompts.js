// ── Prompt Admin API Routes ──────────────────────────────────
// CRUD + A/B config + metrics for managed prompts.
// Mount: app.use('/api/prompts', promptRoutes)

const express = require('express');
const router = express.Router();
const promptStore = require('../gateway/promptStore');
const promptLoader = require('../engine/promptLoader');

// GET /api/prompts — list all (metadata only)
router.get('/', async (_req, res) => {
  try {
    const list = await promptStore.listPrompts();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prompts/:key — full prompt detail with versions
router.get('/:key', async (req, res) => {
  try {
    const prompt = await promptStore.getPrompt(req.params.key);
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });
    res.json(prompt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/prompts/:key — update prompt text (creates new version)
router.put('/:key', async (req, res) => {
  try {
    const { text, note } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const userId = req.user?.uid || 'admin';
    const updated = await promptStore.updatePromptText(req.params.key, text, note, userId);
    if (!updated) return res.status(404).json({ error: 'Prompt not found' });
    // Hot-reload into cache
    await promptLoader.reload(req.params.key);
    res.json({ key: req.params.key, currentVersion: updated.currentVersion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prompts/:key/revert — revert to a specific version
router.post('/:key/revert', async (req, res) => {
  try {
    const { version } = req.body;
    if (!version) return res.status(400).json({ error: 'version is required' });
    const updated = await promptStore.revertPrompt(req.params.key, version);
    if (!updated) return res.status(404).json({ error: 'Prompt or version not found' });
    await promptLoader.reload(req.params.key);
    res.json({ key: req.params.key, currentVersion: updated.currentVersion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/prompts/:key/ab — configure A/B test
router.put('/:key/ab', async (req, res) => {
  try {
    const { enabled, variantText, splitPct } = req.body;
    const updated = await promptStore.updateAbTest(req.params.key, { enabled, variantText, splitPct });
    if (!updated) return res.status(404).json({ error: 'Prompt not found' });
    await promptLoader.reload(req.params.key);
    res.json({ key: req.params.key, abTest: updated.abTest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prompts/:key/metrics — record a metric event
router.post('/:key/metrics', async (req, res) => {
  try {
    const { variant, latencyMs, signal } = req.body;
    await promptStore.recordMetric(req.params.key, variant, latencyMs, signal);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prompts/seed — one-time seed from legacy prompts.js
router.post('/seed', async (_req, res) => {
  try {
    const count = await promptStore.seedFromLegacy();
    res.json({ seeded: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
