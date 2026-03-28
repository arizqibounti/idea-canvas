Feature: Node tools (precision editing)
  As a user I want to split, merge, delete, and edit nodes precisely
  so that I can refine my thinking tree without regenerating everything

  Background:
    Given I am logged in
    And I have a generated tree with at least 5 nodes in "idea" mode

  # --- Razor: Split node into two ---
  Scenario: Split a node into two more specific nodes
    Given I have a node "node_5" of type "feature" with label "Payment processing"
    When I trigger razor split on "node_5"
    Then a POST request is sent to /api/split-node with the node, idea, and mode
    And the server streams exactly 2 new JSON nodes via SSE
    And each new node has a unique ID prefixed with "split_node_5_"
    And each new node inherits the parent of the original node
    And children of "node_5" are re-parented to the first split node
    And "node_5" is removed from the canvas
    And the first split node is auto-selected

  Scenario: Split streams results via SSE
    Given I have a selected node
    When I trigger razor split
    Then the server responds with SSE headers
    And the AI generates exactly 2 complementary nodes
    And each node has label (max 8 words) and reasoning (2-3 sentences)
    And the stream ends with a [DONE] event

  Scenario: Split via keyboard shortcut
    Given I have node "node_5" selected on the canvas
    And no input field is focused
    When I press the "R" key
    Then razor split is triggered on the selected node

  # --- Merge: Combine two nodes ---
  Scenario: Merge two nodes into a synthesis node
    Given I have node "node_3" of type "feature" with label "User auth"
    And I have node "node_7" of type "feature" with label "Access control"
    When I trigger merge and select "node_3" as the first node
    Then merge mode is activated and isMerging becomes true
    When I select "node_7" as the second node
    Then a POST request is sent to /api/merge-nodes with both nodes
    And the server streams exactly 1 synthesis node via SSE
    And the merged node has type "synthesis" and parentIds ["node_3", "node_7"]
    And the merged node ID is prefixed with "merged_"
    And the merged node is auto-selected
    And merge mode is deactivated

  Scenario: Cancel merge with Escape key
    Given I have started a merge by selecting the first node
    And merge mode is active with mergeTarget set
    When I press the Escape key
    Then merge mode is cancelled
    And mergeTarget is reset to null

  Scenario: Merge same node with itself is a no-op
    Given I have node "node_3" selected as merge target
    When I select "node_3" again as the second merge node
    Then the merge is cancelled (no API call)
    And merge mode is deactivated

  # --- Ripple Delete ---
  Scenario: Ripple delete removes a node and re-parents its children
    Given I have a tree: seed -> "node_2" -> "node_5" -> "node_8"
    When I trigger ripple delete on "node_5"
    Then "node_5" is removed from the canvas
    And "node_8" is re-parented from "node_5" to "node_2"
    And the tree structure remains connected: seed -> "node_2" -> "node_8"
    And the layout is recomputed

  Scenario: Ripple delete does not remove the seed node
    Given I have the "seed" root node selected
    When I trigger ripple delete on the seed node
    Then nothing happens — the seed node is protected from deletion

  Scenario: Ripple delete via keyboard shortcut
    Given I have node "node_5" selected on the canvas
    And no input field is focused
    When I press the Delete or Backspace key (without Shift)
    Then ripple delete is triggered on "node_5"

  # --- Delete branch ---
  Scenario: Delete branch removes node and all descendants
    Given I have a tree: seed -> "node_2" -> "node_5" -> "node_8"
    When I trigger delete branch on "node_2"
    Then "node_2", "node_5", and "node_8" are all removed
    And only the seed node remains

  Scenario: Delete branch via keyboard shortcut
    Given I have node "node_2" selected on the canvas
    And no input field is focused
    When I press Shift+Delete or Shift+Backspace
    Then delete branch is triggered on "node_2"

  # --- Slip Edit (inline editing) ---
  Scenario: Slip edit updates a node's label and reasoning in place
    Given I have node "node_5" with label "Payment processing" and reasoning "Handles all transactions"
    When I activate slip edit on "node_5"
    Then slipEditNodeId is set to "node_5"
    When I change the label to "Secure payment gateway" and reasoning to "PCI-compliant transaction handling"
    And I save the edit
    Then handleSaveNodeEdit is called with the new label and reasoning
    And the node updates in rawNodesRef without regeneration
    And the layout is recomputed
    And the Yjs sync layer is notified of the change

  # --- Undo/Redo ---
  Scenario: Undo reverts the canvas to the previous snapshot
    Given I have a tree with 10 nodes
    And a snapshot was pushed to the undo stack
    When I perform a destructive operation (e.g., ripple delete)
    And I press Ctrl+Z (or Cmd+Z on Mac)
    Then the canvas reverts to the previous snapshot
    And the deleted node reappears with all its connections
    And the redo stack contains the post-delete state
    And canUndo reflects the remaining stack depth

  Scenario: Redo re-applies an undone operation
    Given I have undone an operation via Ctrl+Z
    When I press Ctrl+Shift+Z (or Ctrl+Y)
    Then the canvas restores to the state after the operation
    And canRedo is updated accordingly

  Scenario: New actions clear the redo stack
    Given I have undone 2 operations (redo stack has 2 entries)
    When I perform a new action (e.g., split a node)
    Then the redo future is cleared
    And canRedo becomes false

  Scenario: Undo stack is capped at 60 snapshots
    Given I have performed 65 operations, each pushing a snapshot
    Then the undo stack holds at most 60 snapshots
    And the oldest snapshots have been evicted

  Scenario: Undo stack is cleared on session load
    Given I have 5 entries in the undo stack
    When I load a different saved session
    Then the undo stack is cleared
    And the redo stack is cleared
    And canUndo and canRedo are both false

  # --- Chat action dispatch for node tools ---
  Scenario: Ripple delete triggered via chat action
    Given I have a generated tree
    When the chat panel dispatches action {"rippleDelete": {"nodeId": "node_5"}}
    Then ripple delete executes on "node_5"

  # --- Error handling ---
  Scenario: Split fails gracefully on server error
    Given I have a selected node
    When I trigger razor split and the server returns an error
    Then the original node remains unchanged on the canvas
    And isSplitting resets to false
    And a console error is logged

  Scenario: Merge fails gracefully on server error
    Given I have selected two nodes for merge
    When the merge API call fails
    Then both original nodes remain unchanged
    And isMerging resets to false
    And mergeTarget resets to null
