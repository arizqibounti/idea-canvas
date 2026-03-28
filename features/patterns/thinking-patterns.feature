# Domain: patterns
# Capability: Thinking pattern CRUD, execution, validation, recommendation, AI generation

Feature: Thinking patterns
  As a user I want to create, execute, and manage declarative thinking patterns
  so that I can apply structured reasoning pipelines to my ideas

  Background:
    Given I am logged in
    And I have an active session in "idea" mode

  # --- CRUD: List ---

  Scenario: List all available thinking patterns
    Given the pattern store has been seeded with built-in patterns
    When I send GET /api/patterns
    Then I receive a JSON array containing at least 12 built-in patterns
    And each entry includes "id", "name", "description", "icon", "color", and "builtIn"
    And the list includes "adversarial", "progressive-refine", "portfolio-explore", and "diffusion"

  # --- CRUD: Get full definition ---

  Scenario: Retrieve a full pattern definition with version history
    Given the built-in pattern "adversarial" exists
    When I send GET /api/patterns/adversarial
    Then I receive the full pattern document with a "versions" array
    And versions[0].definition contains stages "critique", "respond", "check_consensus", and "finalize"
    And the graph.entrypoint is "critique"
    And the graph.edges connect critique -> respond -> check_consensus with branch to finalize

  # --- CRUD: Create custom pattern ---

  Scenario: Create a custom thinking pattern
    When I send POST /api/patterns with definition:
      """
      {
        "id": "five-whys",
        "name": "Five Whys",
        "stages": {
          "ask": { "type": "transform", "model": "gemini:flash", "promptFallback": "Ask why for: {{idea}}", "outputFormat": "json" },
          "check": { "type": "branch", "condition": "{{round}} >= 5", "onTrue": "summarize", "onFalse": "ask" },
          "summarize": { "type": "generate", "model": "claude:sonnet", "promptFallback": "Summarize root causes", "outputFormat": "node-stream", "stream": true, "terminal": true }
        },
        "graph": { "entrypoint": "ask", "edges": [{"from": "ask", "to": "check"}, {"from": "check", "to": "ask"}, {"from": "check", "to": "summarize"}] }
      }
      """
    Then the response status is 200
    And the pattern "five-whys" is available in GET /api/patterns
    And the patternLoader cache contains "five-whys"

  # --- CRUD: Delete (built-in blocked) ---

  Scenario: Deleting a built-in pattern is blocked
    Given the built-in pattern "adversarial" exists
    When I send DELETE /api/patterns/adversarial
    Then the response status is 403
    And the response body contains error "builtIn"
    And the pattern "adversarial" still exists in the store

  Scenario: Deleting a custom pattern succeeds
    Given I have created a custom pattern "five-whys"
    When I send DELETE /api/patterns/five-whys
    Then the response status is 200
    And the patternLoader cache no longer contains "five-whys"

  # --- Validation ---

  Scenario: Pattern validation rejects invalid definitions
    When I send POST /api/patterns with definition:
      """
      {
        "id": "bad-pattern",
        "name": "Bad Pattern",
        "stages": {
          "oops": { "type": "teleport", "model": "gpt-5" },
          "fan": { "type": "fan_out" },
          "branch": { "type": "branch" }
        },
        "graph": { "entrypoint": "missing_stage", "edges": [{"from": "ghost", "to": "phantom"}] }
      }
      """
    Then the response status is 400
    And the validation errors include:
      | error                                                   |
      | stage "oops": invalid type "teleport"                   |
      | stage "oops": invalid model "gpt-5"                     |
      | stage "fan": fan_out requires branches[]                |
      | stage "fan": fan_out requires mergeTo                   |
      | stage "branch": branch requires condition               |
      | stage "branch": branch requires onTrue                  |
      | stage "branch": branch requires onFalse                 |
      | graph.entrypoint "missing_stage" not found in stages    |
      | edge from "ghost" not found in stages                   |
      | edge to "phantom" not found in stages                   |

  # --- Execution: Adversarial pattern with SSE streaming ---

  Scenario: Execute the Adversarial Critique pattern with SSE streaming
    Given I have a generated tree "AI startup strategy" with 10 nodes
    And the built-in pattern "adversarial" exists
    When I send POST /api/pattern/execute with:
      | patternId   | adversarial                |
      | idea        | AI startup strategy        |
      | mode        | idea                       |
    Then the server responds with SSE headers
    And I receive a _patternProgress event for stage "critique" with type "transform"
    And I receive a _patternStageResult event for stage "critique" containing "verdict" and "critiques"
    And I receive a _patternProgress event for stage "respond" with type "generate"
    And I receive streamed node events with ids prefixed "rebut_r"
    And I receive a _checkpoint event for stage "check_consensus" with options ["continue", "stop"]
    And the stream ends with a _patternComplete event containing "executionId", "totalRounds", and "stagesExecuted"
    And the stream terminates with a [DONE] event

  # --- Execution: Diffusion pattern (linear pipeline, no looping) ---

  Scenario: Execute the Diffusion Refinement pattern end-to-end
    Given I have a vague idea "something about sustainability"
    And the built-in pattern "diffusion" exists
    When I send POST /api/pattern/execute with:
      | patternId   | diffusion                          |
      | idea        | something about sustainability      |
      | mode        | idea                               |
    Then I receive _patternProgress events for stages in order: "sketch", "expand", "detail", "sharpen", "reconstruct"
    And the "sketch" stage streams 6-8 coarse nodes via SSE
    And the "expand" stage streams 15-20 child nodes
    And the "detail" stage streams concrete detail nodes and _update nodes
    And the "sharpen" stage returns a _patternStageResult with "nodeScores" and "nodesToRewrite"
    And the "reconstruct" stage streams final sharpened nodes
    And the stream ends with _patternComplete and [DONE]

  # --- Execution: Expert Committee with fan_out + merge ---

  Scenario: Execute Expert Committee pattern with parallel fan-out and merge
    Given I have a generated tree "marketplace platform" with 12 nodes
    And the built-in pattern "mixture-of-experts" exists
    When I send POST /api/pattern/execute with:
      | patternId   | mixture-of-experts          |
      | idea        | marketplace platform        |
      | mode        | idea                        |
    Then the "classify" stage returns node-to-domain classifications as JSON
    And the "fan" stage launches parallel branches "expert_market", "expert_technical", "expert_design"
    And each expert branch streams nodes with domain-specific id prefixes ("mkt_", "tech_", "ux_")
    And the "synthesis" merge stage combines results using "ai_merge" strategy
    And the synthesis streams unified "syn_" prefixed nodes

  # --- Stage types: loop ---

  Scenario: Loop stage iterates body stages until exit condition
    Given a custom pattern with a loop stage:
      """
      {
        "id": "loop-test",
        "name": "Loop Test",
        "stages": {
          "refine_loop": {
            "type": "loop",
            "body": ["improve", "evaluate"],
            "maxIterations": 3,
            "exitCondition": "{{evaluate.score}} >= 8",
            "exitTo": "finish"
          },
          "improve": { "type": "generate", "model": "claude:sonnet", "promptFallback": "Improve: {{idea}}", "outputFormat": "node-stream", "stream": true },
          "evaluate": { "type": "score", "model": "gemini:flash", "promptFallback": "Score 1-10", "outputFormat": "json" },
          "finish": { "type": "transform", "model": "gemini:flash", "promptFallback": "Done", "outputFormat": "json", "terminal": true }
        },
        "graph": { "entrypoint": "refine_loop", "edges": [] }
      }
      """
    When I execute the pattern with idea "improve my pitch"
    Then the loop executes "improve" then "evaluate" on each iteration
    And each iteration increments the round counter in _patternProgress events
    And the loop exits when evaluate.score >= 8 or after 3 iterations
    And execution continues to the "finish" stage

  # --- Node-level execution (single stage) ---

  Scenario: Execute a single pattern stage in isolation
    Given the built-in pattern "adversarial" exists
    When I send POST /api/pattern/execute-stage with:
      | patternId   | adversarial                       |
      | stageName   | critique                          |
      | context     | {"idea": "remote work policy", "nodes": [{"id": "n1", "type": "strategy", "label": "Hybrid model"}]} |
    Then the response is JSON (non-streaming, since critique has stream: false)
    And the response contains "stage": "critique" and a "result" with "critiques" array

  Scenario: Execute a streaming stage in isolation returns SSE
    Given the built-in pattern "adversarial" exists
    When I send POST /api/pattern/execute-stage with:
      | patternId   | adversarial                       |
      | stageName   | respond                           |
      | context     | {"idea": "remote work policy", "nodes": [], "critique": {"critiques": [{"id": "dc_1", "challenge": "No metrics"}]}} |
    Then the server responds with SSE headers
    And I receive streamed node events
    And the stream ends with _patternStageResult and [DONE]

  # --- Pattern recommendation ---

  Scenario: Recommend a thinking pattern based on user input
    Given multiple patterns exist with autoSelect keywords
    When I send POST /api/pattern/recommend with:
      | idea   | I have a rough idea about a new product but nothing concrete |
      | mode   | idea                                                         |
    Then the response contains "recommended" with a valid pattern id
    And the response contains "alternatives" as an array of pattern ids
    And the response contains "reasoning" explaining the recommendation
    And "diffusion" appears in recommended or alternatives (matching keyword "rough idea")

  # --- AI pattern generation from natural language ---

  Scenario: Generate a new pattern definition from natural language
    When I send POST /api/pattern/generate with:
      | description | A Socratic questioning pattern that asks probing questions to surface hidden assumptions, then stress-tests each assumption |
    Then the response contains a "pattern" object with valid id, name, stages, and graph
    And the response contains a "validation" object
    And the generated pattern has stages using types from: generate, transform, score, branch, loop, merge, filter, enrich, fan_out
    And each stage has a "promptFallback" with {{slot}} interpolation placeholders

  # --- Client-side hook behavior ---

  Scenario: usePatternExecutor hook manages execution lifecycle on the client
    Given the usePatternExecutor hook is initialized with canvas refs
    When I call execute("adversarial", "test idea", nodes, "idea")
    Then isExecuting becomes true
    And patternName is set to "Adversarial"
    And the hook sends POST /api/pattern/execute with the serialized nodes
    And as SSE events arrive:
      | event type          | hook state update                                         |
      | _patternProgress    | currentStage and currentRound update; stageHistory grows   |
      | _patternStageResult | stageResults map gains an entry for the stage              |
      | _checkpoint         | checkpoint state is set with executionId and options        |
      | _patternError       | error state is set if fatal is true                        |
      | _patternComplete    | stageHistory marks all stages "done"; onComplete fires     |
      | node event (id+type)| buildFlowNode adds the node to rawNodesRef; applyLayout fires |
      | _meta               | dynamicTypesRef and dynamicConfigRef update                |
    And when the stream ends, isExecuting becomes false

  # --- Abort mid-execution ---

  Scenario: User aborts a running pattern execution
    Given a pattern execution is in progress for "adversarial"
    When the user calls stop() on the usePatternExecutor hook
    Then the AbortController signal fires
    And the server stops streaming and ends the response
    And isExecuting becomes false on the client
    And no _patternError is set (abort is not treated as an error)

  # --- Error handling: missing pattern ---

  Scenario: Executing a non-existent pattern returns 404
    When I send POST /api/pattern/execute with:
      | patternId   | nonexistent-pattern |
      | idea        | test                |
    Then the response status is 404
    And the response body contains error "Pattern \"nonexistent-pattern\" not found"

  # --- Version revert ---

  Scenario: Revert a pattern to a previous version
    Given I have created and updated custom pattern "five-whys" twice
    When I send POST /api/patterns/five-whys/revert with version 1
    Then the pattern definition reverts to the first version
    And the patternLoader cache is refreshed with the reverted definition

  # --- Bug regressions ---

  @bug
  # Bug: Patterns tab shows empty in production — SEED must auto-populate on first visit (2026-03-28)
  Scenario: Patterns settings tab loads built-in patterns without manual seeding
    Given I navigate to the Settings page
    When I click the "Patterns" tab
    Then I see at least 12 built-in patterns in the sidebar
    And the list includes "Adversarial", "Progressive Refine", "Portfolio Exploration", and "Diffusion"
    And I do not see "No patterns found"

  @bug
  # Bug: SEED button click should populate patterns and refresh the list (2026-03-28)
  Scenario: Clicking SEED populates built-in patterns
    Given I am on the Patterns settings tab
    And the pattern list is empty
    When I click the "SEED" button
    Then the button text changes to "SEEDING..."
    And after seeding completes the sidebar shows at least 12 patterns
    And no error is shown
