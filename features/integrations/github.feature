# GitHub Integration — OAuth, repo access, codebase analysis in code mode
# Domain: integrations

Feature: GitHub integration
  As a user I want to connect my GitHub account so that I can analyze private repos and inject codebase context into code mode

  Background:
    Given I am logged in
    And GitHub OAuth is configured with GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET

  # --- OAuth flow ---

  Scenario: Start GitHub OAuth connection flow
    Given I am not connected to GitHub
    When I POST to /api/integrations/github/connect
    Then I receive a response with an "authUrl" pointing to github.com/login/oauth/authorize
    And the authUrl includes scope "repo read:user"
    And the redirect_uri is dynamically resolved from the request origin
    And a CSRF state parameter is stored server-side

  Scenario: Complete GitHub OAuth callback
    Given I initiated a GitHub OAuth flow
    When GitHub redirects to /api/integrations/github/callback with a valid code
    Then the server exchanges the code for an access token via github.com/login/oauth/access_token
    And the server fetches the authenticated user profile from api.github.com/user
    And the access token and username are persisted to integration config
    And the response is an HTML page that posts a "github-connected" message with the username to the opener window

  Scenario: OAuth callback with invalid code
    Given I initiated a GitHub OAuth flow
    When GitHub redirects to /api/integrations/github/callback with an invalid code
    Then the server responds with a 400 error page showing the GitHub error description

  # --- Status ---

  Scenario: Check GitHub integration status when connected
    Given I have connected GitHub as "@octocat"
    When I GET /api/integrations/github/status
    Then the response shows configured: true, connected: true, and account: "octocat"

  Scenario: GitHub not configured shows appropriate status
    Given GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are not set
    When I GET /api/integrations/github/status
    Then the response shows configured: false and connected: false

  # --- Repo listing ---

  Scenario: List authenticated user repos
    Given I have connected GitHub as "@octocat"
    When I GET /api/integrations/github/repos
    Then I receive up to 20 repos sorted by last updated
    And each repo includes name, url, description, private flag, language, and updatedAt

  Scenario: Search repos by query
    Given I have connected GitHub as "@octocat"
    When I GET /api/integrations/github/repos?q=thoughtclaw&maxResults=5
    Then I receive up to 5 repos matching "thoughtclaw" scoped to the authenticated user
    And results are sorted by relevance

  Scenario: Repo listing fails when not connected
    Given I have not connected GitHub
    When I GET /api/integrations/github/repos
    Then I receive a 401 response with error "Not connected to GitHub"

  # --- Codebase analysis (SSE streaming) ---

  Scenario: Analyze a public GitHub repo via URL
    Given I have an active session in "code" mode
    When I POST to /api/analyze-github with repoUrl: "https://github.com/expressjs/express"
    Then the server responds with SSE headers
    And I receive progress events: "Connecting to GitHub...", "Fetching file tree...", "Fetched N/M files"
    And the server fetches the repo tree, filters out node_modules, .git, images, and lock files
    And high-value files (package.json, routes/, models/) are fetched first
    And the server streams codebase analysis nodes via SSE using gemini:pro
    And the stream ends with a [DONE] event

  Scenario: Analyze a private repo using OAuth token
    Given I have connected GitHub as "@octocat"
    And "@octocat" has access to private repo "octocat/secret-project"
    When I POST to /api/analyze-github with repoUrl: "https://github.com/octocat/secret-project"
    Then the server uses the GitHub OAuth token for authenticated API requests
    And private repo files are fetched and analyzed successfully

  Scenario: Analysis handles repo not found
    When I POST to /api/analyze-github with repoUrl: "https://github.com/nonexistent/repo"
    Then I receive an SSE error event with message "Repository nonexistent/repo not found"
    And the stream ends with a [DONE] event

  Scenario: Analysis handles GitHub API rate limit
    Given I am not connected to GitHub (unauthenticated requests)
    And the GitHub API rate limit is exceeded
    When I POST to /api/analyze-github with repoUrl: "https://github.com/large-org/large-repo"
    Then I receive an SSE error event with message "GitHub API rate limit exceeded"

  Scenario: Analysis respects file size and count limits
    Given there is a repo with 500 code files totaling 2MB
    When I POST to /api/analyze-github with that repoUrl
    Then the server fetches at most 300 files
    And total fetched content does not exceed 400KB
    And individual files are truncated at 8000 characters
    And files are fetched in batches of 20 to respect rate limits

  Scenario: Analysis falls back from main to master branch
    Given there is a repo that uses "master" as its default branch
    When I POST to /api/analyze-github with repoUrl pointing to that repo and branch: "main"
    Then the server tries "main" first, gets a 404, and falls back to "master"
    And analysis proceeds using the "master" branch

  # --- Disconnect ---

  Scenario: Disconnect GitHub integration
    Given I have connected GitHub as "@octocat"
    When I POST to /api/integrations/github/disconnect
    Then the runtime token and username are cleared
    And the persisted access token is removed from config
    And subsequent repo listing requests return 401

  # --- Session restore ---

  Scenario: Restore GitHub session on server restart
    Given GitHub was previously connected and the access token is persisted in config
    When the server starts and initializes integrations
    Then the GitHub integration restores the token and username from config
    And the integration status shows connected: true and account matches the stored username
