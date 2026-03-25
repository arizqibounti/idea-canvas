// ── useGmail hook ─────────────────────────────────────────────
// Extracted Gmail integration logic: status, connect, disconnect,
// thread search/select, and picker modal state.

import { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

const ENDPOINTS = {
  status:     `${API_URL}/api/integrations/gmail/status`,
  connect:    `${API_URL}/api/integrations/gmail/connect`,
  disconnect: `${API_URL}/api/integrations/gmail/disconnect`,
  threads:    `${API_URL}/api/integrations/gmail/threads`,
  thread:     (id, mode) => `${API_URL}/api/integrations/gmail/thread/${id}${mode ? `?mode=${mode}` : ''}`,
};

const MAX_RESULTS = 25;

export default function useGmail({ onThreadSelected, onClearEmail, mode } = {}) {
  const [status, setStatus] = useState({ configured: false, connected: false, account: null });
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [threads, setThreads] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(null);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  // Check integration status on mount
  useEffect(() => {
    authFetch(ENDPOINTS.status)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStatus(d); })
      .catch(() => {});
  }, []);

  // Listen for OAuth popup callback
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'gmail-connected') {
        setStatus(prev => ({ ...prev, configured: true, connected: true, account: event.data.email }));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const res = await authFetch(ENDPOINTS.connect, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to start connection');
        return;
      }
      const { authUrl } = await res.json();
      const w = 500, h = 600;
      const left = window.screenX + (window.innerWidth - w) / 2;
      const top = window.screenY + (window.innerHeight - h) / 2;
      window.open(authUrl, 'gmail-oauth', `width=${w},height=${h},left=${left},top=${top}`);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await authFetch(ENDPOINTS.disconnect, { method: 'POST' }).catch(() => {});
    setStatus(prev => ({ ...prev, connected: false, account: null }));
    setThreads([]);
    onClearEmail?.();
  }, [onClearEmail]);

  const searchThreads = useCallback(async (query) => {
    setIsSearching(true);
    setError(null);
    try {
      const res = await authFetch(`${ENDPOINTS.threads}?q=${encodeURIComponent(query || '')}&maxResults=${MAX_RESULTS}`);
      if (!res.ok) throw new Error('Failed to fetch threads');
      const data = await res.json();
      setThreads(data.threads || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced auto-search as user types (300ms delay)
  const handleSearchInput = useCallback((value) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchThreads(value);
    }, 400);
  }, [searchThreads]);

  const selectThread = useCallback(async (threadId) => {
    setIsLoadingThread(threadId);
    setError(null);
    try {
      const res = await authFetch(ENDPOINTS.thread(threadId, mode));
      if (!res.ok) throw new Error('Failed to fetch thread');
      const data = await res.json();
      onThreadSelected?.({
        id: data.thread.id,
        subject: data.thread.subject,
        messageCount: data.thread.messageCount,
        formatted: data.formatted,
      });
      setShowPicker(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoadingThread(null);
    }
  }, [onThreadSelected, mode]);

  const openPicker = useCallback(() => {
    setShowPicker(true);
    setSearchQuery('');
    searchThreads('');
  }, [searchThreads]);

  return {
    // Status
    configured: status.configured,
    connected: status.connected,
    account: status.account,
    error,
    // Actions
    connect,
    disconnect,
    openPicker,
    // Picker state
    showPicker,
    setShowPicker,
    searchQuery,
    setSearchQuery: handleSearchInput, // auto-search on type
    searchThreads,
    selectThread,
    threads,
    isSearching,
    isLoadingThread,
  };
}
