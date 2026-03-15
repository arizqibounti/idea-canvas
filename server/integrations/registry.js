// ── Integration Registry ──────────────────────────────────────
// Pattern: openclaw plugin system — register integrations with lifecycle hooks.
// Each integration provides: init, connect, disconnect, status, and hook mappings.

const integrations = new Map();

/**
 * Register an integration.
 * @param {string} id - Unique integration identifier (e.g., 'gmail')
 * @param {object} definition - Integration definition
 * @param {string} definition.name - Display name
 * @param {string} definition.description - Short description
 * @param {function} definition.init - Called on server start; returns { configured: bool }
 * @param {function} definition.connect - Start auth flow; returns { authUrl } or connection info
 * @param {function} definition.handleCallback - Handle OAuth callback
 * @param {function} definition.disconnect - Tear down connection
 * @param {function} definition.status - Returns current status { configured, connected, account, ... }
 * @param {object}   definition.hooks - Hook preset mappings for this integration
 * @param {object}   definition.api - Additional API methods (listThreads, getThread, etc.)
 */
function register(id, definition) {
  if (integrations.has(id)) {
    console.warn(`Integration "${id}" already registered — overwriting.`);
  }
  integrations.set(id, {
    id,
    ...definition,
    _initialized: false,
  });
}

/**
 * Initialize all registered integrations.
 * Called once on server start.
 */
async function initAll() {
  for (const [id, integration] of integrations) {
    try {
      if (integration.init) {
        const result = await integration.init();
        integration._initialized = true;
        console.log(`Integration "${id}" initialized:`, result?.configured ? 'configured' : 'not configured');
      }
    } catch (err) {
      console.error(`Integration "${id}" init failed:`, err.message);
    }
  }
}

/**
 * Get an integration by ID.
 */
function get(id) {
  return integrations.get(id) || null;
}

/**
 * List all registered integrations with their status.
 */
async function listAll() {
  const results = [];
  for (const [id, integration] of integrations) {
    try {
      const status = integration.status ? await integration.status() : { configured: false, connected: false };
      results.push({ id, name: integration.name, description: integration.description, ...status });
    } catch {
      results.push({ id, name: integration.name, description: integration.description, configured: false, connected: false, error: 'Status check failed' });
    }
  }
  return results;
}

/**
 * Get hook mappings for an integration.
 * Pattern: openclaw hookPresetMappings — returns templates for formatting external data.
 */
function getHookMappings(integrationId) {
  const integration = integrations.get(integrationId);
  return integration?.hooks || null;
}

module.exports = {
  register,
  initAll,
  get,
  listAll,
  getHookMappings,
};
