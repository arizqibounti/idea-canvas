// ── Workspace Middleware ──────────────────────────────────────
// Resolves workspace context from request and checks role permissions.

const workspaces = require('../gateway/workspaces');

/**
 * resolveWorkspace — attaches req.workspace and req.workspaceRole.
 * Looks for workspaceId in: params, query, body, or falls back to user's personal workspace.
 */
async function resolveWorkspace(req, res, next) {
  const workspaceId =
    req.params.workspaceId ||
    req.query.workspaceId ||
    req.body?.workspaceId ||
    req.user?.personalWorkspaceId;

  if (!workspaceId) {
    return res.status(400).json({ error: 'No workspace context available' });
  }

  try {
    const workspace = await workspaces.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await workspaces.getWorkspaceMember(workspaceId, req.user.uid);
    if (!member) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    req.workspace = workspace;
    req.workspaceRole = member.role;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * requireRole — middleware factory that checks req.workspaceRole.
 * Usage: requireRole('owner', 'admin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.workspaceRole || !roles.includes(req.workspaceRole)) {
      return res.status(403).json({
        error: `This action requires one of: ${roles.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = { resolveWorkspace, requireRole };
