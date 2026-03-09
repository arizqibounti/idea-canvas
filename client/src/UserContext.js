// ── User Profile Context ──────────────────────────────────────
// Fetches and caches the user profile from /api/me on login.
// Provides profile, workspace, billing helpers to all components.

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const { user, tokenReady } = useAuth();
  const [profile, setProfile] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!user || !tokenReady) {
      setProfile(null);
      setWorkspace(null);
      setLoading(false);
      return;
    }

    try {
      const res = await authFetch(`${API_URL}/api/me`);
      if (res.ok) {
        const data = await res.json();
        setProfile(data);

        // Load personal workspace
        if (data.personalWorkspaceId) {
          const wsRes = await authFetch(`${API_URL}/api/workspaces/${data.personalWorkspaceId}`);
          if (wsRes.ok) setWorkspace(await wsRes.json());
        }
      }
    } catch (err) {
      console.warn('Failed to fetch user profile:', err.message);
    } finally {
      setLoading(false);
    }
  }, [user, tokenReady]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  // Billing helpers
  const createCheckout = useCallback(async () => {
    const res = await authFetch(`${API_URL}/api/billing/checkout`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId: workspace?.id }),
    });
    if (!res.ok) throw new Error('Failed to create checkout session');
    const { url } = await res.json();
    window.location.href = url;
  }, [workspace]);

  const openPortal = useCallback(async () => {
    const res = await authFetch(`${API_URL}/api/billing/portal`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error('Failed to create portal session');
    const { url } = await res.json();
    window.open(url, '_blank');
  }, []);

  const refreshProfile = useCallback(() => fetchProfile(), [fetchProfile]);

  return (
    <UserContext.Provider value={{ profile, workspace, loading, refreshProfile, createCheckout, openPortal }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within <UserProvider>');
  return ctx;
}
