// ── Pattern CRUD Routes ──────────────────────────────────────
// REST API for managing thinking pattern definitions.
// Follows the same router pattern as routes/prompts.js.

const express = require('express');
const router = express.Router();
const patternStore = require('../gateway/patternStore');
const patternLoader = require('../engine/patternLoader');
const { validatePattern, applyDefaults } = require('../engine/patternSchema');

// GET /api/patterns — list all patterns (metadata only)
router.get('/', async (req, res) => {
  try {
    const patterns = await patternStore.listPatterns();
    res.json(patterns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/patterns/:id — full pattern definition + versions
router.get('/:id', async (req, res) => {
  try {
    const pattern = await patternStore.getPattern(req.params.id);
    if (!pattern) return res.status(404).json({ error: 'Pattern not found' });
    res.json(pattern);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/patterns — create new pattern
router.post('/', async (req, res) => {
  try {
    const { definition } = req.body;
    if (!definition?.id) return res.status(400).json({ error: 'definition.id is required' });

    const withDefaults = applyDefaults(definition);
    const validation = validatePattern(withDefaults);
    if (!validation.valid) return res.status(400).json({ error: 'Validation failed', errors: validation.errors });

    const existing = await patternStore.getPattern(withDefaults.id);
    if (existing) return res.status(409).json({ error: `Pattern "${withDefaults.id}" already exists` });

    const doc = await patternStore.createPattern(withDefaults, req.uid);
    await patternLoader.reload(withDefaults.id);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/patterns/:id — update pattern (new version)
router.put('/:id', async (req, res) => {
  try {
    const { definition, note } = req.body;
    if (!definition) return res.status(400).json({ error: 'definition is required' });

    const withDefaults = applyDefaults({ ...definition, id: req.params.id });
    const validation = validatePattern(withDefaults);
    if (!validation.valid) return res.status(400).json({ error: 'Validation failed', errors: validation.errors });

    const updated = await patternStore.updatePattern(req.params.id, withDefaults, note, req.uid);
    if (!updated) return res.status(404).json({ error: 'Pattern not found' });

    await patternLoader.reload(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/patterns/:id/revert — revert to specific version
router.post('/:id/revert', async (req, res) => {
  try {
    const { version } = req.body;
    if (!version) return res.status(400).json({ error: 'version is required' });

    const reverted = await patternStore.revertPattern(req.params.id, version);
    if (!reverted) return res.status(404).json({ error: 'Pattern or version not found' });

    await patternLoader.reload(req.params.id);
    res.json(reverted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/patterns/:id — delete (blocked for builtIn)
router.delete('/:id', async (req, res) => {
  try {
    const result = await patternStore.deletePattern(req.params.id);
    if (!result) return res.status(404).json({ error: 'Pattern not found' });
    if (result.error) return res.status(403).json(result);

    patternLoader.remove(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/patterns/seed — seed built-in patterns
router.post('/seed', async (req, res) => {
  try {
    const count = await patternStore.seedBuiltInPatterns();
    await patternLoader.reloadAll();
    res.json({ seeded: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
