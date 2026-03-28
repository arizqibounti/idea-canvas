Feature: AI chat companion with action dispatch
  As a user I want to chat with a mode-aware AI companion
  so that I can ask questions, get insights, and trigger tools through natural conversation

  Background:
    Given I am logged in
    And I have an active session in "idea" mode
    And I have a generated tree for "AI-powered fitness coaching app"

  # --- Mode-specific personas ---
  Scenario: Chat uses mode-specific persona from CHAT_PERSONAS
    When I send a chat message "What are the key risks?"
    Then the system prompt uses the CHAT_PERSONAS["idea"] persona
    And the AI responds with context grounded in the thinking tree

  Scenario: Chat adapts persona for codebase mode
    Given I have an active session in "codebase" mode
    When I send a chat message "Explain the architecture"
    Then the system prompt uses the CHAT_PERSONAS["codebase"] persona

  Scenario: Chat adapts persona for resume mode
    Given I have an active session in "resume" mode
    When I send a chat message "How should I position my experience?"
    Then the system prompt uses the CHAT_PERSONAS["resume"] persona

  # --- Tree-aware context ---
  Scenario: Chat receives full tree context in the system prompt
    Given the tree has 15 nodes across types "feature", "risk", and "metric"
    When I send a chat message
    Then the system prompt includes the serialized tree context
    And the AI can reference specific nodes by label and type

  Scenario: Chat receives focused node context when a node is selected
    Given I have selected node "Personalized workout plans" of type "feature"
    When I send a chat message "Go deeper on this"
    Then the system prompt includes a FOCUSED NODE section with the node's type, label, and reasoning
    And the subtree of the focused node is included
    And the AI scopes its response to the focused node

  # --- Action dispatch via <<<ACTIONS>>> JSON ---
  Scenario: Chat parses <<<ACTIONS>>> delimiter and dispatches action
    Given I send a chat message "Run a debate on this tree"
    When the AI responds with text followed by <<<ACTIONS>>>{"debate": true}
    Then the <<<ACTIONS>>> delimiter is detected in the response
    And the JSON action {"debate": true} is parsed
    And the debate workflow is dispatched via handleChatAction
    And the action label "Started Debate" appears in the chat

  Scenario: Chat dispatches filter action to dim non-matching nodes
    When the AI emits action {"filter": {"types": ["feature", "constraint"]}}
    Then only "feature" and "constraint" nodes remain visible on the canvas
    And other node types are dimmed

  Scenario: Chat dispatches addNodes action to create nodes on canvas
    When the AI emits action {"addNodes": [{"id": "chat_1", "type": "feature", "label": "Workout Gamification", "reasoning": "Increases engagement through competition", "parentId": "seed"}]}
    Then a new "feature" node "Workout Gamification" appears on the canvas
    And it is connected to the seed node as its parent
    And the node id starts with "chat_"

  Scenario: Chat dispatches drill action for a specific node
    Given I have a node "node_abc" labeled "Revenue Model"
    When the AI emits action {"drill": {"nodeId": "node_abc"}}
    Then a drill-down is triggered on "node_abc"
    And 12-15 child nodes are generated exploring that node

  Scenario: Chat dispatches refine with scoping
    When the AI emits action {"refine": {"types": ["tech_debt"]}}
    Then the auto-refine workflow starts scoped to "tech_debt" nodes

  Scenario: Chat dispatches evolve action
    When the AI emits action {"evolve": true}
    Then the handleStartEvolve function is called
    And a 5-step evolution plan is created for the current session

  # --- Quick action buttons ---
  Scenario: Quick actions are mode-specific
    Given I have an active session in "idea" mode
    Then the quick action buttons show "Write Proposal", "Draft Email", "Create PRD", and "Pitch Summary"

  Scenario: Quick actions change for resume mode
    Given I have an active session in "resume" mode
    Then the quick action buttons show "Cover Letter", "LinkedIn Summary", "Interview Prep", and "Resume Bullets"

  Scenario: Quick actions change for decision mode
    Given I have an active session in "decision" mode
    Then the quick action buttons show "Decision Brief", "Pros/Cons", "Stakeholder Email", and "Risk Assessment"

  Scenario: Quick actions change for plan mode
    Given I have an active session in "plan" mode
    Then the quick action buttons show "Project Plan", "Timeline", "Status Update", and "Resource Brief"

  # --- Focused node actions ---
  Scenario: Chat uses focused node id for contextual commands
    Given I have selected node "node_xyz" labeled "Premium Tier Pricing"
    When I type "expand this"
    Then the AI emits action {"drill": {"nodeId": "node_xyz"}}
    And the drill targets the focused node specifically

  Scenario: Chat edits focused node via action
    Given I have selected node "node_xyz" labeled "Basic Plan"
    When I type "change the label to Premium Plan"
    Then the AI emits action {"editNode": {"nodeId": "node_xyz", "label": "Premium Plan"}}

  # --- SSE streaming ---
  Scenario: Chat streams response text in real time via SSE
    When I send a chat message
    Then the server responds with SSE headers via POST /api/chat
    And I receive incremental text events as {"text": "..."} chunks
    And the stream ends with a [DONE] event

  # --- Compounding context ---
  Scenario: Chat injects compounding session context
    Given my session has a session brief and prior artifacts
    When I send a chat message
    Then the compounding context is appended to the system prompt
    And the AI can reference insights from earlier in the session

  # --- Email context ---
  Scenario: Chat incorporates email thread context
    Given I have connected an email thread about "Q3 product roadmap"
    When I send a chat message
    Then the email thread content is included in the system prompt
    And the AI can reference specific email messages and senders

  # --- Message compaction ---
  Scenario: Long conversations are compacted to stay within context limits
    Given I have exchanged 20 messages in the chat
    When I send the 21st message
    Then the first 10 messages are summarized into a compact context message
    And the most recent 10 messages are kept verbatim
    And the conversation continues smoothly

  # --- Error handling ---
  Scenario: Chat handles missing messages gracefully
    When I send a chat request with no messages
    Then the server returns a 400 error with "messages required"
    And no AI call is made

  Scenario: Chat handles stream errors gracefully
    Given the AI stream encounters an error mid-response
    When the stream error fires
    Then an error event is written to the SSE stream
    And the response ends cleanly
