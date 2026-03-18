// ── Specialty engine handlers ─────────────────────────────────
// Now uses the AI provider abstraction layer.

const nodeFetch = require('node-fetch');

const {
  MOCKUP_PROMPT,
  RESUME_CHANGES_PROMPT,
} = require('./prompts');

const { fetchPage, extractInternalLinks, scoreLinks, HUB_PATTERNS } = require('../utils/web');
const ai = require('../ai/providers');

// ── POST /api/mockup ──────────────────────────────────────────

async function handleMockup(_client, req, res) {
  const { featureNode, ancestorContext } = req.body;
  if (!featureNode) return res.status(400).json({ error: 'featureNode is required' });

  // Build a rich description of the feature from the tree context
  const contextSummary = (ancestorContext || []).map(n =>
    `[${n.type}] ${n.label}: ${n.reasoning}`
  ).join('\n');

  const userMessage = `FEATURE TO DEMO:
Label: "${featureNode.label}"
Reasoning: ${featureNode.reasoning}

PRODUCT TREE CONTEXT (ancestors — understand what problem this solves and for whom):
${contextSummary || '(no additional context)'}

Generate the complete HTML demo file for this feature. The demo should show this specific feature — "${featureNode.label}" — actually working, with realistic UI and real simulated interactions. Not wireframe boxes. The actual feature UI.`;

  try {
    const { text } = await ai.call({
      model: 'claude:opus',
      system: MOCKUP_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 6000,
      signal: req.signal,
    });

    let html = text;
    // Strip any accidental markdown fences
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
      throw new Error('Model did not return valid HTML');
    }

    res.json({ html });
  } catch (err) {
    console.error('Mockup error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/resume/changes ──────────────────────────────────
// Generates a precise change manifest from the debate output

async function handleResumeChanges(_client, req, res) {
  const { resumePdf, nodes, debateHistory, idea } = req.body;
  if (!nodes?.length) return res.status(400).json({ error: 'nodes required' });

  const historyText = (debateHistory || []).map((r) => `
Round ${r.round} — Hiring Manager Verdict: ${r.verdict}
Summary: ${r.summary || ''}
Critiques: ${JSON.stringify((r.critiques || []).map(c => ({ category: c.category, challenge: c.challenge, reasoning: c.reasoning, targetNode: c.targetNodeLabel })))}
Career Coach Responses: ${JSON.stringify((r.rebutNodes || []).map(n => ({ label: n.data?.label || n.label, reasoning: n.data?.reasoning || n.reasoning })))}
`).join('\n');

  const contentParts = [];

  if (resumePdf) {
    contentParts.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: resumePdf },
    });
  }

  contentParts.push({
    type: 'text',
    text: `Role / JD context: "${idea || 'target role'}"

Final resume strategy tree (${nodes.length} nodes — represents the full picture of what the resume should convey):
${JSON.stringify(nodes, null, 2)}

Debate history (${debateHistory?.length || 0} rounds — hiring manager critique + career coach responses):
${historyText || '(no debate history provided)'}

${resumePdf
  ? 'The PDF above is the candidate\'s current resume. Cross-reference it with the debate findings to generate the change manifest.'
  : 'No PDF resume was provided — generate changes based on the strategy tree and debate findings alone, framing them as recommendations rather than direct text replacements.'}

Generate the change manifest now.`,
  });

  try {
    const requestOptions = resumePdf ? { headers: { 'anthropic-beta': 'pdfs-2024-09-25' } } : undefined;

    const { text } = await ai.call({
      model: 'claude:opus',
      system: RESUME_CHANGES_PROMPT,
      messages: [{ role: 'user', content: contentParts }],
      maxTokens: 4096,
      signal: req.signal,
      requestOptions,
    });

    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    res.json(parsed);
  } catch (err) {
    console.error('Resume changes error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/export/github ─────────────────────────────────────
// Creates a new GitHub repo and pushes markdown files via the Contents API

async function handleExportGithub(_client, req, res) {
  const { token, repoName, repoDescription, isPrivate, files } = req.body;

  if (!token) return res.status(400).json({ error: 'GitHub token is required' });
  if (!repoName) return res.status(400).json({ error: 'Repository name is required' });
  if (!files || !Object.keys(files).length) return res.status(400).json({ error: 'At least one file is required' });

  const ghFetch = (url, opts = {}) => nodeFetch(url, {
    ...opts,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });

  try {
    // Step 1: Create repo (no auto_init — we'll push files directly)
    const createRes = await ghFetch('https://api.github.com/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        description: repoDescription || 'Product spec exported from Idea Graph',
        private: isPrivate !== false,
        auto_init: false,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      if (createRes.status === 401) return res.status(401).json({ error: 'Invalid GitHub token. Please check your Personal Access Token.' });
      if (createRes.status === 422) return res.status(422).json({ error: `Repository "${repoName}" already exists. Choose a different name.` });
      if (createRes.status === 403) return res.status(403).json({ error: 'GitHub rate limit or permissions issue. Try again later.' });
      return res.status(createRes.status).json({ error: err.message || `GitHub error: ${createRes.status}` });
    }

    const repo = await createRes.json();
    const owner = repo.owner.login;
    const repoFullName = `${owner}/${repoName}`;

    // Step 2: Push files sequentially via Contents API
    // The first file creates the initial commit; subsequent files chain on it
    const fileEntries = Object.entries(files);
    for (let i = 0; i < fileEntries.length; i++) {
      const [filename, content] = fileEntries[i];
      const encoded = Buffer.from(content, 'utf-8').toString('base64');

      const putRes = await ghFetch(`https://api.github.com/repos/${repoFullName}/contents/${filename}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: i === 0
            ? 'Export product spec from Idea Graph'
            : `Add ${filename}`,
          content: encoded,
        }),
      });

      if (!putRes.ok) {
        const putErr = await putRes.json().catch(() => ({}));
        console.error(`Failed to push ${filename}:`, putRes.status, putErr);
        if (putRes.status === 403) {
          throw new Error(`Permission denied. If using a fine-grained PAT, add "Contents" read & write permission. Or use a classic PAT with "repo" scope.`);
        }
        throw new Error(`Failed to push ${filename}: ${putErr.message || putRes.status}`);
      }
    }

    res.json({
      repoUrl: repo.html_url,
      repoFullName,
    });
  } catch (err) {
    console.error('GitHub export error:', err);
    res.status(500).json({ error: err.message || 'Failed to export to GitHub' });
  }
}

// ── POST /api/fetch-url ────────────────────────────────────────
// Proxy-fetches a URL and returns stripped plain text (for JD scraping)

async function handleFetchUrl(_client, req, res) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const result = await fetchPage(url);
    if (!result) throw new Error('Failed to fetch page');
    res.json({ text: result.text });
  } catch (err) {
    console.error('fetch-url error:', err.message);
    res.status(500).json({ error: `Failed to fetch URL: ${err.message}` });
  }
}

// ── POST /api/crawl-site ──────────────────────────────────────
// Two-level crawl: fetches the root page, discovers subpages, then
// dives deeper into "hub" pages (blog, docs, solutions) to find
// content that's only linked from those hub index pages.

async function handleCrawlSite(_client, req, res) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const MAX_PAGES = 20;
  const PER_PAGE_CHARS = 6000;

  try {
    // 1. Fetch the root page
    const root = await fetchPage(url, PER_PAGE_CHARS);
    if (!root) throw new Error('Failed to fetch root page');

    const fetched = new Set([root.url]);
    const pages = [{ url: root.url, text: root.text }];

    // 2. Extract + score internal links from root
    const rootLinks = extractInternalLinks(root.html, url);
    const level1Budget = Math.min(10, MAX_PAGES - 1);
    const level1Links = scoreLinks(rootLinks, fetched).slice(0, level1Budget).map(s => s.link);

    // 3. Fetch Level 1 subpages in parallel
    const level1Results = await Promise.all(level1Links.map(link => fetchPage(link, PER_PAGE_CHARS)));
    const level1Pages = [];
    for (const r of level1Results) {
      if (!r) continue;
      fetched.add(r.url);
      pages.push({ url: r.url, text: r.text });
      level1Pages.push(r);
    }

    // 4. Identify hub pages among Level 1 results and crawl deeper
    if (pages.length < MAX_PAGES) {
      const hubs = level1Pages.filter(r => HUB_PATTERNS.some(p => p.test(new URL(r.url).pathname)));

      if (hubs.length) {
        // Collect all Level 2 candidate links from hub pages
        let level2Candidates = [];
        for (const hub of hubs) {
          const hubLinks = extractInternalLinks(hub.html, hub.url);
          level2Candidates.push(...hubLinks);
        }

        const level2Budget = MAX_PAGES - pages.length;
        const level2Links = scoreLinks(level2Candidates, fetched).slice(0, level2Budget).map(s => s.link);

        if (level2Links.length) {
          const level2Results = await Promise.all(level2Links.map(link => fetchPage(link, PER_PAGE_CHARS)));
          for (const r of level2Results) {
            if (!r) continue;
            fetched.add(r.url);
            pages.push({ url: r.url, text: r.text });
          }
        }
        console.log(`crawl-site: deep-crawled ${hubs.length} hub(s): ${hubs.map(h => new URL(h.url).pathname).join(', ')}`);
      }
    }

    console.log(`crawl-site: fetched ${pages.length} pages from ${url}`);
    res.json({ pages });
  } catch (err) {
    console.error('crawl-site error:', err.message);
    res.status(500).json({ error: `Failed to crawl site: ${err.message}` });
  }
}

module.exports = {
  handleMockup,
  handleResumeChanges,
  handleExportGithub,
  handleFetchUrl,
  handleCrawlSite,
};
