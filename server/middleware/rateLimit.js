// ── Rate Limiting Middleware ────────────────────────────────────
// In-memory token-bucket rate limiter per user UID.
// Two tiers: generation limit (plan-based) and general limit (all API).

const buckets = new Map();

// Plan-based generation limits
const PLAN_LIMITS = {
  free: { windowMs: 24 * 60 * 60 * 1000, max: 20 },
  pro:  { windowMs: 24 * 60 * 60 * 1000, max: 150 },
};

// Backward compat export
const GENERATION_LIMIT = PLAN_LIMITS.free;
// General: 60 requests per minute (all API calls)
const GENERAL_LIMIT = { windowMs: 60 * 1000, max: 60 };

function getGenerationLimitForUser(user) {
  return PLAN_LIMITS[user?.plan || 'free'] || PLAN_LIMITS.free;
}

function checkLimit(key, config) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > config.windowMs) {
    bucket = { windowStart: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  return {
    allowed: bucket.count <= config.max,
    remaining: Math.max(0, config.max - bucket.count),
    resetMs: config.windowMs - (now - bucket.windowStart),
  };
}

function getGenerationCount(userId, plan) {
  const limit = getGenerationLimitForUser({ plan });
  const key = `gen:${userId}`;
  const bucket = buckets.get(key);
  if (!bucket) return { used: 0, limit: limit.max };
  const now = Date.now();
  if (now - bucket.windowStart > limit.windowMs) {
    return { used: 0, limit: limit.max };
  }
  return { used: bucket.count, limit: limit.max };
}

/**
 * generationLimit — blocks if user exceeded daily generation quota.
 * Limit is based on user's plan (free: 20/day, pro: 150/day).
 */
function generationLimit(req, res, next) {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Auth required' });

  const limit = getGenerationLimitForUser(req.user);
  const key = `gen:${uid}`;
  const result = checkLimit(key, limit);
  if (!result.allowed) {
    return res.status(429).json({
      error: 'Daily generation limit reached',
      limit: limit.max,
      remaining: 0,
      resetMs: result.resetMs,
      plan: req.user.plan || 'free',
      upgradable: (req.user.plan || 'free') === 'free',
    });
  }

  res.setHeader('X-RateLimit-Limit', limit.max);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  next();
}

/**
 * generalLimit — blocks if user exceeded per-minute API rate.
 */
function generalLimit(req, res, next) {
  const key = `api:${req.user?.uid || req.ip}`;
  const result = checkLimit(key, GENERAL_LIMIT);
  if (!result.allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again shortly.' });
  }
  next();
}

// Cleanup stale buckets every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > 24 * 60 * 60 * 1000) buckets.delete(key);
  }
}, 60 * 60 * 1000);

module.exports = { generationLimit, generalLimit, getGenerationCount, getGenerationLimitForUser, GENERATION_LIMIT, PLAN_LIMITS };
