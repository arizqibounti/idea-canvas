Feature: Canvas modes
  As a user I want to select from 7 specialized thinking modes
  so that the AI generates domain-appropriate tree structures

  Background:
    Given I am logged in
    And I have an active session

  # --- All 7 modes exist with correct configuration ---
  Scenario: All canvas modes are defined with distinct identities
    Then the following modes are available:
      | id        | label  | icon | color   |
      | idea      | IDEA   |    | #6c63ff |
      | codebase  | CODE   |  | #20c997 |
      | resume    | RESUME |    | #74c0fc |
      | decision  | DECIDE |    | #ffa94d |
      | writing   | WRITE  |    | #f06595 |
      | plan      | PLAN   |    | #69db7c |
      | learn     | LEARN  |    | #34d399 |
    And each mode has a unique placeholder text and keyword list
    And "resume" mode is marked as hidden (not shown in mode selector by default)

  # --- Mode switching ---
  Scenario: Switching modes updates the canvas context
    Given I am in "idea" mode with an empty canvas
    When I switch to "plan" mode
    Then the input placeholder changes to "describe the project, goal, or initiative you're planning..."
    And the mode indicator shows "PLAN" with color #69db7c
    And subsequent generations use the "plan" mode parameter

  # --- Auto-detection from input text ---
  Scenario: Mode is auto-detected from input keywords
    Given I am in "idea" mode
    When I type "should i choose React or Vue for my frontend"
    Then the mode detector scores "decision" highest due to keywords "choose", "should i"
    And the UI suggests switching to "decide" mode

  Scenario: Auto-detection requires clear signal to avoid false positives
    Given I am in "idea" mode
    When I type "build an app"
    Then the detector scores "idea" with score 1
    And since "idea" requires score > 1 for suggestion, no mode change is suggested

  Scenario: Auto-detection handles ambiguous input gracefully
    Given I am in "idea" mode
    When I type "plan to build a product roadmap and write about it"
    And "plan" and "writing" modes score equally
    Then no mode suggestion is shown because of a tie

  Scenario: Hidden modes are excluded from auto-detection
    Given I am in "idea" mode
    When I type "update my resume for this job application"
    Then the "resume" mode is NOT suggested via auto-detection because it is hidden
    But the user can manually select "resume" mode

  # --- Mode-specific node types ---
  Scenario: Idea mode generates product-thinking node types
    Given I am in "idea" mode
    When I generate a tree for "Build a meal planning app"
    Then the tree may contain nodes of types: "seed", "problem", "user_segment", "job_to_be_done", "feature", "constraint", "metric", "insight"

  Scenario: Code mode generates codebase analysis node types
    Given I am in "codebase" mode
    When I generate a tree for a codebase analysis
    Then the tree may contain nodes of types: "seed", "component", "api_endpoint", "data_model", "tech_debt"

  Scenario: Resume mode generates career strategy node types
    Given I am in "resume" mode
    When I generate a tree for a job description
    Then the tree may contain nodes of types: "seed", "requirement", "skill_match", "skill_gap", "achievement", "keyword", "story", "positioning"

  Scenario: Learn mode generates concept mastery node types
    Given I am in "learn" mode
    When I generate a tree for "Machine learning fundamentals"
    Then the tree may contain nodes of types: "seed", "concept", "prerequisite", "exercise", "analogy", "misconception", "milestone"

  # --- Dynamic / adaptive node types ---
  Scenario: AI declares custom node types via _meta and they render correctly
    Given I am in "idea" mode
    When the AI returns a _meta event with custom types: [{"type": "risk_factor", "label": "Risk Factor", "icon": "!"}]
    Then a dynamic node config is built using buildDynamicConfig()
    And "risk_factor" nodes render with a color from the DYNAMIC_PALETTE
    And the label displays as "RISK FACTOR"

  # --- Unknown node type fallback ---
  Scenario: Unknown node types fall back to the insight config
    Given I have a tree with a node of type "some_unknown_type"
    When the canvas renders that node
    Then it uses the "insight" fallback config with color #a855f7 and icon "✦"
