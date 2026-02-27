import React, { useState, useEffect, useCallback } from 'react';

const API_URL = 'http://localhost:5001';
const MEMORY_KEY = 'IDEA_MEMORY_SESSIONS';

// ── Helpers ───────────────────────────────────────────────────

export function buildMemoryEntry(idea, rawNodes) {
  const nodeTypeCounts = {};
  const topLabels = [];
  rawNodes.forEach((n) => {
    const t = n.data?.type || 'unknown';
    nodeTypeCounts[t] = (nodeTypeCounts[t] || 0) + 1;
    if (topLabels.length < 12) topLabels.push(n.data?.label || '');
  });
  return {
    idea,
    nodeCount: rawNodes.length,
    nodeTypeCounts,
    topLabels,
    timestamp: Date.now(),
  };
}

export function readMemory() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]'); }
  catch { return []; }
}

export function appendMemory(entry) {
  const sessions = readMemory();
  // Keep latest 20 sessions for analysis
  const updated = [entry, ...sessions].slice(0, 20);
  localStorage.setItem(MEMORY_KEY, JSON.stringify(updated));
  return updated;
}

// ── MemoryInsights component ──────────────────────────────────

export default function MemoryInsights({ onDismiss }) {
  const [patterns, setPatterns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const fetchInsights = useCallback(async () => {
    const sessions = readMemory();
    if (sessions.length < 2) { setLoading(false); return; }

    try {
      const res = await fetch(`${API_URL}/api/reflect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.patterns?.length) setPatterns(data.patterns);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchInsights(); }, [fetchInsights]);

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  if (dismissed || (!loading && !patterns)) return null;

  const typeColors = {
    blindspot: '#ff4757',
    bias: '#ffa94d',
    strength: '#51cf66',
  };
  const typeIcons = { blindspot: '◌', bias: '⟳', strength: '✦' };
  const typeLabels = { blindspot: 'BLIND SPOT', bias: 'TENDENCY', strength: 'STRENGTH' };

  return (
    <div className="memory-card">
      <div className="memory-card-header">
        <span className="memory-card-title">◈ YOUR THINKING PATTERNS</span>
        <button className="modal-close" onClick={handleDismiss}>✕</button>
      </div>

      {loading ? (
        <div className="memory-card-loading">
          <span className="memory-spinner" />
          <span>analyzing your past sessions...</span>
        </div>
      ) : (
        <div className="memory-card-patterns">
          {patterns?.map((p, i) => (
            <div key={i} className="memory-pattern">
              <div className="memory-pattern-header">
                <span
                  className="memory-pattern-badge"
                  style={{ color: typeColors[p.type], borderColor: typeColors[p.type] }}
                >
                  {typeIcons[p.type]} {typeLabels[p.type]}
                </span>
              </div>
              <div className="memory-pattern-insight">{p.insight}</div>
              <div className="memory-pattern-detail">{p.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
