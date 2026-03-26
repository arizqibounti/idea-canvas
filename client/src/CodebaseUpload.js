// ── GitHub Repo Analyzer ─────────────────────────────────────
// Input a GitHub repo URL to analyze the codebase and generate
// a thinking tree of product features, architecture, and user flows.
// Supports private repos via GitHub OAuth.

import React, { useState, useCallback } from 'react';

const ANALYSIS_GOALS = [
  { id: 'features', label: 'Product Features', desc: 'What the app does — routes, components, handlers', defaultChecked: true },
  { id: 'architecture', label: 'Architecture & Constraints', desc: 'Tech debt, coupling, bottlenecks, patterns', defaultChecked: true },
  { id: 'users', label: 'User Segments & Flows', desc: 'Inferred user types from auth, roles, data models', defaultChecked: true },
];

export default function CodebaseUpload({ onAnalysisReady, isAnalyzing, github }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [goals, setGoals] = useState(() => new Set(ANALYSIS_GOALS.filter(g => g.defaultChecked).map(g => g.id)));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isValidUrl = repoUrl.includes('github.com/') && repoUrl.split('github.com/')[1]?.includes('/');

  const handleAnalyze = useCallback(() => {
    if (!isValidUrl || isAnalyzing) return;
    onAnalysisReady({
      repoUrl: repoUrl.trim(),
      branch: branch.trim() || 'main',
      analysisGoals: Array.from(goals),
      folderName: repoUrl.split('github.com/')[1]?.replace(/\.git$/, '') || 'repo',
      githubToken: token.trim() || undefined,
    });
  }, [repoUrl, branch, token, goals, isValidUrl, isAnalyzing, onAnalysisReady]);

  return (
    <div className="codebase-upload">
      <div className="cb-upload-header">
        <span className="cb-upload-icon">⟨/⟩</span>
        <span className="cb-upload-title">ANALYZE GITHUB REPO</span>
      </div>

      <div className="cb-upload-desc">
        Paste a GitHub repository URL to analyze the codebase and generate a product thinking tree.
      </div>

      {/* GitHub connection status */}
      {github?.configured && (
        <div className="cb-github-auth">
          {github.connected ? (
            <div className="cb-github-connected">
              <span className="cb-github-badge">✓ Connected as @{github.account}</span>
              <button className="cb-github-disconnect" onClick={github.disconnect}>Disconnect</button>
            </div>
          ) : (
            <button className="cb-github-connect-btn" onClick={github.connect}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 6 }}>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              Connect GitHub for private repos
            </button>
          )}
        </div>
      )}

      <div className="cb-github-input-row">
        <input
          type="text"
          className="cb-github-url-input"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && isValidUrl) handleAnalyze(); }}
          disabled={isAnalyzing}
          autoFocus
        />
      </div>

      <button className="cb-advanced-toggle" onClick={() => setShowAdvanced(v => !v)}>
        {showAdvanced ? '▾' : '▸'} Options
      </button>

      {showAdvanced && (
        <div className="cb-advanced-panel">
          <div className="cb-branch-row">
            <label className="cb-branch-label">Branch:</label>
            <input
              type="text"
              className="cb-branch-input"
              value={branch}
              onChange={e => setBranch(e.target.value)}
              placeholder="main"
              disabled={isAnalyzing}
            />
          </div>

          {!github?.connected && (
            <div className="cb-token-row">
              <label className="cb-branch-label">Token (PAT):</label>
              <input
                type="password"
                className="cb-token-input"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="ghp_... or github_pat_..."
                disabled={isAnalyzing}
              />
              <div className="cb-token-hint">For private repos without OAuth. Generate at github.com/settings/tokens</div>
            </div>
          )}

          <div className="cb-goals">
            {ANALYSIS_GOALS.map(g => (
              <label key={g.id} className="cb-goal-check">
                <input
                  type="checkbox"
                  checked={goals.has(g.id)}
                  onChange={e => {
                    setGoals(prev => {
                      const next = new Set(prev);
                      e.target.checked ? next.add(g.id) : next.delete(g.id);
                      return next;
                    });
                  }}
                  disabled={isAnalyzing}
                />
                <div>
                  <div className="cb-goal-label">{g.label}</div>
                  <div className="cb-goal-desc">{g.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      <button
        className="cb-analyze-btn"
        onClick={handleAnalyze}
        disabled={!isValidUrl || isAnalyzing || goals.size === 0}
      >
        {isAnalyzing ? '◌ Analyzing...' : '▶ ANALYZE REPO'}
      </button>

      {repoUrl && !isValidUrl && (
        <div className="cb-url-hint">Enter a valid GitHub URL: https://github.com/owner/repo</div>
      )}

      {!github?.connected && isValidUrl && repoUrl.includes('github.com') && (
        <div className="cb-private-hint">For private repos, connect your GitHub account above.</div>
      )}
    </div>
  );
}
