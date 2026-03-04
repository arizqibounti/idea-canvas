// ── Firebase Auth Context ──────────────────────────────────────
// Provides Google sign-in via Firebase Auth.
// Manages auth state, ID token (auto-refreshed), and sign-in/out.

import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
};

// Only initialize if config is present
let auth = null;
const isConfigured = !!firebaseConfig.apiKey;

if (isConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
  } catch (err) {
    console.warn('Firebase init failed:', err.message);
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(isConfigured); // only loading if Firebase is configured
  const tokenRef = useRef(null);
  const [tokenReady, setTokenReady] = useState(!isConfigured);

  // Listen for auth state changes
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      setTokenReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const idToken = await firebaseUser.getIdToken();
        tokenRef.current = idToken;
        setTokenReady(true);
      } else {
        tokenRef.current = null;
        setTokenReady(true);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Refresh token periodically (Firebase tokens expire after 1 hour)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      try {
        const newToken = await user.getIdToken(true);
        tokenRef.current = newToken;
      } catch { /* ignore refresh errors */ }
    }, 50 * 60 * 1000); // refresh every 50 minutes
    return () => clearInterval(interval);
  }, [user]);

  const login = async () => {
    if (!auth) {
      console.warn('Firebase Auth not configured');
      return;
    }
    return signInWithPopup(auth, new GoogleAuthProvider());
  };

  const logout = async () => {
    if (!auth) return;
    return signOut(auth);
  };

  const getToken = () => tokenRef.current;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, getToken, isConfigured, tokenReady }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
