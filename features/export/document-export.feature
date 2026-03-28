# Domain: export
# Source: server/engine/export.js (exportDocument, exportToGoogleDoc, generateAndExportToGoogleDoc)

Feature: Document export (Markdown and Google Docs)
  As a user I want to export my thinking tree as a structured document so that I can share or archive my analysis

  Background:
    Given I am logged in
    And I have an active session in "idea" mode
    And I have a generated tree with at least 5 nodes

  # --- Happy path: Markdown ---
  Scenario: Export a thinking tree as a Markdown document
    Given my tree is about "Supply chain optimization platform"
    When I send POST /api/export/document with nodes, idea, and format "md"
    Then the server responds with SSE headers
    And Claude receives the tree with tool definitions "add_section" and "finish_export"
    And the tool loop produces multiple sections with headings at levels 1, 2, and 3
    And the final SSE event contains a base64-encoded markdown file with format "md"
    And the filename ends with ".md"
    And the stream ends with a [DONE] event

  # --- SSE streaming with section progress ---
  Scenario: Document export streams section-by-section progress
    Given my tree is about "Healthcare appointment scheduler"
    When I trigger document export
    Then I receive a progress event with status "thinking" for each Claude iteration
    And for each section Claude adds I receive a progress event with type "section_added" including sectionIndex, heading, and level
    And I receive a progress event with status "rendering" when markdown generation begins
    And the stream ends with a [DONE] event

  # --- Section structure ---
  Scenario: Generated document has proper heading hierarchy
    Given my tree is about "Real estate investment analyzer"
    When the document export completes successfully
    Then the markdown contains level 1 headings prefixed with "# " for major sections
    And level 2 headings are prefixed with "## " for subsections
    And level 3 headings are prefixed with "### " for sub-subsections
    And sections with bullets are rendered as markdown list items prefixed with "- "
    And each section has a body text paragraph

  # --- Chat action dispatch ---
  Scenario: Document export is triggered via chat action
    Given I have a generated tree
    When the chat AI emits action {"exportDoc": true}
    Then the document export workflow starts
    And the chat panel shows progress updates as sections are generated

  # --- Google Docs export ---
  Scenario: Export to Google Docs creates a formatted document
    Given my tree is about "Event management platform"
    And I have connected Gmail with Google Docs OAuth scopes
    When I send POST /api/export/google-doc with nodes and idea
    Then a blank Google Doc is created with title containing the idea and current date
    And sections are inserted with correct heading styles HEADING_1, HEADING_2, HEADING_3
    And body text is inserted with NORMAL_TEXT paragraph style
    And bullet lists use the BULLET_DISC_CIRCLE_SQUARE preset
    And the response contains the docId and a docUrl pointing to docs.google.com

  # --- Google Docs: OAuth not connected ---
  Scenario: Google Docs export fails when Gmail is not connected
    Given I have not connected my Gmail account
    When I send POST /api/export/google-doc with nodes and idea
    Then the server responds with HTTP 500
    And the error message is "Gmail/Google not connected -- sign in with Google first"

  # --- Google Docs: insufficient scopes ---
  Scenario: Google Docs export fails when document scope is missing
    Given I have connected Gmail but without document access scopes
    When I send POST /api/export/google-doc with nodes and idea
    Then the server responds with HTTP 500
    And the error message contains "Google Docs permission not granted"
    And the message advises disconnecting and reconnecting Gmail

  # --- Error: no sections generated ---
  Scenario: Document export handles empty generation gracefully
    Given my tree is about "Test idea"
    And the Claude tool loop produces zero sections
    When the document export SSE stream completes
    Then I receive an SSE event with _error "No sections were generated"
    And the stream ends with a [DONE] event
    And no file is returned

  # --- Artifact tracking ---
  Scenario: Successful document export records an artifact
    Given my tree is about "Fintech budgeting app"
    And my session ID is "session_doc456"
    When the document export completes with 6 sections in format "md"
    Then an artifact of type "export_doc" is appended to the session
    And the artifact summary mentions "6-section md"
    And updateSessionBrief is called with action "export_doc", sectionCount 6, and format "md"
