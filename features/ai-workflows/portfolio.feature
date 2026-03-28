Feature: Portfolio generation and scoring
  As a user I want to generate 3-5 alternative thinking trees
  so that I can compare diverse approaches and pick the strongest one

  Background:
    Given I am logged in
    And I have an active session in "idea" mode

  # --- Happy path ---
  Scenario: Generate 3 alternative trees with mini-trees
    Given I have entered the idea "Sustainable fashion marketplace"
    When I generate a portfolio with count 3
    Then the server streams alternatives via SSE on POST /api/portfolio/generate
    And each alternative includes an _alternative event with index, title, thesis, and approach
    And each alternative includes a _meta event
    And each alternative includes 8-12 child nodes
    And all node ids are prefixed "alt{N}_" for each alternative N

  Scenario: Generate 5 alternative trees
    Given I have entered the idea "Developer productivity tool"
    When I generate a portfolio with count 5
    Then 5 alternatives are streamed, each with distinct titles and theses
    And no two alternatives share the same approach

  # --- Multi-phase enrichment pipeline ---
  Scenario: Portfolio runs entity enrichment before generation
    Given I have entered the idea "Competitor to Notion for small teams"
    When portfolio generation starts
    Then a progress event reports "Researching entities..."
    And relevant entity URLs are fetched and appended as reference content

  Scenario: Portfolio runs research pipeline with 3 agents
    Given portfolio generation is in progress
    Then a progress event reports "Planning research for portfolio alternatives..."
    And 3 parallel research agents run for market, technology, and audience
    And a progress event reports "Researching market, technology & audience..."
    And the research brief is included in the generation prompt

  Scenario: Portfolio runs 3-lens multi-agent analysis
    Given portfolio generation is in progress
    Then a progress event reports "Analyzing from multiple perspectives..."
    And the analogical perspective completes (1/3)
    And the first_principles perspective completes (2/3)
    And the adversarial perspective completes (3/3)
    And all lens insights are included as MULTI-PERSPECTIVE ANALYSIS context

  # --- SSE streaming ---
  Scenario: Portfolio generation streams results in real time
    Given I have entered the idea "AI tutoring platform"
    When I trigger portfolio generation
    Then the server responds with SSE headers
    And I receive _progress events for each pipeline phase
    And I receive _alternative, _meta, and node events incrementally
    And the stream ends with a [DONE] event

  # --- Multi-dimensional scoring ---
  Scenario: Score and rank alternatives with mode-specific dimensions
    Given I have 3 generated alternatives for "AI tutoring platform"
    When I score the portfolio via POST /api/portfolio/score
    Then each alternative receives a composite score
    And each alternative is scored on dimensions like innovation, feasibility, market_fit, and defensibility
    And the response includes a recommendation for the best alternative

  Scenario: Codebase mode uses tech-specific scoring dimensions
    Given I have an active session in "codebase" mode
    And I have 3 generated alternatives for "E-commerce platform refactor"
    When I score the portfolio
    Then alternatives are scored by a "senior software architect" persona
    And dimensions include maintainability, performance, scalability, and developer_experience

  Scenario: Focus on specific node types changes scoring dimensions
    Given I have an active session in "codebase" mode with focus on "feature" types
    When I score the portfolio with focus types ["feature"]
    Then the scoring persona is "product strategist"
    And dimensions include user_value, market_differentiation, execution_feasibility, and scalability

  # --- Existing title deduplication ---
  Scenario: Portfolio avoids repeating previously generated alternatives
    Given I already generated alternatives with titles "Premium SaaS" and "Freemium Marketplace"
    When I generate more portfolio alternatives via {"portfolioMore": true}
    Then the existing titles are sent as existingTitles
    And the new alternatives have different titles and approaches

  # --- Chat action dispatch ---
  Scenario: Portfolio is triggered via chat action
    Given I have a generated tree
    When the chat AI emits action {"portfolio": true}
    Then the portfolio generation workflow starts
    And the chat panel shows a PortfolioCard with alternative navigation

  Scenario: Portfolio is triggered scoped to specific node types
    Given I have a generated tree with "feature" and "risk" nodes
    When the chat AI emits action {"portfolio": {"types": ["feature"]}}
    Then portfolio generation focuses on the "feature" nodes
    And the prompt adapts to the focused node type context

  # --- Error handling ---
  Scenario: Portfolio handles missing idea gracefully
    When I try to generate a portfolio without an idea
    Then the server returns a 400 error with message "idea is required"
    And no alternatives are generated

  Scenario: Portfolio score handles JSON parse failure gracefully
    Given the scoring AI returns malformed JSON
    When the score response is parsed
    Then JSON repair is attempted (fix trailing commas, unterminated strings)
    And if repair fails, a fallback response with empty scores and error message is returned

  # --- Zettelkasten knowledge ---
  Scenario: Portfolio injects cross-session knowledge context
    Given I have knowledge entries related to "sustainable fashion"
    When portfolio generation runs
    Then the Zettelkasten knowledge context is appended to the prompt
    And alternatives are informed by prior session insights
