// ── Centralized API Fetch Wrapper ──────────────────────────────
// Wraps fetch() to automatically attach the Firebase Auth Bearer token.
// All components use authFetch() instead of fetch() for API calls.

let _getToken = () => null;

/**
 * Set the token getter function (called once from App on mount).
 * @param {Function} fn - Should return the current ID token string or null
 */
export function setTokenGetter(fn) {
  _getToken = fn;
}

/**
 * Fetch wrapper that auto-attaches Authorization header.
 * Drop-in replacement for fetch() — same API.
 */
export function authFetch(url, options = {}) {
  const token = _getToken();
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Ensure Content-Type for JSON bodies if not already set
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(url, { ...options, headers });
}
