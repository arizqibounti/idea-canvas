// ── Centralized API Fetch Wrapper ──────────────────────────────
// Wraps fetch() to automatically attach the Firebase Auth Bearer token.
// All components use authFetch() instead of fetch() for API calls.
// Retries once on 401 with a force-refreshed token.

let _getToken = () => null;
let _forceRefreshToken = null;

/**
 * Set the token getter function (called once from App on mount).
 * @param {Function} fn - Should return the current ID token string or null
 * @param {Function} [refreshFn] - Async function to force-refresh the token (e.g. user.getIdToken(true))
 */
export function setTokenGetter(fn, refreshFn) {
  _getToken = fn;
  _forceRefreshToken = refreshFn || null;
}

/**
 * Fetch wrapper that auto-attaches Authorization header.
 * Drop-in replacement for fetch() — same API, but returns a Promise.
 * Retries once with a force-refreshed token on 401.
 */
export async function authFetch(url, options = {}) {
  const token = _getToken();
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Ensure Content-Type for JSON bodies if not already set
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });

  // Retry once on 401 with a force-refreshed token
  if (res.status === 401 && _forceRefreshToken) {
    try {
      const freshToken = await _forceRefreshToken();
      if (freshToken && freshToken !== token) {
        const retryHeaders = { ...headers, Authorization: `Bearer ${freshToken}` };
        return fetch(url, { ...options, headers: retryHeaders });
      }
    } catch {
      // Force-refresh failed — return original 401 response
    }
  }

  return res;
}
