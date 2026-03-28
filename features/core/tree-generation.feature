Feature: Domain-adaptive tree generation
  As a user I want to generate structured thinking trees from my ideas
  so that I can explore concepts through AI-powered decomposition

  Background:
    Given I am logged in
    And I have an active session

  # --- Happy path: basic single-agent generation ---
  Scenario: Generate a thinking tree from a text idea
    Given I am in "idea" mode
    And I enter the idea "Build a SaaS marketplace for freelance designers"
    When I click GENERATE
    Then a POST request is sent to /api/generate with the idea and mode
    And the server responds with SSE headers
    And I receive node events with fields: id, type, label, reasoning, parentId
    And each node is rendered on the canvas via buildFlowNode()
    And the stream ends with a [DONE] event
    And the canvas shows 10-20 nodes including a "seed" root node

  # --- SSE streaming behavior ---
  Scenario: Tree generation streams nodes incrementally via SSE
    Given I am in "idea" mode
    And I enter the idea "AI-powered tutoring platform"
    When I trigger generation
    Then the server sets Content-Type to "text/event-stream"
    And each SSE event is formatted as "data: {JSON}\n\n"
    And each node appears on the canvas as it arrives (incremental render)
    And progress events with _progress field are displayed in the UI
    And the final event is "data: [DONE]\n\n"

  # --- Multi-agent research generation ---
  Scenario: Deep research generation runs parallel research agents
    Given I am in "idea" mode
    And I enter the idea "Competitive analysis of Figma vs Sketch"
    When I trigger research generation via POST /api/generate-research
    Then I receive a progress event "Planning research strategy..."
    And 3 parallel research agents run: market, technology, audience
    And I receive progress updates as each agent completes (1/3, 2/3, 3/3)
    And the research brief is synthesized into the tree generation prompt
    And the tree is streamed via SSE from claude:opus
    And if the tree has 10+ nodes, Graph of Thoughts aggregate runs (claude:sonnet)
    And synthesis nodes are appended to the tree
    And the stream ends with [DONE]

  # --- Multi-agent 3-lens generation ---
  Scenario: Multi-agent generation merges three analytical lenses
    Given I am in "idea" mode
    And I enter the idea "Launch a direct-to-consumer pet food brand"
    When I trigger multi-agent generation via POST /api/generate-multi
    Then 3 lenses run in parallel: analogical, first_principles, adversarial
    And I receive progress events for each lens ("Lens 1/3", "Lens 2/3", "Lens 3/3")
    And a merge phase combines all 3 outputs into a unified tree
    And the merged tree is streamed as SSE node events

  # --- Mode-specific system prompts ---
  Scenario: Resume mode uses the resume-specific system prompt
    Given I am in "resume" mode
    And I enter a job description "Senior Product Manager at Stripe..."
    When I trigger generation
    Then the server selects RESUME_SYSTEM_PROMPT
    And the tree contains resume-specific node types: "requirement", "skill_match", "skill_gap", "achievement", "keyword", "positioning"

  Scenario: Learn mode uses the curriculum system prompt
    Given I am in "learn" mode
    And I enter the topic "Distributed systems fundamentals"
    When I trigger generation
    Then the server selects LEARN_CURRICULUM_PROMPT
    And the tree contains learn-specific node types: "concept", "prerequisite", "exercise", "analogy", "misconception", "milestone"

  # --- Branch regeneration ---
  Scenario: Regenerate a subtree from a specific node
    Given I have a generated tree with node "node_5" of type "feature" label "Payment processing"
    And "node_5" has 3 descendant nodes
    When I trigger regenerate on "node_5" via POST /api/regenerate
    Then the 3 descendant nodes are removed from the canvas
    And new child nodes stream in via SSE under "node_5"
    And the ancestor chain is passed as parentContext for continuity
    And dynamic types are threaded if the tree uses adaptive mode

  # --- Deep drill-down ---
  Scenario: Drill into a node for sub-tree exploration
    Given I have a generated tree with node "node_3" of type "feature" label "User onboarding"
    When I trigger drill on "node_3" via POST /api/drill
    Then the drill stack pushes {nodeId: "node_3", nodeLabel: "User onboarding"}
    And the canvas zooms to show only the subtree rooted at "node_3"
    And new child nodes stream in via SSE with full tree context
    And I can exit drill to return to the full tree view

  # --- Fractal expansion ---
  Scenario: Fractal expand generates deeper sub-nodes on a leaf
    Given I have a generated tree with leaf node "node_8" of type "metric" label "Monthly active users"
    When I trigger fractal expand on "node_8" via POST /api/fractal-expand
    Then the ancestor chain is passed for context
    And the existing tree snapshot is included to avoid duplicate concepts
    And 3-5 new child nodes stream in via SSE under "node_8"
    And dynamic types are threaded if available

  Scenario: Autonomous fractal select picks the best leaf to expand
    Given I have a generated tree with 5 leaf nodes
    When I trigger fractal select via POST /api/fractal-select
    Then the server evaluates all leaf nodes for "depth potential"
    And returns a JSON response with selectedNodeId and reasoning
    And the selected node is used for the next fractal expansion round

  # --- Steering / continuation ---
  Scenario: Steered generation adds new nodes to an existing tree
    Given I have a generated tree with 12 nodes for "E-commerce platform"
    When I enter steering instruction "Focus more on payment security"
    And I trigger generation with steeringInstruction and existingNodes
    Then the server instructs the AI to generate only NEW nodes (8-15)
    And new node IDs are prefixed with "s_" to avoid collisions
    And all new nodes reference valid parentIds from existing or new nodes

  # --- Error handling ---
  Scenario: Generation fails when no idea is provided
    Given I am in "idea" mode
    When I trigger generation with an empty idea
    Then the server returns 400 with error "idea or jdText is required"
    And no SSE stream is opened

  Scenario: Generation handles AI provider errors gracefully
    Given I am in "idea" mode
    And I enter the idea "Test error handling"
    When the AI provider throws an error during streaming
    Then the server writes an SSE error event: data: {"error": "..."}
    And the stream closes
    And the client displays the error message
    And any nodes received before the error remain on canvas
