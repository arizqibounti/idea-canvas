Feature: Multi-round adversarial debate
  As a user I want to stress-test my thinking tree through adversarial debate
  so that blind spots, contradictions, and weak reasoning are exposed and resolved

  Background:
    Given I am logged in
    And I have an active session in "idea" mode
    And I have a generated tree for "AI-powered meal planning app"

  # --- Happy path ---
  Scenario: Complete critique-rebut-finalize debate cycle in idea mode
    When I start a debate on the tree
    Then the Critic persona (VC Critic) sends critiques via POST /api/debate/critique
    And each critique includes a severity, target node, and reason
    When the critiques are received
    Then the Architect persona rebuts via SSE stream on POST /api/debate/rebut
    And rebuttal nodes are added to the tree with ids prefixed "rebut_"
    When all rounds complete
    Then the finalize step synthesizes the debate via SSE stream on POST /api/debate/finalize
    And synthesis nodes are added to the tree with ids prefixed "syn_" or "final_"

  # --- Mode-specific personas ---
  Scenario: Debate uses mode-specific critic and architect personas
    Given I have an active session in "codebase" mode
    And I have a generated tree for "E-commerce platform analysis"
    When I start a debate on the tree
    Then the critique uses the codebase-specific CRITIC_PROMPT_MAP persona
    And the rebuttal uses the "Tech lead" responder from MODE_SERVER_META
    And the finalize uses the codebase-specific FINALIZE_PROMPT_MAP persona

  Scenario: Debate uses resume-specific personas for resume mode
    Given I have an active session in "resume" mode
    And I have a generated tree for "Senior Product Manager at Google"
    When I start a debate on the tree
    Then the critique uses the resume-specific CRITIC_PROMPT_MAP persona
    And the rebuttal uses the "Career coach" responder from MODE_SERVER_META

  # --- Multi-round debate ---
  Scenario: Debate runs multiple rounds with prior critique context
    When I start a debate on the tree
    And round 1 produces 3 critiques
    Then round 2 receives those critiques as priorCritiques
    And the Critic checks whether the Architect addressed prior feedback
    And new critiques target remaining or newly introduced weaknesses

  # --- SSE streaming ---
  Scenario: Rebut step streams rebuttal nodes in real time
    Given the Critic has produced critiques for round 1
    When the Architect rebuts via POST /api/debate/rebut
    Then the server responds with SSE headers
    And I receive incremental data events with rebuttal node JSON
    And the stream ends with a [DONE] event

  Scenario: Finalize step streams synthesis nodes in real time
    Given I have completed 3 rounds of critique and rebuttal
    When the finalize step runs via POST /api/debate/finalize
    Then the server responds with SSE headers
    And I receive synthesis nodes as incremental SSE events
    And the stream ends with a [DONE] event

  # --- Chat action dispatch ---
  Scenario: Debate is triggered via chat action
    Given I have a generated tree
    When the chat AI emits action {"debate": true}
    Then the debate workflow starts with the full tree
    And the chat panel shows a DebateCard with round progress

  Scenario: Debate is triggered with node scope via chat
    Given I have a generated tree with nodes of types "feature", "risk", and "metric"
    When the chat AI emits action {"debate": {"types": ["feature"]}}
    Then the debate workflow starts scoped to "feature" nodes only

  # --- Compounding context ---
  Scenario: Debate injects compounding session context
    Given my session has a session brief from prior actions
    When the Critic runs critique on the tree
    Then the compounding context (session brief, artifacts, pollination) is appended to the user message
    And the critique accounts for prior session history

  # --- Finalize records artifact ---
  Scenario: Finalize records debate artifact and updates session brief
    Given I have completed a 3-round debate
    When the finalize step completes
    Then a "debate_outcome" artifact is appended to the session
    And the session brief is updated with the debate finalize action
    And a session summary is generated as a milestone

  # --- Error handling ---
  Scenario: Critique fails gracefully with missing nodes
    Given I have no generated tree
    When I try to start a debate
    Then the server returns a 400 error with message "nodes required"
    And no debate round is initiated

  Scenario: Finalize fails gracefully with missing debate history
    Given I have a generated tree but no debateHistory
    When the finalize step is called
    Then the server returns a 400 error with message "nodes and debateHistory required"

  # --- Expand suggestion ---
  Scenario: Debate suggestion is expanded into tree nodes
    Given the debate produced a suggestion "Add a competitive moat analysis"
    When I expand the suggestion via POST /api/expand-suggestion
    Then the suggestion is placed under the most relevant existing node
    And 5-8 child nodes are generated via Claude Sonnet SSE stream
    And the new nodes use available dynamic types from the tree
