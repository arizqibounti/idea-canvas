Feature: Auto-refine critique-strengthen-score loop
  As a user I want to automatically refine my thinking tree
  so that weaknesses are identified, fixed, and measured across multiple rounds

  Background:
    Given I am logged in
    And I have an active session in "idea" mode
    And I have a generated tree for "Subscription box for pet owners"

  # --- Happy path ---
  Scenario: Complete 3-round refine loop with score improvement
    When I start auto-refine with maxRounds 3
    Then round 1 begins with a critique via POST /api/refine/critique
    And the critique returns weaknesses with severity scores, gaps, and contradictions
    Then the strengthen step streams new and updated nodes via SSE on POST /api/refine/strengthen
    And new nodes are tagged with autoRefined: true
    Then the score step evaluates improvement via POST /api/refine/score
    And the round summary shows oldScore and newScore
    And the loop continues for up to 3 rounds

  # --- Critique step ---
  Scenario: Critique identifies weaknesses with severity badges
    When the critique step runs
    Then the response includes a "weaknesses" array
    And each weakness has a severity (1-10), nodeLabel, reason, and approach
    And the response includes an overallScore for the tree
    And nodeScores are returned per-node for visual fitness indicators

  Scenario: Critique uses mode-specific prompts
    Given I have an active session in "resume" mode
    And I have a generated tree for "Senior Engineer at Stripe"
    When the critique step runs
    Then it uses REFINE_CRITIQUE_PROMPT_MAP["resume"] as the system prompt
    And weaknesses are evaluated in the context of resume strategy

  Scenario: Critique includes prior weaknesses for continuity
    Given round 1 identified 3 weaknesses
    When round 2 critique runs
    Then the prior weaknesses are sent as priorWeaknesses
    And the AI checks whether they have already been addressed

  # --- Research and multi-agent enrichment ---
  Scenario: Strengthen step runs research agent enrichment
    When the strengthen step begins
    Then a progress event reports "Researching context for strengthening..."
    And 3 parallel research agents run for market, technology, and audience
    And the research brief is appended to the strengthen prompt context

  Scenario: Strengthen step runs 3-lens multi-agent analysis
    When the strengthen step begins
    Then the analogical lens analyzes weaknesses from cross-domain parallels
    And the first_principles lens deconstructs weaknesses to fundamentals
    And the adversarial lens stress-tests the proposed fixes
    And all 3 lens perspectives are appended as MULTI-PERSPECTIVE ANALYSIS context

  # --- Strengthen step ---
  Scenario: Strengthen step streams new and updated nodes
    Given the critique found 2 weaknesses and 1 gap
    When the strengthen step runs via SSE on POST /api/refine/strengthen
    Then the server responds with SSE headers
    And _progress events report the research and strengthening stages
    And _update events modify existing weak nodes in-place
    And new nodes are streamed with unique ids and parentIds
    And the stream ends with a [DONE] event

  Scenario: Strengthen step handles growth candidates
    Given the critique identified 2 growthCandidates (high-fitness nodes)
    When the strengthen step runs
    Then 1-2 new child nodes are generated for each growth candidate
    And the new nodes extend each candidate's strength in the suggested direction

  # --- Score step ---
  Scenario: Score step measures improvement and records meta-evolution outcome
    Given the prior overallScore was 6.5
    When the score step runs via POST /api/refine/score
    Then it returns a new overallScore and summary
    And the score delta is recorded via meta-evolution recordOutcome
    And a "refine_result" artifact is appended to the session

  # --- Chat action dispatch ---
  Scenario: Refine is triggered via chat action
    Given I have a generated tree
    When the chat AI emits action {"refine": true}
    Then the auto-refine loop starts with default maxRounds 3
    And the chat panel shows a RefineCard with round-by-round progress

  Scenario: Refine more continues with additional rounds
    Given a refine loop has completed 3 rounds
    When the chat AI emits action {"refineMore": true}
    Then 2 additional refine rounds run via handleGoDeeper

  # --- Early stopping ---
  Scenario: Refine stops early when no issues are found
    Given the tree is already strong with no weaknesses
    When the critique step returns stopReason "No significant weaknesses found"
    Then the refine loop ends immediately
    And the progress status shows "complete" with the stopReason

  # --- Abort ---
  Scenario: User can abort refine mid-loop
    Given auto-refine is running on round 2
    When I click stop
    Then the AbortController signal is triggered
    And the refine loop exits cleanly
    And the tree retains all changes made before the abort

  # --- Error handling ---
  Scenario: Refine handles missing nodes gracefully
    Given I have no generated tree
    When I try to start auto-refine
    Then the server returns a 400 error with "nodes and idea are required"
    And no refine round is initiated

  # --- Zettelkasten knowledge injection ---
  Scenario: Critique injects cross-session knowledge context
    Given I have knowledge entries related to "pet subscription businesses"
    When the critique step runs
    Then the Zettelkasten knowledge context is appended to the user message
    And the critique references insights from prior sessions
