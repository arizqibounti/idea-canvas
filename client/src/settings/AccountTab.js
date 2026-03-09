// ── Account Settings Tab ──────────────────────────────────────
import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useUser } from '../UserContext';
import { authFetch } from '../api';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function AccountTab() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useUser();
  const [name, setName] = useState(profile?.name || user?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await authFetch(`${API_URL}/api/me`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Profile</h2>
      <div className="settings-card">
        <div className="settings-avatar-row">
          {(profile?.photoURL || user?.photoURL) && (
            <img
              src={profile?.photoURL || user?.photoURL}
              alt=""
              className="settings-avatar"
            />
          )}
          <div>
            <div className="settings-field-label">Email</div>
            <div className="settings-field-value">{profile?.email || user?.email || 'Not set'}</div>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-field-label">Display Name</label>
          <input
            className="settings-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div className="settings-field">
          <label className="settings-field-label">Plan</label>
          <span className={`settings-plan-badge ${profile?.plan === 'pro' ? 'settings-plan-badge--pro' : ''}`}>
            {(profile?.plan || 'free').toUpperCase()}
          </span>
        </div>

        <button
          className="settings-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
