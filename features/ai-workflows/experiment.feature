Feature: Autonomous experiment loop
  As a user I want to autonomously mutate, score, and compare tree variants
  so that the best version of my idea emerges through iterative experimentation

  Background:
    Given I am logged in
    And I have an active session in "idea" mode
    And I have a generated tree for "AI-powered code review tool"

  # --- Happy path ---
  Scenario: Complete 5-iteration experiment loop
    When I start an experiment with maxIterations 5
    Then the baseline tree is scored first via POST /api/experiment/score
    And for each iteration the loop runs: analyze -> mutate -> score -> keep/discard
    And the loop runs up to 5 iterations
    And the final best tree is applied to the canvas

  # --- Step 0: Baseline scoring ---
  Scenario: Experiment scores baseline tree before iterating
    When the experiment starts
    Then the progress shows status "scoring_baseline"
    And the baseline tree is scored against itself to establish a starting total
    And the bestTree state is initialized with the baseline score

  # --- Step 1: Analyze and choose mutation strategy ---
  Scenario: Analyze step recommends next mutation strategy
    Given the current best scores show weak "market_fit" dimension
    When the analyze step runs via POST /api/experiment/analyze
    Then the AI recommends a nextStrategy from available strategies
    And available strategies include "pivot_market", "change_monetization", "simplify", "differentiate", "scale", "wildcard"
    And the response includes a rationale and focusAreas

  Scenario: Analyze step uses meta-evolution historical data
    Given meta-evolution records show "differentiate" has the highest avg delta for "idea" mode
    When the analyze step runs
    Then the meta-evolution hint is included in the prompt
    And the AI considers historically effective strategies in its recommendation

  Scenario: Analyze step falls back to random strategy on error
    Given the analyze AI call fails
    When the analyze step errors
    Then a fallback strategy is selected from untried strategies
    And the rationale indicates "Fallback selection due to analysis error"

  # --- Step 2: Mutate ---
  Scenario: Mutate step generates a complete alternative tree via SSE
    Given the analyze step recommended "pivot_market"
    When the mutate step runs via SSE on POST /api/experiment/mutate
    Then the server responds with SSE headers
    And a progress event reports "Generating pivot market variant..."
    And the stream includes an _alternative event with title, thesis, and strategy
    And the stream includes complete tree nodes for the variant
    And the stream ends with a [DONE] event

  Scenario: Mutate step receives weak dimensions and prior mutations
    Given iteration 3 with weak dimensions "market_fit: 4/10" and "defensibility: 3/10"
    And prior mutations include "simplify" (kept) and "scale" (discarded)
    When the mutate step runs
    Then weakDimensions are passed to target the lowest-scoring areas
    And priorMutations are passed to avoid repeating discarded approaches

  # --- Step 3: Score comparison ---
  Scenario: Score step compares baseline vs candidate side by side
    Given the mutate step produced a "differentiate" variant with 10 nodes
    When the score step runs via POST /api/experiment/score
    Then both baseline and candidate are scored on mode-specific dimensions
    And the response includes a winner ("baseline" or "candidate")
    And the score delta is recorded via meta-evolution recordOutcome
    And an "experiment_variant" artifact is appended to the session

  # --- Step 4: Keep or discard ---
  Scenario: Winning candidate replaces the canvas tree
    Given the candidate scored 7.8 and the baseline scored 6.2
    When the winner is "candidate"
    Then the canvas tree is replaced with the candidate nodes
    And all new nodes are tagged with autoExperimented: true
    And the tree swap banner shows the old and new scores
    And currentBest is updated for subsequent iterations

  Scenario: Losing candidate is discarded and baseline is kept
    Given the candidate scored 5.1 and the baseline scored 6.2
    When the winner is "baseline"
    Then the canvas tree remains unchanged
    And the experiment history records kept: false for this iteration
    And the next iteration begins with the same baseline

  # --- Strategy badges ---
  Scenario: Experiment history tracks strategy badges
    Given the experiment has run 3 iterations
    Then the experiment history includes entries with strategy names
    And strategies shown include badges like "pivot_market", "simplify", "differentiate"
    And each entry records candidateTotal, baselineTotal, and whether it was kept

  # --- Chat action dispatch ---
  Scenario: Experiment loop has no direct chat action but is part of evolution
    Given I have a generated tree
    When the chat AI suggests experimenting
    Then the user can trigger the experiment from the toolbar or evolution plan
    And the chat panel shows an ExperimentCard with iteration progress

  # --- Abort ---
  Scenario: User can abort experiment mid-iteration
    Given the experiment is running on iteration 3
    When I click stop
    Then the AbortController signal is triggered
    And the experiment loop exits cleanly
    And the tree retains the best variant found so far

  # --- Empty mutation ---
  Scenario: Empty mutation is skipped gracefully
    Given the mutate step produces 0 candidate nodes
    When the mutation result is empty
    Then the iteration is skipped with kept: false
    And the loop continues to the next iteration

  # --- Compounding context ---
  Scenario: Mutate step injects compounding session context
    Given my session has prior refine and debate artifacts
    When the mutate step runs
    Then the compounding context (session brief, artifacts, pollination) is appended
    And the mutation is informed by the full session history

  # --- Error handling ---
  Scenario: Experiment handles missing required fields
    When I try to start an experiment without nodes or idea
    Then the server returns a 400 error
    And no experiment iteration is initiated
