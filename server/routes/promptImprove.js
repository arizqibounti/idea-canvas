// ── Prompt Improvement API Routes ────────────────────────────
// AI-powered prompt critique, refinement, experimentation, and chat.
// Mount: app.use('/api/prompt-improve', promptImproveRoutes)

const express = require('express');
const router = express.Router();
const { handlePromptCritique, handlePromptRefine, handlePromptExperiment, handlePromptChat } = require('../engine/promptImprove');

router.post('/critique',    (req, res) => handlePromptCritique(req, res));
router.post('/refine',      (req, res) => handlePromptRefine(req, res));
router.post('/experiment',  (req, res) => handlePromptExperiment(req, res));
router.post('/chat',        (req, res) => handlePromptChat(req, res));

module.exports = router;
