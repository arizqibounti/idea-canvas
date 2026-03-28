# Domain: learning
# Capability: Socratic comprehension loop (Teach -> Probe -> Evaluate -> Adapt)
# Source: server/engine/learn.js, client/src/useLearnLoop.js, client/src/chat/LearnCard.js

Feature: Learn mode — Socratic comprehension loop
  As a learner I want ThoughtClaw to teach me concepts via a Teach-Probe-Evaluate-Adapt loop
  so that I build genuine understanding tracked by mastery scores

  Background:
    Given I am logged in
    And I have an active session in "learn" mode
    And the concept DAG contains the following nodes:
      | id         | type         | label              | difficulty | parentIds      |
      | seed       | seed         | Machine Learning   |            |                |
      | concept_1  | prerequisite | Linear Algebra     | 3          | seed           |
      | concept_2  | concept      | Gradient Descent   | 5          | concept_1      |
      | concept_3  | concept      | Backpropagation    | 7          | concept_2      |
      | milestone_1| milestone    | Neural Net Basics  |            | concept_2,concept_3 |

  # --- Happy path: full loop ---
  Scenario: Complete teach-probe-evaluate cycle for a single concept
    Given concept "concept_1" has mastery 0/10
    When the learn loop starts with topic "Machine Learning" and target mastery 7
    Then the system teaches "Linear Algebra" first because it has no unmastered prerequisites
    And I see a LearnCard with status "teaching" containing explanation, keyTakeaways, example, and analogy
    When I click "Ready for Quiz"
    Then the system generates a probe question for "concept_1"
    And I see a LearnCard with status "probing" showing the question and a text input
    When I type "Vectors and matrices form the foundation" and click "Submit Answer"
    Then the system evaluates my answer via POST /api/learn/evaluate
    And I see a LearnCard with status "feedback" showing a MasteryBadge and feedback text

  # --- Teach phase is skipped for partially learned concepts ---
  Scenario: Skip teaching when mastery is 5 or above
    Given concept "concept_2" has mastery 5/10
    And concept "concept_1" has mastery 7/10
    When the learn loop picks "concept_2" as the next concept
    Then the teach phase is skipped
    And the system jumps directly to generating a probe question

  # --- Topological ordering and prerequisite gating ---
  Scenario: Concepts are probed in prerequisite order
    Given all concepts start at mastery 0/10
    When the learn loop starts with topic "Machine Learning" and target mastery 7
    Then "concept_1" (Linear Algebra, difficulty 3) is selected first
    And "concept_2" (Gradient Descent, difficulty 5) is not selected until "concept_1" reaches mastery 7
    And "concept_3" (Backpropagation, difficulty 7) is not selected until "concept_2" reaches mastery 7

  # --- Mastery persistence ---
  Scenario: Mastery scores persist across browser sessions via localStorage
    Given concept "concept_1" has mastery 8/10 from a previous session
    When I reload the page and start learn mode
    Then the masteryMap loads from localStorage key "tc_learn_mastery"
    And concept "concept_1" is already marked as mastered
    And the loop skips "concept_1" and proceeds to "concept_2"

  # --- Milestone Socratic challenge ---
  Scenario: Socratic challenge triggers at milestone node
    Given concept "concept_2" has mastery 7/10
    And concept "concept_3" has mastery 7/10
    When the loop detects milestone "milestone_1" with all parent concepts mastered
    Then the system calls POST /api/learn/socratic with milestoneId "milestone_1" and the masteryMap
    And I see a LearnCard with status "socratic" showing a "MILESTONE CHALLENGE" label
    And the challenge covers concepts "Gradient Descent" and "Backpropagation"
    When I submit my milestone answer
    Then the answer is evaluated via POST /api/learn/evaluate
    And I see milestone feedback with a mastery score

  # --- Adapt phase: alternative explanation via SSE ---
  Scenario: Requesting "Explain Differently" streams adaptive nodes
    Given I received feedback for "concept_2" with mastery 3/10 and misconceptions detected
    When I click "Explain Differently"
    Then the system calls POST /api/learn/adapt with the evaluation and mastery
    And the server responds with SSE headers
    And I receive 2-4 adaptive learning nodes streamed as SSE events
    And each node is added to the canvas via buildFlowNode and applyLayout
    And the stream ends with a [DONE] event
    And I see a LearnCard with status "adapt_summary" showing the alternative explanation inline

  # --- Hint system ---
  Scenario: Requesting hints during a probe question
    Given I am viewing a probe question for "concept_2" with 3 available hints
    When I click "Hint"
    Then hint 1 is revealed below the question
    When I click "Hint" again
    Then hint 2 is also revealed
    And the "Hint" button remains available until all hints are shown

  # --- Skip concept ---
  Scenario: Skipping a concept marks it with score -1
    Given I am viewing a probe question for "concept_3"
    When I click "Skip"
    Then concept "concept_3" is recorded in masteryMap with score -1 and skipped true
    And the loop advances to the next eligible concept

  # --- Completion ---
  Scenario: Loop completes when all concepts reach target mastery
    Given concept "concept_1" has mastery 7/10
    And concept "concept_2" has mastery 7/10
    And concept "concept_3" has mastery 7/10
    When the loop checks for the next concept with target mastery 7
    Then no unmastered concept is found
    And I see a LearnCard with status "complete" showing a summary of all mastery scores
    And isLearning is set to false

  # --- Error handling ---
  Scenario: Server error during probe generation shows error card
    Given the learn loop is running for topic "Machine Learning"
    When POST /api/learn/probe returns HTTP 500
    Then the loop catches the error
    And I see a LearnCard with status "error" and the error message displayed

  # --- Abort / stop ---
  Scenario: Stopping the learn loop mid-cycle
    Given the learn loop is running and waiting for my answer on "concept_2"
    When I click "Stop" on the LearnCard
    Then learnAbortRef.current.abort() is called
    And isLearning is set to false
    And the layout is reapplied via applyLayout
    And the onProgress callback receives status "done" with the current masteryMap

  # --- Validation: missing parameters ---
  Scenario: Server rejects teach request with missing parameters
    When POST /api/learn/teach is called without a topic
    Then the server returns HTTP 400 with error "nodes, topic, and conceptId are required"

  Scenario: Server rejects probe when conceptId is not found in nodes
    When POST /api/learn/probe is called with conceptId "nonexistent_node"
    Then the server returns HTTP 400 with error "Concept nonexistent_node not found in nodes"
