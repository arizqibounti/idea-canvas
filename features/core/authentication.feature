Feature: Authentication
  As a system administrator I want to enforce Firebase authentication
  so that only authorized users can access the application

  # --- Local dev: auth disabled ---
  Scenario: Auth is disabled in local development by default
    Given ENABLE_AUTH is not set in the environment
    When a request is made to any /api/* route without a token
    Then the request is allowed through
    And req.user is set to {uid: "local", email: "local@dev", name: "Local Dev"}

  # --- Production: auth enabled ---
  Scenario: Authenticated request with valid Firebase token
    Given ENABLE_AUTH is "true"
    And Firebase Admin is initialized
    When a request includes header "Authorization: Bearer <valid-token>"
    And the token decodes to {uid: "user_123", email: "alice@example.com", name: "Alice"}
    Then verifyToken() returns the decoded user
    And the request proceeds with req.user containing uid, email, name
    And the user profile is enriched with plan, personalWorkspaceId, stripeCustomerId

  Scenario: Request rejected with missing token
    Given ENABLE_AUTH is "true"
    And Firebase Admin is initialized
    When a request is made without an Authorization header
    Then the server returns 401 with error "Authentication required"

  Scenario: Request rejected with invalid or expired token
    Given ENABLE_AUTH is "true"
    And Firebase Admin is initialized
    When a request includes header "Authorization: Bearer <invalid-token>"
    And verifyToken() returns null
    Then the server returns 401 with error "Invalid or expired token"

  # --- Email allowlist ---
  Scenario: Access granted when email is on the allowlist
    Given ENABLE_AUTH is "true"
    And ALLOWED_EMAILS is "alice@example.com,bob@corp.io"
    When a request authenticates as "alice@example.com"
    Then the request is allowed through

  Scenario: Access granted when email domain is on the domain allowlist
    Given ENABLE_AUTH is "true"
    And ALLOWED_DOMAINS is "corp.io,startup.com"
    When a request authenticates as "charlie@corp.io"
    Then the request is allowed through

  Scenario: Access denied when email is not on the allowlist
    Given ENABLE_AUTH is "true"
    And ALLOWED_EMAILS is "alice@example.com"
    And ALLOWED_DOMAINS is "corp.io"
    When a request authenticates as "mallory@evil.com"
    Then the server returns 403 with error "Access denied. Your email is not authorized to use this application."

  Scenario: No allowlist means all authenticated users are allowed
    Given ENABLE_AUTH is "true"
    And ALLOWED_EMAILS is empty
    And ALLOWED_DOMAINS is empty
    When a request authenticates as "anyone@anywhere.com"
    Then the request is allowed through

  # --- Optional auth middleware ---
  Scenario: optionalAuth attaches user when token is present
    Given ENABLE_AUTH is "true"
    When a request includes a valid Bearer token for "alice@example.com"
    And the route uses optionalAuth middleware
    Then req.user is set to the decoded user

  Scenario: optionalAuth allows request when no token is present
    Given ENABLE_AUTH is "true"
    When a request is made without an Authorization header
    And the route uses optionalAuth middleware
    Then req.user is null
    And the request proceeds normally

  Scenario: optionalAuth still enforces email allowlist
    Given ENABLE_AUTH is "true"
    And ALLOWED_EMAILS is "alice@example.com"
    When a request includes a valid Bearer token for "mallory@evil.com"
    And the route uses optionalAuth middleware
    Then the server returns 403 with error "Access denied. Your email is not authorized to use this application."

  # --- Profile caching ---
  Scenario: User profile is cached for 60 seconds
    Given ENABLE_AUTH is "true"
    And user "user_123" has been authenticated once
    When a second request arrives for "user_123" within 60 seconds
    Then the profile is served from cache without calling getOrCreateUser()
    And the cached profile includes plan, personalWorkspaceId, stripeCustomerId
