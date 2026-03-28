Feature: Workspace management and role-based access
  As a team user I want to organize sessions into workspaces so that I can collaborate with my team under shared access controls

  Background:
    Given I am logged in as user "alice" with uid "user_alice"

  # --- Workspace CRUD ---

  Scenario: Create a new workspace
    When I create a workspace named "Product Team"
    Then a workspace is created with:
      | field      | value                        |
      | name       | Product Team                 |
      | slug       | product-team-{6-char-suffix} |
      | ownerId    | user_alice                   |
      | plan       | free                         |
      | isPersonal | false                        |
    And alice is automatically added as a member with role "owner"
    And the workspace has default settings with null branding color and null default mode

  Scenario: Create a personal workspace
    When a personal workspace is created for user "alice"
    Then the workspace has isPersonal set to true
    And alice is added as the owner

  Scenario: List workspaces for a user
    Given alice is a member of workspaces "Product Team" and "Design Team"
    When alice requests her workspace list
    Then she receives both "Product Team" and "Design Team" workspaces
    And workspaces she is not a member of are excluded

  Scenario: Update workspace settings
    Given a workspace "Product Team" owned by alice
    When alice updates the workspace name to "Product & Engineering"
    Then the workspace name is changed to "Product & Engineering"
    And the updatedAt timestamp is refreshed

  # --- Role-based access control ---

  Scenario: Workspace middleware resolves context and role
    Given alice is a member of workspace "ws_123" with role "admin"
    When a request is made with workspaceId "ws_123"
    Then the middleware attaches req.workspace with the workspace document
    And req.workspaceRole is set to "admin"

  Scenario: Non-member is denied workspace access
    Given bob is not a member of workspace "ws_123"
    When bob makes a request to workspace "ws_123"
    Then the middleware returns HTTP 403 with error "You are not a member of this workspace"

  Scenario: Workspace not found returns 404
    When a request is made with workspaceId "nonexistent_ws"
    Then the middleware returns HTTP 404 with error "Workspace not found"

  Scenario: Role requirement enforced for admin actions
    Given bob is a member of workspace "ws_123" with role "member"
    When bob attempts an action requiring role "owner" or "admin"
    Then the server returns HTTP 403 with error "This action requires one of: owner, admin"

  Scenario: Owner can perform all workspace actions
    Given alice is the owner of workspace "ws_123"
    When alice attempts an action requiring role "owner" or "admin"
    Then the action is permitted

  # --- Team invitations ---

  Scenario: Invite a team member to a Pro workspace
    Given a workspace "Product Team" on the "pro" plan owned by alice
    When alice invites "bob@example.com" with role "member"
    Then an invitation is created with:
      | field       | value            |
      | email       | bob@example.com  |
      | role        | member           |
      | status      | pending          |
      | invitedBy   | user_alice       |
    And the invitation has a 64-character hex token
    And the invitation expires in 7 days

  Scenario: Accept a workspace invitation
    Given a pending invitation with token "abc123...hex" for workspace "Product Team"
    When bob accepts the invitation using the token
    Then bob is added as a member of "Product Team" with the invited role
    And the invitation status changes to "accepted"

  Scenario: Invitation rejected on free plan
    Given a workspace "Hobby Project" on the "free" plan
    When alice tries to invite "bob@example.com"
    Then the invitation fails with error "Pro plan required to invite members"

  Scenario: Duplicate pending invitation is rejected
    Given alice has already invited "bob@example.com" to "Product Team"
    When alice tries to invite "bob@example.com" again
    Then the invitation fails with error "An invitation for this email is already pending"

  Scenario: Invitation rejected when member cap is reached
    Given workspace "Product Team" has 10 members (the maximum)
    When alice tries to invite another member
    Then the invitation fails with error "Member limit reached (10)"

  Scenario: Expired invitation cannot be accepted
    Given an invitation that expired 2 days ago
    When bob tries to accept the invitation token
    Then the invitation lookup returns null
    And acceptance fails with error "Invalid or expired invitation"

  Scenario: Invalid role is rejected on invitation creation
    When alice invites "bob@example.com" with role "superadmin"
    Then the invitation fails with error "Invalid role"
    And only "admin", "member", and "viewer" roles are accepted

  Scenario: Revoke a pending invitation
    Given a pending invitation for "bob@example.com" in "Product Team"
    When alice revokes the invitation
    Then the invitation is deleted from the store
    And it no longer appears in the pending invitations list

  # --- Member management ---

  Scenario: Update a member's role
    Given bob is a member of "Product Team" with role "member"
    When alice updates bob's role to "admin"
    Then bob's role in the workspace is changed to "admin"

  Scenario: Remove a member from a workspace
    Given bob is a member of "Product Team"
    When alice removes bob from the workspace
    Then bob is no longer a member
    And bob cannot access "Product Team" sessions

  # --- Workspace context fallback ---

  Scenario: Request falls back to personal workspace when no workspaceId is provided
    Given alice has a personal workspace with id "personal_ws_alice"
    When a request is made without a workspaceId
    Then the middleware uses alice's personalWorkspaceId as the workspace context
