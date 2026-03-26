import React, { useState, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { MODES } from './modeConfig';
import { useAuth } from './AuthContext';
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

const Sidebar = forwardRef(function Sidebar(
  { activeSessionId, onOpenSession, onNewSession, isCollapsed, onToggleCollapse, onOpenSettings, onOpenKnowledge, onOpenForest },
  ref
) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedForests, setExpandedForests] = useState(new Set());
  const { user: authUser, logout: authLogout } = useAuth();

  // Fetch & merge sessions from server + localStorage
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      let serverSessions = [];
      try {
        const res = await authFetch(`${API_URL}/api/sessions?limit=50`);
        if (res.ok) serverSessions = await res.json();
      } catch { /* server unavailable */ }

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

      const tagged = serverSessions.map(s => ({ ...s, source: 'cloud' }));
      const serverIdeas = new Set(tagged.map(s => (s.idea || '').toLowerCase().trim()));
      const uniqueLocal = [...ideaSessions, ...codeSessions].filter(
        s => !serverIdeas.has((s.idea || '').toLowerCase().trim())
      );

      const seenIdeas = new Set();
      const dedupedLocal = uniqueLocal.filter(s => {
        const key = (s.idea || '').toLowerCase().trim();
        if (!key || seenIdeas.has(key)) return false;
        seenIdeas.add(key);
        return true;
      });

      const meaningful = [...tagged, ...dedupedLocal].filter(s => {
        const nodeCount = s.nodeCount || s.rawNodes?.length || 0;
        const hasIdea = s.idea && s.idea.trim() && s.idea.trim() !== 'Untitled session';
        return nodeCount > 0 || hasIdea;
      });

      setSessions(meaningful.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // Expose refresh to parent
  useImperativeHandle(ref, () => ({ refresh: fetchSessions }), [fetchSessions]);

  // Delete handler (two-click pattern)
  const handleDelete = useCallback(async (e, session) => {
    e.stopPropagation();
    if (deleteConfirm !== session.id) {
      setDeleteConfirm(session.id);
      return;
    }
    try {
      if (session.source === 'cloud') {
        await authFetch(`${API_URL}/api/sessions/${session.id}`, { method: 'DELETE' });
      } else {
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

  useEffect(() => {
    if (deleteConfirm) {
      const timer = setTimeout(() => setDeleteConfirm(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [deleteConfirm]);

  // Filtering & Grouping
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

  return (
    <aside className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Header */}
      <div className="sidebar-header">
        <button className="sidebar-toggle" onClick={onToggleCollapse} title="Toggle sidebar">
          ☰
        </button>
        {!isCollapsed && (
          <button className="sidebar-new-btn" onClick={onNewSession}>
            <span className="sidebar-new-icon">+</span>
            New session
          </button>
        )}
      </div>

      {/* Search */}
      {!isCollapsed && sessions.length > 0 && (
        <div className="sidebar-search-wrap">
          <span className="sidebar-search-icon">⌕</span>
          <input
            className="sidebar-search"
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="sidebar-search-clear" onClick={() => setSearchQuery('')}>✕</button>
          )}
        </div>
      )}

      {/* Session list */}
      <div className="sidebar-sessions">
        {loading ? (
          <div className="sidebar-loading">
            <div className="sl-loading-spinner" />
          </div>
        ) : !isCollapsed && groupedSessions.length > 0 ? (
          groupedSessions.map(group => (
            <div className="sidebar-group" key={group.label}>
              <div className="sidebar-group-label">{group.label}</div>
              {group.sessions.map(session => {
                const mode = getModeConfig(session.mode);
                const isActive = activeSessionId === session.id;
                const isConfirming = deleteConfirm === session.id;
                const isForest = !!session.forestCanvases?.length;
                const isExpanded = expandedForests.has(session.id);

                return (
                  <React.Fragment key={session.id}>
                    <div
                      className={`sidebar-row ${isActive ? 'sidebar-row--active' : ''} ${isForest ? 'sidebar-row--forest' : ''}`}
                      onClick={() => {
                        if (isForest && onOpenForest) {
                          // Open forest view
                          onOpenForest({ id: session.forestId, sessionId: session.id, idea: session.idea, plan: session.forestPlan, canvases: session.forestCanvases });
                        } else {
                          onOpenSession(session);
                        }
                      }}
                    >
                      {isForest && (
                        <button
                          className="sidebar-row-expand"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedForests(prev => {
                              const next = new Set(prev);
                              if (next.has(session.id)) next.delete(session.id);
                              else next.add(session.id);
                              return next;
                            });
                          }}
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      )}
                      <span className="sidebar-row-icon" style={{ color: isForest ? '#6c63ff' : mode.color }}>
                        {isForest ? '📁' : mode.icon}
                      </span>
                      <span className="sidebar-row-title">
                        {session.idea || 'Untitled session'}
                      </span>
                      <button
                        className={`sidebar-row-delete ${isConfirming ? 'confirming' : ''}`}
                        onClick={(e) => handleDelete(e, session)}
                        title={isConfirming ? 'Click again to confirm' : 'Delete'}
                      >
                        {isConfirming ? '?' : '✕'}
                      </button>
                    </div>
                    {/* Forest sub-canvases (directory listing) */}
                    {isForest && isExpanded && session.forestCanvases.map(canvas => (
                      <div
                        key={canvas.canvasKey}
                        className="sidebar-row sidebar-row--sub"
                        onClick={() => {
                          if (onOpenForest) {
                            onOpenForest({ id: session.forestId, sessionId: session.id, idea: session.idea, plan: session.forestPlan, canvases: session.forestCanvases, activeCanvasKey: canvas.canvasKey });
                          }
                        }}
                      >
                        <span className="sidebar-sub-indent" />
                        <span className={`sidebar-sub-status sidebar-sub-status--${canvas.status || 'pending'}`}>
                          {canvas.status === 'ready' ? '●' : canvas.status === 'generating' ? '◌' : '○'}
                        </span>
                        <span className="sidebar-row-title">{canvas.title}</span>
                        {canvas.nodeCount > 0 && <span className="sidebar-sub-count">{canvas.nodeCount}</span>}
                      </div>
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
          ))
        ) : !isCollapsed && sessions.length === 0 && !loading ? (
          <div className="sidebar-empty">No sessions yet</div>
        ) : !isCollapsed ? (
          <div className="sidebar-no-results">No matches</div>
        ) : null}
      </div>

      {/* Footer: user info */}
      {!isCollapsed && authUser && (
        <div className="sidebar-footer">
          <div className="sidebar-user">
            {authUser.photoURL ? (
              <img src={authUser.photoURL} alt="" className="sidebar-user-avatar" referrerPolicy="no-referrer" />
            ) : (
              <div className="sidebar-user-avatar-fallback">
                {(authUser.displayName || authUser.email || '?')[0].toUpperCase()}
              </div>
            )}
            <span className="sidebar-user-name">
              {authUser.displayName || authUser.email || 'User'}
            </span>
          </div>
          <div className="sidebar-footer-actions">
            <button className="sidebar-settings-btn" onClick={onOpenKnowledge} title="Knowledge graph">
              ⬡ Knowledge
            </button>
            <button className="sidebar-settings-btn" onClick={onOpenSettings} title="Settings">
              ⚙ Settings
            </button>
            <button className="sidebar-signout" onClick={authLogout} title="Sign out">
              Sign out
            </button>
          </div>
        </div>
      )}
    </aside>
  );
});

export default Sidebar;
