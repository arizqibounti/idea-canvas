Feature: Autonomous evolution plans with meta-evolution tracking
  As a user I want to launch a 1-click evolution plan that autonomously improves my tree
  so that my thinking tree gets refined, debated, experimented on, and exported over time

  Background:
    Given I am logged in
    And I have an active session in "idea" mode
    And I have a generated tree for "B2B SaaS analytics platform"

  # --- 1-click EVOLVE ---
  Scenario: Create a 5-step evolution plan with 1 click
    When I click EVOLVE on the toolbar
    Then a POST /api/evolve request is sent with the sessionId
    And a scheduled task is created with type "evolve"
    And the default plan is ["refine", "debate", "experiment", "refine", "synthesize_export"]
    And the default cron schedule is "0 9 * * *" (daily at 9 AM)
    And the chat panel shows an EvolutionCard with the plan timeline

  Scenario: Create a custom evolution plan
    When I create an evolution plan with custom steps ["debate", "refine", "debate", "synthesize_export"]
    And a custom cron of "0 9 * * 1-5" (weekdays at 9 AM)
    Then the task is created with the custom plan and schedule
    And the EvolutionCard shows 4 steps instead of 5

  # --- Multi-step autonomous pipeline ---
  Scenario: Evolution executes refine step
    Given an evolution plan at step 1 of 5 (refine)
    When the scheduled task executes
    Then the refine step identifies 3-5 weak nodes
    And improvements are applied to the session nodes
    And the step result records appliedCount and summary
    And the evolution history is updated with the step result

  Scenario: Evolution executes debate step
    Given an evolution plan at step 2 of 5 (debate)
    When the scheduled task executes
    Then the debate step critiques the tree for weaknesses and contradictions
    And the step result includes the critique summary
    And the evolution history is updated

  Scenario: Evolution executes experiment step
    Given an evolution plan at step 3 of 5 (experiment)
    When the scheduled task executes
    Then a candidate tree is generated as a bold alternative
    And the candidate is compared to the baseline using quality heuristics
    And if the candidate wins, the session tree is replaced
    And the step result records whether the tree was swapped

  Scenario: Evolution executes synthesize_export step
    Given an evolution plan at step 5 of 5 (synthesize_export)
    When the scheduled task executes
    Then the tree is exported to a Google Doc via generateAndExportToGoogleDoc
    And the step result includes the docUrl and docId
    And the EvolutionCard shows an "Open Doc" link for this step

  # --- Step progression ---
  Scenario: Evolution plan advances one step per scheduled run
    Given an evolution plan with 5 steps and runCount 0
    When the task runs 3 times
    Then step 1 (refine) executes on the first run
    And step 2 (debate) executes on the second run
    And step 3 (experiment) executes on the third run
    And each step result is appended to config.evolutionHistory

  Scenario: Evolution plan auto-disables when all steps complete
    Given an evolution plan at step 5 of 5 (the final step)
    When the final step completes
    Then the task is auto-disabled (enabled: false)
    And the EvolutionCard shows a "COMPLETE" badge
    And no further scheduled runs are triggered

  # --- Meta-evolution strategy tracking ---
  Scenario: Each evolution step records outcome in meta-evolution
    Given an evolution plan runs its refine step
    When the step completes with appliedCount 4
    Then recordOutcome is called with strategy "refine" and the score delta
    And the outcome is persisted to Firestore or in-memory store

  Scenario: Evolution step receives meta-evolution hint
    Given meta-evolution records show "refine" has avg delta +1.5 over 8 runs
    When the next evolution step executes
    Then the meta-evolution best strategy is queried via getBestStrategy
    And the metaHint is attached to the step result
    And the EvolutionCard displays "Meta-evolution suggests: refine (avg delta: +1.5)"

  # --- Meta-evolution effectiveness report ---
  Scenario: View meta-evolution effectiveness report for a mode
    When I request GET /api/meta-evolution:idea
    Then the response includes per-strategy statistics
    And each strategy shows avgDelta, count, best, and worst scores
    And the total number of recorded outcomes is included

  # --- Fitness-based pruning ---
  Scenario: Experiment step within evolution prunes low-fitness trees
    Given the evolution experiment step generates a candidate tree
    And the candidate quality score is lower than the baseline
    When the comparison completes
    Then the baseline tree is kept (candidate pruned)
    And the step result records swapped: false
    And the evolution proceeds to the next step with the stronger tree

  # --- EvolutionCard UI ---
  Scenario: EvolutionCard shows timeline with step states
    Given an evolution plan with 3 completed steps and 2 remaining
    Then the EvolutionCard displays 5 steps in a timeline
    And completed steps show a "done" state with their summary
    And the current step (step 4) is highlighted as "current"
    And remaining steps are shown as pending

  Scenario: User can manually run the next evolution step
    Given an evolution plan with 2 completed steps
    When I click "Run Step 3 Now" on the EvolutionCard
    Then the task executes immediately via POST /api/tasks/{taskId}/run
    And the step result is displayed in the timeline
    And the EvolutionCard updates without waiting for the cron schedule

  # --- Session notification ---
  Scenario: Evolution step result is stored as a chat notification
    Given an evolution step completes successfully
    Then a system message is appended to the session chat history
    And the message includes the task name, completion time, and summary
    And the notification appears in the chat panel

  # --- Error handling ---
  Scenario: Evolution handles missing session gracefully
    Given the evolution plan references a sessionId with no tree
    When the task executes
    Then the step returns an error "No session linked -- requires an existing tree"
    And the task status is set to "error"

  Scenario: Evolution plan requires a sessionId
    When I try to create an evolution plan without a sessionId
    Then the server returns a 400 error with "sessionId is required"
