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

  return (
    <div
      style={{
        background: config.bg,
        border: `1px solid ${isStarred ? '#ffd43b' : isSelected ? config.color : config.border}`,
        borderRadius: '8px',
        padding: '12px 14px',
        width: '260px',
        minHeight: '100px',
        position: 'relative',
        fontFamily: 'var(--font-mono)',
        cursor: isInRange ? 'pointer' : 'default',
        boxShadow: isStarred
          ? `0 0 0 2px #ffd43b, 0 0 28px rgba(255,212,59,0.3)`
          : isSelected
            ? `0 0 0 2px ${config.color}, 0 0 24px ${config.glow}`
            : `0 0 12px ${config.glow}, 0 2px 8px rgba(0,0,0,0.4)`,
        transition: 'opacity 0.3s ease, filter 0.3s ease, box-shadow 0.2s ease',
        animation: 'nodeAppear 0.3s ease forwards',
        opacity: dimmedBySearch ? 0.35 : (isInRange ? 1 : 0.08),
        filter: dimmedBySearch ? 'saturate(0.4) brightness(0.7)' : (isInRange ? 'none' : 'saturate(0.2)'),
        pointerEvents: dimmedBySearch ? 'none' : (isInRange ? 'auto' : 'none'),
      }}
    >
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

      {/* Left accent bar */}
      <div style={{
        position: 'absolute', left: 0, top: '10px', bottom: '10px',
        width: '3px', background: config.color,
        borderRadius: '0 2px 2px 0', opacity: 0.85,
      }} />

      <Handle type="target" position={Position.Top} style={{
        background: config.color, width: 8, height: 8,
        border: `2px solid ${config.bg}`, top: -5,
      }} />
      <Handle type="source" position={Position.Bottom} style={{
        background: config.color, width: 8, height: 8,
        border: `2px solid ${config.bg}`, bottom: -5,
      }} />

      {/* Child count badge */}
      {data.childCount > 0 && (
        <div style={{
          position: 'absolute', bottom: -18, left: '50%',
          transform: 'translateX(-50%)',
          background: config.bg, border: `1px solid ${config.border}`,
          borderRadius: 10, padding: '1px 6px',
          fontSize: 9, fontWeight: 700, color: config.color,
          opacity: 0.8, zIndex: 1, fontFamily: 'var(--font-mono)',
        }}>
          {data.childCount}
        </div>
      )}
    </div>
  );
});

export default IdeaNode;
