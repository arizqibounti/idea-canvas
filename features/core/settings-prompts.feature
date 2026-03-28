# Domain: core
# Capability: Prompt management in Settings page

Feature: Settings — Prompts Tab
  As a power user I want to view and edit the AI system prompts
  so that I can customize ThoughtClaw's behavior

  Background:
    Given I am logged in
    And I navigate to the Settings page

  Scenario: View list of seeded prompts
    Given the prompt store has been seeded from legacy
    When I click the "Prompts" tab
    Then I see a list of prompts in the sidebar
    And each prompt shows its key and category
    And the filter input is visible

  Scenario: Select and edit a prompt
    Given the prompt store has prompts loaded
    When I click a prompt in the sidebar
    Then the editor panel shows the prompt text
    And I can modify the text and save

  Scenario: Filter prompts by keyword
    Given the prompt store has prompts loaded
    When I type "debate" in the "Filter prompts..." input
    Then only prompts matching "debate" are shown in the sidebar

  Scenario: Revert a prompt to original
    Given I have edited prompt "SYSTEM_MAIN"
    When I click the revert button for "SYSTEM_MAIN"
    Then the prompt text reverts to the original legacy value

  @bug
  # Bug: Prompts tab shows empty in production — needs seed or auto-load (2026-03-28)
  Scenario: Prompts tab loads with seeded data or shows seed button
    When I click the "Prompts" tab
    Then either the sidebar lists available prompts
    Or the "Seed from legacy" button is visible and functional

  @bug
  # Bug: Clicking "Seed from legacy" should populate prompts and refresh list (2026-03-28)
  Scenario: Seed from legacy populates all system prompts
    Given the prompt list is empty
    When I click "Seed from legacy"
    Then the button shows "Seeding..." while in progress
    And after seeding completes the sidebar lists 50+ prompts
    And no error is shown
