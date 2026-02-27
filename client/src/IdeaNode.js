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
        width: '220px',
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
        opacity: dimmedBySearch ? 0.2 : (isInRange ? 1 : 0.08),
        filter: dimmedBySearch ? 'saturate(0.3)' : (isInRange ? 'none' : 'saturate(0.2)'),
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

      {/* Type badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <span style={{ color: config.color, fontSize: '12px' }}>{config.icon}</span>
        <span style={{
          color: config.color, fontSize: '10px', fontWeight: '700',
          letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.95,
        }}>
          {config.label}
        </span>
      </div>

      {/* Label */}
      <div style={{
        color: '#e8e8f0', fontSize: '13px', fontWeight: '600',
        lineHeight: '1.4', marginBottom: '8px', letterSpacing: '0.01em',
      }}>
        {data.label}
      </div>

      {/* Reasoning */}
      {data.reasoning && (
        <div style={{
          color: '#7070a0', fontSize: '11px', lineHeight: '1.5',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '7px', fontStyle: 'italic',
        }}>
          {data.reasoning}
        </div>
      )}

      {/* Left accent bar */}
      <div style={{
        position: 'absolute', left: 0, top: '10px', bottom: '10px',
        width: '3px', background: config.color,
        borderRadius: '0 2px 2px 0', opacity: 0.7,
      }} />

      <Handle type="target" position={Position.Top} style={{
        background: config.color, width: 8, height: 8,
        border: `2px solid ${config.bg}`, top: -5,
      }} />
      <Handle type="source" position={Position.Bottom} style={{
        background: config.color, width: 8, height: 8,
        border: `2px solid ${config.bg}`, bottom: -5,
      }} />
    </div>
  );
});

export default IdeaNode;
