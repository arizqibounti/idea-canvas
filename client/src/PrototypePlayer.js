import React, { useRef, useEffect } from 'react';

export default function PrototypePlayer({ html, isLoading, error }) {
  const iframeRef = useRef(null);

  // When html changes, write it into the iframe via srcdoc.
  // We use a ref write instead of the srcdoc prop so React doesn't
  // unnecessarily remount the iframe on every keystroke in the parent.
  useEffect(() => {
    if (iframeRef.current && html) {
      iframeRef.current.srcdoc = html;
    }
  }, [html]);

  if (isLoading) {
    return (
      <div className="mockup-player-wrapper mockup-loading">
        <div className="mockup-spinner" />
        <span className="mockup-loading-text">generating interactive prototype…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mockup-player-wrapper mockup-error">
        <span>⚠ {error}</span>
      </div>
    );
  }

  if (!html) return null;

  return (
    <div className="mockup-player-wrapper">
      {/* Phone chrome */}
      <div className="prototype-phone">
        <div className="prototype-notch" />
        <iframe
          ref={iframeRef}
          title="Feature prototype"
          sandbox="allow-scripts"
          scrolling="no"
          className="prototype-iframe"
          /* srcdoc is set imperatively via the effect above */
        />
      </div>
    </div>
  );
}
