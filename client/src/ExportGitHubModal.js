import React, { useState, useCallback, useEffect } from 'react';
import { generateREADME, generateSPEC, generateDEBATE, generateCLAUDE, generateRepoName } from './exportMarkdown';

const API_URL = 'http://localhost:5001';
const PAT_KEY = 'ig_github_pat';

export default function ExportGitHubModal({ isOpen, onClose, nodes, idea, debateRounds }) {
  const [stage, setStage] = useState('config'); // config | exporting | success | error
  const [token, setToken] = useState(() => localStorage.getItem(PAT_KEY) || '');
  const [repoName, setRepoName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [includeDebate, setIncludeDebate] = useState(true);
  const [includeClaude, setIncludeClaude] = useState(true);
  const [progress, setProgress] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStage('config');
      setRepoName(generateRepoName(idea));
      setToken(localStorage.getItem(PAT_KEY) || '');
      setIncludeDebate(debateRounds?.length > 0);
      setIncludeClaude(true);
      setProgress('');
      setRepoUrl('');
      setErrorMsg('');
    }
  }, [isOpen, idea, debateRounds]);

  const handleExport = useCallback(async () => {
    if (!token.trim() || !repoName.trim()) return;

    // Save token
    localStorage.setItem(PAT_KEY, token.trim());

    setStage('exporting');
    setProgress('Generating markdown files...');

    try {
      // Generate markdown client-side
      const files = {};
      files['README.md'] = generateREADME(idea, nodes);
      files['SPEC.md'] = generateSPEC(idea, nodes);

      if (includeDebate) {
        files['DEBATE.md'] = generateDEBATE(debateRounds || []);
      }
      if (includeClaude) {
        files['CLAUDE.md'] = generateCLAUDE(idea, nodes, debateRounds || []);
      }

      setProgress('Creating GitHub repository...');

      const res = await fetch(`${API_URL}/api/export/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          repoName: repoName.trim(),
          repoDescription: `Product spec: ${idea.slice(0, 100)}`,
          isPrivate,
          files,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Export failed (${res.status})`);
      }

      setRepoUrl(data.repoUrl);
      setStage('success');
    } catch (err) {
      setErrorMsg(err.message);
      setStage('error');
    }
  }, [token, repoName, isPrivate, includeDebate, includeClaude, idea, nodes, debateRounds]);

  if (!isOpen) return null;

  const hasDebateData = debateRounds?.length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box export-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">⬆ EXPORT TO GITHUB</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* ── Config State ── */}
          {stage === 'config' && (
            <div className="export-config">
              <div className="export-field">
                <label className="export-label">GitHub Personal Access Token</label>
                <input
                  type="password"
                  className="export-input"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  autoFocus
                />
                <span className="export-hint">
                  Classic PAT with <code>repo</code> scope, or fine-grained PAT with <code>Contents</code> read+write. <a href="https://github.com/settings/tokens/new?scopes=repo&description=Idea%20Graph%20Export" target="_blank" rel="noopener noreferrer">Create classic →</a>
                </span>
              </div>

              <div className="export-field">
                <label className="export-label">Repository Name</label>
                <input
                  type="text"
                  className="export-input"
                  placeholder="my-product-spec"
                  value={repoName}
                  onChange={e => setRepoName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, '-'))}
                />
              </div>

              <div className="export-toggle-row">
                <label className="export-label">Visibility</label>
                <div className="export-toggle-group">
                  <button
                    className={`export-toggle-btn ${isPrivate ? 'active' : ''}`}
                    onClick={() => setIsPrivate(true)}
                  >
                    🔒 Private
                  </button>
                  <button
                    className={`export-toggle-btn ${!isPrivate ? 'active' : ''}`}
                    onClick={() => setIsPrivate(false)}
                  >
                    🌐 Public
                  </button>
                </div>
              </div>

              <div className="export-checkboxes">
                <label className="export-checkbox-row">
                  <input type="checkbox" checked disabled />
                  <span>README.md</span>
                  <span className="export-check-desc">Executive summary</span>
                </label>
                <label className="export-checkbox-row">
                  <input type="checkbox" checked disabled />
                  <span>SPEC.md</span>
                  <span className="export-check-desc">Full product spec</span>
                </label>
                <label className="export-checkbox-row">
                  <input
                    type="checkbox"
                    checked={includeDebate}
                    onChange={e => setIncludeDebate(e.target.checked)}
                    disabled={!hasDebateData}
                  />
                  <span style={{ opacity: hasDebateData ? 1 : 0.4 }}>DEBATE.md</span>
                  <span className="export-check-desc">{hasDebateData ? `${debateRounds.length} round(s)` : 'No debate data'}</span>
                </label>
                <label className="export-checkbox-row">
                  <input
                    type="checkbox"
                    checked={includeClaude}
                    onChange={e => setIncludeClaude(e.target.checked)}
                  />
                  <span>CLAUDE.md</span>
                  <span className="export-check-desc">Context for Claude Code</span>
                </label>
              </div>

              <button
                className="btn btn-export-primary"
                onClick={handleExport}
                disabled={!token.trim() || !repoName.trim()}
              >
                ⬆ EXPORT TO GITHUB
              </button>
            </div>
          )}

          {/* ── Exporting State ── */}
          {stage === 'exporting' && (
            <div className="export-progress-area">
              <div className="export-spinner" />
              <div className="export-progress-text">{progress}</div>
              <div className="export-progress-bar">
                <div className="export-progress-fill" />
              </div>
            </div>
          )}

          {/* ── Success State ── */}
          {stage === 'success' && (
            <div className="export-success-area">
              <div className="export-success-icon">✦</div>
              <div className="export-success-title">Repository Created!</div>
              <a
                className="export-success-link"
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {repoUrl}
              </a>
              <div className="export-success-actions">
                <a
                  className="btn btn-export-primary"
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ↗ OPEN IN GITHUB
                </a>
                <button className="btn btn-export-secondary" onClick={onClose}>
                  DONE
                </button>
              </div>
            </div>
          )}

          {/* ── Error State ── */}
          {stage === 'error' && (
            <div className="export-error-area">
              <div className="export-error-icon">⚠</div>
              <div className="export-error-msg">{errorMsg}</div>
              <button className="btn btn-export-secondary" onClick={() => setStage('config')}>
                ← TRY AGAIN
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
