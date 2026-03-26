// ── GitHub Integration ────────────────────────────────────────
// OAuth-based GitHub connection for accessing private repos.
// Follows the same pattern as the Gmail integration.

const { getIntegrationConfig, setIntegrationConfig, removeIntegrationConfig } = require('../config');
const registry = require('../registry');

const INTEGRATION_ID = 'github';
const SCOPES = 'repo read:org';
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API = 'https://api.github.com';

// ── In-memory runtime state ──────────────────────────────────
let runtimeToken = null;   // GitHub access token
let runtimeUser = null;    // { login, name, avatarUrl }
const stateStore = new Map();

// ── Config helpers ───────────────────────────────────────────

function getClientId() {
  const cfg = getIntegrationConfig(INTEGRATION_ID);
  return cfg?.clientId || process.env.GITHUB_CLIENT_ID;
}

function getClientSecret() {
  const cfg = getIntegrationConfig(INTEGRATION_ID);
  return cfg?.clientSecret || process.env.GITHUB_CLIENT_SECRET;
}

function getRedirectUri() {
  const cfg = getIntegrationConfig(INTEGRATION_ID);
  return cfg?.redirectUri || process.env.GITHUB_REDIRECT_URI || 'http://localhost:5001/api/integrations/github/callback';
}

function isConfigured() {
  return !!(getClientId() && getClientSecret());
}

// ── Lifecycle ────────────────────────────────────────────────

async function init() {
  const configured = isConfigured();

  // Restore session from persisted token
  if (configured) {
    const cfg = getIntegrationConfig(INTEGRATION_ID);
    if (cfg?.accessToken) {
      try {
        const res = await fetch(`${GITHUB_API}/user`, {
          headers: {
            'Authorization': `Bearer ${cfg.accessToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'ThoughtClaw/1.0',
          },
        });
        if (res.ok) {
          const user = await res.json();
          runtimeToken = cfg.accessToken;
          runtimeUser = { login: user.login, name: user.name, avatarUrl: user.avatar_url };
          console.log(`GitHub: restored session for @${user.login}`);
        } else {
          console.log('GitHub: saved token expired or invalid');
        }
      } catch (err) {
        console.warn('GitHub: failed to restore session:', err.message);
      }
    }
  }

  return { configured };
}

function connect() {
  if (!isConfigured()) throw new Error('GitHub not configured (missing GITHUB_CLIENT_ID/SECRET)');

  const state = `gh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  stateStore.set(state, Date.now());
  setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state,
  });

  return { authUrl: `${GITHUB_AUTH_URL}?${params.toString()}` };
}

async function handleCallback(code, state) {
  if (!stateStore.has(state)) throw new Error('Invalid state parameter');
  stateStore.delete(state);

  // Exchange code for access token
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      code,
      redirect_uri: getRedirectUri(),
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

  runtimeToken = tokenData.access_token;

  // Persist token
  const existing = getIntegrationConfig(INTEGRATION_ID) || {};
  setIntegrationConfig(INTEGRATION_ID, {
    ...existing,
    accessToken: runtimeToken,
    connectedAt: new Date().toISOString(),
  });

  // Fetch user info
  const userRes = await fetch(`${GITHUB_API}/user`, {
    headers: {
      'Authorization': `Bearer ${runtimeToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ThoughtClaw/1.0',
    },
  });
  const user = await userRes.json();
  runtimeUser = { login: user.login, name: user.name, avatarUrl: user.avatar_url };

  return { login: user.login, name: user.name };
}

function disconnect() {
  runtimeToken = null;
  runtimeUser = null;
  removeIntegrationConfig(INTEGRATION_ID);
}

function status() {
  return {
    configured: isConfigured(),
    connected: !!runtimeToken,
    account: runtimeUser?.login || null,
    name: runtimeUser?.name || null,
  };
}

// ── API methods ──────────────────────────────────────────────

async function listRepos(query = '', perPage = 20) {
  if (!runtimeToken) throw new Error('Not connected to GitHub');

  const url = query
    ? `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}+in:name+user:${runtimeUser?.login}&per_page=${perPage}`
    : `${GITHUB_API}/user/repos?sort=updated&per_page=${perPage}`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${runtimeToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ThoughtClaw/1.0',
    },
  });

  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  const repos = query ? (data.items || []) : data;

  return repos.map(r => ({
    fullName: r.full_name,
    name: r.name,
    owner: r.owner?.login,
    description: r.description,
    private: r.private,
    language: r.language,
    stars: r.stargazers_count,
    updatedAt: r.updated_at,
    defaultBranch: r.default_branch,
    url: r.html_url,
  }));
}

function getToken() {
  return runtimeToken;
}

// ── Register with integration registry ───────────────────────

registry.register(INTEGRATION_ID, {
  id: INTEGRATION_ID,
  name: 'GitHub',
  description: 'Connect GitHub to analyze private repositories',
  init,
  connect,
  handleCallback,
  disconnect,
  status: () => status(),
  hooks: {},
  api: { listRepos, getToken },
});

module.exports = {
  INTEGRATION_ID,
  init,
  connect,
  handleCallback,
  disconnect,
  status,
  listRepos,
  getToken,
};
