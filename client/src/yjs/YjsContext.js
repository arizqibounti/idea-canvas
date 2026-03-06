// ── Yjs React Context ──────────────────────────────────────
// Wraps the app when in a collaborative room (/room/:id).
// Returns null when not in a room (single-user mode).

import React, { createContext, useContext } from 'react';
import { useYjsSync } from './useYjsSync';
import { useAuth } from '../AuthContext';
import { generateColorFromUid } from './roomUtils';

const YjsContext = createContext(null);

export function YjsProvider({ roomId, children }) {
  const { user, getToken } = useAuth();

  const yjs = useYjsSync({
    roomId,
    userName: user?.displayName || user?.email || 'Anonymous',
    userColor: generateColorFromUid(user?.uid),
    getToken,
  });

  return (
    <YjsContext.Provider value={yjs}>
      {children}
    </YjsContext.Provider>
  );
}

export function useYjs() {
  return useContext(YjsContext); // null when not in a room
}
