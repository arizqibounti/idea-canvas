// ── Firebase Auth Middleware ────────────────────────────────────
// Verifies Firebase ID tokens on incoming requests.
// Uses firebase-admin SDK; on Cloud Run, auto-uses default service account.
// Falls back gracefully if Firebase Admin can't initialize (local dev without creds).

let admin = null;
let authReady = false;

// ── Profile cache (60s TTL) ─────────────────────────────────
const profileCache = new Map();
const PROFILE_CACHE_TTL = 60 * 1000;

function getCachedProfile(uid) {
  const entry = profileCache.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.ts > PROFILE_CACHE_TTL) {
    profileCache.delete(uid);
    return null;
  }
  return entry.profile;
}

function setCachedProfile(uid, profile) {
  profileCache.set(uid, { profile, ts: Date.now() });
}

// Lazy-loaded to avoid circular dependency
let _users = null;
let _workspaces = null;
function getUsers() { if (!_users) _users = require('../gateway/users'); return _users; }
function getWorkspaces() { if (!_workspaces) _workspaces = require('../gateway/workspaces'); return _workspaces; }

// Auth is only enforced when ENABLE_AUTH=true is set.
// In local dev (no env var), all requests are allowed through with a local user.
// In production (Cloud Run), set ENABLE_AUTH=true to require Firebase tokens.
const AUTH_ENABLED = process.env.ENABLE_AUTH === 'true';

// ── Email Allowlist ─────────────────────────────────────────────
// Restrict access to specific emails and/or email domains.
// If both are empty, all authenticated users are allowed (no restriction).
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

function isEmailAllowed(email) {
  // If no allowlist configured, allow everyone
  if (ALLOWED_EMAILS.length === 0 && ALLOWED_DOMAINS.length === 0) return true;
  const lower = (email || '').toLowerCase();
  if (ALLOWED_EMAILS.includes(lower)) return true;
  const domain = lower.split('@')[1];
  if (domain && ALLOWED_DOMAINS.includes(domain)) return true;
  return false;
}

function initAdmin() {
  if (!AUTH_ENABLED) {
    console.log('Auth disabled (set ENABLE_AUTH=true to enforce)');
    return;
  }
  try {
    admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    authReady = true;
    console.log('Firebase Admin initialized — auth enforced');
    if (ALLOWED_EMAILS.length || ALLOWED_DOMAINS.length) {
      console.log(`Access restricted to: ${ALLOWED_EMAILS.length} email(s), ${ALLOWED_DOMAINS.length} domain(s)`);
    } else {
      console.log('No email allowlist — all authenticated users can access');
    }
  } catch (err) {
    console.log('Firebase Admin not available — auth disabled (all requests allowed)');
  }
}

initAdmin();

/**
 * Verify a Firebase ID token string.
 * Returns the decoded token or null if invalid/unavailable.
 */
async function verifyToken(token) {
  if (!authReady || !admin) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email || '', name: decoded.name || '' };
  } catch {
    return null;
  }
}

/**
 * requireAuth — Express middleware.
 * Blocks request with 401 if no valid Bearer token.
 * Blocks with 403 if email is not in the allowlist.
 * When auth is disabled (no Firebase Admin), allows all requests through.
 */
async function requireAuth(req, res, next) {
  // If Firebase Admin isn't available, skip auth (local dev)
  if (!authReady) {
    req.user = { uid: 'local', email: 'local@dev', name: 'Local Dev' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split('Bearer ')[1];
  const user = await verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Check email allowlist
  if (!isEmailAllowed(user.email)) {
    return res.status(403).json({ error: 'Access denied. Your email is not authorized to use this application.' });
  }

  // Enrich with profile (plan, personalWorkspaceId, etc.)
  let profile = getCachedProfile(user.uid);
  if (!profile) {
    try {
      const users = getUsers();
      const workspaces = getWorkspaces();
      profile = await users.getOrCreateUser(
        user.uid, user.email, user.name, null,
        (name, slug, ownerId, isPersonal) => workspaces.createWorkspace(name, slug, ownerId, isPersonal)
      );
      setCachedProfile(user.uid, profile);
    } catch (err) {
      console.error('Failed to load user profile:', err.message);
      // Fall through with basic user info
    }
  }

  req.user = profile
    ? { ...user, plan: profile.plan, personalWorkspaceId: profile.personalWorkspaceId, stripeCustomerId: profile.stripeCustomerId, photoURL: profile.photoURL }
    : user;
  next();
}

/**
 * optionalAuth — Express middleware.
 * Attaches req.user if valid token present, but doesn't block if missing.
 * Still enforces email allowlist if token is present.
 */
async function optionalAuth(req, res, next) {
  if (!authReady) {
    req.user = null;
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    const user = await verifyToken(token);
    if (user && !isEmailAllowed(user.email)) {
      return res.status(403).json({ error: 'Access denied. Your email is not authorized to use this application.' });
    }
    req.user = user;
  } else {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, optionalAuth, verifyToken };
