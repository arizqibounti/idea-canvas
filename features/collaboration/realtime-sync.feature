Feature: Real-time collaboration via Y.js CRDT sync
  As a collaborator I want to edit a thinking tree simultaneously with teammates so that we can build ideas together in real time

  Background:
    Given I am logged in as user "alice"
    And I am in a collaborative room at /room/tc_abc123def456

  # --- Room creation and WebSocket connection ---

  Scenario: Join a collaborative room
    When I navigate to /room/tc_abc123def456
    Then a Y.js document is created for the room
    And a WebSocket connection is established to /yjs/tc_abc123def456
    And an IndexedDB persistence layer is initialized for offline support
    And my awareness state is set with my display name and a deterministic color

  Scenario: Room ID generation follows the tc_ prefix convention
    When I click "Start live session" in the Share Modal
    Then a room ID is generated matching the pattern "tc_" followed by 12 alphanumeric characters
    And I am navigated to /room/{roomId}

  Scenario: WebSocket authentication with Firebase token
    Given I have a valid Firebase auth token
    When the Y.js WebSocket provider connects to /yjs/tc_abc123def456
    Then the token is passed as a query parameter
    And the server verifies the token before completing the upgrade
    And the connection is established

  Scenario: WebSocket connection rejected with invalid token
    Given I have an invalid auth token
    When the Y.js WebSocket provider attempts to connect
    Then the server responds with HTTP 401 Unauthorized
    And the socket is destroyed

  # --- Sync protocol ---

  Scenario: Initial sync sends document state vector
    When a new client connects to room tc_abc123def456
    Then the server sends a sync step 1 message containing the document state vector
    And the client responds with its diff
    And the sync status transitions from "connecting" to "synced"

  Scenario: Sync status indicator reflects connection state
    Given I am connected and synced
    Then the SyncStatusBar shows a green dot with label "Synced"
    When the WebSocket connection drops
    Then the status changes to a red dot with label "Offline"
    When the connection is re-established but not yet synced
    Then the status shows a yellow dot with label "Syncing..."

  # --- Concurrent editing ---

  Scenario: Two users add nodes simultaneously
    Given alice and bob are both in room tc_abc123def456
    When alice adds a node "Revenue Model" of type "feature"
    And bob simultaneously adds a node "Cost Structure" of type "risk"
    Then both nodes appear on both canvases via Y.js CRDT merge
    And the nodes map in the Y.js document contains both entries
    And no conflict or data loss occurs

  Scenario: Node update propagates to all collaborators
    Given alice and bob are both in room tc_abc123def456
    And the tree has a node "node_1" with label "Initial Idea"
    When alice updates node_1 label to "Refined Idea"
    Then the update is written to the Y.js document via transact()
    And bob's canvas reflects the label change within 50ms (debounce window)

  Scenario: Node deletion propagates to all collaborators
    Given alice and bob share a tree with nodes "node_1", "node_2", "node_3"
    When alice removes nodes "node_2" and "node_3"
    Then the removal is wrapped in a single Y.js transaction
    And bob's canvas shows only "node_1"

  Scenario: Bulk tree write replaces all nodes for collaborators
    Given a room with an existing tree of 5 nodes
    When alice triggers a fresh generation that writes 8 new nodes via writeNodesToYjs
    Then the Y.js nodes map is cleared and repopulated in a single transaction
    And all collaborators see exactly the 8 new nodes

  # --- Awareness and presence ---

  Scenario: Collaborator avatars shown in the toolbar
    Given alice and bob are in the same room
    Then the SyncStatusBar shows bob's avatar with first letter of his name
    And the collaborator count displays "2 online"
    When a third user carol joins
    Then the count updates to "3 online"
    And carol's avatar appears with her deterministic color

  Scenario: Generating state is broadcast via awareness
    Given alice and bob are in room tc_abc123def456
    When alice starts an AI generation
    Then alice's awareness state sets isGenerating to true
    And bob sees alice's avatar with a "generating..." indicator
    When the generation completes
    Then alice's isGenerating resets to false
    And bob's view of alice's avatar returns to normal

  Scenario: Collaborator disconnect removes their awareness state
    Given alice and bob are connected to the same room
    When bob's WebSocket connection closes
    Then bob's awareness state is removed via removeAwarenessStates
    And alice's collaborator list no longer includes bob
    And the online count decreases by 1

  # --- Room lifecycle ---

  Scenario: Room is garbage collected after all users leave
    Given a room tc_abc123def456 with 1 connected client
    When the last client disconnects
    Then the server waits 30 seconds before cleanup
    If no client reconnects within 30 seconds
    Then the Y.js document is destroyed
    And the room is removed from the server room map

  Scenario: Room survives brief disconnection
    Given a room tc_abc123def456 with 1 connected client
    When the client disconnects
    And reconnects within 30 seconds
    Then the room and its Y.js document are preserved
    And the client receives the existing document state

  # --- Copy room link ---

  Scenario: Copy collaborative room link to clipboard
    Given I am in room tc_abc123def456
    When I click "Copy Link" in the SyncStatusBar
    Then the URL "{origin}/room/tc_abc123def456" is copied to the clipboard
    And the button text changes to "Copied!" for 2 seconds

  # --- Metadata sync ---

  Scenario: Session metadata syncs across collaborators
    Given alice and bob are in the same room
    When alice writes metadata with idea "Market Analysis" and mode "idea"
    Then the Y.js meta map is updated in a transaction
    And bob can read the same idea and mode from the meta map
