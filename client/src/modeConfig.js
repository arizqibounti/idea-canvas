// ── Mode Configuration ────────────────────────────────────────────────────────
// Each mode defines: display (icon, label, color), input placeholder,
// and keyword signals used for auto-detection from the input text.

export const MODES = [
  {
    id: 'idea',
    label: 'IDEA',
    icon: '◈',
    color: '#6c63ff',
    placeholder: 'describe your idea, product, or startup concept...',
    keywords: [
      'app', 'startup', 'product', 'build', 'feature', 'mvp', 'saas',
      'platform', 'tool', 'launch', 'service', 'marketplace', 'software',
      'mobile app', 'web app',
    ],
  },
  {
    id: 'codebase',
    label: 'CODE',
    icon: '⟨/⟩',
    color: '#20c997',
    placeholder: 'describe the codebase to analyze, or switch to upload files...',
    keywords: [
      'codebase', 'repository', 'github', 'refactor', 'reverse engineer',
      'analyze code', 'code review',
    ],
  },
  {
    id: 'resume',
    label: 'RESUME',
    icon: '◎',
    color: '#74c0fc',
    placeholder: 'paste a job description or describe the role you\'re applying for...',
    keywords: [
      'resume', 'cv', 'job', 'apply', 'career', 'interview', 'hiring',
      'cover letter', 'application', 'recruiter', 'linkedin',
      'job description', 'work at', 'work for',
      // Job-description-style signals (pasted JD)
      'requirements', 'qualifications', 'we are looking for', 'responsibilities',
      'years of experience', 'must have', 'nice to have', 'you will own',
      'preferred', 'you will be', 'we offer', 'about the role',
    ],
  },
  {
    id: 'decision',
    label: 'DECIDE',
    icon: '⚖',
    color: '#ffa94d',
    placeholder: 'describe the decision you\'re trying to make...',
    keywords: [
      'decide', 'decision', 'should i', 'comparing', 'pros and cons',
      'trade-off', 'tradeoff', 'choice', 'whether to', 'dilemma',
      'pick between', 'choose between', 'options are',
    ],
  },
  {
    id: 'writing',
    label: 'WRITE',
    icon: '✦',
    color: '#f06595',
    placeholder: 'describe what you want to write — essay, article, proposal, report...',
    keywords: [
      'write', 'essay', 'article', 'blog post', 'proposal', 'draft',
      'argument', 'thesis', 'paper', 'newsletter', 'report', 'memo',
      'opinion piece', 'pitch deck', 'white paper',
    ],
  },
  {
    id: 'plan',
    label: 'PLAN',
    icon: '◉',
    color: '#69db7c',
    placeholder: 'describe the project, goal, or initiative you\'re planning...',
    keywords: [
      'plan', 'roadmap', 'timeline', 'milestones', 'okr', 'project plan',
      'schedule', 'sprint', 'quarterly', 'initiative', 'launch plan',
      'go-to-market', 'gtm',
    ],
  },
];

// ── Mode Detection ─────────────────────────────────────────────────────────────
// Scores each mode based on keyword matches in the input text.
// Returns the winning mode id, or null if no clear signal.
export function detectMode(text) {
  if (!text || text.trim().length < 8) return null;

  const lower = text.toLowerCase();
  const scores = {};

  for (const mode of MODES) {
    scores[mode.id] = 0;
    for (const keyword of mode.keywords) {
      if (lower.includes(keyword)) {
        // Multi-word phrases score higher than single words
        scores[mode.id] += keyword.trim().includes(' ') ? 2 : 1;
      }
    }
  }

  // Find the top two scores
  let topId = null;
  let topScore = 0;
  let secondScore = 0;

  for (const mode of MODES) {
    const s = scores[mode.id];
    if (s > topScore) {
      secondScore = topScore;
      topScore = s;
      topId = mode.id;
    } else if (s > secondScore) {
      secondScore = s;
    }
  }

  // No meaningful match
  if (topScore === 0) return null;

  // Tied at the top — ambiguous, don't suggest
  if (topScore === secondScore) return null;

  // 'idea' keywords are generic; require clear lead to avoid false positives
  if (topId === 'idea' && topScore <= 1) return null;

  return topId;
}
