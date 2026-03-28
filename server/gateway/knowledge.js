// ── Zettelkasten Knowledge Store ─────────────────────────────
// Persistent cross-session node storage for pattern recognition.
// Falls back to in-memory store if Firestore is unavailable.

const { v4: uuidv4 } = require('uuid');

let db = null;
let useFirestore = false;
const memoryStore = new Map(); // userId -> array of knowledge nodes

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection('knowledge').limit(1).get()
      .then(() => {
        useFirestore = true;
        console.log('Knowledge Firestore connected');
      })
      .catch(() => {
        console.log('Knowledge: Firestore unavailable — using in-memory store');
      });
  } catch {
    console.log('Knowledge: Firestore SDK not configured — using in-memory store');
  }
}

initFirestore();

/**
 * Save generated nodes to the knowledge store.
 * @param {string} userId - user ID
 * @param {string} sessionId - session ID
 * @param {string} idea - the original idea/prompt
 * @param {Array} nodes - array of generated node objects
 */
async function saveNodes(userId, sessionId, idea, nodes) {
  const timestamp = new Date().toISOString();
  const knowledgeNodes = nodes
    .filter(n => !n._meta && !n._progress)
    .map(n => ({
      id: `kn_${uuidv4().slice(0, 8)}`,
      nodeId: n.id,
      sessionId,
      userId: userId || 'local',
      idea: idea?.slice(0, 200) || '',
      label: n.label || '',
      type: n.type || 'unknown',
      reasoning: n.reasoning || '',
      tags: extractTags(n.label, n.reasoning),
      createdAt: timestamp,
    }));

  if (useFirestore) {
    const batch = db.batch();
    for (const kn of knowledgeNodes) {
      const ref = db.collection('knowledge').doc(kn.id);
      batch.set(ref, kn);
    }
    await batch.commit();
  } else {
    const existing = memoryStore.get(userId || 'local') || [];
    memoryStore.set(userId || 'local', [...existing, ...knowledgeNodes]);
  }

  return knowledgeNodes.length;
}

/**
 * Extract simple tags from label and reasoning.
 */
function extractTags(label, reasoning) {
  const text = `${label} ${reasoning}`.toLowerCase();
  // Extract meaningful words (3+ chars, not common stop words)
  const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'from', 'that', 'with', 'this', 'they', 'will', 'each', 'make', 'like', 'long', 'look', 'many', 'some', 'them', 'than', 'would', 'been', 'most', 'more', 'into', 'over', 'such']);
  const words = text.match(/\b[a-z]{3,}\b/g) || [];
  const unique = [...new Set(words.filter(w => !stopWords.has(w)))];
  return unique.slice(0, 10);
}

/**
 * Find similar past knowledge nodes by tag overlap.
 * @param {string} userId - user ID
 * @param {Array} tags - tags to match against
 * @param {number} limit - max results
 * @returns {Array} similar knowledge nodes
 */
async function findSimilar(userId, tags, limit = 10) {
  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  if (useFirestore) {
    // Query all user's knowledge nodes and rank by tag overlap
    const snapshot = await db.collection('knowledge')
      .where('userId', '==', userId || 'local')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const scored = snapshot.docs.map(doc => {
      const data = doc.data();
      const overlap = (data.tags || []).filter(t => tagSet.has(t)).length;
      return { ...data, score: overlap };
    }).filter(n => n.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  } else {
    const all = memoryStore.get(userId || 'local') || [];
    const scored = all.map(n => {
      const overlap = (n.tags || []).filter(t => tagSet.has(t)).length;
      return { ...n, score: overlap };
    }).filter(n => n.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

/**
 * Get knowledge clusters — group nodes by tag co-occurrence.
 * @param {string} userId - user ID
 * @returns {Array} clusters with sessions and node counts
 */
async function getNodeClusters(userId) {
  let allNodes;
  if (useFirestore) {
    const snapshot = await db.collection('knowledge')
      .where('userId', '==', userId || 'local')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();
    allNodes = snapshot.docs.map(doc => doc.data());
  } else {
    allNodes = memoryStore.get(userId || 'local') || [];
  }

  if (allNodes.length === 0) return { clusters: [], totalNodes: 0, totalSessions: 0 };

  // Build tag frequency map
  const tagCount = {};
  allNodes.forEach(n => {
    (n.tags || []).forEach(tag => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });

  // Find top recurring tags (appeared in 3+ nodes)
  const recurringTags = Object.entries(tagCount)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // Build clusters from top tags
  const clusters = recurringTags.map(([tag, count]) => {
    const members = allNodes.filter(n => (n.tags || []).includes(tag));
    const sessions = [...new Set(members.map(n => n.sessionId))];
    const ideas = [...new Set(members.map(n => n.idea).filter(Boolean))];
    return {
      tag,
      nodeCount: count,
      sessionCount: sessions.length,
      ideas: ideas.slice(0, 5),
      recentNodes: members.slice(0, 5).map(n => ({
        label: n.label,
        type: n.type,
        sessionId: n.sessionId,
        idea: n.idea,
      })),
    };
  });

  const totalSessions = [...new Set(allNodes.map(n => n.sessionId))].length;
  return { clusters, totalNodes: allNodes.length, totalSessions };
}

/**
 * Get knowledge context for AI generation — similar past nodes.
 * Returns a brief string to inject into generation prompts.
 */
async function getKnowledgeContext(userId, idea) {
  if (!idea) return '';
  const tags = extractTags(idea, '');
  if (tags.length === 0) return '';

  const similar = await findSimilar(userId, tags, 5);
  if (similar.length === 0) return '';

  const contextLines = similar.map(n =>
    `- [${n.type}] "${n.label}" (from session about: "${n.idea?.slice(0, 80)}")`
  );

  return `\n\nZETTELKASTEN CONTEXT — You've explored similar ideas in past sessions:\n${contextLines.join('\n')}\nBuild on these previous insights where relevant. Don't repeat them verbatim.`;
}

/**
 * Cross-session pollination — find related past sessions and return their summaries.
 * @param {string} userId - user ID
 * @param {string} idea - current session idea
 * @param {string} currentSessionId - exclude current session
 * @returns {string} formatted context block or empty string
 */
async function getSessionPollination(userId, idea, currentSessionId) {
  if (!userId || !idea) return '';

  try {
    const { listSessions } = require('./sessions');
    const sessions = await listSessions(userId, 50);

    // Filter: exclude current session, only those with summaries
    const candidates = sessions.filter(
      s => s.id !== currentSessionId && s.sessionSummary
    );
    if (candidates.length === 0) return '';

    // Score by tag overlap with current idea
    const ideaTags = extractTags(idea, '');
    if (ideaTags.length === 0) return '';

    const scored = candidates.map(s => {
      const sessionTags = extractTags(s.idea || '', '');
      const overlap = ideaTags.filter(t => sessionTags.includes(t)).length;
      return { ...s, overlap };
    }).filter(s => s.overlap > 0);

    scored.sort((a, b) => b.overlap - a.overlap);
    const top = scored.slice(0, 3);
    if (top.length === 0) return '';

    const lines = top.map(s => {
      const ago = getTimeAgo(s.updatedAt);
      return `- "${s.idea?.slice(0, 80)}" (${ago}): ${s.sessionSummary}`;
    });

    return `PRIOR SESSIONS (insights from your related past work):\n${lines.join('\n')}`;
  } catch (err) {
    console.error('Session pollination error:', err.message);
    return '';
  }
}

function getTimeAgo(dateStr) {
  if (!dateStr) return 'unknown';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

module.exports = {
  saveNodes,
  findSimilar,
  getNodeClusters,
  getKnowledgeContext,
  getSessionPollination,
  extractTags,
};
