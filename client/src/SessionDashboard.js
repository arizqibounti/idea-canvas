import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MODES } from './modeConfig';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

// ── Helpers ──────────────────────────────────────────────────────

function getModeConfig(modeId) {
  return MODES.find(m => m.id === modeId) || MODES[0];
}

function readLocalSessions(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

function groupSessionsByDate(sessions) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const prev7 = new Date(today);
  prev7.setDate(today.getDate() - 7);
  const prev30 = new Date(today);
  prev30.setDate(today.getDate() - 30);

  const groups = [
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'Previous 7 days', sessions: [] },
    { label: 'Previous 30 days', sessions: [] },
    { label: 'Older', sessions: [] },
  ];

  for (const session of sessions) {
    const d = new Date(session.updatedAt || session.createdAt);
    if (d >= today) groups[0].sessions.push(session);
    else if (d >= yesterday) groups[1].sessions.push(session);
    else if (d >= prev7) groups[2].sessions.push(session);
    else if (d >= prev30) groups[3].sessions.push(session);
    else groups[4].sessions.push(session);
  }

  return groups.filter(g => g.sessions.length > 0);
}

// ── Component ────────────────────────────────────────────────────

export default function SessionDashboard({ onOpenSession, onNewSession }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  // Clear delete confirm after timeout
  useEffect(() => {
    if (deleteConfirm) {
      const timer = setTimeout(() => setDeleteConfirm(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [deleteConfirm]);

  // ── Filtering & Grouping ────────────────────────────────────────

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(s =>
      (s.idea || '').toLowerCase().includes(q) ||
      (getModeConfig(s.mode).label || '').toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions]
  );

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="sl-container">
        <div className="sl-inner">
          <div className="sl-loading">
            <div className="sl-loading-spinner" />
            <span>Loading sessions...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sl-container">
      <div className="sl-inner">
        {/* Header */}
        <div className="sl-header">
          <button className="sl-new-btn" onClick={onNewSession}>
            <span className="sl-new-btn-icon">+</span>
            New session
          </button>

          {sessions.length > 0 && (
            <div className="sl-search-wrap">
              <span className="sl-search-icon">⌕</span>
              <input
                className="sl-search"
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="sl-search-clear"
                  onClick={() => setSearchQuery('')}
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {/* List */}
        <div className="sl-list">
          {sessions.length === 0 ? (
            <div className="sl-empty">
              <div className="sl-empty-icon">◈</div>
              <h3>No sessions yet</h3>
              <p>Start exploring ideas, analyzing code, crafting resumes, or making decisions.</p>
              <button className="sl-new-btn" onClick={onNewSession}>
                Start your first session
              </button>
            </div>
          ) : groupedSessions.length === 0 ? (
            <div className="sl-no-results">
              No sessions matching "{searchQuery}"
            </div>
          ) : (
            groupedSessions.map(group => (
              <div className="sl-group" key={group.label}>
                <div className="sl-group-label">{group.label}</div>
                {group.sessions.map(session => {
                  const mode = getModeConfig(session.mode);
                  const isConfirming = deleteConfirm === session.id;
                  const nodeCount = session.nodeCount || session.rawNodes?.length || 0;

                  return (
                    <div
                      key={session.id}
                      className="sl-row"
                      onClick={() => onOpenSession(session)}
                    >
                      <span className="sl-row-icon" style={{ color: mode.color }}>
                        {mode.icon}
                      </span>
                      <span className="sl-row-title">
                        {session.idea || 'Untitled session'}
                      </span>
                      <span className="sl-row-meta">
                        {nodeCount > 0 ? `${nodeCount} nodes` : ''}
                      </span>
                      <span
                        className="sl-row-source"
                        title={session.source === 'cloud' ? 'Synced' : 'Local'}
                      >
                        {session.source === 'cloud' ? '☁' : ''}
                      </span>
                      <button
                        className={`sl-row-delete ${isConfirming ? 'confirming' : ''}`}
                        onClick={(e) => handleDelete(e, session)}
                        title={isConfirming ? 'Click again to confirm' : 'Delete'}
                      >
                        {isConfirming ? 'Delete?' : '✕'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
