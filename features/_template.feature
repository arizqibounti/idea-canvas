# Template — copy this when starting a new feature
# File naming: features/{domain}/{capability}.feature
# Domains: core, ai-workflows, collaboration, learning, patterns, export, integrations, billing

Feature: [Capability name]
  As a [user role] I want to [action] so that [outcome]

  # --- Background: shared setup across all scenarios in this file ---
  Background:
    Given I am logged in
    And I have an active session in "idea" mode

  # --- Happy path ---
  Scenario: [Primary use case]
    Given [precondition with concrete data]
    When [user action]
    Then [expected outcome]
    And [additional assertion]

  # --- SSE streaming (for AI-powered features) ---
  Scenario: [Feature] streams results in real time
    Given [precondition]
    When I trigger [feature]
    Then the server responds with SSE headers
    And I receive incremental data events
    And the stream ends with a [DONE] event

  # --- Chat action dispatch ---
  Scenario: [Feature] is triggered via chat action
    Given I have a generated tree
    When the chat AI emits action {"myFeature": true}
    Then the [feature] workflow starts
    And the chat panel shows progress

  # --- Error / empty state ---
  Scenario: [Feature] handles missing data gracefully
    Given I have no generated tree
    When I try to [action]
    Then I see an appropriate error message
    And no server request is made

  # --- Edge cases ---
  Scenario: [Feature] with large tree
    Given I have a tree with 100+ nodes
    When I trigger [feature]
    Then it completes within a reasonable time
    And all nodes are processed

  # -----------------------------------------------
  # Gherkin conventions for ThoughtClaw:
  #
  # - Use concrete mode names: "idea", "code", "resume", "decide", "write", "plan", "learn"
  # - Use concrete node types: "feature", "risk", "metric", "question", "strategy", etc.
  # - Reference action shapes: {"debate": true}, {"refine": true}, {"drill": {"nodeId": "node_1"}}
  # - For SSE features, always include a streaming scenario
  # - For chat-dispatchable features, include a chat action scenario
  # - Keep scenarios independent — each should work in isolation
  # -----------------------------------------------
