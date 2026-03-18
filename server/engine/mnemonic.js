// ── Mnemonic video generation engine ─────────────────────────
// Generates memory mnemonic videos using Claude (prompt craft) + Veo 3 (video gen) + GCS (storage)
// Now uses the AI provider abstraction layer.

const { MNEMONIC_VEO_PROMPT } = require('./prompts');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ai = require('../ai/providers');

const storage = new Storage({ projectId: 'lasttouchashar' });
const GCS_BUCKET = 'lasttouchashar-mnemonics';

// In-memory job tracking (survives across requests, lost on server restart)
const pendingJobs = new Map();

// Helper: compact node summary for prompt context
function nodeSummary(nodes) {
  return (nodes || []).map(n => ({
    id: n.id || n.nodeId || n.data?.nodeId,
    type: n.type || n.data?.type,
    label: n.label || n.data?.label,
    reasoning: n.reasoning || n.data?.reasoning,
    parentIds: n.parentIds || n.data?.parentIds || [],
    difficulty: n.difficulty || n.data?.difficulty,
  }));
}

// ── POST /api/learn/mnemonic/generate ────────────────────────
// Step 1: Claude crafts a Veo prompt from concept context
// Step 2: Veo 3 starts async video generation
// Returns job info for client to poll

async function handleMnemonicGenerate(_client, req, res, _gemini) {
  const { nodeId, topic, nodes } = req.body;
  if (!nodeId || !topic || !nodes?.length) {
    return res.status(400).json({ error: 'nodeId, topic, and nodes are required' });
  }

  try {
    const compactNodes = nodeSummary(nodes);
    const targetNode = compactNodes.find(n => n.id === nodeId);
    if (!targetNode) {
      return res.status(400).json({ error: `Node ${nodeId} not found` });
    }

    // Find parent concepts for context
    const parentNodes = compactNodes.filter(n => targetNode.parentIds?.includes(n.id));

    // Step 1: Claude crafts the Veo prompt
    const userContent = `Topic: "${topic}"

Concept to create a mnemonic video for:
${JSON.stringify(targetNode, null, 2)}

Parent/prerequisite concepts (for context):
${JSON.stringify(parentNodes, null, 2)}

Difficulty level: ${targetNode.difficulty || 'unknown'}/10

Craft a vivid, memorable 6-second video scene that will encode this concept in the student's visual memory.`;

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: MNEMONIC_VEO_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1000,
      signal: req.signal,
    });

    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const { mnemonicStrategy, veoPrompt, briefDescription } = JSON.parse(cleaned);

    if (!veoPrompt) {
      return res.status(500).json({ error: 'Claude did not generate a veoPrompt' });
    }

    // Step 2: Start Veo 3 video generation (uses raw Gemini — specialized Veo API)
    const gemini = ai.getGemini();
    let operation = await gemini.models.generateVideos({
      model: 'veo-3.0-generate-001',
      prompt: veoPrompt,
      config: {
        aspectRatio: '16:9',
        numberOfVideos: 1,
        durationSeconds: 6,
      },
    });

    const jobId = `mnemonic_${nodeId}_${Date.now()}`;

    pendingJobs.set(jobId, {
      operation,
      nodeId,
      mnemonicStrategy,
      veoPrompt,
      briefDescription,
      createdAt: Date.now(),
    });

    res.json({
      jobId,
      status: 'pending',
      mnemonicStrategy,
      veoPrompt,
      briefDescription,
    });
  } catch (err) {
    console.error('Mnemonic generate error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/learn/mnemonic/poll ────────────────────────────
// Checks Veo operation status. On completion, downloads video and uploads to GCS.

async function handleMnemonicPoll(req, res, _gemini) {
  const { jobId } = req.body;
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' });
  }

  const job = pendingJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found or expired' });
  }

  // Already completed — return cached URL
  if (job.videoUrl) {
    return res.json({
      status: 'complete',
      videoUrl: job.videoUrl,
      mnemonicStrategy: job.mnemonicStrategy,
      veoPrompt: job.veoPrompt,
      briefDescription: job.briefDescription,
    });
  }

  try {
    // Check Veo operation status (uses raw Gemini — specialized operations API)
    const gemini = ai.getGemini();
    const operation = await gemini.operations.getVideosOperation({
      operation: job.operation,
    });

    if (!operation.done) {
      return res.json({ status: 'pending' });
    }

    // Video is ready — download and upload to GCS
    const generatedVideo = operation.response?.generatedVideos?.[0]?.video;
    if (!generatedVideo) {
      pendingJobs.delete(jobId);
      return res.status(500).json({ error: 'Veo completed but no video returned' });
    }

    // Download to temp file
    const tmpFile = path.join(os.tmpdir(), `${jobId}.mp4`);
    await gemini.files.download({
      file: generatedVideo,
      downloadPath: tmpFile,
    });

    // Upload to GCS
    const gcsFileName = `${jobId}.mp4`;
    await storage.bucket(GCS_BUCKET).upload(tmpFile, {
      destination: gcsFileName,
      metadata: {
        contentType: 'video/mp4',
        metadata: {
          nodeId: job.nodeId,
          mnemonicStrategy: job.mnemonicStrategy,
        },
      },
    });

    // Make publicly readable
    await storage.bucket(GCS_BUCKET).file(gcsFileName).makePublic();

    // Clean up temp file
    fs.unlink(tmpFile, () => {});

    const videoUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${gcsFileName}`;

    // Cache the result on the job
    job.videoUrl = videoUrl;

    res.json({
      status: 'complete',
      videoUrl,
      mnemonicStrategy: job.mnemonicStrategy,
      veoPrompt: job.veoPrompt,
      briefDescription: job.briefDescription,
    });
  } catch (err) {
    console.error('Mnemonic poll error:', err);
    // Don't delete job on poll error — might be transient
    res.status(500).json({ error: err.message });
  }
}

// Clean up stale jobs every hour (older than 2 hours)
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [jobId, job] of pendingJobs) {
    if (job.createdAt < cutoff) pendingJobs.delete(jobId);
  }
}, 60 * 60 * 1000);

module.exports = { handleMnemonicGenerate, handleMnemonicPoll };
