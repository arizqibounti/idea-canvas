// ── Compounding Context Builder ──────────────────────────────────────────────
// Builds a unified context block from session brief, artifacts, and prior sessions.
// Injected into AI calls so every action benefits from accumulated session knowledge.

const { loadSession } = require('../gateway/sessions');

/**
 * Build the compounding context string for injection into AI prompts.
 * Returns empty string if no context available.
 */
async function buildCompoundingContext(sessionId, userId, idea) {
  if (!sessionId) return '';

  const parts = [];

  try {
    const session = await loadSession(sessionId);
    if (!session) return '';

    // 1. Session Brief
    if (session.sessionBrief) {
      parts.push(`SESSION CONTEXT (running insights from this session):\n${session.sessionBrief}`);
    }

    // 2. Artifacts Produced
    const artifacts = session.artifacts || [];
    if (artifacts.length > 0) {
      const artifactLines = artifacts.slice(-10).map(a => {
        const title = a.title || a.type;
        const summary = a.summary ? `: ${a.summary}` : '';
        return `- ${title}${summary} (${a.createdAt || 'unknown'})`;
      });
      parts.push(`ARTIFACTS PRODUCED SO FAR:\n${artifactLines.join('\n')}`);
    }

    // 3. Cross-Session Pollination
    // Lazy-load to avoid circular deps
    try {
      const { getSessionPollination } = require('../gateway/knowledge');
      const priorContext = await getSessionPollination(userId, idea || session.idea, sessionId);
      if (priorContext) {
        parts.push(priorContext);
      }
    } catch (e) {
      // knowledge.js may not have pollination yet, that's fine
    }
  } catch (err) {
    console.error('contextBuilder error:', err.message);
  }

  if (parts.length === 0) return '';
  return '\n\n---\n' + parts.join('\n\n') + '\n---\n';
}

module.exports = { buildCompoundingContext };
