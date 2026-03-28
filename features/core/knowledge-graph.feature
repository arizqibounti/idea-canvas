# Domain: core
# Capability: Cross-session Zettelkasten knowledge graph

Feature: Knowledge Graph
  As a user I want to see patterns across my past sessions
  so that I can discover connections between ideas over time

  Background:
    Given I am logged in
    And I have multiple sessions with generated trees

  Scenario: View knowledge graph clusters
    When I open the Knowledge Graph panel
    Then the panel loads without error
    And I see clusters of related nodes grouped by tags
    And each cluster shows a count of matching nodes

  Scenario: Find similar past nodes
    Given my past sessions contain nodes tagged with "market-analysis"
    When I search for similar nodes with tags ["market-analysis"]
    Then I receive a list of up to 10 matching nodes from prior sessions
    And each result includes the node label, session ID, and similarity score

  Scenario: Knowledge graph with no prior sessions
    Given I have no saved sessions
    When I open the Knowledge Graph panel
    Then I see an empty state message
    And no error is displayed

  @bug
  # Bug: Knowledge Graph returns HTTP 401 in production (2026-03-28)
  # Root cause: /api/knowledge/clusters requires auth but may fail token validation
  Scenario: Knowledge graph loads in authenticated production environment
    Given ENABLE_AUTH is "true"
    And I am logged in with a valid Firebase token
    When I open the Knowledge Graph panel
    Then the request to /api/knowledge/clusters includes Authorization header
    And the panel loads successfully without 401 error

  @bug
  # Bug: Knowledge Graph returns HTTP 401 when auth is disabled (2026-03-28)
  Scenario: Knowledge graph loads in local development without auth
    Given ENABLE_AUTH is not set
    When I open the Knowledge Graph panel
    Then the request to /api/knowledge/clusters proceeds without a token
    And the server uses fallback user {uid: "local"}
    And the panel loads successfully without 401 error
