import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AppRouter } from './App';
import { AuthProvider } from './AuthContext';
import { UserProvider } from './UserContext';

// Suppress harmless ResizeObserver loop error in dev overlay
// This error is benign — it means a resize callback couldn't complete in a single frame
if (typeof window !== 'undefined') {
  // Catch it as a window error event (stops React error overlay)
  window.addEventListener('error', (e) => {
    if (e.message?.includes('ResizeObserver loop')) {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      return false;
    }
  });
  // Also catch unhandled rejection variant
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason?.message?.includes('ResizeObserver loop')) {
      e.preventDefault();
    }
  });
  // Patch ResizeObserver to swallow the loop error at the source
  const OriginalResizeObserver = window.ResizeObserver;
  if (OriginalResizeObserver) {
    window.ResizeObserver = class PatchedResizeObserver extends OriginalResizeObserver {
      constructor(callback) {
        super((entries, observer) => {
          // Use requestAnimationFrame to avoid the loop-limit error
          window.requestAnimationFrame(() => {
            try { callback(entries, observer); } catch (_) { /* swallow */ }
          });
        });
      }
    };
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AuthProvider>
    <UserProvider>
      <AppRouter />
    </UserProvider>
  </AuthProvider>
);
