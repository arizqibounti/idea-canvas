// ── GitHub Repo Analyzer ─────────────────────────────────────
// Fetches files from a GitHub repo via API, applies the same
// scoring/filtering as CodebaseUpload, then runs codebase analysis.

const { sseHeaders, attachAbortSignal, autoStreamToSSE } = require('../utils/sse');
const ai = require('../ai/providers');
const { CODEBASE_ANALYSIS_PROMPT } = require('./prompts');

// ── Config ───────────────────────────────────────────────────
// Gemini 3.1 Pro has 1M token context — we can send much more code
const MAX_FILES = 300;
const MAX_TOTAL_CHARS = 400000; // ~400KB — well within Gemini's 1M token window
const MAX_FILE_CHARS = 8000;
const GITHUB_API = 'https://api.github.com';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.cache',
  'coverage', '__pycache__', '.pytest_cache', 'venv', 'env', '.venv',
  'vendor', 'target', 'bin', 'obj', '.idea', '.vscode', '.output',
  'public/assets', 'static/assets', '.turbo', '.vercel', '.netlify',
]);

const SKIP_EXTENSIONS = new Set([
  '.lock', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.webm', '.zip',
  '.tar', '.gz', '.map', '.min.js', '.min.css', '.pyc', '.exe', '.dll',
  '.so', '.dylib', '.pdf', '.pptx', '.xlsx', '.docx',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.rb', '.java',
  '.kt', '.swift', '.c', '.cpp', '.h', '.cs', '.php', '.vue', '.svelte',
  '.html', '.css', '.scss', '.less', '.sql', '.sh', '.bash', '.yaml',
  '.yml', '.toml', '.json', '.md', '.txt', '.env.example', '.dockerfile',
  '.tf', '.proto', '.graphql', '.prisma',
]);

// High-value file patterns (higher score = fetched first)
const HIGH_VALUE_PATTERNS = [
  { pattern: /package\.json$/, score: 10 },
  { pattern: /Cargo\.toml$/, score: 10 },
  { pattern: /go\.mod$/, score: 10 },
  { pattern: /requirements\.txt$/, score: 9 },
  { pattern: /pyproject\.toml$/, score: 9 },
  { pattern: /(README|CHANGELOG)\.md$/i, score: 8 },
  { pattern: /Dockerfile/i, score: 7 },
  { pattern: /docker-compose/i, score: 7 },
  { pattern: /\.env\.example$/, score: 7 },
  { pattern: /\/(routes|api|handlers|controllers)\//i, score: 9 },
  { pattern: /\/(models|schema|entities)\//i, score: 8 },
  { pattern: /\/(middleware|auth)\//i, score: 8 },
  { pattern: /\/(components|pages|views)\//i, score: 7 },
  { pattern: /\/(services|utils|helpers)\//i, score: 6 },
  { pattern: /(index|main|app|server)\.(js|ts|py|go|rs)$/, score: 8 },
];

// ── Parse GitHub URL ─────────────────────────────────────────
function parseGitHubUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/\s#?]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

// ── Score a file path ────────────────────────────────────────
function scoreFile(path) {
  let score = 1;
  for (const { pattern, score: s } of HIGH_VALUE_PATTERNS) {
    if (pattern.test(path)) { score = Math.max(score, s); break; }
  }
  return score;
}

// ── Should skip a file path ──────────────────────────────────
function shouldSkip(path) {
  const parts = path.split('/');
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return true;
  }
  const ext = '.' + path.split('.').pop()?.toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return true;
  if (!CODE_EXTENSIONS.has(ext) && !path.endsWith('.json')) return true;
  return false;
}

// ── Fetch repo file tree from GitHub API ─────────────────────
async function fetchRepoTree(owner, repo, branch = 'main', token) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ThoughtClaw/1.0',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Try the specified branch, fallback to 'master'
  let lastStatus = 0;
  for (const ref of [branch, branch === 'main' ? 'master' : null].filter(Boolean)) {
    try {
      const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, { headers });
      lastStatus = res.status;
      if (res.ok) {
        const data = await res.json();
        return { tree: data.tree || [], branch: ref };
      }
    } catch {}
  }
  if (lastStatus === 403) throw new Error(`GitHub API rate limit exceeded. Connect GitHub OAuth or try again later.`);
  if (lastStatus === 404) throw new Error(`Repository ${owner}/${repo} not found. Check the URL or connect GitHub for private repos.`);
  throw new Error(`Could not fetch repo tree for ${owner}/${repo} (HTTP ${lastStatus})`);
}

// ── Fetch a single file's content ────────────────────────────
async function fetchFileContent(owner, repo, path, branch, token) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ThoughtClaw/1.0',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.encoding === 'base64' && data.content) {
      const text = Buffer.from(data.content, 'base64').toString('utf8');
      return text.slice(0, MAX_FILE_CHARS);
    }
    return null;
  } catch {
    return null;
  }
}

// ── Main: Fetch and filter repo files ────────────────────────
async function fetchRepoFiles(repoUrl, branch = 'main', token, onProgress) {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) throw new Error('Invalid GitHub URL. Expected: https://github.com/owner/repo');

  const { owner, repo } = parsed;
  onProgress?.(`Fetching file tree for ${owner}/${repo}...`);

  const { tree, branch: resolvedBranch } = await fetchRepoTree(owner, repo, branch, token);

  // Filter to code files only
  const codeFiles = tree
    .filter(item => item.type === 'blob' && !shouldSkip(item.path))
    .map(item => ({ path: item.path, size: item.size || 0, score: scoreFile(item.path) }))
    .sort((a, b) => b.score - a.score) // highest score first
    .slice(0, MAX_FILES);

  onProgress?.(`Found ${codeFiles.length} relevant files. Fetching content...`);

  // Fetch file contents in batches of 10 (respect rate limits)
  const files = [];
  let totalChars = 0;
  const BATCH_SIZE = 20;

  for (let i = 0; i < codeFiles.length; i += BATCH_SIZE) {
    if (totalChars >= MAX_TOTAL_CHARS) break;

    const batch = codeFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(f => fetchFileContent(owner, repo, f.path, resolvedBranch, token))
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled' && results[j].value) {
        const content = results[j].value;
        if (totalChars + content.length > MAX_TOTAL_CHARS) break;
        files.push({ path: batch[j].path, content });
        totalChars += content.length;
      }
    }

    onProgress?.(`Fetched ${files.length}/${codeFiles.length} files (${Math.round(totalChars / 1024)}KB)...`);
  }

  return {
    files,
    folderName: `${owner}/${repo}`,
    totalFiles: tree.filter(i => i.type === 'blob').length,
    fetchedFiles: files.length,
    filesOmitted: codeFiles.length - files.length,
    branch: resolvedBranch,
  };
}

// ── SSE Handler ──────────────────────────────────────────────
async function handleAnalyzeGithub(_client, req, res) {
  const { repoUrl, branch, analysisGoals, githubToken } = req.body;
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

  // Get token: prefer explicit token from request, fallback to GitHub integration OAuth token
  let token = githubToken || null;
  if (!token) {
    try {
      const integrationRegistry = require('../integrations/registry');
      const ghIntegration = integrationRegistry.get('github');
      if (ghIntegration?.api?.getToken) token = ghIntegration.api.getToken();
    } catch {}
  }

  sseHeaders(res);
  attachAbortSignal(req, res);
  const signal = req.signal;

  try {
    // Phase 1: Fetch repo files
    res.write(`data: ${JSON.stringify({ _progress: true, stage: 'Connecting to GitHub...' })}\n\n`);

    const result = await fetchRepoFiles(repoUrl, branch || 'main', token, (stage) => {
      res.write(`data: ${JSON.stringify({ _progress: true, stage })}\n\n`);
    });

    if (!result.files.length) {
      res.write(`data: ${JSON.stringify({ error: 'No code files found in this repository' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    res.write(`data: ${JSON.stringify({ _progress: true, stage: `Analyzing ${result.fetchedFiles} files from ${result.folderName}...` })}\n\n`);

    // Phase 2: Run analysis (same logic as handleAnalyzeCodebase)
    const goals = analysisGoals || ['features', 'architecture', 'users'];
    const goalDescriptions = {
      features: 'Product Features — What the app does: routes, components, handlers, business logic.',
      architecture: 'Architecture & Constraints — Tech debt, coupling, bottlenecks, patterns, dependencies.',
      users: 'User Segments & Flows — Inferred user types from auth, roles, data models.',
    };

    const goalBlock = goals.map(g => `- ${goalDescriptions[g] || g}`).join('\n');
    const fileBlock = result.files.map(f => `// FILE: ${f.path}\n${f.content}`).join('\n\n');
    const nodeTarget = result.fetchedFiles > 100 ? '100-150' : result.fetchedFiles > 50 ? '60-100' : result.fetchedFiles > 20 ? '40-60' : '20-30';

    const userContent = `Project: ${result.folderName} (${result.fetchedFiles} files fetched, ${result.totalFiles} total in repo, branch: ${result.branch})

Analysis goals:
${goalBlock}

Codebase files (${result.fetchedFiles} files):

${fileBlock}

Generate ${nodeTarget} thinking nodes covering all analysis goals. Ground every node in specific file paths, function names, and code patterns you observe.`;

    const streamResult = await ai.stream({
      model: 'gemini:pro',
      system: CODEBASE_ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 16384,
      signal,
    });

    // Stream nodes as SSE (autoStreamToSSE handles both Claude and Gemini)
    await autoStreamToSSE(res, streamResult);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('GitHub analysis error:', err);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

module.exports = { handleAnalyzeGithub, fetchRepoFiles, parseGitHubUrl };
