import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { getNodeConfig } from './nodeConfig';

const IdeaNode = memo(({ data }) => {
  const config = getNodeConfig(data.type, data.dynamicConfig);
  const isSelected = data.isSelected;
  const isStarred = data.starred;
  const isInRange = data.isInRange !== false;
  const searchActive = data.searchActive === true;
  const searchMatch = data.searchMatch !== false;
  const dimmedBySearch = searchActive && !searchMatch;
  const chatFilterActive = data.chatFilterActive === true;
  const chatFilterMatch = data.chatFilterMatch !== false;
  const dimmedByChatFilter = chatFilterActive && !chatFilterMatch;
  const isDimmed = dimmedBySearch || dimmedByChatFilter;
  const isUnexplored = (data.childCount === 0) && !data.expanded && !data.isExpanding;
  const isLeaf = data.childCount === 0;
  const isConvergence = (data.parentIds?.length || 0) > 1;
  const hasLoop = !!data.loopId;
  const isGhost = data.isGhost === true;
  const isMergeTarget = data.isMergeTarget === true;

  // Build box shadow — add subtle bottom glow for unexplored leaves
  let boxShadow;
  if (isMergeTarget) {
    boxShadow = '0 0 0 2px #818cf8, 0 0 20px rgba(129,140,248,0.4)';
  } else if (isStarred) {
    boxShadow = '0 0 0 2px #ffd43b, 0 0 28px rgba(255,212,59,0.3)';
  } else if (isSelected) {
    boxShadow = `0 0 0 2px ${config.color}, 0 0 24px ${config.glow}`;
  } else {
    boxShadow = `0 0 12px ${config.glow}, 0 2px 8px rgba(0,0,0,0.4)`;
  }
  if (isUnexplored && isInRange) {
    boxShadow += ', 0 4px 14px rgba(108,99,255,0.2)';
  }

  return (
    <div
      className={isGhost ? 'idea-node-ghost' : undefined}
      onMouseEnter={() => data.onHoverPreview?.(data.nodeId, true)}
      onMouseLeave={() => data.onHoverPreview?.(data.nodeId, false)}
      style={{
        background: isGhost ? 'rgba(139,92,246,0.05)' : config.bg,
        border: `1px solid ${isMergeTarget ? '#818cf8' : isGhost ? 'rgba(139,92,246,0.2)' : isStarred ? '#ffd43b' : isSelected ? config.color : config.border}`,
        borderRadius: '8px',
        padding: '12px 14px',
        width: '260px',
        minHeight: isGhost ? '60px' : '100px',
        position: 'relative',
        fontFamily: 'var(--font-mono)',
        cursor: isInRange ? 'pointer' : 'default',
        boxShadow,
        transition: 'opacity 0.3s ease, filter 0.3s ease, box-shadow 0.2s ease',
        opacity: isGhost ? 0.6 : isDimmed ? 0.35 : (isInRange ? 1 : 0.08),
        filter: isDimmed ? 'saturate(0.4) brightness(0.7)' : (isInRange ? 'none' : 'saturate(0.2)'),
        pointerEvents: isGhost ? 'none' : isDimmed ? 'none' : (isInRange ? 'auto' : 'none'),
      }}
    >
      {/* Ghost shimmer overlay */}
      {isGhost && (
        <div className="ghost-shimmer">
          <div style={{ color: '#a78bfa', fontSize: 11, fontWeight: 600 }}>
            Generating…
          </div>
          <div className="ghost-pulse-bar" />
        </div>
      )}

      {/* Merge target indicator */}
      {isMergeTarget && (
        <div style={{
          position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
          background: '#1e1e2e', border: '1px solid #818cf8',
          borderRadius: 8, padding: '1px 8px',
          fontSize: 8, fontWeight: 700, color: '#818cf8',
          fontFamily: 'var(--font-mono)', zIndex: 3,
          letterSpacing: '0.06em',
        }}>
          MERGE TARGET
        </div>
      )}

      {/* Star badge */}
      {isStarred && (
        <div style={{
          position: 'absolute', top: 7, right: 10,
          color: '#ffd43b', fontSize: 12, lineHeight: 1,
        }}>★ FOCUS</div>
      )}

      {/* Score badge */}
      {data.score != null && (
        <div style={{
          position: 'absolute', top: 7, right: isStarred ? 65 : 10,
          display: 'flex', alignItems: 'center', padding: '1px 6px',
          borderRadius: 4, fontSize: 10, fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          background: data.score >= 8 ? 'rgba(34,197,94,0.15)' : data.score >= 5 ? 'rgba(250,204,21,0.15)' : 'rgba(248,113,113,0.15)',
          color: data.score >= 8 ? '#22c55e' : data.score >= 5 ? '#facc15' : '#f87171',
          border: `1px solid ${data.score >= 8 ? 'rgba(34,197,94,0.3)' : data.score >= 5 ? 'rgba(250,204,21,0.3)' : 'rgba(248,113,113,0.3)'}`,
        }}>
          {data.score}/10
        </div>
      )}

      {/* Mastery badge (learn mode) */}
      {data.mastery != null && data.mastery > 0 && (
        <div style={{
          position: 'absolute', top: 7,
          right: data.score != null ? (isStarred ? 100 : 50) : (isStarred ? 65 : 10),
          display: 'flex', alignItems: 'center', padding: '1px 6px',
          borderRadius: 4, fontSize: 10, fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          background: data.mastery >= 8 ? 'rgba(34,197,94,0.15)' : data.mastery >= 5 ? 'rgba(251,191,36,0.15)' : 'rgba(239,68,68,0.15)',
          color: data.mastery >= 8 ? '#22c55e' : data.mastery >= 5 ? '#fbbf24' : '#ef4444',
          border: `1px solid ${data.mastery >= 8 ? 'rgba(34,197,94,0.3)' : data.mastery >= 5 ? 'rgba(251,191,36,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          {data.mastery >= 8 ? '✓' : data.mastery >= 5 ? '◐' : '○'} {data.mastery}/10
        </div>
      )}

      {/* Mastery left accent bar (learn mode) */}
      {data.mastery != null && (
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0, width: 4,
          borderRadius: '8px 0 0 8px',
          background: data.mastery >= 8 ? '#22c55e' : data.mastery >= 5 ? '#fbbf24' : data.mastery >= 1 ? '#ef4444' : '#374151',
        }} />
      )}

      {/* Depth indicator */}
      {data.depth >= 2 && (
        <span style={{
          position: 'absolute', top: 6, left: 10,
          fontSize: 8, fontWeight: 600, color: '#555580',
          letterSpacing: '0.04em', opacity: 0.7,
          fontFamily: 'var(--font-mono)',
        }}>
          L{data.depth}
        </span>
      )}

      {/* Execution status badge */}
      {data.executionStatus === 'in_progress' && (
        <div className="node-exec-badge node-exec-pulse" style={{
          position: 'absolute', top: 7,
          right: data.score != null ? (isStarred ? 100 : 50) : (isStarred ? 65 : 10),
        }}>
          ⟳ FIXING…
        </div>
      )}
      {data.executionStatus === 'completed' && (
        <div className="node-exec-badge node-exec-fixed" style={{
          position: 'absolute', top: 7,
          right: data.score != null ? (isStarred ? 100 : 50) : (isStarred ? 65 : 10),
        }}>
          ✓ FIXED
        </div>
      )}
      {data.executionStatus === 'failed' && (
        <div className="node-exec-badge node-exec-failed" style={{
          position: 'absolute', top: 7,
          right: data.score != null ? (isStarred ? 100 : 50) : (isStarred ? 65 : 10),
        }}>
          ✗ FAILED
        </div>
      )}

      {/* Auto-explored badge */}
      {data.autoExplored && (
        <span
          title="Auto-explored by fractal mode"
          style={{
            position: 'absolute', top: 6,
            right: data.score != null ? (isStarred ? 100 : 50) : (isStarred ? 65 : 10),
            fontSize: 10, color: '#c084fc', opacity: 0.8,
            fontWeight: 700,
          }}
        >
          ∞
        </span>
      )}

      {/* Convergence badge — multi-parent node */}
      {isConvergence && (
        <div
          title={`Convergence: ${data.parentIds.length} parent connections`}
          style={{
            position: 'absolute', top: -10, right: 12,
            background: '#1e1e2e', border: '1px solid #818cf8',
            borderRadius: 8, padding: '1px 6px',
            fontSize: 9, fontWeight: 700, color: '#818cf8',
            fontFamily: 'var(--font-mono)', zIndex: 3,
            display: 'flex', alignItems: 'center', gap: 3,
          }}
        >
          <span style={{ fontSize: 10 }}>&#x21E4;</span> {data.parentIds.length}
        </div>
      )}

      {/* Loop badge */}
      {hasLoop && (
        <div
          title={`Part of feedback loop: ${data.loopId}`}
          style={{
            position: 'absolute', top: -10, left: 12,
            background: '#1e1e2e',
            border: `1px solid ${data.loopType === 'balancing' ? '#f59e0b' : '#22c55e'}`,
            borderRadius: 8, padding: '1px 6px',
            fontSize: 8, fontWeight: 700,
            color: data.loopType === 'balancing' ? '#f59e0b' : '#22c55e',
            fontFamily: 'var(--font-mono)', zIndex: 3,
            letterSpacing: '0.05em',
          }}
        >
          {data.loopType === 'balancing' ? '⟳ BAL' : '⟲ REINF'}
        </div>
      )}

      {/* Type badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <span style={{ color: config.color, fontSize: '12px' }}>{config.icon}</span>
        <span style={{
          color: config.color, fontSize: '10px', fontWeight: '700',
          letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.95,
        }}>
          {config.label}
        </span>
        {data.lens && (
          <span
            title={data.lens === 'first_principles' ? 'First Principles' : data.lens === 'analogical' ? 'Analogical' : data.lens === 'adversarial' ? 'Adversarial' : 'Synthesis'}
            style={{
              fontSize: 8, marginLeft: 'auto', fontWeight: 600,
              letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7,
              color: data.lens === 'analogical' ? '#4dabf7' : data.lens === 'first_principles' ? '#69db7c' : data.lens === 'adversarial' ? '#ff6b6b' : '#c084fc',
            }}
          >
            {data.lens === 'first_principles' ? 'FP' : data.lens === 'analogical' ? 'AN' : data.lens === 'adversarial' ? 'ADV' : 'SYN'}
          </span>
        )}
      </div>

      {/* Label */}
      <div
        style={{
          color: '#e8e8f0', fontSize: '13px', fontWeight: '600',
          lineHeight: '1.4', marginBottom: '8px', letterSpacing: '0.01em',
          display: '-webkit-box', WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}
        title={data.label}
      >
        {data.label}
      </div>

      {/* Reasoning */}
      {data.reasoning && (
        <div
          style={{
            color: '#8888b8', fontSize: '11px', lineHeight: '1.5',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: '7px', fontStyle: 'italic',
            display: '-webkit-box', WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}
          title={data.reasoning}
        >
          {data.reasoning}
        </div>
      )}

      {/* Left accent bar — colored by execution status, loop, or type */}
      <div style={{
        position: 'absolute', left: 0, top: '10px', bottom: '10px',
        width: data.executionStatus ? '4px' : (hasLoop ? '4px' : '3px'),
        background: data.executionStatus === 'in_progress' ? '#f59e0b'
          : data.executionStatus === 'completed' ? '#22c55e'
          : data.executionStatus === 'failed' ? '#f87171'
          : hasLoop ? (data.loopType === 'balancing' ? '#f59e0b' : '#22c55e')
          : config.color,
        borderRadius: '0 2px 2px 0',
        opacity: data.executionStatus || hasLoop ? 1 : 0.85,
      }} />

      <Handle type="target" position={Position.Top} style={{
        background: config.color, width: 8, height: 8,
        border: `2px solid ${config.bg}`, top: -5,
      }} />
      <Handle type="source" position={Position.Bottom} style={{
        background: config.color, width: 8, height: 8,
        border: `2px solid ${config.bg}`, bottom: -5,
      }} />

      {/* Bottom area: fractal expand OR collapse/expand OR child count */}
      {data.isExpanding ? (
        /* Loading state during expansion */
        <div className="fractal-expanding" style={{
          position: 'absolute', bottom: -20, left: '50%',
          transform: 'translateX(-50%)',
        }}>
          <span className="fractal-pulse" />
        </div>
      ) : isLeaf && isInRange && !isDimmed ? (
        /* Fractal expand button — shown on leaf nodes */
        <button
          className="fractal-expand-btn"
          onClick={(e) => { e.stopPropagation(); data.onFractalExpand?.(data.nodeId); }}
          title="Expand this idea fractally"
          style={{
            position: 'absolute', bottom: -16, left: '50%',
            transform: 'translateX(-50%)',
            background: '#16161f', border: `1px solid ${config.border}`,
            borderRadius: 12, padding: '2px 10px',
            fontSize: 12, fontWeight: 700, color: '#6c63ff',
            cursor: 'pointer', zIndex: 2, fontFamily: 'var(--font-mono)',
            transition: 'all 0.2s ease',
            opacity: 0.7,
          }}
          onMouseEnter={e => { e.target.style.opacity = '1'; e.target.style.background = '#1e1e2e'; e.target.style.borderColor = '#6c63ff'; }}
          onMouseLeave={e => { e.target.style.opacity = '0.7'; e.target.style.background = '#16161f'; e.target.style.borderColor = config.border; }}
        >
          ⊕
        </button>
      ) : data.childCount > 0 ? (
        /* Collapse/expand chevron with child count */
        <button
          className="fractal-collapse-btn"
          onClick={(e) => { e.stopPropagation(); data.onToggleCollapse?.(data.nodeId); }}
          title={data.isCollapsed ? 'Expand children' : 'Collapse children'}
          style={{
            position: 'absolute', bottom: -18, left: '50%',
            transform: 'translateX(-50%)',
            background: config.bg, border: `1px solid ${config.border}`,
            borderRadius: 10, padding: '1px 8px',
            fontSize: 9, fontWeight: 700, color: config.color,
            cursor: 'pointer', zIndex: 2, fontFamily: 'var(--font-mono)',
            display: 'flex', alignItems: 'center', gap: 3,
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: 8 }}>{data.isCollapsed ? '▸' : '▾'}</span>
          {data.childCount}
        </button>
      ) : null}

      {/* Unexplored glow effect */}
      {isUnexplored && isInRange && !isDimmed && (
        <div className="fractal-glow" style={{
          position: 'absolute', bottom: -2, left: '10%', right: '10%',
          height: 4, borderRadius: 2,
          background: 'linear-gradient(90deg, transparent, rgba(108,99,255,0.4), transparent)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
});

export default IdeaNode;
