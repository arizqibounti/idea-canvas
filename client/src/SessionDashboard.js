import React, { useState, useEffect, useCallback } from 'react';
import { MODES } from './modeConfig';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

// ── Helpers ──────────────────────────────────────────────────────

function getModeConfig(modeId) {
  return MODES.find(m => m.id === modeId) || MODES[0];
}

function relativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function readLocalSessions(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

// ── Component ────────────────────────────────────────────────────

export default function SessionDashboard({ onOpenSession, onNewSession }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Fetch & merge sessions from server + localStorage
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch server sessions
      let serverSessions = [];
      try {
        const res = await authFetch(`${API_URL}/api/sessions?limit=50`);
        if (res.ok) serverSessions = await res.json();
      } catch { /* server unavailable, continue with local only */ }

      // Read localStorage sessions
      const ideaSessions = readLocalSessions('IDEA_CANVAS_SESSIONS').map(s => ({
        ...s,
        idea: s.label || s.idea || '',
        mode: s.mode || 'idea',
        source: 'local',
        updatedAt: s.timestamp ? new Date(s.timestamp).toISOString() : s.id,
      }));
      const codeSessions = readLocalSessions('CODEBASE_CANVAS_SESSIONS').map(s => ({
        ...s,
        idea: s.label || s.idea || '',
        mode: s.mode || 'codebase',
        source: 'local',
        updatedAt: s.timestamp ? new Date(s.timestamp).toISOString() : s.id,
      }));

      // Tag server sessions
      const tagged = serverSessions.map(s => ({ ...s, source: 'cloud' }));

      // Merge: server sessions first, then local sessions not already on server
      const serverIdeas = new Set(tagged.map(s => (s.idea || '').toLowerCase().trim()));
      const uniqueLocal = [...ideaSessions, ...codeSessions].filter(
        s => !serverIdeas.has((s.idea || '').toLowerCase().trim())
      );

      // Deduplicate local sessions — keep only most recent per idea text
      const seenIdeas = new Set();
      const dedupedLocal = uniqueLocal.filter(s => {
        const key = (s.idea || '').toLowerCase().trim();
        if (!key || seenIdeas.has(key)) return false;
        seenIdeas.add(key);
        return true;
      });

      // Filter out empty/untitled sessions with 0 nodes
      const meaningful = [...tagged, ...dedupedLocal].filter(s => {
        const nodeCount = s.nodeCount || s.rawNodes?.length || 0;
        const hasIdea = s.idea && s.idea.trim() && s.idea.trim() !== 'Untitled session';
        return nodeCount > 0 || hasIdea;
      });

      const merged = meaningful.sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
      );

      setSessions(merged);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // Delete handler (two-click pattern)
  const handleDelete = useCallback(async (e, session) => {
    e.stopPropagation();

    if (deleteConfirm !== session.id) {
      setDeleteConfirm(session.id);
      return;
    }

    // Actually delete
    try {
      if (session.source === 'cloud') {
        await authFetch(`${API_URL}/api/sessions/${session.id}`, { method: 'DELETE' });
      } else {
        // Delete from localStorage
        for (const key of ['IDEA_CANVAS_SESSIONS', 'CODEBASE_CANVAS_SESSIONS']) {
          const stored = readLocalSessions(key);
          const filtered = stored.filter(s => s.id !== session.id);
          if (filtered.length !== stored.length) {
            localStorage.setItem(key, JSON.stringify(filtered));
          }
        }
      }
      setSessions(prev => prev.filter(s => s.id !== session.id));
    } catch (err) {
      console.error('Delete failed:', err);
    }
    setDeleteConfirm(null);
  }, [deleteConfirm]);

  // Clear delete confirm when clicking elsewhere
  useEffect(() => {
    if (deleteConfirm) {
      const timer = setTimeout(() => setDeleteConfirm(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [deleteConfirm]);

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
          <div style={{ fontSize: 12, letterSpacing: '0.1em', opacity: 0.7 }}>LOADING SESSIONS...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div className="dashboard-title">
          <span className="dashboard-title-icon">◈</span>
          <span>YOUR SESSIONS</span>
        </div>
        <button className="dashboard-new-btn" onClick={onNewSession}>
          ＋ New Session
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="dashboard-empty">
          <div className="dashboard-empty-icon">◈</div>
          <h3>No sessions yet</h3>
          <p>Start exploring ideas, analyzing code, crafting resumes, or making decisions.</p>
          <button className="dashboard-new-btn" onClick={onNewSession}>
            Start Your First Session
          </button>
        </div>
      ) : (
        <div className="dashboard-grid">
          {sessions.map(session => {
            const mode = getModeConfig(session.mode);
            const isConfirming = deleteConfirm === session.id;

            return (
              <div
                key={session.id}
                className="dashboard-card"
                style={{ borderLeftColor: mode.color }}
                onClick={() => onOpenSession(session)}
              >
                <button
                  className={`dashboard-card-delete ${isConfirming ? 'confirming' : ''}`}
                  onClick={(e) => handleDelete(e, session)}
                  title={isConfirming ? 'Click again to delete' : 'Delete session'}
                >
                  {isConfirming ? 'Delete?' : '✕'}
                </button>

                <div className="dashboard-card-mode">
                  <span className="dashboard-card-mode-icon" style={{ color: mode.color }}>
                    {mode.icon}
                  </span>
                  <span className="dashboard-card-mode-label" style={{ color: mode.color }}>
                    {mode.label}
                  </span>
                </div>

                <div className="dashboard-card-idea">
                  {session.idea || 'Untitled session'}
                </div>

                <div className="dashboard-card-footer">
                  <span className="dashboard-card-nodes">
                    {session.nodeCount || session.rawNodes?.length || 0} nodes
                  </span>
                  <span className="dashboard-card-time">
                    {relativeTime(session.updatedAt || session.createdAt)}
                  </span>
                  <span className="dashboard-card-source" title={session.source === 'cloud' ? 'Synced to cloud' : 'Local only'}>
                    {session.source === 'cloud' ? '☁' : '💾'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
