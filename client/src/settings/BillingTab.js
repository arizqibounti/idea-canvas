// ── Billing Settings Tab ──────────────────────────────────────
import React, { useState, useEffect } from 'react';
import { useUser } from '../UserContext';
import { authFetch } from '../api';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function BillingTab() {
  const { profile, createCheckout, openPortal } = useUser();
  const [usage, setUsage] = useState(null);
  const [upgrading, setUpgrading] = useState(false);

  const isPro = profile?.plan === 'pro';

  useEffect(() => {
    authFetch(`${API_URL}/api/usage`)
      .then(r => r.ok ? r.json() : null)
      .then(data => data && setUsage(data))
      .catch(() => {});
  }, []);

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      await createCheckout();
    } catch (err) {
      console.error('Checkout error:', err);
      setUpgrading(false);
    }
  };

  const usagePercent = usage ? Math.min(100, (usage.generationsToday / usage.limit) * 100) : 0;
  const usageColor = usagePercent > 80 ? '#ef4444' : usagePercent > 50 ? '#eab308' : '#22c55e';

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Billing & Usage</h2>

      {/* Current plan */}
      <div className="settings-card">
        <div className="settings-plan-header">
          <div>
            <div className="settings-field-label">Current Plan</div>
            <span className={`settings-plan-badge settings-plan-badge--lg ${isPro ? 'settings-plan-badge--pro' : ''}`}>
              {isPro ? 'PRO' : 'FREE'}
            </span>
          </div>
          {isPro ? (
            <button className="settings-portal-btn" onClick={openPortal}>
              Manage Subscription
            </button>
          ) : (
            <button
              className="settings-upgrade-btn"
              onClick={handleUpgrade}
              disabled={upgrading}
            >
              {upgrading ? 'Redirecting...' : 'Upgrade to Pro — $20/mo'}
            </button>
          )}
        </div>
      </div>

      {/* Usage */}
      {usage && (
        <div className="settings-card" style={{ marginTop: 16 }}>
          <div className="settings-field-label">Daily Usage</div>
          <div className="settings-usage-bar-wrap">
            <div className="settings-usage-bar" style={{ width: `${usagePercent}%`, backgroundColor: usageColor }} />
          </div>
          <div className="settings-usage-text">
            <span>{usage.generationsToday} / {usage.limit} generations today</span>
            <span className="settings-muted">{usage.remaining} remaining</span>
          </div>
          <div className="settings-usage-total">
            Total generations: {usage.totalGenerations || 0}
          </div>
        </div>
      )}

      {/* Plan comparison */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-subsection-title">Plan Comparison</h3>
        <table className="settings-plan-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Free</th>
              <th>Pro</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Generations / day</td><td>20</td><td>150</td></tr>
            <tr><td>Team members</td><td>1 (personal)</td><td>Up to 10</td></tr>
            <tr><td>Workspaces</td><td>Personal only</td><td>Multiple</td></tr>
            <tr><td>All thinking modes</td><td>✓</td><td>✓</td></tr>
            <tr><td>Share links</td><td>✓</td><td>✓</td></tr>
            <tr><td>Cinematic & Studio</td><td>✓</td><td>✓</td></tr>
            <tr><td>Live collaboration</td><td>✓</td><td>✓</td></tr>
            <tr><td>Priority support</td><td>—</td><td>✓</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
