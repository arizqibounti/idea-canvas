// ── Stripe Billing Manager ────────────────────────────────────
// Handles Stripe checkout, portal, and webhook event processing.
// Only active when STRIPE_SECRET_KEY is configured.

const users = require('./users');
const workspaces = require('./workspaces');

let stripe = null;

function initStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.log('Stripe not configured (set STRIPE_SECRET_KEY to enable billing)');
    return;
  }
  try {
    const Stripe = require('stripe');
    stripe = new Stripe(key);
    console.log('Stripe initialized');
  } catch (err) {
    console.log('Stripe SDK not available:', err.message);
  }
}

initStripe();

function isConfigured() {
  return !!stripe;
}

/**
 * Create or retrieve Stripe customer for a user.
 */
async function ensureStripeCustomer(user) {
  if (!stripe) throw new Error('Stripe not configured');

  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { uid: user.uid },
  });

  await users.setStripeCustomerId(user.uid, customer.id);
  return customer.id;
}

/**
 * Create a Stripe Checkout session for Pro subscription.
 */
async function createCheckoutSession(user, workspaceId) {
  if (!stripe) throw new Error('Stripe not configured');

  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) throw new Error('STRIPE_PRO_PRICE_ID not configured');

  const customerId = await ensureStripeCustomer(user);
  const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || 'https://thoughtclaw.com/settings';

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${returnUrl}?billing=success`,
    cancel_url: `${returnUrl}?billing=cancelled`,
    metadata: {
      uid: user.uid,
      workspaceId: workspaceId || user.personalWorkspaceId,
    },
  });

  return { url: session.url, sessionId: session.id };
}

/**
 * Create a Stripe Customer Portal session.
 */
async function createPortalSession(user) {
  if (!stripe) throw new Error('Stripe not configured');

  const customerId = await ensureStripeCustomer(user);
  const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || 'https://thoughtclaw.com/settings';

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return { url: session.url };
}

/**
 * Get the current billing status for a user.
 */
async function getBillingStatus(user) {
  if (!stripe || !user.stripeCustomerId) {
    return { plan: user.plan || 'free', subscription: null, configured: !!stripe };
  }

  try {
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'all',
      limit: 1,
    });

    const sub = subs.data[0] || null;
    return {
      plan: user.plan || 'free',
      configured: true,
      subscription: sub ? {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      } : null,
    };
  } catch {
    return { plan: user.plan || 'free', subscription: null, configured: true };
  }
}

/**
 * Handle Stripe webhook events.
 */
async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const uid = session.metadata?.uid;
      const workspaceId = session.metadata?.workspaceId;
      if (uid) {
        await users.setPlan(uid, 'pro');
        if (workspaceId) await workspaces.updateWorkspace(workspaceId, { plan: 'pro' });
        console.log(`[Stripe] User ${uid} upgraded to pro`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = sub.customer;
      // Find user by stripeCustomerId — search in Firestore or iterate memory
      const uid = sub.metadata?.uid;
      if (uid) {
        await users.setPlan(uid, 'free');
        console.log(`[Stripe] User ${uid} downgraded to free`);
      } else {
        console.log(`[Stripe] Subscription deleted for customer ${customerId} — uid not in metadata`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`[Stripe] Payment failed for customer ${invoice.customer}`);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const uid = sub.metadata?.uid;
      if (uid && (sub.status === 'active' || sub.status === 'trialing')) {
        await users.setPlan(uid, 'pro');
      }
      break;
    }

    default:
      // Unhandled event type
      break;
  }
}

/**
 * Construct a webhook event from raw body + signature.
 */
function constructWebhookEvent(rawBody, signature) {
  if (!stripe) throw new Error('Stripe not configured');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

module.exports = {
  isConfigured,
  ensureStripeCustomer,
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
  handleWebhookEvent,
  constructWebhookEvent,
};
