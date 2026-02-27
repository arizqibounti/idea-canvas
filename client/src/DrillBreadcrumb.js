import React from 'react';

export default function DrillBreadcrumb({ drillStack, onExit, onJump }) {
  if (!drillStack.length) return null;

  return (
    <div className="drill-breadcrumb">
      <button className="crumb crumb-exit" onClick={onExit}>
        ⬆ ROOT
      </button>
      {drillStack.map((entry, i) => (
        <React.Fragment key={entry.nodeId}>
          <span className="crumb-sep">›</span>
          <button
            className="crumb"
            onClick={() => onJump(i)}
            style={{ fontWeight: i === drillStack.length - 1 ? 600 : 400 }}
          >
            {entry.nodeLabel}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
