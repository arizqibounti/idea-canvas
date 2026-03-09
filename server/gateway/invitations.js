// ── Invitation Manager ────────────────────────────────────────
// CRUD for workspace invitations. Link-based (no email service).
// Falls back to in-memory store if Firestore is unavailable.

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const workspaces = require('./workspaces');

let db = null;
let useFirestore = false;
const memoryStore = new Map();

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection('invitations').limit(1).get()
      .then(() => {
        useFirestore = true;
        console.log('Firestore invitations collection ready');
      })
      .catch(() => {
        console.log('Firestore unavailable for invitations — using in-memory store');
      });
  } catch {
    console.log('Firestore SDK not configured for invitations — using in-memory store');
  }
}

initFirestore();

const MEMBER_CAP = 10;
const EXPIRY_DAYS = 7;

/**
 * Create an invitation. Enforces: Pro plan, member cap, no duplicates.
 */
async function createInvitation(workspaceId, email, role, invitedBy) {
  email = (email || '').toLowerCase().trim();
  if (!email) throw new Error('Email is required');
  if (!['admin', 'member', 'viewer'].includes(role)) throw new Error('Invalid role');

  // Check workspace plan
  const ws = await workspaces.getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');
  if (ws.plan !== 'pro') throw new Error('Pro plan required to invite members');

  // Check member cap
  const memberCount = await workspaces.getMemberCount(workspaceId);
  if (memberCount >= MEMBER_CAP) throw new Error(`Member limit reached (${MEMBER_CAP})`);

  // Check for existing member with this email (can't check by email easily, skip for now)

  // Check for duplicate pending invitation
  const pending = await listPendingInvitations(workspaceId);
  if (pending.some(inv => inv.email === email)) {
    throw new Error('An invitation for this email is already pending');
  }

  const invitation = {
    id: uuidv4(),
    workspaceId,
    email,
    role,
    invitedBy,
    token: crypto.randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  if (useFirestore) {
    await db.collection('invitations').doc(invitation.id).set(invitation);
  } else {
    memoryStore.set(invitation.id, invitation);
  }

  return invitation;
}

async function getInvitationByToken(token) {
  if (useFirestore) {
    const snap = await db.collection('invitations')
      .where('token', '==', token)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const inv = { id: snap.docs[0].id, ...snap.docs[0].data() };
    // Check expiration
    if (new Date(inv.expiresAt) < new Date()) {
      await db.collection('invitations').doc(inv.id).update({ status: 'expired' });
      return null;
    }
    return inv;
  } else {
    for (const inv of memoryStore.values()) {
      if (inv.token === token && inv.status === 'pending') {
        if (new Date(inv.expiresAt) < new Date()) {
          inv.status = 'expired';
          return null;
        }
        return inv;
      }
    }
    return null;
  }
}

async function acceptInvitation(token, userId) {
  const inv = await getInvitationByToken(token);
  if (!inv) throw new Error('Invalid or expired invitation');

  // Add as member
  await workspaces.addMember(inv.workspaceId, userId, inv.role, inv.invitedBy);

  // Mark invitation as accepted
  if (useFirestore) {
    await db.collection('invitations').doc(inv.id).update({ status: 'accepted' });
  } else {
    inv.status = 'accepted';
  }

  return inv;
}

async function listPendingInvitations(workspaceId) {
  if (useFirestore) {
    const snap = await db.collection('invitations')
      .where('workspaceId', '==', workspaceId)
      .where('status', '==', 'pending')
      .get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(inv => new Date(inv.expiresAt) >= new Date());
  } else {
    const results = [];
    for (const inv of memoryStore.values()) {
      if (inv.workspaceId === workspaceId && inv.status === 'pending' && new Date(inv.expiresAt) >= new Date()) {
        results.push(inv);
      }
    }
    return results;
  }
}

async function revokeInvitation(invitationId) {
  if (useFirestore) {
    await db.collection('invitations').doc(invitationId).delete();
  } else {
    memoryStore.delete(invitationId);
  }
}

module.exports = {
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  listPendingInvitations,
  revokeInvitation,
};
