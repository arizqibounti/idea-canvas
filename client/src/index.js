import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AppRouter } from './App';
import { AuthProvider } from './AuthContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AuthProvider>
    <AppRouter />
  </AuthProvider>
);
