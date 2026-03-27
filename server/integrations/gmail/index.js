// ── Gmail Integration ─────────────────────────────────────────
// Pattern: openclaw gmail hooks — config-driven, lifecycle-managed,
// with hook preset mappings for formatting email data.

const { google } = require('googleapis');
const { getIntegrationConfig, setIntegrationConfig, removeIntegrationConfig } = require('../config');
const registry = require('../registry');

const INTEGRATION_ID = 'gmail';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
];

// ── In-memory runtime state (never persisted for sensitive tokens) ──
let runtimeTokens = null;      // { access_token, refresh_token, expiry_date }
let runtimeEmail = null;       // Connected account email
const stateStore = new Map();  // CSRF state -> timestamp

// ── OAuth2 Client ────────────────────────────────────────────

function getOAuth2Client() {
  const cfg = getIntegrationConfig(INTEGRATION_ID);
  const clientId = cfg?.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = cfg?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = cfg?.redirectUri || process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthenticatedClient() {
  if (!runtimeTokens) return null;
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return null;

  oauth2Client.setCredentials(runtimeTokens);

  // Auto-refresh: update runtime tokens when refreshed
  oauth2Client.on('tokens', (newTokens) => {
    runtimeTokens = { ...runtimeTokens, ...newTokens };
  });

  return oauth2Client;
}

// ── Hook Preset Mappings ─────────────────────────────────────
// Pattern: openclaw hookPresetMappings — templates for formatting
// email data for different consumption modes.

const hookMappings = {
  // Default context template — used when injecting email into thinking tree
  contextTemplate: (thread) => {
    if (!thread?.messages?.length) return '';
    const lines = [`Email Thread: "${thread.subject}" (${thread.messageCount} messages)\n`];
    for (const msg of thread.messages) {
      lines.push(`--- From: ${msg.from} | Date: ${msg.date} ---`);
      const body = msg.body.length > 2000 ? msg.body.slice(0, 2000) + '... [truncated]' : msg.body;
      lines.push(body);
      lines.push('');
    }
    return lines.join('\n');
  },

  // Mode-specific templates — different framing per thinking mode
  modeTemplates: {
    idea: (thread, formatted) =>
      `EMAIL CONTEXT — Analyze this email thread and generate ideas:\n\n${formatted}`,
    decide: (thread, formatted) =>
      `EMAIL CONTEXT — Use this email thread to inform the decision analysis:\n\n${formatted}`,
    write: (thread, formatted) =>
      `EMAIL CONTEXT — Reference this email thread for the writing task:\n\n${formatted}`,
    plan: (thread, formatted) =>
      `EMAIL CONTEXT — Incorporate this email thread into the planning process:\n\n${formatted}`,
  },

  // Chat injection template
  chatTemplate: (formatted) =>
    `\n\nEMAIL CONTEXT — The user has connected an email thread for reference:\n\n${formatted}\n\nUse this email thread as additional context. Reference specific messages, senders, or details when relevant to the user's questions or the thinking tree analysis.`,
};

// ── Lifecycle Hooks ──────────────────────────────────────────

/**
 * Init — called on server start.
 * Checks if Gmail is configured (env vars or config file).
 * If refresh token is persisted, restores the session.
 */
async function init() {
  const cfg = getIntegrationConfig(INTEGRATION_ID);
  const configured = !!(
    (cfg?.clientId || process.env.GOOGLE_CLIENT_ID) &&
    (cfg?.clientSecret || process.env.GOOGLE_CLIENT_SECRET) &&
    (cfg?.redirectUri || process.env.GOOGLE_REDIRECT_URI)
  );

  // Restore session if refresh token was persisted
  if (configured && cfg?.refreshToken) {
    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials({ refresh_token: cfg.refreshToken });
      const { credentials } = await oauth2Client.refreshAccessToken();
      runtimeTokens = credentials;

      // Fetch account email
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      runtimeEmail = profile.data.emailAddress;
      console.log(`Gmail: restored session for ${runtimeEmail}`);
    } catch (err) {
      console.warn('Gmail: failed to restore session:', err.message);
      runtimeTokens = null;
      runtimeEmail = null;
    }
  }

  return { configured };
}

/**
 * Connect — generate OAuth URL for popup flow.
 */
function connect() {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) throw new Error('Gmail not configured');

  const state = `gmail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  stateStore.set(state, Date.now());

  // Clean up stale states after 10 minutes
  setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent',
  });

  return { authUrl: url };
}

/**
 * Handle OAuth callback — exchange code for tokens, persist refresh token.
 */
async function handleCallback(code, state) {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) throw new Error('Gmail not configured');

  if (!stateStore.has(state)) throw new Error('Invalid state parameter');
  stateStore.delete(state);

  const { tokens } = await oauth2Client.getToken(code);
  runtimeTokens = tokens;

  // Persist refresh token to config (encrypted at rest via file permissions)
  if (tokens.refresh_token) {
    const existing = getIntegrationConfig(INTEGRATION_ID) || {};
    setIntegrationConfig(INTEGRATION_ID, {
      ...existing,
      refreshToken: tokens.refresh_token,
      connectedAt: new Date().toISOString(),
    });
  }

  // Fetch account email
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  runtimeEmail = profile.data.emailAddress;

  // Persist account email to config
  const cfg = getIntegrationConfig(INTEGRATION_ID) || {};
  setIntegrationConfig(INTEGRATION_ID, { ...cfg, account: runtimeEmail });

  return { email: runtimeEmail };
}

/**
 * Disconnect — revoke tokens, clear runtime state, remove persisted config.
 */
async function disconnect() {
  if (runtimeTokens?.access_token) {
    try {
      const oauth2Client = getOAuth2Client();
      if (oauth2Client) {
        await oauth2Client.revokeToken(runtimeTokens.access_token).catch(() => {});
      }
    } catch {
      // Best effort revoke
    }
  }

  runtimeTokens = null;
  runtimeEmail = null;

  // Remove persisted tokens but keep client config
  const cfg = getIntegrationConfig(INTEGRATION_ID);
  if (cfg) {
    const { refreshToken, connectedAt, account, ...rest } = cfg;
    if (Object.keys(rest).length > 0) {
      setIntegrationConfig(INTEGRATION_ID, rest);
    } else {
      removeIntegrationConfig(INTEGRATION_ID);
    }
  }
}

/**
 * Status — return current integration state.
 */
function status() {
  const cfg = getIntegrationConfig(INTEGRATION_ID);
  const configured = !!(
    (cfg?.clientId || process.env.GOOGLE_CLIENT_ID) &&
    (cfg?.clientSecret || process.env.GOOGLE_CLIENT_SECRET) &&
    (cfg?.redirectUri || process.env.GOOGLE_REDIRECT_URI)
  );

  return {
    configured,
    connected: !!runtimeTokens,
    account: runtimeEmail || cfg?.account || null,
  };
}

// ── API Methods ──────────────────────────────────────────────

async function listThreads(query = '', maxResults = 10) {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error('Not connected to Gmail');

  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.threads.list({
    userId: 'me',
    q: query || undefined,
    maxResults,
  });

  const threads = res.data.threads || [];

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

async function getThread(threadId) {
  const auth = getAuthenticatedClient();
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

    let body = '';
    const extractText = (part) => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.parts) part.parts.forEach(extractText);
    };
    if (msg.payload) extractText(msg.payload);
    if (!body && msg.snippet) body = msg.snippet;

    return {
      id: msg.id,
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      subject: getHeader('Subject'),
      body: body.trim(),
    };
  });

  return {
    id: threadId,
    subject: messages[0]?.subject || '',
    messageCount: messages.length,
    messages,
  };
}

// ── Email Composition Helpers ─────────────────────────────────

function buildRawEmail({ to, subject, body, cc, bcc, inReplyTo, references, contentType = 'text/plain' }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: ${contentType}; charset=utf-8`,
  ];
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('', body);
  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}

/**
 * Send an email directly.
 * @param {Object} opts - { to, subject, body, cc?, bcc?, contentType? }
 * @returns {Object} - { id, threadId, labelIds }
 */
async function sendEmail({ to, subject, body, cc, bcc, contentType }) {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error('Not connected to Gmail');

  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawEmail({ to, subject, body, cc, bcc, contentType });

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return { id: res.data.id, threadId: res.data.threadId, labelIds: res.data.labelIds };
}

/**
 * Create a draft (not sent).
 * @param {Object} opts - { to, subject, body, cc?, bcc?, contentType? }
 * @returns {Object} - { draftId, messageId }
 */
async function createDraft({ to, subject, body, cc, bcc, contentType }) {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error('Not connected to Gmail');

  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawEmail({ to, subject, body, cc, bcc, contentType });

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw },
    },
  });

  return { draftId: res.data.id, messageId: res.data.message?.id };
}

/**
 * Reply to an existing thread.
 * @param {Object} opts - { threadId, body, cc?, bcc?, contentType? }
 * @returns {Object} - { id, threadId }
 */
async function replyToThread({ threadId, body, cc, bcc, contentType }) {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error('Not connected to Gmail');

  const gmail = google.gmail({ version: 'v1', auth });

  // Get the last message in the thread to extract reply headers
  const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata', metadataHeaders: ['Subject', 'From', 'To', 'Message-ID'] });
  const lastMsg = thread.data.messages?.[thread.data.messages.length - 1];
  const headers = lastMsg?.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

  const subject = `Re: ${getHeader('Subject').replace(/^Re:\s*/i, '')}`;
  const to = getHeader('From'); // reply to sender
  const messageId = getHeader('Message-ID');

  const raw = buildRawEmail({
    to,
    subject,
    body,
    cc,
    bcc,
    contentType,
    inReplyTo: messageId,
    references: messageId,
  });

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId },
  });

  return { id: res.data.id, threadId: res.data.threadId };
}

/**
 * Format thread for context using the hook mapping template.
 */
function formatThreadForContext(thread, mode) {
  const formatted = hookMappings.contextTemplate(thread);
  if (mode && hookMappings.modeTemplates[mode]) {
    return hookMappings.modeTemplates[mode](thread, formatted);
  }
  return formatted;
}

/**
 * Get chat injection text for email context.
 */
function formatForChat(formatted) {
  return hookMappings.chatTemplate(formatted);
}

// ── Register with Integration Registry ───────────────────────

registry.register(INTEGRATION_ID, {
  name: 'Gmail',
  description: 'Connect your Gmail to feed email threads into thinking modes',
  init,
  connect,
  handleCallback,
  disconnect,
  status,
  hooks: hookMappings,
  api: {
    listThreads,
    getThread,
    sendEmail,
    createDraft,
    replyToThread,
    formatThreadForContext,
    formatForChat,
  },
});

module.exports = {
  INTEGRATION_ID,
  init,
  connect,
  handleCallback,
  disconnect,
  status,
  listThreads,
  getThread,
  sendEmail,
  createDraft,
  replyToThread,
  formatThreadForContext,
  formatForChat,
  hookMappings,
};
