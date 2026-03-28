# Billing — Stripe subscriptions, plan tiers, usage tracking, rate limiting
# Domain: billing

Feature: Subscription management and usage limits
  As a user I want to manage my subscription plan so that I can access higher generation limits

  Background:
    Given I am logged in
    And Stripe is configured with STRIPE_SECRET_KEY

  # --- Plan tiers and limits ---

  Scenario: Free plan user has 20 generations per day
    Given I am on the "free" plan
    When I check my usage via GET /api/usage
    Then I see my daily generation limit is 20
    And I see my current generation count for today

  Scenario: Pro plan user has 150 generations per day
    Given I am on the "pro" plan
    When I check my usage via GET /api/usage
    Then I see my daily generation limit is 150

  # --- Rate limiting ---

  Scenario: Free plan user hits daily generation limit
    Given I am on the "free" plan
    And I have already used 20 generations today
    When I POST to /api/generate with a new idea
    Then I receive a 429 response with error "Daily generation limit reached"
    And the response includes limit: 20, remaining: 0, plan: "free", and upgradable: true
    And the response includes resetMs indicating when the limit resets

  Scenario: Pro plan user hits daily generation limit
    Given I am on the "pro" plan
    And I have already used 150 generations today
    When I POST to /api/generate with a new idea
    Then I receive a 429 response with error "Daily generation limit reached"
    And the response includes limit: 150, remaining: 0, plan: "pro", and upgradable: false

  Scenario: Rate limit headers are included on successful generation requests
    Given I am on the "free" plan
    And I have used 5 generations today
    When I POST to /api/generate with a new idea
    Then the response includes header X-RateLimit-Limit: 20
    And the response includes header X-RateLimit-Remaining: 14

  Scenario: General API rate limit enforces 60 requests per minute
    Given I have made 60 API requests in the last minute
    When I make another API request
    Then I receive a 429 response with error "Rate limit exceeded. Try again shortly."

  Scenario: Rate limits are bypassed in dev mode
    Given the server is running with NODE_ENV != "production"
    When I POST to /api/generate
    Then the generation limit middleware is skipped
    And the request proceeds regardless of usage count

  # --- Usage tracking ---

  Scenario: Generation count increments on each generation
    Given I am on the "free" plan with 0 generations today
    When I successfully complete a generation via /api/generate
    Then my generationsToday increments to 1
    And my totalGenerations increments by 1

  Scenario: Daily generation count resets at midnight
    Given I used 15 generations yesterday
    When I check my usage today (a new calendar day in UTC)
    Then my generationsToday is 0
    And my totalGenerations retains the cumulative count from all previous days

  # --- Stripe checkout ---

  Scenario: Create a Stripe checkout session for Pro upgrade
    Given I am on the "free" plan
    When I POST to /api/billing/checkout
    Then the server creates or retrieves my Stripe customer using my email and uid
    And a Stripe Checkout session is created in "subscription" mode with the STRIPE_PRO_PRICE_ID
    And the success_url points to /settings?billing=success
    And the cancel_url points to /settings?billing=cancelled
    And I receive the checkout session URL to redirect to

  Scenario: Checkout reuses existing Stripe customer
    Given I am on the "free" plan
    And I already have a stripeCustomerId on my user record
    When I POST to /api/billing/checkout
    Then the server uses my existing stripeCustomerId instead of creating a new customer

  # --- Stripe portal ---

  Scenario: Access Stripe customer portal to manage subscription
    Given I am on the "pro" plan with an active Stripe subscription
    When I POST to /api/billing/portal
    Then the server creates a Stripe Customer Portal session
    And I receive a portal URL where I can cancel, update payment, or view invoices
    And the return_url points back to /settings

  # --- Billing status ---

  Scenario: Check billing status for a Pro subscriber
    Given I am on the "pro" plan with an active Stripe subscription
    When I GET /api/billing/status
    Then the response includes plan: "pro" and configured: true
    And the subscription object includes id, status: "active", currentPeriodEnd, and cancelAtPeriodEnd

  Scenario: Check billing status for a free user with no subscription
    Given I am on the "free" plan with no Stripe customer
    When I GET /api/billing/status
    Then the response includes plan: "free", configured: true, and subscription: null

  Scenario: Check billing status when Stripe is not configured
    Given STRIPE_SECRET_KEY is not set
    When I GET /api/billing/status
    Then the response includes plan: "free", configured: false, and subscription: null

  # --- Webhook handling ---

  Scenario: Webhook upgrades user to Pro on successful checkout
    When Stripe sends a "checkout.session.completed" webhook event
    And the session metadata contains uid: "user_123" and workspaceId: "ws_456"
    Then the server verifies the webhook signature using STRIPE_WEBHOOK_SECRET
    And user "user_123" plan is set to "pro"
    And workspace "ws_456" plan is updated to "pro"

  Scenario: Webhook downgrades user to Free on subscription deletion
    When Stripe sends a "customer.subscription.deleted" webhook event
    And the subscription metadata contains uid: "user_123"
    Then user "user_123" plan is set to "free"

  Scenario: Webhook maintains Pro on subscription update with active status
    When Stripe sends a "customer.subscription.updated" webhook event
    And the subscription status is "active" and metadata uid is "user_123"
    Then user "user_123" plan remains "pro"

  Scenario: Webhook logs payment failure without changing plan
    When Stripe sends an "invoice.payment_failed" webhook event for customer "cus_abc"
    Then the server logs the payment failure
    And the user plan is not changed

  Scenario: Webhook rejects invalid signature
    When a request arrives at /api/stripe/webhook with an invalid stripe-signature header
    Then the server responds with a 400 error
    And no plan changes are made

  # --- Generation limit applies to all AI endpoints ---

  Scenario: Generation limit applies across all AI-powered endpoints
    Given I am on the "free" plan and have used 20 generations today
    When I POST to any of these endpoints:
      | endpoint                  |
      | /api/generate             |
      | /api/drill                |
      | /api/fractal-expand       |
      | /api/debate/critique      |
      | /api/refine/strengthen    |
      | /api/portfolio/generate   |
      | /api/analyze-github       |
      | /api/prototype/build      |
    Then each request receives a 429 response with "Daily generation limit reached"
