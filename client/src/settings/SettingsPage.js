// ── Settings Page ─────────────────────────────────────────────
// Container with tabs: Account | Workspace | Members | Billing | Prompts

import React, { useState } from 'react';
import AccountTab from './AccountTab';
import WorkspaceTab from './WorkspaceTab';
import MembersTab from './MembersTab';
import BillingTab from './BillingTab';
import PromptsTab from './PromptsTab';

const TABS = [
  { id: 'account', label: 'ACCOUNT' },
  { id: 'workspace', label: 'WORKSPACE' },
  { id: 'members', label: 'MEMBERS' },
  { id: 'billing', label: 'BILLING' },
  { id: 'prompts', label: 'PROMPTS' },
];

export default function SettingsPage({ onClose }) {
  const [activeTab, setActiveTab] = useState('account');

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={onClose}>← BACK</button>
        <h1 className="settings-title">SETTINGS</h1>
      </div>
      <div className="settings-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? 'settings-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="settings-content">
        {activeTab === 'account' && <AccountTab />}
        {activeTab === 'workspace' && <WorkspaceTab />}
        {activeTab === 'members' && <MembersTab />}
        {activeTab === 'billing' && <BillingTab />}
        {activeTab === 'prompts' && <PromptsTab />}
      </div>
    </div>
  );
}
