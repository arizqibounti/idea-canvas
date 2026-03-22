import React, { useState, useRef, useEffect, useCallback } from 'react';

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 800;

export default function FullPrototypePlayer({ prototype, onClose, onRegenScreen }) {
  const [activeScreen, setActiveScreen] = useState(0);
  const [viewMode, setViewMode] = useState('combined'); // 'combined' | 'screen'
  const [viewport, setViewport] = useState(prototype?.viewport || 'mobile');
  const [autoDemo, setAutoDemo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);
  const iframeRef = useRef(null);
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const autoDemoRef = useRef(null);

  const screens = prototype?.screens || [];
  const hasFinalHtml = !!prototype?.finalHtml;

  // Write HTML into iframe imperatively
  useEffect(() => {
    if (!iframeRef.current) return;
    const html = viewMode === 'combined' && hasFinalHtml
      ? prototype.finalHtml
      : screens[activeScreen]?.html || '';
    iframeRef.current.srcdoc = html;
  }, [viewMode, activeScreen, screens, hasFinalHtml, prototype?.finalHtml, viewport]);

  // Scale-to-fit: measure the viewer container and compute the scale factor
  useEffect(() => {
    if (viewport !== 'desktop' || !viewerRef.current) return;
    const measure = () => {
      const rect = viewerRef.current.getBoundingClientRect();
      // Available space minus padding
      const availW = rect.width - 24;
      const availH = rect.height - 24;
      const scaleW = availW / DESIGN_WIDTH;
      const scaleH = availH / DESIGN_HEIGHT;
      setScale(Math.min(scaleW, scaleH, 1)); // never scale up
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewerRef.current);
    return () => observer.disconnect();
  }, [viewport, isFullscreen]);

  // Auto-demo: cycle screens every 3 seconds
  useEffect(() => {
    if (autoDemo && screens.length > 1 && viewMode === 'screen') {
      autoDemoRef.current = setInterval(() => {
        setActiveScreen(prev => (prev + 1) % screens.length);
      }, 3000);
    }
    return () => {
      if (autoDemoRef.current) clearInterval(autoDemoRef.current);
    };
  }, [autoDemo, screens.length, viewMode]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleRegenClick = useCallback((idx) => {
    const instruction = window.prompt('Describe what to change on this screen:');
    if (instruction) onRegenScreen?.(idx, instruction);
  }, [onRegenScreen]);

  return (
    <div className="full-prototype-overlay">
      <div className="full-prototype-backdrop" onClick={onClose} />
      <div className="full-prototype-container" ref={containerRef}>
        {/* Sidebar */}
        <div className="full-prototype-sidebar">
          <div className="full-prototype-sidebar-title">Screens</div>
          {screens.map((screen, i) => (
            <div
              key={i}
              className={`prototype-screen-thumb ${viewMode === 'screen' && activeScreen === i ? 'active' : ''}`}
              onClick={() => { setActiveScreen(i); setViewMode('screen'); }}
            >
              <span className="prototype-screen-name">{screen.name || `Screen ${i + 1}`}</span>
              <button
                className="prototype-screen-regen"
                onClick={(e) => { e.stopPropagation(); handleRegenClick(i); }}
                title="Regenerate this screen"
              >
                ⟲
              </button>
            </div>
          ))}
          {hasFinalHtml && (
            <div
              className={`prototype-screen-thumb ${viewMode === 'combined' ? 'active' : ''}`}
              onClick={() => setViewMode('combined')}
            >
              <span className="prototype-screen-name">Combined</span>
            </div>
          )}
        </div>

        {/* Main area */}
        <div className="full-prototype-main">
          {/* Toolbar */}
          <div className="full-prototype-toolbar">
            <button
              className={`full-prototype-toolbar-btn ${viewport === 'mobile' ? 'full-prototype-toolbar-btn--active' : ''}`}
              onClick={() => setViewport('mobile')}
              title="Mobile view"
            >
              ◻ Mobile
            </button>
            <button
              className={`full-prototype-toolbar-btn ${viewport === 'desktop' ? 'full-prototype-toolbar-btn--active' : ''}`}
              onClick={() => setViewport('desktop')}
              title="Desktop view"
            >
              ▭ Desktop
            </button>
            <div className="toolbar-sep" />
            {hasFinalHtml && (
              <button
                className={`full-prototype-toolbar-btn ${viewMode === 'combined' ? 'full-prototype-toolbar-btn--active' : ''}`}
                onClick={() => setViewMode(viewMode === 'combined' ? 'screen' : 'combined')}
              >
                {viewMode === 'combined' ? '◉ Combined' : '◎ Screens'}
              </button>
            )}
            {viewMode === 'screen' && screens.length > 1 && (
              <button
                className={`full-prototype-toolbar-btn ${autoDemo ? 'full-prototype-toolbar-btn--active' : ''}`}
                onClick={() => setAutoDemo(v => !v)}
                title="Auto-cycle through screens"
              >
                {autoDemo ? '⏸ Pause' : '▶ Demo'}
              </button>
            )}
            {autoDemo && <span className="prototype-auto-demo-indicator">auto-playing</span>}
            {viewport === 'desktop' && scale < 1 && (
              <span className="prototype-scale-indicator">{Math.round(scale * 100)}%</span>
            )}
            <div className="full-prototype-toolbar-spacer" />
            <button
              className="full-prototype-toolbar-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? '⊡' : '⊞'}
            </button>
            <button className="full-prototype-toolbar-close" onClick={onClose} title="Close viewer">
              ✕
            </button>
          </div>

          {/* Viewer */}
          <div className="full-prototype-viewer" ref={viewerRef}>
            {viewport === 'mobile' ? (
              <div className="prototype-phone-viewer">
                <div className="prototype-phone">
                  <div className="prototype-notch" />
                  <iframe
                    ref={iframeRef}
                    title="Prototype viewer"
                    sandbox="allow-scripts"
                    className="prototype-iframe"
                  />
                </div>
              </div>
            ) : (
              <div
                className="prototype-desktop-chrome"
                style={{
                  width: DESIGN_WIDTH,
                  height: DESIGN_HEIGHT,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <div className="prototype-address-bar">
                  <div className="prototype-window-dots">
                    <span className="prototype-window-dot prototype-window-dot--red" />
                    <span className="prototype-window-dot prototype-window-dot--yellow" />
                    <span className="prototype-window-dot prototype-window-dot--green" />
                  </div>
                  <span className="prototype-url-text">
                    {viewMode === 'combined' ? 'app://prototype' : `app://prototype/${screens[activeScreen]?.name || 'screen'}`}
                  </span>
                </div>
                <iframe
                  ref={iframeRef}
                  title="Prototype viewer"
                  sandbox="allow-scripts"
                  className="prototype-desktop-iframe"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
