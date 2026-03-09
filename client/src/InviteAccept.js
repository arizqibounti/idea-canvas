// ── Invite Acceptance Page ─────────────────────────────────────
// Shown when a user visits /invite/:token

import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function InviteAccept({ token }) {
  const { user, login } = useAuth();
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    authFetch(`${API_URL}/api/invitations/check?token=${token}`)
      .then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d.error); }))
      .then(data => setInvite(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      await authFetch(`${API_URL}/api/invitations/accept`, {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setDone(true);
      setTimeout(() => { window.location.href = '/'; }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="invite-page">
        <div className="invite-card">Loading invitation...</div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="invite-page">
        <div className="invite-card">
          <h2>Invalid Invitation</h2>
          <p className="settings-muted">{error}</p>
          <button className="settings-save-btn" onClick={() => { window.location.href = '/'; }}>Go Home</button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="invite-page">
        <div className="invite-card">
          <h2>Welcome!</h2>
          <p>You've joined <strong>{invite?.workspaceName}</strong> as {invite?.role}.</p>
          <p className="settings-muted">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="invite-page">
      <div className="invite-card">
        <h2>You're Invited</h2>
        <p>Join <strong>{invite?.workspaceName}</strong> as <strong>{invite?.role}</strong></p>
        {!user ? (
          <button className="settings-upgrade-btn" onClick={login}>Sign in to accept</button>
        ) : (
          <>
            <button
              className="settings-upgrade-btn"
              onClick={handleAccept}
              disabled={accepting}
            >
              {accepting ? 'Joining...' : 'Accept Invitation'}
            </button>
            {error && <div className="settings-error" style={{ marginTop: 8 }}>{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
