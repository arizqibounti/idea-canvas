// ── Zettelkasten Knowledge Graph View ────────────────────────
// Shows cross-session node clusters from the persistent knowledge store.

import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function KnowledgeGraph({ onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedCluster, setExpandedCluster] = useState(null);

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/api/knowledge/clusters`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClusters(); }, [fetchClusters]);

  return (
    <div className="knowledge-graph">
      <div className="knowledge-header">
        <div className="knowledge-title-row">
          <span className="knowledge-icon">&#x2B21;</span>
          <h2 className="knowledge-title">Knowledge Graph</h2>
          <span className="knowledge-subtitle">Zettelkasten — cross-session patterns</span>
        </div>
        <button className="knowledge-close" onClick={onClose}>&times;</button>
      </div>

      {loading && (
        <div className="knowledge-loading">
          <span className="knowledge-spinner" />
          Loading knowledge graph...
        </div>
      )}

      {error && (
        <div className="knowledge-error">
          Error: {error}
        </div>
      )}

      {data && !loading && (
        <>
          <div className="knowledge-stats">
            <div className="knowledge-stat">
              <span className="knowledge-stat-value">{data.totalNodes}</span>
              <span className="knowledge-stat-label">Total Nodes</span>
            </div>
            <div className="knowledge-stat">
              <span className="knowledge-stat-value">{data.totalSessions}</span>
              <span className="knowledge-stat-label">Sessions</span>
            </div>
            <div className="knowledge-stat">
              <span className="knowledge-stat-value">{data.clusters.length}</span>
              <span className="knowledge-stat-label">Clusters</span>
            </div>
          </div>

          {data.clusters.length === 0 ? (
            <div className="knowledge-empty">
              <span className="knowledge-empty-icon">&#x2B21;</span>
              <p>No patterns detected yet.</p>
              <p className="knowledge-empty-hint">Generate more ideas to build your knowledge graph. Patterns emerge after 3+ sessions.</p>
            </div>
          ) : (
            <div className="knowledge-clusters">
              {data.clusters.map((cluster, i) => (
                <div
                  key={cluster.tag}
                  className={`knowledge-cluster ${expandedCluster === i ? 'expanded' : ''}`}
                  onClick={() => setExpandedCluster(expandedCluster === i ? null : i)}
                >
                  <div className="knowledge-cluster-header">
                    <span className="knowledge-cluster-tag">{cluster.tag}</span>
                    <div className="knowledge-cluster-meta">
                      <span>{cluster.nodeCount} nodes</span>
                      <span>&middot;</span>
                      <span>{cluster.sessionCount} sessions</span>
                    </div>
                  </div>

                  {cluster.sessionCount >= 3 && (
                    <div className="knowledge-insight">
                      You've explored "{cluster.tag}" in {cluster.sessionCount} sessions — this may be a core thesis or recurring blind spot.
                    </div>
                  )}

                  {expandedCluster === i && (
                    <div className="knowledge-cluster-detail">
                      <div className="knowledge-cluster-ideas">
                        <span className="knowledge-detail-label">From ideas:</span>
                        {cluster.ideas.map((idea, j) => (
                          <span key={j} className="knowledge-idea-pill">{idea.slice(0, 60)}</span>
                        ))}
                      </div>
                      <div className="knowledge-cluster-nodes">
                        <span className="knowledge-detail-label">Recent nodes:</span>
                        {cluster.recentNodes.map((n, j) => (
                          <div key={j} className="knowledge-node-row">
                            <span className="knowledge-node-type">[{n.type}]</span>
                            <span className="knowledge-node-label">{n.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
