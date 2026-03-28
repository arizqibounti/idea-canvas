# Gmail Integration — OAuth, thread search, context injection, email composition
# Domain: integrations

Feature: Gmail integration
  As a user I want to connect my Gmail account so that I can feed email threads into thinking modes as context

  Background:
    Given I am logged in
    And Gmail OAuth is configured with GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI

  # --- OAuth flow ---

  Scenario: Start Gmail OAuth connection flow
    Given I am not connected to Gmail
    When I POST to /api/integrations/gmail/connect
    Then I receive a response with an "authUrl" pointing to accounts.google.com
    And the authUrl includes scopes for gmail.readonly, gmail.send, gmail.compose, documents, and drive.file
    And a CSRF state parameter is stored server-side with a 10-minute expiry

  Scenario: Complete Gmail OAuth callback
    Given I initiated a Gmail OAuth flow and received a state token
    When Google redirects to /api/integrations/gmail/callback with a valid code and state
    Then the server exchanges the code for access and refresh tokens
    And the refresh token is persisted to integration config
    And the connected account email is fetched from the Gmail profile
    And the response is an HTML page that posts a "gmail-connected" message to the opener window

  Scenario: Reject OAuth callback with invalid state
    Given I have not initiated a Gmail OAuth flow
    When a request arrives at /api/integrations/gmail/callback with an unrecognized state parameter
    Then the server responds with a 400 error "Invalid state parameter"

  # --- Status and listing ---

  Scenario: Check Gmail integration status when connected
    Given I have connected Gmail as "user@example.com"
    When I GET /api/integrations/gmail/status
    Then the response shows configured: true, connected: true, and account: "user@example.com"

  Scenario: List all integrations includes Gmail
    When I GET /api/integrations
    Then the response includes an entry with id "gmail", name "Gmail", and its current connection status

  # --- Thread search and retrieval ---

  Scenario: Search Gmail threads by query
    Given I have connected Gmail as "user@example.com"
    When I GET /api/integrations/gmail/threads?q="project proposal"&maxResults=5
    Then I receive up to 5 thread summaries
    And each thread includes id, snippet, subject, from, date, and messageCount

  Scenario: Retrieve full thread with formatted context
    Given I have connected Gmail as "user@example.com"
    And there is a thread "thread_abc" with subject "Q3 Budget Review" containing 4 messages
    When I GET /api/integrations/gmail/thread/thread_abc?mode=idea
    Then I receive the full thread with all 4 messages including from, to, date, subject, and body
    And I receive a "formatted" string prefixed with "EMAIL CONTEXT -- Analyze this email thread and generate ideas:"
    And message bodies longer than 2000 characters are truncated with "... [truncated]"

  Scenario: Thread retrieval fails when not connected
    Given I have not connected Gmail
    When I GET /api/integrations/gmail/threads
    Then I receive a 401 response with error "Not connected to Gmail"

  # --- Context injection into generation ---

  Scenario: Email context is injected into tree generation
    Given I have connected Gmail and selected thread "thread_abc" with subject "Product Launch Plan"
    And I have an active session in "plan" mode
    When I trigger generation with the email thread attached
    Then the generation request includes the formatted email context
    And the context is prefixed with "EMAIL CONTEXT -- Incorporate this email thread into the planning process:"
    And the email context injection is wrapped in try/catch so failures never block generation

  # --- Email composition ---

  Scenario: Send an email via Gmail integration
    Given I have connected Gmail as "user@example.com"
    When I POST to /api/integrations/gmail/send with to: "recipient@example.com", subject: "Follow-up", body: "Thanks for the meeting"
    Then the email is sent via the Gmail API
    And I receive the message id and threadId in the response

  Scenario: Reply to an existing thread
    Given I have connected Gmail as "user@example.com"
    And there is a thread "thread_xyz" with a last message from "colleague@example.com"
    When I POST to /api/integrations/gmail/reply with threadId: "thread_xyz" and body: "Sounds good, let's proceed"
    Then the reply is sent to "colleague@example.com" with subject prefixed "Re:"
    And the reply includes In-Reply-To and References headers from the last message
    And the reply is appended to thread "thread_xyz"

  Scenario: Create a draft without sending
    Given I have connected Gmail as "user@example.com"
    When I POST to /api/integrations/gmail/draft with subject: "Draft proposal" and body: "Here is my initial draft..."
    Then a draft is created in Gmail
    And I receive the draftId and messageId in the response

  Scenario: Send email fails with missing required fields
    Given I have connected Gmail as "user@example.com"
    When I POST to /api/integrations/gmail/send with subject: "No recipient" and body: "test" but no "to" field
    Then I receive a 400 response with error "to, subject, and body are required"

  # --- Disconnect ---

  Scenario: Disconnect Gmail integration
    Given I have connected Gmail as "user@example.com"
    When I POST to /api/integrations/gmail/disconnect
    Then the server revokes the access token (best effort)
    And runtime tokens and email are cleared
    And the persisted refresh token and account are removed from config
    And subsequent thread requests return 401 "Not connected to Gmail"

  # --- Session restore ---

  Scenario: Restore Gmail session on server restart
    Given Gmail was previously connected and the refresh token is persisted in config
    When the server starts and initializes integrations
    Then the Gmail integration refreshes the access token using the persisted refresh token
    And the connected account email is restored from the Gmail profile
    And the integration status shows connected: true

  # --- Edge cases ---

  Scenario: Gmail not configured returns appropriate status
    Given GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set
    When I GET /api/integrations/gmail/status
    Then the response shows configured: false and connected: false

  Scenario: Mode-specific context formatting per thinking mode
    Given I have connected Gmail and retrieved thread "thread_abc"
    When I format the thread for "decide" mode
    Then the formatted output is prefixed with "EMAIL CONTEXT -- Use this email thread to inform the decision analysis:"
    When I format the thread for "write" mode
    Then the formatted output is prefixed with "EMAIL CONTEXT -- Reference this email thread for the writing task:"
    When I format the thread with no mode specified
    Then the formatted output uses the default template with thread subject and message bodies
