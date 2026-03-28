# Domain: export
# Source: client/src/ExportGitHubModal.js, client/src/exportMarkdown.js, server/engine/specialty.js (handleExportGithub)

Feature: Export to GitHub repository
  As a user I want to export my thinking tree to a GitHub repository so that I can version-control and share my product spec

  Background:
    Given I am logged in
    And I have an active session in "idea" mode
    And I have a generated tree with at least 5 nodes

  # --- Happy path ---
  Scenario: Export tree to a new private GitHub repository
    Given my tree is about "AI-powered customer support platform"
    And I have a valid GitHub Personal Access Token with "repo" scope
    When I open the Export to GitHub modal
    And I enter my PAT and accept the auto-generated repo name "idea-graph-ai-powered-customer"
    And I select "Private" visibility
    And I click "EXPORT TO GITHUB"
    Then the client generates README.md, SPEC.md, DEBATE.md, and CLAUDE.md from the tree
    And POST /api/export/github is called with the token, repoName, isPrivate true, and the generated files
    And the server creates a new private GitHub repo via the GitHub API
    And each file is pushed sequentially via the GitHub Contents API
    And the first commit message is "Export product spec from Idea Graph"
    And subsequent files use commit messages like "Add SPEC.md"
    And the modal shows the repository URL on success

  # --- Generated markdown content ---
  Scenario: README.md contains structured sections from the tree
    Given my tree has nodes of types "seed", "problem", "user_segment", "feature", "metric"
    When the client generates README.md
    Then it contains an "Executive Summary" section from the seed node's reasoning
    And a "Problems Solved" section listing each problem node with label and reasoning
    And a "Target Users" section listing each user_segment node
    And a "Key Features" section listing each feature and sub_feature node
    And a "Success Metrics" section listing each metric node
    And footer links to SPEC.md, DEBATE.md, and CLAUDE.md

  # --- SPEC.md generation ---
  Scenario: SPEC.md contains full product specification with node table
    Given my tree has 20 nodes including architecture, risk, and go_to_market types
    When the client generates SPEC.md
    Then it contains sections organized by type: "Problems & Pain Points", "Features", "Architecture & Technical Design", "Risks & Constraints", "Success Metrics"
    And each node shows its label, parent reference, and reasoning
    And a "Full Node Tree" section includes a markdown table with columns ID, Type, Label, Parent

  # --- Optional file toggles ---
  Scenario: Export without DEBATE.md when no debate rounds exist
    Given I have not run any debate rounds
    When I open the Export to GitHub modal
    Then the DEBATE.md checkbox is disabled and unchecked
    And README.md and SPEC.md checkboxes are checked and disabled (always included)
    And CLAUDE.md checkbox is checked by default
    When I click "EXPORT TO GITHUB"
    Then only README.md, SPEC.md, and CLAUDE.md are sent to the server

  # --- CLAUDE.md for Claude Code context ---
  Scenario: CLAUDE.md provides build context for Claude Code
    Given my tree has feature, architecture, risk, and metric nodes
    And I ran 2 rounds of debate with final verdict "YES"
    When the client generates CLAUDE.md
    Then it contains "What This Product Does" with the seed node details
    And "Features (Priority Order)" lists features in tree order
    And "Architecture & Technical Decisions" from architecture nodes
    And "Known Risks & Constraints" from risk nodes
    And "Critique Debate Summary" showing 2 rounds with verdict "CONSENSUS REACHED"
    And "Build Guidance" with numbered implementation steps

  # --- Token persistence ---
  Scenario: GitHub PAT is saved to localStorage for reuse
    Given I have no saved GitHub PAT
    When I enter PAT "ghp_abc123xyz" in the export modal
    And I complete the export successfully
    Then the PAT is saved to localStorage under key "ig_github_pat"
    And when I reopen the modal the PAT field is pre-filled

  # --- Error: invalid token ---
  Scenario: Export fails with invalid GitHub token
    Given I enter an expired or invalid GitHub PAT
    When I click "EXPORT TO GITHUB"
    Then the GitHub API returns HTTP 401
    And the server responds with error "Invalid GitHub token. Please check your Personal Access Token."
    And the modal shows the error with a "TRY AGAIN" button

  # --- Error: repository already exists ---
  Scenario: Export fails when repository name is taken
    Given I enter a repo name "idea-graph-my-project" that already exists under my GitHub account
    When I click "EXPORT TO GITHUB"
    Then the GitHub API returns HTTP 422
    And the server responds with error containing "already exists. Choose a different name."
    And the modal shows the error with a "TRY AGAIN" button

  # --- Repo name sanitization ---
  Scenario: Repository name is sanitized to valid GitHub format
    Given my tree is about "AI & ML: Next-Gen Platform!!!"
    When the modal auto-generates the repo name
    Then the name is slugified to lowercase with hyphens: "idea-graph-ai-ml-next-gen"
    And typing special characters in the repo name field replaces them with hyphens
    And only alphanumeric characters, hyphens, dots, and underscores are allowed
