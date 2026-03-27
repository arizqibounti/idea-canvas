// ── GitHub OAuth Integration ─────────────────────────────────
// Follows the Gmail integration pattern: OAuth lifecycle, token
// management, and API access for private repos.

const { getIntegrationConfig, setIntegrationConfig } = require('../config');
const registry = require('../registry');

const INTEGRATION_ID = 'github';
const SCOPES = 'repo read:user';

// In-memory runtime state
let runtimeToken = null;
let runtimeUsername = null;
const stateStore = new Map();

function getClientConfig() {
  const cfg = getIntegrationConfig(INTEGRATION_ID);
  const clientId = cfg?.clientId || process.env.GITHUB_CLIENT_ID;
  const clientSecret = cfg?.clientSecret || process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = cfg?.redirectUri || process.env.GITHUB_REDIRECT_URI || `${process.env.BASE_URL || 'http://localhost:5001'}/api/integrations/github/callback`;
  return { clientId, clientSecret, redirectUri };
}

function isConfigured() {
  const { clientId, clientSecret } = getClientConfig();
  return !!(clientId && clientSecret);
}

function init() {
  if (!isConfigured()) {
    console.log('GitHub: not configured (set GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET)');
    return { configured: false };
  }
  const cfg = getIntegrationConfig(INTEGRATION_ID);
  if (cfg?.accessToken) {
    runtimeToken = cfg.accessToken;
    runtimeUsername = cfg.username || null;
    console.log(`GitHub: restored session for @${runtimeUsername || 'unknown'}`);
  } else {
    console.log('GitHub: configured, not connected');
  }
  return { configured: true };
}

function connect() {
  if (!isConfigured()) return { error: 'GitHub OAuth not configured' };
  const { clientId, redirectUri } = getClientConfig();
  const state = Math.random().toString(36).slice(2);
  stateStore.set(state, Date.now());
  for (const [s, ts] of stateStore) { if (Date.now() - ts > 600000) stateStore.delete(s); }
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}&state=${state}`;
  return { authUrl };
}

async function handleCallback(code, state) {
  if (!code) throw new Error('No authorization code');
  if (state && !stateStore.has(state)) throw new Error('Invalid state');
  if (state) stateStore.delete(state);

  const { clientId, clientSecret } = getClientConfig();
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);

  runtimeToken = data.access_token;

  const userRes = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': `Bearer ${runtimeToken}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  const userData = await userRes.json();
  runtimeUsername = userData.login || null;

  setIntegrationConfig(INTEGRATION_ID, {
    ...getIntegrationConfig(INTEGRATION_ID),
    accessToken: runtimeToken,
    username: runtimeUsername,
  });
  return { username: runtimeUsername };
}

function disconnect() {
  runtimeToken = null;
  runtimeUsername = null;
  const cfg = getIntegrationConfig(INTEGRATION_ID) || {};
  delete cfg.accessToken;
  delete cfg.username;
  setIntegrationConfig(INTEGRATION_ID, cfg);
}

function status() {
  return { configured: isConfigured(), connected: !!runtimeToken, account: runtimeUsername };
}

function getToken() { return runtimeToken; }

async function listRepos(query = '', maxResults = 20) {
  if (!runtimeToken) throw new Error('Not connected to GitHub');
  const url = query
    ? `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+user:${runtimeUsername}&sort=updated&per_page=${maxResults}`
    : `https://api.github.com/user/repos?sort=updated&per_page=${maxResults}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${runtimeToken}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return (query ? data.items || [] : data).map(r => ({
    name: r.full_name, url: r.html_url, description: r.description,
    private: r.private, language: r.language, updatedAt: r.updated_at,
  }));
}

registry.register(INTEGRATION_ID, {
  name: 'GitHub',
  description: 'Connect GitHub for private repo analysis',
  init, connect, handleCallback, disconnect, status,
  api: { getToken, listRepos },
});

module.exports = { INTEGRATION_ID, init, connect, handleCallback, disconnect, status, getToken, listRepos };
