Feature: Share link generation and access
  As a user I want to share my thinking trees via links so that others can view or interact with my work

  Background:
    Given I am logged in
    And I have a generated tree "Market Entry Strategy" with 8 nodes in "idea" mode

  # --- Happy path: snapshot sharing ---

  Scenario: Create a share link with interactive permission
    When I open the Share Modal
    And I select "Interactive" permission
    And I set expiration to "7 days"
    And I click "Generate Share Link"
    Then the modal shows a "Creating share link..." spinner
    And a POST request is sent to /api/shares with:
      | field          | value     |
      | permission     | interact  |
      | expiresInHours | 168       |
    And I receive a share URL in the format "/share/{11-char-id}"
    And the modal displays the URL with a "Copy" button
    And the share metadata shows "Permission: Interactive" and "Expires: 7 days"

  Scenario: Create a view-only share link
    When I open the Share Modal
    And I select "View only" permission
    And I set expiration to "Never expires"
    And I click "Generate Share Link"
    Then the share is created with permission "view" and expiresAt null
    And the recipient can pan, zoom, and inspect nodes
    But the recipient cannot modify the tree

  Scenario: Create a share link with 1-hour expiration
    When I create a share with expiresInHours set to 1
    Then the share document has an expiresAt timestamp 1 hour in the future
    And the viewCount is initialized to 0

  Scenario: Copy share URL to clipboard
    Given I have generated a share link
    When I click the "Copy" button
    Then the URL is copied to the clipboard
    And the button text changes to "Copied" for 2 seconds
    And then reverts to "Copy"

  # --- Viewing shared sessions ---

  Scenario: View a shared tree via share link
    Given a share exists with id "aBcDeFgHiJk" and permission "interact"
    When a visitor navigates to /share/aBcDeFgHiJk
    Then the share is loaded via GET /api/shares/aBcDeFgHiJk
    And the viewCount is incremented by 1
    And the visitor sees the tree with all 8 nodes rendered on the canvas

  Scenario: View an expired share link
    Given a share exists with id "xYz12345678" that expired 2 hours ago
    When a visitor navigates to /share/xYz12345678
    Then the share is loaded with the "expired" flag set to true
    And the visitor sees an expiration notice

  Scenario: View a non-existent share link
    When a visitor navigates to /share/doesNotExist
    Then the API returns null for the share
    And the visitor sees a "Share not found" error

  # --- Share node count info ---

  Scenario: Share modal displays node count
    Given I have a tree with 12 nodes
    When I open the Share Modal
    Then I see an info line reading "12 nodes will be included in the snapshot"

  Scenario: Share modal blocks creation with no nodes
    Given I have no generated tree
    When I open the Share Modal
    And I click "Generate Share Link"
    Then no POST request is sent to /api/shares
    And the button does nothing

  # --- Share deletion ---

  Scenario: Delete a share link
    Given I created a share with id "myShare12345"
    When I delete the share via DELETE /api/shares/myShare12345
    Then the share is removed from the store
    And navigating to /share/myShare12345 returns null

  # --- Error handling ---

  Scenario: Share creation fails due to server error
    Given the server returns an HTTP 500 error on POST /api/shares
    When I click "Generate Share Link"
    Then the modal shows the error stage with the error message
    And a "Try Again" button is displayed
    When I click "Try Again"
    Then the modal resets to the configuration stage

  # --- Live collaboration from share modal ---

  Scenario: Start a live collaboration session from the Share Modal
    When I open the Share Modal
    And I click "Start live session"
    Then a new room ID is generated with the "tc_" prefix and 12 alphanumeric characters
    And I am navigated to /room/{roomId}
    And real-time collaboration is enabled via Y.js
