// ── Node Action Execution Engine ─────────────────────────────
// Dispatches node actions to mode-specific executors.
// Currently supports CODE mode via Claude Code CLI.
// Future: IDEA → Jira, PLAN → Linear, etc.

const { sseHeaders } = require('../utils/sse');

// ── Executor registry ────────────────────────────────────────
const executors = {
  codebase: require('./executors/claudeCode'),
  // Future executors:
  // idea: require('./executors/jiraTicket'),
  // plan: require('./executors/linearIssue'),
};

// Track active executions (max 1 concurrent)
let activeExecution = null;

/**
 * POST /api/execute-action
 * Streams execution progress via SSE.
 *
 * Body: { nodeId, nodeData, mode, projectPath }
 */
async function handleExecuteAction(client, req, res) {
  const { nodeId, nodeData, mode, projectPath } = req.body;

  // ── Validation ─────────────────────────────────────────────
  if (!nodeId || !nodeData?.label) {
    return res.status(400).json({ error: 'Missing nodeId or nodeData.label' });
  }
  if (!mode) {
    return res.status(400).json({ error: 'Missing mode' });
  }
  if (!projectPath) {
    return res.status(400).json({ error: 'Missing projectPath — set your local project path first' });
  }

  const executor = executors[mode];
  if (!executor) {
    return res.status(400).json({ error: `No executor available for mode: ${mode}` });
  }

  // ── Concurrency guard ──────────────────────────────────────
  if (activeExecution) {
    return res.status(409).json({
      error: 'Another execution is already in progress',
      activeNodeId: activeExecution.nodeId,
    });
  }

  // ── Set up SSE stream ──────────────────────────────────────
  sseHeaders(res);

  // Send initial progress
  res.write(`data: ${JSON.stringify({ _progress: true, stage: 'starting', nodeId })}\n\n`);

  // ── Create abort controller ────────────────────────────────
  const abortController = new AbortController();

  // Track this execution
  activeExecution = { nodeId, abortController };

  // Track whether execution completed normally (result or error from executor).
  // We only abort the child process on client disconnect if execution hasn't finished.
  let executionFinished = false;

  // Detect real client disconnects:
  // In Express, req emits 'close' when request body stream closes (normal).
  // The reliable way to detect a real client disconnect mid-SSE is to detect
  // a write failure. We also add a safety net: if the socket gets destroyed
  // while execution is still running, abort.
  const disconnectCheck = setInterval(() => {
    if (executionFinished) {
      clearInterval(disconnectCheck);
      return;
    }
    if (req.socket?.destroyed && activeExecution?.nodeId === nodeId) {
      console.log(`[execute] Client socket destroyed, aborting execution for node ${nodeId}`);
      clearInterval(disconnectCheck);
      abortController.abort();
      activeExecution = null;
    }
  }, 2000);

  // ── Execute ────────────────────────────────────────────────
  try {
    const emitter = executor.execute({
      nodeData,
      projectPath,
      signal: abortController.signal,
    });

    emitter.on('progress', (detail) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ _progress: true, stage: detail, nodeId })}\n\n`);
    });

    emitter.on('text', (text) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ _text: true, text, nodeId })}\n\n`);
    });

    emitter.on('result', (result) => {
      if (res.writableEnded) return;
      executionFinished = true;
      clearInterval(disconnectCheck);
      res.write(`data: ${JSON.stringify({ _result: true, ...result, nodeId })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      activeExecution = null;
    });

    emitter.on('error', (errMsg) => {
      if (res.writableEnded) return;
      executionFinished = true;
      clearInterval(disconnectCheck);
      res.write(`data: ${JSON.stringify({ _error: true, error: errMsg, nodeId })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      activeExecution = null;
    });
  } catch (err) {
    console.error('Execute action error:', err);
    executionFinished = true;
    clearInterval(disconnectCheck);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ _error: true, error: err.message, nodeId })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
    activeExecution = null;
  }
}

/**
 * Stop the currently active execution.
 */
function stopExecution() {
  if (activeExecution) {
    activeExecution.abortController.abort();
    activeExecution = null;
    return true;
  }
  return false;
}

module.exports = { handleExecuteAction, stopExecution };
