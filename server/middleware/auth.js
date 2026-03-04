// ── Firebase Auth Middleware ────────────────────────────────────
// Verifies Firebase ID tokens on incoming requests.
// Uses firebase-admin SDK; on Cloud Run, auto-uses default service account.
// Falls back gracefully if Firebase Admin can't initialize (local dev without creds).

let admin = null;
let authReady = false;

// Auth is only enforced when ENABLE_AUTH=true is set.
// In local dev (no env var), all requests are allowed through with a local user.
// In production (Cloud Run), set ENABLE_AUTH=true to require Firebase tokens.
const AUTH_ENABLED = process.env.ENABLE_AUTH === 'true';

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

  req.user = user;
  next();
}

/**
 * optionalAuth — Express middleware.
 * Attaches req.user if valid token present, but doesn't block if missing.
 */
async function optionalAuth(req, res, next) {
  if (!authReady) {
    req.user = null;
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    req.user = await verifyToken(token);
  } else {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, optionalAuth, verifyToken };
