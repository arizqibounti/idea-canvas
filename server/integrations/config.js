// ── Integration Config ─────────────────────────────────────────
// Persistent config file for integration settings & tokens.
// Pattern: openclaw config.js — atomic writes, validation, file-based persistence.

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.thinkapp');
const CONFIG_PATH = path.join(CONFIG_DIR, 'integrations.json');

const DEFAULT_CONFIG = {
  version: '1.0.0',
  integrations: {},
};

// ── Read / Write ─────────────────────────────────────────────

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Atomic write — write to temp file then rename (prevents corruption).
 * Pattern from openclaw: temp file + rename + 0o600 permissions.
 */
function writeConfig(config) {
  ensureConfigDir();
  const tmpPath = CONFIG_PATH + `.tmp.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, CONFIG_PATH);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

// ── Integration-scoped helpers ───────────────────────────────

function getIntegrationConfig(integrationId) {
  const config = readConfig();
  return config.integrations[integrationId] || null;
}

function setIntegrationConfig(integrationId, data) {
  const config = readConfig();
  config.integrations[integrationId] = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  writeConfig(config);
}

function removeIntegrationConfig(integrationId) {
  const config = readConfig();
  delete config.integrations[integrationId];
  writeConfig(config);
}

module.exports = {
  CONFIG_DIR,
  CONFIG_PATH,
  readConfig,
  writeConfig,
  getIntegrationConfig,
  setIntegrationConfig,
  removeIntegrationConfig,
};
