Feature: Session CRUD
  As a user I want to create, load, save, and delete thinking sessions
  so that my work persists across visits

  Background:
    Given I am logged in

  # --- Create session ---
  Scenario: Create a new session with idea and mode
    When I create a session with idea "Build a marketplace for AI tools" and mode "idea"
    Then a session is created with a UUID id
    And the session contains: idea, mode, userId, createdAt, updatedAt
    And the session initializes with empty arrays for: nodes, debates, chatMessages, canvasArtifacts, artifacts
    And sessionBrief and sessionSummary are empty strings
    And surfaces defaults to ["web"]

  Scenario: Create a session with default mode
    When I create a session with idea "Some idea" and no mode specified
    Then the session mode defaults to "idea"
    And userId defaults to "local" when no auth is present

  # --- Load session ---
  Scenario: Load an existing session by ID
    Given I have a session "sess_abc" with 15 nodes about "Market analysis"
    When I load session "sess_abc"
    Then I receive the full session including all nodes, debates, and chatMessages
    And the nodes are deduplicated by ID before rendering

  Scenario: Load a non-existent session returns null
    When I load session "non_existent_id"
    Then the result is null

  # --- Save / update session ---
  Scenario: Update session nodes
    Given I have a session "sess_abc"
    When I update the session nodes with 20 raw nodes
    Then the session stores the new nodes array
    And nodeCount is set to 20
    And updatedAt is refreshed to the current timestamp

  Scenario: Update session metadata
    Given I have a session "sess_abc"
    When I update the session meta with {mode: "plan", title: "Q4 Roadmap"}
    Then the session meta field is updated
    And updatedAt is refreshed

  # --- Auto-save behavior (client-side) ---
  Scenario: Auto-save triggers after canvas changes
    Given I have an active session with idea "E-commerce platform"
    And the canvas has 10 nodes
    When a node is added or modified
    Then triggerAutoSave is called with the current label and mode
    And after a 500ms debounce, saveSession writes to localStorage
    And the session is upserted (updated if same idea exists, created if new)

  Scenario: Auto-save does not fire with empty canvas
    Given I have an active session with idea "Test"
    And the canvas has 0 nodes
    When triggerAutoSave is called
    Then no save occurs because rawNodesRef is empty

  # --- List sessions ---
  Scenario: List sessions for a user ordered by most recent
    Given user "user_123" has 5 sessions
    When I list sessions for "user_123" with limit 20
    Then I receive up to 20 sessions ordered by updatedAt descending
    And each session summary includes: id, idea, mode, createdAt, updatedAt, nodeCount, sessionSummary

  Scenario: List sessions with cursor-based pagination
    Given user "user_123" has 30 sessions
    When I list sessions with limit 20 and before "2026-03-01T00:00:00Z"
    Then I receive only sessions with updatedAt before the cursor
    And results are limited to 20

  # --- Delete session ---
  Scenario: Delete a session by ID
    Given I have a session "sess_abc"
    When I delete session "sess_abc"
    Then the session is removed from the store
    And loading "sess_abc" returns null

  # --- Session switching (client-side) ---
  Scenario: Load a session restores canvas state
    Given I have a saved session with 12 nodes and label "API Design"
    When I load the session from the session list
    Then the canvas is populated with the 12 deduplicated nodes
    And the drill stack is reset to empty
    And the layout is recomputed via applyLayout
    And the input label updates to "API Design"

  # --- Append operations ---
  Scenario: Append a debate round to a session
    Given I have a session "sess_abc"
    When a debate round completes with critique and rebuttal
    Then the round is appended to the session's debates array
    And updatedAt is refreshed

  Scenario: Append a chat message to a session
    Given I have a session "sess_abc"
    When the user sends a chat message
    Then the message is appended to the session's chatMessages array
    And updatedAt is refreshed

  Scenario: Append a canvas artifact to a session
    Given I have a session "sess_abc"
    When a prototype or mockup is generated
    Then the artifact is appended with an auto-generated UUID and generatedAt timestamp

  # --- Firestore fallback ---
  Scenario: In-memory store is used when Firestore is unavailable
    Given Firestore is not configured (no service account)
    When I create and load sessions
    Then all CRUD operations work against the in-memory Map store
    And a console message indicates "using in-memory session store"

  # --- Manual save (client-side) ---
  Scenario: Manual save persists current canvas to localStorage
    Given I have 15 nodes on canvas with idea label "Growth Strategy"
    When I trigger a manual save
    Then the session is saved to localStorage with the current rawNodes
    And the session list in savedSessions state is updated
    And the list is capped at 10 most recent sessions
