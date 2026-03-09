// ── Workspace Settings Tab ────────────────────────────────────
import React, { useState } from 'react';
import { useUser } from '../UserContext';
import { authFetch } from '../api';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function WorkspaceTab() {
  const { profile, workspace, refreshProfile } = useUser();
  const [name, setName] = useState(workspace?.name || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isPro = profile?.plan === 'pro';

  const handleSave = async () => {
    if (!workspace) return;
    setSaving(true);
    try {
      await authFetch(`${API_URL}/api/workspaces/${workspace.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save workspace:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!isPro) {
    return (
      <div className="settings-section">
        <h2 className="settings-section-title">Workspace</h2>
        <div className="settings-card settings-locked">
          <div className="settings-locked-icon">🔒</div>
          <p>Workspace customization is available on the Pro plan.</p>
          <p className="settings-muted">Upgrade to rename your workspace and configure team settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Workspace</h2>
      <div className="settings-card">
        <div className="settings-field">
          <label className="settings-field-label">Workspace Name</label>
          <input
            className="settings-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Workspace"
          />
        </div>

        <div className="settings-field">
          <label className="settings-field-label">Slug</label>
          <div className="settings-field-value settings-muted">{workspace?.slug || '—'}</div>
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
