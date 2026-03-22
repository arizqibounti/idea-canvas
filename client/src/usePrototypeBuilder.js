import { useState, useRef, useCallback } from 'react';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

// SSE reader (same pattern used elsewhere in the codebase)
async function readSSE(res, onEvent, signal) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') return;
          try { onEvent(JSON.parse(payload)); } catch {}
        }
      }
    }
  } finally { reader.releaseLock(); }
}

export function usePrototypeBuilder() {
  const [isBuilding, setIsBuilding] = useState(false);
  const [prototype, setPrototype] = useState(null); // final result
  const abortRef = useRef(null);

  const handleBuildPrototype = useCallback(async (nodes, idea, mode, onProgress, sessionId) => {
    setIsBuilding(true);
    setPrototype(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const serialized = nodes.map(n => ({
        id: n.id,
        type: n.data?.type || n.type,
        label: n.data?.label || n.label,
        reasoning: n.data?.reasoning || n.reasoning || '',
        parentIds: n.data?.parentIds || [],
      }));

      const res = await authFetch(`${API_URL}/api/prototype/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: serialized, idea, mode }),
        signal: controller.signal,
      });

      await readSSE(res, (event) => {
        if (event._result) {
          // Map server data to player-expected shape
          const mappedScreens = (event.screens || []).map((s, i) => ({
            ...s,
            name: event.plan?.screens?.[i]?.name || s.screenId || `Screen ${i + 1}`,
          }));
          const built = { finalHtml: event.html, plan: event.plan, screens: mappedScreens, screenCount: event.screenCount, viewport: event.plan?.viewport };
          setPrototype(built);

          // Persist to session if we have a sessionId
          if (sessionId) {
            authFetch(`${API_URL}/api/sessions/${sessionId}/prototype`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prototype: built }),
            }).catch(err => console.warn('Failed to save prototype:', err));
          }
        }
        onProgress?.(event);
      }, controller.signal);
    } catch (err) {
      if (err.name !== 'AbortError') {
        onProgress?.({ error: err.message });
      }
    }
    setIsBuilding(false);
  }, []);

  const handleRegenScreen = useCallback(async (screenIndex, instruction, sessionId) => {
    if (!prototype) return;
    try {
      const res = await authFetch(`${API_URL}/api/prototype/regen-screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: prototype.plan,
          screenIndex,
          screenHtml: prototype.screens[screenIndex]?.html,
          nodes: [],
          instruction,
        }),
      });
      const data = await res.json();
      if (data.html) {
        setPrototype(prev => {
          const screens = [...prev.screens];
          screens[screenIndex] = { ...screens[screenIndex], html: data.html };
          const updated = { ...prev, screens };

          // Persist update
          if (sessionId) {
            authFetch(`${API_URL}/api/sessions/${sessionId}/prototype`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prototype: updated }),
            }).catch(err => console.warn('Failed to save prototype:', err));
          }
          return updated;
        });
      }
    } catch (err) {
      console.error('Regen screen error:', err);
    }
  }, [prototype]);

  const handleStopBuild = useCallback(() => {
    abortRef.current?.abort();
    setIsBuilding(false);
  }, []);

  return { isBuilding, prototype, setPrototype, handleBuildPrototype, handleRegenScreen, handleStopBuild };
}
