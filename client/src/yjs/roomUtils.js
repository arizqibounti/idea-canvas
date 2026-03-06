// ── Room Utilities ─────────────────────────────────────────
// Room ID generation and URL parsing for collaborative sessions.

export function generateRoomId() {
  // Use crypto.randomUUID if available, else fallback
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return 'tc_' + uuid.replace(/-/g, '').slice(0, 12);
}

export function getRoomIdFromUrl() {
  const m = window.location.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
  return m ? m[1] : null;
}

export function buildRoomUrl(roomId) {
  return `${window.location.origin}/room/${roomId}`;
}

// Generate a deterministic color from a user ID string
export function generateColorFromUid(uid) {
  if (!uid) return '#6c63ff';
  const COLORS = [
    '#6c63ff', '#a78bfa', '#f87171', '#fb923c', '#facc15',
    '#22c55e', '#0ea5e9', '#ec4899', '#14b8a6', '#a855f7',
  ];
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = ((hash << 5) - hash) + uid.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}
