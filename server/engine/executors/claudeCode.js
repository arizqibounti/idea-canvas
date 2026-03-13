// ── Claude Code CLI Executor ─────────────────────────────────
// Spawns the Claude Code CLI as a subprocess to fix issues in a codebase.
// Returns an EventEmitter-like interface for streaming progress back.

const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build the prompt sent to Claude Code CLI.
 * @param {object} nodeData - The node's data (label, reasoning, type)
 * @returns {string}
 */
function buildPrompt(nodeData) {
  const parts = [
    `Fix the following issue in this codebase:\n`,
    `Issue: ${nodeData.label}`,
  ];
  if (nodeData.reasoning) {
    parts.push(`Details: ${nodeData.reasoning}`);
  }
  if (nodeData.type) {
    parts.push(`Category: ${nodeData.type}`);
  }
  parts.push('');
  parts.push('IMPORTANT: Use tools one at a time — do NOT make parallel/concurrent tool calls.');
  parts.push('After fixing, run the project\'s test suite and/or linter to verify the fix doesn\'t break anything.');
  parts.push('Provide a brief summary of what you changed and the test results.');
  return parts.join('\n');
}

/**
 * Execute Claude Code CLI to fix a node's issue.
 *
 * @param {object} opts
 * @param {object} opts.nodeData   - Node data with label, reasoning, type
 * @param {string} opts.projectPath - Absolute path to the project directory
 * @param {AbortSignal} [opts.signal] - Optional abort signal
 * @returns {EventEmitter} Emits: 'progress', 'text', 'result', 'error'
 */
function execute({ nodeData, projectPath, signal }) {
  const emitter = new EventEmitter();
  const prompt = buildPrompt(nodeData);

  // Validate project path
  const fs = require('fs');
  if (!projectPath || !fs.existsSync(projectPath)) {
    process.nextTick(() => {
      emitter.emit('error', `Project path does not exist: ${projectPath}`);
    });
    return emitter;
  }

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    '--no-session-persistence',
    '--append-system-prompt', 'CRITICAL: You must call tools sequentially, one at a time. Never make parallel or concurrent tool calls.',
  ];

  const child = spawn(CLAUDE_BIN, args, {
    cwd: projectPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDECODE: undefined },
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  let lastAssistantText = '';
  let killed = false;

  // Timeout
  const timer = setTimeout(() => {
    killed = true;
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
    emitter.emit('error', 'Execution timed out after 5 minutes');
  }, TIMEOUT_MS);

  // Abort support
  if (signal) {
    const onAbort = () => {
      killed = true;
      child.kill('SIGTERM');
      clearTimeout(timer);
      emitter.emit('error', 'Execution aborted by user');
    };
    if (signal.aborted) {
      process.nextTick(onAbort);
      return emitter;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();

    // stream-json format: one JSON object per line
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop(); // keep incomplete last line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        console.log(`[claude-code] event type=${evt.type}${evt.subtype ? '/' + evt.subtype : ''}`);
        handleStreamEvent(emitter, evt);
        // Track last assistant text for summary
        if (evt.type === 'assistant' && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === 'text') {
              lastAssistantText = block.text;
            }
          }
        }
      } catch {
        // Non-JSON line, emit as raw text
        emitter.emit('text', line);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuf += text;
    if (text.trim()) console.error(`[claude-code] stderr: ${text.trim()}`);
  });

  child.on('close', (code) => {
    clearTimeout(timer);

    // Process any remaining buffer
    if (stdoutBuf.trim()) {
      try {
        const evt = JSON.parse(stdoutBuf);
        handleStreamEvent(emitter, evt);
      } catch {
        emitter.emit('text', stdoutBuf);
      }
    }

    if (killed) return; // already emitted error

    if (code === 0) {
      emitter.emit('result', {
        success: true,
        summary: lastAssistantText || 'Fix completed successfully.',
        exitCode: code,
      });
    } else {
      emitter.emit('error', `Claude Code exited with code ${code}${stderrBuf ? ': ' + stderrBuf.slice(0, 500) : ''}`);
    }
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    emitter.emit('error', `Failed to spawn Claude Code: ${err.message}`);
  });

  // Return cancel function attached to emitter
  emitter.cancel = () => {
    killed = true;
    child.kill('SIGTERM');
    clearTimeout(timer);
  };

  return emitter;
}

/**
 * Map Claude Code stream-json events to emitter events.
 */
function handleStreamEvent(emitter, evt) {
  switch (evt.type) {
    case 'assistant':
      // Assistant message with content blocks
      if (evt.message?.content) {
        for (const block of evt.message.content) {
          if (block.type === 'text') {
            emitter.emit('text', block.text);
          } else if (block.type === 'tool_use') {
            // Tool use — emit as progress with tool info
            const toolName = block.name || 'tool';
            const input = block.input || {};
            let detail = toolName;
            if (toolName === 'Edit' || toolName === 'Write') {
              detail = `Editing ${input.file_path || 'file'}`;
            } else if (toolName === 'Bash') {
              detail = `Running: ${(input.command || '').slice(0, 80)}`;
            } else if (toolName === 'Read') {
              detail = `Reading ${input.file_path || 'file'}`;
            }
            emitter.emit('progress', detail);
          }
        }
      }
      break;

    case 'content_block_delta':
      if (evt.delta?.type === 'text_delta' && evt.delta.text) {
        emitter.emit('text', evt.delta.text);
      }
      break;

    case 'result':
      // Final result from Claude Code
      emitter.emit('result', {
        success: true,
        summary: evt.result || evt.text || 'Fix completed.',
        cost: evt.cost_usd,
        duration: evt.duration_ms,
      });
      break;

    default:
      // Ignore other event types (system, ping, etc.)
      break;
  }
}

module.exports = { execute, buildPrompt };
