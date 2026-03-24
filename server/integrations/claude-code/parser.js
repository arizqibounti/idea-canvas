// ── Claude Code JSONL Parser ─────────────────────────────────
// Reads Claude Code conversation transcripts (.jsonl) and extracts
// structured summaries for context injection into ThoughtClaw.

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const PLANS_DIR = path.join(CLAUDE_DIR, 'plans');

// ── Discover available Claude Code projects ──────────────────
function listProjects() {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return [];
    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
    const results = [];

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const projectPath = path.join(PROJECTS_DIR, e.name);
      const indexPath = path.join(projectPath, 'sessions-index.json');

      // Only include projects that have a sessions-index.json
      if (!fs.existsSync(indexPath)) continue;

      try {
        const raw = fs.readFileSync(indexPath, 'utf8');
        const index = JSON.parse(raw);
        const sessionCount = index.entries?.length || 0;
        if (sessionCount === 0) continue;

        const originalPath = index.originalPath || null;
        const lastModified = (index.entries || [])
          .map(entry => entry.modified)
          .filter(Boolean)
          .sort()
          .pop() || null;

        results.push({
          id: e.name,
          path: projectPath,
          originalPath: originalPath || e.name.replace(/-/g, '/').replace(/^\//, ''),
          sessionCount,
          lastModified,
        });
      } catch {
        // Skip malformed index files
      }
    }

    return results.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
  } catch (err) {
    console.error('listProjects error:', err.message);
    return [];
  }
}

// ── List sessions for a project ──────────────────────────────
function listSessions(projectPath) {
  try {
    const indexPath = path.join(projectPath, 'sessions-index.json');
    if (!fs.existsSync(indexPath)) return [];
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return (index.entries || [])
      .filter(e => !e.isSidechain && e.messageCount > 2)
      .map(e => ({
        sessionId: e.sessionId,
        filePath: e.fullPath,
        firstPrompt: e.firstPrompt || 'Untitled',
        messageCount: e.messageCount,
        created: e.created,
        modified: e.modified,
        gitBranch: e.gitBranch,
      }))
      .sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  } catch {
    return [];
  }
}

// ── Parse a JSONL transcript ─────────────────────────────────
function parseTranscript(jsonlPath, opts = {}) {
  const { maxLines = 5000 } = opts;
  try {
    if (!fs.existsSync(jsonlPath)) return [];
    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.split('\n').slice(0, maxLines);
    const messages = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' || entry.type === 'assistant') {
          messages.push(entry);
        }
      } catch {}
    }
    return messages;
  } catch {
    return [];
  }
}

// ── Extract key messages (smart summarization) ───────────────
// Takes user prompts + assistant text conclusions, skips tool results/thinking
function extractKeyMessages(messages, maxTokens = 2000) {
  const extracted = [];
  let tokenEstimate = 0;
  const tokensPerChar = 0.25; // rough estimate

  for (const msg of messages) {
    if (tokenEstimate > maxTokens) break;

    if (msg.type === 'user') {
      // Extract user text messages (skip tool results)
      const textParts = (msg.message?.content || [])
        .filter(c => c.type === 'text' && c.text?.trim())
        .map(c => c.text.trim());

      if (textParts.length) {
        const text = textParts.join('\n').slice(0, 500);
        extracted.push({ role: 'user', text });
        tokenEstimate += text.length * tokensPerChar;
      }
    }

    if (msg.type === 'assistant') {
      // Extract assistant text (skip thinking blocks, tool_use blocks)
      const textParts = (msg.message?.content || [])
        .filter(c => c.type === 'text' && c.text?.trim())
        .map(c => c.text.trim());

      if (textParts.length) {
        const text = textParts.join('\n').slice(0, 800);
        extracted.push({ role: 'assistant', text });
        tokenEstimate += text.length * tokensPerChar;
      }
    }
  }

  return extracted;
}

// ── Summarize a conversation into structured output ──────────
function summarizeConversation(messages, sessionMeta = {}) {
  const keyMessages = extractKeyMessages(messages, 1500);

  // Extract the topic from first user message
  const firstUser = keyMessages.find(m => m.role === 'user');
  const topic = firstUser?.text?.slice(0, 100) || sessionMeta.firstPrompt || 'Unknown topic';

  // Extract key decisions from assistant messages
  const decisions = [];
  const artifacts = [];

  for (const msg of keyMessages) {
    if (msg.role !== 'assistant') continue;
    const text = msg.text.toLowerCase();

    // Look for decision-like statements
    if (text.includes('i\'ll ') || text.includes('let\'s ') || text.includes('we should') ||
        text.includes('the approach') || text.includes('decided') || text.includes('choosing')) {
      const snippet = msg.text.split('\n')[0].slice(0, 150);
      if (snippet.length > 20) decisions.push(snippet);
    }

    // Look for artifact/file creation mentions
    if (text.includes('created') || text.includes('wrote') || text.includes('built') ||
        text.includes('implemented') || text.includes('added')) {
      const snippet = msg.text.split('\n')[0].slice(0, 100);
      if (snippet.length > 15) artifacts.push(snippet);
    }
  }

  return {
    topic: topic.slice(0, 100),
    messageCount: messages.length,
    keyDecisions: decisions.slice(0, 5),
    artifacts: artifacts.slice(0, 5),
    keyExchanges: keyMessages.slice(0, 6), // first few exchanges for context
    created: sessionMeta.created,
    modified: sessionMeta.modified,
  };
}

// ── Read project memory files ────────────────────────────────
function getProjectMemory(projectPath) {
  const memoryDir = path.join(projectPath, 'memory');
  try {
    if (!fs.existsSync(memoryDir)) return [];
    const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
    return files.map(f => {
      try {
        const content = fs.readFileSync(path.join(memoryDir, f), 'utf8');
        return { name: f, content: content.slice(0, 3000) };
      } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Read plans ───────────────────────────────────────────────
function getPlans() {
  try {
    if (!fs.existsSync(PLANS_DIR)) return [];
    const files = fs.readdirSync(PLANS_DIR).filter(f => f.endsWith('.md'));
    return files.map(f => {
      try {
        const content = fs.readFileSync(path.join(PLANS_DIR, f), 'utf8');
        return { name: f.replace('.md', ''), content: content.slice(0, 2000) };
      } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Format everything into a context block for injection ─────
function formatForContext(summaries, memory = [], plans = []) {
  const parts = [];

  parts.push('CLAUDE CONVERSATION CONTEXT — You have access to the user\'s prior Claude Code sessions on this project:');

  // Memory
  if (memory.length) {
    parts.push('\n=== PROJECT MEMORY ===');
    for (const m of memory) {
      parts.push(`[${m.name}]\n${m.content}`);
    }
  }

  // Plans
  if (plans.length) {
    parts.push('\n=== IMPLEMENTATION PLANS ===');
    for (const p of plans) {
      parts.push(`[${p.name}]\n${p.content.slice(0, 500)}...`);
    }
  }

  // Session summaries
  for (const s of summaries) {
    const age = s.modified ? getRelativeTime(s.modified) : 'unknown time ago';
    parts.push(`\n=== SESSION: "${s.topic}" (${age}, ${s.messageCount} messages) ===`);

    if (s.keyDecisions.length) {
      parts.push('Key decisions:');
      for (const d of s.keyDecisions) parts.push(`- ${d}`);
    }

    if (s.artifacts.length) {
      parts.push('Work done:');
      for (const a of s.artifacts) parts.push(`- ${a}`);
    }

    if (s.keyExchanges?.length) {
      parts.push('Key exchanges:');
      for (const ex of s.keyExchanges.slice(0, 3)) {
        parts.push(`  [${ex.role}]: ${ex.text.slice(0, 200)}`);
      }
    }
  }

  parts.push('\nINSTRUCTION: Use these prior conversations to ground your thinking. Reference specific decisions and avoid contradicting established choices.');

  return parts.join('\n');
}

function getRelativeTime(isoDate) {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

// ── Parse Claude.ai exported conversation ────────────────────
function parseClaudeAiExport(jsonContent) {
  try {
    const data = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;

    // Handle different export formats
    let messages = [];
    if (Array.isArray(data)) {
      messages = data;
    } else if (data.messages) {
      messages = data.messages;
    } else if (data.chat_messages) {
      messages = data.chat_messages;
    }

    // Normalize to our format
    return messages.map(m => ({
      type: m.role === 'user' ? 'user' : 'assistant',
      message: {
        content: typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : m.content,
      },
    }));
  } catch {
    return [];
  }
}

module.exports = {
  listProjects,
  listSessions,
  parseTranscript,
  extractKeyMessages,
  summarizeConversation,
  getProjectMemory,
  getPlans,
  formatForContext,
  parseClaudeAiExport,
  CLAUDE_DIR,
  PROJECTS_DIR,
};
