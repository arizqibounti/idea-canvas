// ── Workspace & Member Manager ────────────────────────────────
// CRUD for workspaces and workspace_members collections.
// Falls back to in-memory store if Firestore is unavailable (local dev).

const { v4: uuidv4 } = require('uuid');

let db = null;
let useFirestore = false;
const workspaceStore = new Map();
const memberStore = new Map(); // key: `${workspaceId}:${userId}`

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection('workspaces').limit(1).get()
      .then(() => {
        useFirestore = true;
        console.log('Firestore workspaces collection ready');
      })
      .catch(() => {
        console.log('Firestore unavailable for workspaces — using in-memory store');
      });
  } catch {
    console.log('Firestore SDK not configured for workspaces — using in-memory store');
  }
}

initFirestore();

function generateSlug(name) {
  return (name || 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    + '-' + uuidv4().slice(0, 6);
}

// ── Workspace CRUD ───────────────────────────────────────────

async function createWorkspace(name, slug, ownerId, isPersonal = false) {
  const workspace = {
    id: uuidv4(),
    name: name || 'Workspace',
    slug: slug || generateSlug(name),
    ownerId,
    plan: 'free',
    isPersonal: !!isPersonal,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: { branding: { color: null }, defaults: { mode: null } },
  };

  if (useFirestore) {
    await db.collection('workspaces').doc(workspace.id).set(workspace);
  } else {
    workspaceStore.set(workspace.id, workspace);
  }

  // Add owner as member
  await addMember(workspace.id, ownerId, 'owner', null);

  return workspace;
}

async function getWorkspace(workspaceId) {
  if (useFirestore) {
    const doc = await db.collection('workspaces').doc(workspaceId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }
  return workspaceStore.get(workspaceId) || null;
}

async function updateWorkspace(workspaceId, updates) {
  const timestamped = { ...updates, updatedAt: new Date().toISOString() };
  if (useFirestore) {
    await db.collection('workspaces').doc(workspaceId).update(timestamped);
  } else {
    const ws = workspaceStore.get(workspaceId);
    if (ws) Object.assign(ws, timestamped);
  }
}

async function listUserWorkspaces(userId) {
  if (useFirestore) {
    const snap = await db.collection('workspace_members')
      .where('userId', '==', userId)
      .get();
    const wsIds = snap.docs.map(d => d.data().workspaceId);
    if (wsIds.length === 0) return [];
    // Load each workspace
    const results = await Promise.all(wsIds.map(id => getWorkspace(id)));
    return results.filter(Boolean);
  } else {
    const wsIds = [];
    for (const [key, member] of memberStore) {
      if (member.userId === userId) wsIds.push(member.workspaceId);
    }
    return wsIds.map(id => workspaceStore.get(id)).filter(Boolean);
  }
}

// ── Member CRUD ──────────────────────────────────────────────

async function addMember(workspaceId, userId, role, invitedBy) {
  const member = {
    id: uuidv4(),
    workspaceId,
    userId,
    role: role || 'member',
    invitedBy: invitedBy || null,
    joinedAt: new Date().toISOString(),
  };

  if (useFirestore) {
    await db.collection('workspace_members').doc(member.id).set(member);
  } else {
    memberStore.set(`${workspaceId}:${userId}`, member);
  }

  return member;
}

async function getWorkspaceMember(workspaceId, userId) {
  if (useFirestore) {
    const snap = await db.collection('workspace_members')
      .where('workspaceId', '==', workspaceId)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  return memberStore.get(`${workspaceId}:${userId}`) || null;
}

async function updateMemberRole(workspaceId, userId, newRole) {
  if (useFirestore) {
    const snap = await db.collection('workspace_members')
      .where('workspaceId', '==', workspaceId)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    if (!snap.empty) {
      await snap.docs[0].ref.update({ role: newRole });
    }
  } else {
    const member = memberStore.get(`${workspaceId}:${userId}`);
    if (member) member.role = newRole;
  }
}

async function removeMember(workspaceId, userId) {
  if (useFirestore) {
    const snap = await db.collection('workspace_members')
      .where('workspaceId', '==', workspaceId)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    if (!snap.empty) {
      await snap.docs[0].ref.delete();
    }
  } else {
    memberStore.delete(`${workspaceId}:${userId}`);
  }
}

async function listMembers(workspaceId) {
  if (useFirestore) {
    const snap = await db.collection('workspace_members')
      .where('workspaceId', '==', workspaceId)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  const results = [];
  for (const [, member] of memberStore) {
    if (member.workspaceId === workspaceId) results.push(member);
  }
  return results;
}

async function getMemberCount(workspaceId) {
  const members = await listMembers(workspaceId);
  return members.length;
}

module.exports = {
  createWorkspace, getWorkspace, updateWorkspace, listUserWorkspaces,
  addMember, getWorkspaceMember, updateMemberRole, removeMember,
  listMembers, getMemberCount, generateSlug,
};
