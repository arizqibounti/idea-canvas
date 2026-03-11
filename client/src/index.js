import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AppRouter } from './App';
import { AuthProvider } from './AuthContext';
import { UserProvider } from './UserContext';

// Suppress harmless ResizeObserver loop error in dev overlay
if (typeof window !== 'undefined') {
  const ro = window.addEventListener;
  window.addEventListener('error', (e) => {
    if (e.message?.includes('ResizeObserver loop')) {
      e.stopImmediatePropagation();
    }
  });
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AuthProvider>
    <UserProvider>
      <AppRouter />
    </UserProvider>
  </AuthProvider>
);
