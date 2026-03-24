// ── Claude Code Integration ──────────────────────────────────
// Reads local Claude Code conversation data (~/.claude/) and makes
// it available as context for ThoughtClaw generation.

const fs = require('fs');
const parser = require('./parser');

let activeProjectPath = null;

const claudeCode = {
  id: 'claude-code',
  name: 'Claude Code',
  description: 'Import context from Claude Code conversations',

  init() {
    const exists = fs.existsSync(parser.CLAUDE_DIR);
    const projects = exists ? parser.listProjects() : [];
    if (exists && projects.length) {
      console.log(`Claude Code: found ${projects.length} projects`);
    } else {
      console.log('Claude Code: no local Claude Code data found');
    }
    return { configured: exists && projects.length > 0 };
  },

  status() {
    const projects = parser.listProjects();
    return {
      configured: projects.length > 0,
      connected: !!activeProjectPath,
      projectCount: projects.length,
      activeProject: activeProjectPath,
    };
  },

  connect(body) {
    const { projectPath } = body || {};
    if (projectPath && fs.existsSync(projectPath)) {
      activeProjectPath = projectPath;
      return { connected: true, projectPath };
    }
    // Auto-connect to most recent project
    const projects = parser.listProjects();
    if (projects.length) {
      activeProjectPath = projects[0].path;
      return { connected: true, projectPath: activeProjectPath };
    }
    return { connected: false, error: 'No Claude Code projects found' };
  },

  disconnect() {
    activeProjectPath = null;
  },

  hooks: {
    contextTemplate: (formattedContext) => formattedContext,
    modeTemplates: {
      idea: (ctx) => `\n\n${ctx}`,
      codebase: (ctx) => `\n\n${ctx}`,
      plan: (ctx) => `\n\n${ctx}`,
      decide: (ctx) => `\n\n${ctx}`,
      write: (ctx) => `\n\n${ctx}`,
      resume: (ctx) => `\n\n${ctx}`,
      learn: (ctx) => `\n\n${ctx}`,
    },
  },

  api: {
    listProjects() {
      return parser.listProjects();
    },

    listSessions(projectPath) {
      return parser.listSessions(projectPath || activeProjectPath);
    },

    getSessionSummary(sessionFilePath) {
      const messages = parser.parseTranscript(sessionFilePath);
      return parser.summarizeConversation(messages);
    },

    getProjectMemory(projectPath) {
      return parser.getProjectMemory(projectPath || activeProjectPath);
    },

    getPlans() {
      return parser.getPlans();
    },

    // Build full context from selected sessions
    buildContext({ projectPath, sessionFilePaths = [], includeMemory = true, includePlans = false }) {
      const targetProject = projectPath || activeProjectPath;

      // Summarize selected sessions
      const summaries = [];
      for (const filePath of sessionFilePaths) {
        const sessions = parser.listSessions(targetProject);
        const meta = sessions.find(s => s.filePath === filePath) || {};
        const messages = parser.parseTranscript(filePath);
        if (messages.length > 0) {
          summaries.push(parser.summarizeConversation(messages, meta));
        }
      }

      // Get memory files
      const memory = includeMemory ? parser.getProjectMemory(targetProject) : [];

      // Get plans
      const plans = includePlans ? parser.getPlans() : [];

      return parser.formatForContext(summaries, memory, plans);
    },

    // Parse Claude.ai export
    parseClaudeAiExport(jsonContent) {
      const messages = parser.parseClaudeAiExport(jsonContent);
      const summary = parser.summarizeConversation(messages, { firstPrompt: 'Claude.ai conversation' });
      return {
        summary,
        context: parser.formatForContext([summary]),
      };
    },
  },
};

// Self-register with integration registry
const registry = require('../registry');
registry.register('claude-code', claudeCode);

module.exports = claudeCode;
