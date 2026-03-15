// ── Gmail Integration ─────────────────────────────────────────
// OAuth2 flow + Gmail API client for reading email threads.
// Tokens stored in-memory only (never persisted) for privacy.

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// In-memory token store: userId -> { access_token, refresh_token, ... }
const tokenStore = new Map();

// In-memory state store for CSRF: state -> userId
const stateStore = new Map();

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

// ── Auth URL ──────────────────────────────────────────────────

function getAuthUrl(userId = 'default') {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return null;

  const state = `${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  stateStore.set(state, userId);

  // Clean up stale states after 10 minutes
  setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent',
  });
}

// ── Callback ──────────────────────────────────────────────────

async function handleCallback(code, state) {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) throw new Error('Gmail not configured');

  const userId = stateStore.get(state);
  if (!userId) throw new Error('Invalid state parameter');
  stateStore.delete(state);

  const { tokens } = await oauth2Client.getToken(code);
  tokenStore.set(userId, tokens);

  // Get user email for display
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: 'me' });

  return { email: profile.data.emailAddress };
}

// ── Status ────────────────────────────────────────────────────

function isConnected(userId = 'default') {
  return tokenStore.has(userId);
}

function getEmail(userId = 'default') {
  // We don't store email separately; caller can check via status endpoint
  return isConnected(userId);
}

// ── Disconnect ────────────────────────────────────────────────

async function disconnect(userId = 'default') {
  const tokens = tokenStore.get(userId);
  if (!tokens) return;

  try {
    const oauth2Client = getOAuth2Client();
    if (oauth2Client && tokens.access_token) {
      oauth2Client.revokeToken(tokens.access_token).catch(() => {});
    }
  } catch {
    // Best effort revoke
  }

  tokenStore.delete(userId);
}

// ── Authenticated client helper ───────────────────────────────

function getAuthenticatedClient(userId = 'default') {
  const tokens = tokenStore.get(userId);
  if (!tokens) return null;

  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return null;

  oauth2Client.setCredentials(tokens);

  // Auto-refresh: update stored tokens when refreshed
  oauth2Client.on('tokens', (newTokens) => {
    const existing = tokenStore.get(userId) || {};
    tokenStore.set(userId, { ...existing, ...newTokens });
  });

  return oauth2Client;
}

// ── List Threads ──────────────────────────────────────────────

async function listThreads(userId = 'default', query = '', maxResults = 10) {
  const auth = getAuthenticatedClient(userId);
  if (!auth) throw new Error('Not connected to Gmail');

  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.threads.list({
    userId: 'me',
    q: query || undefined,
    maxResults,
  });

  const threads = res.data.threads || [];

  // Fetch snippets for each thread (batch metadata)
  const details = await Promise.all(
    threads.slice(0, maxResults).map(async (t) => {
      try {
        const detail = await gmail.users.threads.get({
          userId: 'me',
          id: t.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });
        const headers = detail.data.messages?.[0]?.payload?.headers || [];
        const getHeader = (name) => headers.find(h => h.name === name)?.value || '';
        return {
          id: t.id,
          snippet: t.snippet || detail.data.messages?.[0]?.snippet || '',
          subject: getHeader('Subject'),
          from: getHeader('From'),
          date: getHeader('Date'),
          messageCount: detail.data.messages?.length || 0,
        };
      } catch {
        return { id: t.id, snippet: t.snippet || '', subject: '', from: '', date: '', messageCount: 0 };
      }
    })
  );

  return details;
}

// ── Get Thread ────────────────────────────────────────────────

async function getThread(userId = 'default', threadId) {
  const auth = getAuthenticatedClient(userId);
  if (!auth) throw new Error('Not connected to Gmail');

  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = (res.data.messages || []).map((msg) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

    // Extract plain text body
    let body = '';
    const extractText = (part) => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.parts) {
        part.parts.forEach(extractText);
      }
    };

    if (msg.payload) {
      extractText(msg.payload);
    }

    // Fallback: try snippet if no text body found
    if (!body && msg.snippet) {
      body = msg.snippet;
    }

    return {
      id: msg.id,
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      subject: getHeader('Subject'),
      body: body.trim(),
    };
  });

  const subject = messages[0]?.subject || '';

  return {
    id: threadId,
    subject,
    messageCount: messages.length,
    messages,
  };
}

// ── Format thread for AI context ──────────────────────────────

function formatThreadForContext(thread) {
  if (!thread?.messages?.length) return '';

  const lines = [`Email Thread: "${thread.subject}" (${thread.messageCount} messages)\n`];

  for (const msg of thread.messages) {
    lines.push(`--- From: ${msg.from} | Date: ${msg.date} ---`);
    // Truncate very long messages to keep context manageable
    const body = msg.body.length > 2000 ? msg.body.slice(0, 2000) + '... [truncated]' : msg.body;
    lines.push(body);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  isConfigured,
  getAuthUrl,
  handleCallback,
  isConnected,
  disconnect,
  listThreads,
  getThread,
  formatThreadForContext,
};
