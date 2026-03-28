// ── Session Brief Engine ─────────────────────────────────────────────────────
// Maintains a running context summary for each session.
// After each major action, distills the new information into the brief.
// At milestones, compresses into a short sessionSummary for cross-session use.

const ai = require('../ai/providers');
const { loadSession, updateSession } = require('../gateway/sessions');

const MAX_BRIEF_WORDS = 800;

/**
 * Update the session brief after an action completes.
 * Fire-and-forget — callers should .catch(console.error).
 */
async function updateSessionBrief(sessionId, userId, actionType, actionPayload) {
  const session = await loadSession(sessionId);
  if (!session) return;

  const currentBrief = session.sessionBrief || '';
  const idea = session.idea || '';

  const prompt = `You are a session context manager. Your job is to maintain a running brief that captures the key insights, decisions, and artifacts from a thinking session.

CURRENT SESSION IDEA: ${idea}

CURRENT BRIEF:
${currentBrief || '(empty — this is the first action)'}

NEW ACTION: ${actionType}
ACTION DETAILS:
${typeof actionPayload === 'string' ? actionPayload : JSON.stringify(actionPayload, null, 2)}

Update the running brief to incorporate the new action's key insights. Rules:
- Keep the brief under ${MAX_BRIEF_WORDS} words
- Preserve the most important insights from the existing brief
- Add new insights from this action
- Use bullet points for clarity
- Focus on decisions, discoveries, trade-offs, and key conclusions
- Drop redundant or superseded information
- Do NOT include meta-commentary about the brief itself

Return ONLY the updated brief text, nothing else.`;

  try {
    const result = await ai.call({
      model: 'gemini:flash',
      system: 'You are a concise context summarizer. Return only the updated brief.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
    });

    const updatedBrief = (result || '').trim();
    if (updatedBrief) {
      await updateSession(sessionId, { sessionBrief: updatedBrief });
    }
  } catch (err) {
    console.error('sessionBrief update failed:', err.message);
  }
}

/**
 * Generate a short 2-3 sentence summary for cross-session pollination.
 * Called at milestones: export, debate finalize, 15+ nodes.
 */
async function generateSessionSummary(sessionId) {
  const session = await loadSession(sessionId);
  if (!session) return;

  const brief = session.sessionBrief || '';
  const idea = session.idea || '';
  const artifacts = session.artifacts || [];

  if (!brief && !idea) return;

  const prompt = `Summarize this thinking session in 2-3 sentences for future reference.

IDEA: ${idea}
BRIEF: ${brief}
ARTIFACTS PRODUCED: ${artifacts.map(a => `${a.type}: ${a.title || a.summary || ''}`).join('; ') || 'none yet'}

Write a concise summary capturing: what was explored, key insights discovered, and what was produced. Return ONLY the summary.`;

  try {
    const result = await ai.call({
      model: 'gemini:flash',
      system: 'You write concise session summaries. Return only the summary text.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
    });

    const summary = (result || '').trim();
    if (summary) {
      await updateSession(sessionId, { sessionSummary: summary });
    }
  } catch (err) {
    console.error('sessionSummary generation failed:', err.message);
  }
}

module.exports = { updateSessionBrief, generateSessionSummary };
