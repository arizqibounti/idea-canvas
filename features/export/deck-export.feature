# Domain: export
# Source: server/engine/export.js (exportDeck, runToolLoop, buildPptxBuffer)

Feature: AI-powered pitch deck export
  As a user I want to export my thinking tree as a PPTX pitch deck so that I can present my ideas professionally

  Background:
    Given I am logged in
    And I have an active session in "idea" mode
    And I have a generated tree with at least 5 nodes

  # --- Happy path ---
  Scenario: Export a thinking tree as a PPTX pitch deck
    Given my tree is about "AI-powered customer support platform"
    And the tree contains nodes of types "seed", "problem", "feature", "metric", "risk"
    When I trigger deck export via POST /api/export/deck with nodes and idea
    Then the server responds with SSE headers
    And Claude receives the tree serialized as text with tool definitions "add_slide" and "finish_export"
    And the tool loop produces between 8 and 15 slides
    And the final SSE event contains a base64-encoded PPTX file with format "pptx"
    And the filename is derived from the idea text with non-alphanumeric characters replaced by underscores
    And the stream ends with a [DONE] event

  # --- SSE streaming with progress ---
  Scenario: Deck export streams real-time progress via SSE
    Given my tree is about "Marketplace for vintage furniture"
    When I trigger deck export
    Then I receive a progress event with status "thinking" and detail containing "Claude is structuring content"
    And for each slide Claude adds I receive a progress event with type "slide_added" including slideIndex and title
    And I receive a progress event with status "rendering" when PPTX generation begins
    And I receive a progress event with status "complete" when the tool loop finishes
    And the stream ends with a [DONE] event

  # --- Slide structure and layout types ---
  Scenario: Generated deck follows the required slide structure
    Given my tree is about "B2B SaaS analytics dashboard"
    When the deck export completes successfully
    Then the first slide uses layout "title" with a compelling headline
    And at least one slide uses layout "section_break" to separate major themes
    And the final slide uses layout "closing" with a key takeaway
    And content slides have between 3 and 6 bullet points each
    And slides with speaker_notes have the notes attached via addNotes()

  # --- Chat action dispatch ---
  Scenario: Deck export is triggered via chat action
    Given I have a generated tree
    When the chat AI emits action {"exportDeck": true}
    Then the deck export workflow starts
    And the chat panel shows progress updates as slides are generated

  # --- PPTX styling ---
  Scenario: Generated PPTX uses dark theme with correct dimensions
    Given my tree is about "Mobile fitness app"
    When the deck export produces a PPTX file
    Then the presentation uses widescreen layout 13.33 x 7.5 inches
    And all slides have background fill color "0F0F1A"
    And title text uses white color "FFFFFF" with Arial font
    And section break slides use accent color "6C63FF"
    And content slides include a purple divider line below the title

  # --- Fallback when pptxgenjs is not installed ---
  Scenario: Deck export falls back to JSON when pptxgenjs is unavailable
    Given my tree is about "Recipe sharing platform"
    And the pptxgenjs library is not installed on the server
    When I trigger deck export
    Then the tool loop still generates slide data via Claude
    And the final SSE event contains format "json" with the raw slides array
    And the stream ends with a [DONE] event

  # --- Error: no nodes ---
  Scenario: Deck export rejects requests with no nodes
    When I send POST /api/export/deck with an empty nodes array
    Then the server responds with HTTP 400
    And the error message is "No nodes to export"
    And no Claude API call is made

  # --- Error: cancellation ---
  Scenario: Deck export handles cancellation gracefully
    Given my tree is about "Podcast hosting platform"
    When I trigger deck export and then abort the request mid-stream
    Then the tool loop stops at the next iteration check
    And I receive an SSE event with _error "Export cancelled"
    And the stream ends with a [DONE] event

  # --- Artifact tracking ---
  Scenario: Successful deck export records an artifact and updates session brief
    Given my tree is about "EdTech learning platform"
    And my session ID is "session_abc123"
    When the deck export completes with 10 slides
    Then an artifact of type "export_deck" is appended to the session
    And the artifact title contains "Pitch deck (10 slides)"
    And updateSessionBrief is called with action "export_deck" and slideCount 10
    And generateSessionSummary is called for the session
