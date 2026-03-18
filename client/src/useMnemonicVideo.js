// ── Mnemonic video generation hook ──────────────────────────
// Manages Veo 3 mnemonic video jobs per node: generate → poll → complete

import { useState, useRef, useCallback, useEffect } from 'react';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';
const POLL_INTERVAL = 10000;  // 10 seconds
const MAX_POLL_TIME = 7 * 60 * 1000;  // 7 minutes timeout

export function useMnemonicVideo() {
  const [mnemonicJobs, setMnemonicJobs] = useState({});
  const pollTimers = useRef({});

  // Clean up all polling intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
    };
  }, []);

  const startPolling = useCallback((nodeId, jobId, startTime) => {
    // Clear any existing poll for this node
    if (pollTimers.current[nodeId]) clearInterval(pollTimers.current[nodeId]);

    pollTimers.current[nodeId] = setInterval(async () => {
      // Timeout check
      if (Date.now() - startTime > MAX_POLL_TIME) {
        clearInterval(pollTimers.current[nodeId]);
        delete pollTimers.current[nodeId];
        setMnemonicJobs(prev => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], status: 'error', error: 'Video generation timed out (7 minutes). Try again.' },
        }));
        return;
      }

      try {
        const res = await authFetch(`${API_URL}/api/learn/mnemonic/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        });

        if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
        const data = await res.json();

        if (data.status === 'complete') {
          clearInterval(pollTimers.current[nodeId]);
          delete pollTimers.current[nodeId];
          setMnemonicJobs(prev => ({
            ...prev,
            [nodeId]: {
              ...prev[nodeId],
              status: 'complete',
              videoUrl: data.videoUrl,
            },
          }));
        }
        // If still pending, interval continues
      } catch (err) {
        console.error('Mnemonic poll error:', err);
        // Don't stop polling on transient errors — just log
      }
    }, POLL_INTERVAL);
  }, []);

  const generateMnemonic = useCallback(async (nodeId, topic, nodes) => {
    // Set initial generating state
    setMnemonicJobs(prev => ({
      ...prev,
      [nodeId]: { status: 'generating', jobId: null, mnemonicStrategy: null, veoPrompt: null, briefDescription: null, videoUrl: null, error: null },
    }));

    try {
      const res = await authFetch(`${API_URL}/api/learn/mnemonic/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, topic, nodes }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Generate failed: ${res.status}`);
      }

      const data = await res.json();

      setMnemonicJobs(prev => ({
        ...prev,
        [nodeId]: {
          status: 'polling',
          jobId: data.jobId,
          mnemonicStrategy: data.mnemonicStrategy,
          veoPrompt: data.veoPrompt,
          briefDescription: data.briefDescription,
          videoUrl: null,
          error: null,
        },
      }));

      // Start polling for completion
      startPolling(nodeId, data.jobId, Date.now());
    } catch (err) {
      console.error('Mnemonic generate error:', err);
      setMnemonicJobs(prev => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], status: 'error', error: err.message },
      }));
    }
  }, [startPolling]);

  const cancelMnemonic = useCallback((nodeId) => {
    if (pollTimers.current[nodeId]) {
      clearInterval(pollTimers.current[nodeId]);
      delete pollTimers.current[nodeId];
    }
    setMnemonicJobs(prev => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, []);

  return { mnemonicJobs, generateMnemonic, cancelMnemonic };
}
