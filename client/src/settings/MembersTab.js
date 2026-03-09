// ── Members Management Tab ────────────────────────────────────
import React, { useState, useEffect, useCallback } from 'react';
import { useUser } from '../UserContext';
import { authFetch } from '../api';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function MembersTab() {
  const { profile, workspace } = useUser();
  const [members, setMembers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [error, setError] = useState(null);

  const isPro = profile?.plan === 'pro';
  const wsId = workspace?.id;

  const fetchMembers = useCallback(async () => {
    if (!wsId) return;
    try {
      const res = await authFetch(`${API_URL}/api/workspaces/${wsId}/members`);
      if (res.ok) setMembers(await res.json());
    } catch {}
  }, [wsId]);

  const fetchInvites = useCallback(async () => {
    if (!wsId || !isPro) return;
    try {
      const res = await authFetch(`${API_URL}/api/workspaces/${wsId}/invitations`);
      if (res.ok) setPendingInvites(await res.json());
    } catch {}
  }, [wsId, isPro]);

  useEffect(() => { fetchMembers(); fetchInvites(); }, [fetchMembers, fetchInvites]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    setInviteResult(null);
    try {
      const res = await authFetch(`${API_URL}/api/workspaces/${wsId}/members/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInviteResult(data.inviteUrl);
      setInviteEmail('');
      fetchInvites();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await authFetch(`${API_URL}/api/workspaces/${wsId}/members/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      fetchMembers();
    } catch {}
  };

  const handleRemove = async (userId) => {
    try {
      await authFetch(`${API_URL}/api/workspaces/${wsId}/members/${userId}`, { method: 'DELETE' });
      fetchMembers();
    } catch {}
  };

  const handleRevokeInvite = async (invId) => {
    try {
      await authFetch(`${API_URL}/api/workspaces/${wsId}/invitations/${invId}`, { method: 'DELETE' });
      fetchInvites();
    } catch {}
  };

  const isOwnerOrAdmin = members.some(m => m.userId === profile?.uid && (m.role === 'owner' || m.role === 'admin'));

  if (!isPro) {
    return (
      <div className="settings-section">
        <h2 className="settings-section-title">Members</h2>
        <div className="settings-card settings-locked">
          <div className="settings-locked-icon">🔒</div>
          <p>Team features are available on the Pro plan.</p>
          <p className="settings-muted">Upgrade to invite up to 10 team members.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Members ({members.length}/10)</h2>

      {/* Member list */}
      <div className="settings-card">
        {members.map(m => (
          <div key={m.userId} className="settings-member-row">
            <div className="settings-member-info">
              <span className="settings-member-name">{m.userId === profile?.uid ? 'You' : m.userId}</span>
              <span className={`settings-role-badge settings-role-badge--${m.role}`}>{m.role}</span>
            </div>
            {isOwnerOrAdmin && m.role !== 'owner' && m.userId !== profile?.uid && (
              <div className="settings-member-actions">
                <select
                  className="settings-select-sm"
                  value={m.role}
                  onChange={e => handleRoleChange(m.userId, e.target.value)}
                >
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                  <option value="viewer">viewer</option>
                </select>
                <button className="settings-remove-btn" onClick={() => handleRemove(m.userId)}>Remove</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Invite form */}
      {isOwnerOrAdmin && (
        <div className="settings-card" style={{ marginTop: 16 }}>
          <h3 className="settings-subsection-title">Invite Member</h3>
          <div className="settings-invite-form">
            <input
              className="settings-input"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              type="email"
            />
            <select
              className="settings-select"
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value)}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              className="settings-invite-btn"
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
            >
              {inviting ? 'Sending...' : 'Invite'}
            </button>
          </div>
          {error && <div className="settings-error">{error}</div>}
          {inviteResult && (
            <div className="settings-invite-result">
              <span>Invite link:</span>
              <input
                className="settings-input settings-invite-url"
                value={inviteResult}
                readOnly
                onClick={e => { e.target.select(); navigator.clipboard?.writeText(inviteResult); }}
              />
              <span className="settings-muted">Click to copy</span>
            </div>
          )}
        </div>
      )}

      {/* Pending invitations */}
      {pendingInvites.length > 0 && (
        <div className="settings-card" style={{ marginTop: 16 }}>
          <h3 className="settings-subsection-title">Pending Invitations</h3>
          {pendingInvites.map(inv => (
            <div key={inv.id} className="settings-member-row">
              <div className="settings-member-info">
                <span className="settings-member-name">{inv.email}</span>
                <span className="settings-role-badge">{inv.role}</span>
                <span className="settings-muted">pending</span>
              </div>
              {isOwnerOrAdmin && (
                <button className="settings-remove-btn" onClick={() => handleRevokeInvite(inv.id)}>Revoke</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
