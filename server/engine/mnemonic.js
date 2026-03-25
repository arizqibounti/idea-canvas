// ── Mnemonic video generation engine ─────────────────────────
// Generates concept visualization videos using Claude (prompt craft) + Veo 3 or ComfyUI/Wan 2.2 (video gen) + GCS (storage)
// Now uses the AI provider abstraction layer.

const { MNEMONIC_VEO_PROMPT } = require('./prompts');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ai = require('../ai/providers');

const storage = new Storage({ projectId: 'lasttouchashar' });
const GCS_BUCKET = 'lasttouchashar-mnemonics';

// ComfyUI config — defaults to localhost:8188
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';

// In-memory job tracking (survives across requests, lost on server restart)
const pendingJobs = new Map();

// ── ComfyUI / Wan 2.2 integration ────────────────────────────

async function comfyuiHealthCheck() {
  try {
    const res = await fetch(`${COMFYUI_URL}/system_stats`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

async function comfyuiGenerateVideo(prompt, nodeId) {
  // Wan 2.2 text-to-video workflow via ComfyUI API
  const workflow = {
    "1": {
      "class_type": "WanVideoTextEncode",
      "inputs": { "prompt": prompt, "clip": ["2", 0] }
    },
    "2": {
      "class_type": "WanVideoModelLoader",
      "inputs": { "model_name": "wan2.2_t2v_720p_bf16.safetensors" }
    },
    "3": {
      "class_type": "WanVideoSampler",
      "inputs": {
        "model": ["2", 1],
        "positive": ["1", 0],
        "width": 832, "height": 480,
        "num_frames": 81,
        "steps": 30,
        "cfg": 6.0,
        "seed": Math.floor(Math.random() * 2147483647),
      }
    },
    "4": {
      "class_type": "WanVideoDecode",
      "inputs": { "vae": ["2", 2], "samples": ["3", 0] }
    },
    "5": {
      "class_type": "SaveAnimatedWEBP",
      "inputs": {
        "images": ["4", 0],
        "filename_prefix": `mnemonic_${nodeId}`,
        "fps": 16,
        "quality": 90,
      }
    }
  };

  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!res.ok) throw new Error(`ComfyUI prompt failed: ${res.status}`);
  const { prompt_id } = await res.json();
  return prompt_id;
}

async function comfyuiPollResult(promptId) {
  const res = await fetch(`${COMFYUI_URL}/history/${promptId}`);
  if (!res.ok) return null;
  const history = await res.json();
  const job = history[promptId];
  if (!job) return null;
  if (job.status?.status_str === 'error') throw new Error('ComfyUI generation failed');
  if (!job.outputs) return null;

  // Find the output video file
  for (const nodeOutput of Object.values(job.outputs)) {
    if (nodeOutput.gifs?.length) {
      const file = nodeOutput.gifs[0];
      return { filename: file.filename, subfolder: file.subfolder, type: file.type };
    }
    if (nodeOutput.images?.length) {
      const file = nodeOutput.images[0];
      return { filename: file.filename, subfolder: file.subfolder, type: file.type };
    }
  }
  return null;
}

async function comfyuiDownloadFile(fileInfo) {
  const params = new URLSearchParams({ filename: fileInfo.filename, subfolder: fileInfo.subfolder || '', type: fileInfo.type || 'output' });
  const res = await fetch(`${COMFYUI_URL}/view?${params}`);
  if (!res.ok) throw new Error('Failed to download ComfyUI output');
  return Buffer.from(await res.arrayBuffer());
}

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
    // Include example and analogy from teachContent if provided
    const { example, analogy } = req.body;
    const userContent = `Topic: "${topic}"

Concept to visualize:
${JSON.stringify(targetNode, null, 2)}

Parent/prerequisite concepts (for context):
${JSON.stringify(parentNodes, null, 2)}

Difficulty level: ${targetNode.difficulty || 'unknown'}/10
${example ? `\nEXAMPLE TO VISUALIZE (this is what the video should depict):\n${example}` : ''}
${analogy ? `\nANALOGY (for additional context):\n${analogy}` : ''}

Create a realistic 6-second video scene that directly demonstrates ${example ? 'the example above' : 'this concept'} in action — make the physics/mechanics/process tangible and visible.`;

    const { text } = await ai.call({
      model: 'claude:sonnet',
      system: MNEMONIC_VEO_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1000,
      signal: req.signal,
    });

    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const mnemonicStrategy = parsed.visualizationApproach || parsed.mnemonicStrategy;
    const { veoPrompt, briefDescription } = parsed;

    if (!veoPrompt) {
      return res.status(500).json({ error: 'Claude did not generate a veoPrompt' });
    }

    // Step 2: Start video generation — ComfyUI/Wan 2.2 (local) or Veo 3 (cloud)
    const videoBackend = req.body.videoBackend || process.env.VIDEO_BACKEND || 'veo';
    const useComfyUI = videoBackend === 'comfyui' || (videoBackend === 'auto' && await comfyuiHealthCheck());
    const jobId = `mnemonic_${nodeId}_${Date.now()}`;

    if (useComfyUI) {
      const promptId = await comfyuiGenerateVideo(veoPrompt, nodeId);
      pendingJobs.set(jobId, {
        backend: 'comfyui',
        promptId,
        nodeId,
        mnemonicStrategy,
        veoPrompt,
        briefDescription,
        createdAt: Date.now(),
      });
    } else {
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

      pendingJobs.set(jobId, {
        backend: 'veo',
        operation,
        nodeId,
        mnemonicStrategy,
        veoPrompt,
        briefDescription,
        createdAt: Date.now(),
      });
    }

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
// Checks video generation status. On completion, downloads video and uploads to GCS.

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
    if (job.backend === 'comfyui') {
      // ── ComfyUI / Wan 2.2 polling ──
      const result = await comfyuiPollResult(job.promptId);
      if (!result) {
        return res.json({ status: 'pending' });
      }

      // Download from ComfyUI output
      const videoBuffer = await comfyuiDownloadFile(result);
      const ext = result.filename.endsWith('.webp') ? 'webp' : 'mp4';
      const contentType = ext === 'webp' ? 'image/webp' : 'video/mp4';

      // Upload to GCS
      const gcsFileName = `${jobId}.${ext}`;
      await storage.bucket(GCS_BUCKET).file(gcsFileName).save(videoBuffer, {
        metadata: {
          contentType,
          metadata: { nodeId: job.nodeId, backend: 'comfyui' },
        },
      });
      await storage.bucket(GCS_BUCKET).file(gcsFileName).makePublic();

      const videoUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${gcsFileName}`;
      job.videoUrl = videoUrl;

      return res.json({
        status: 'complete',
        videoUrl,
        mnemonicStrategy: job.mnemonicStrategy,
        veoPrompt: job.veoPrompt,
        briefDescription: job.briefDescription,
      });
    }

    // ── Veo 3 polling ──
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
