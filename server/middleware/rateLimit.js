// ── Rate Limiting Middleware ────────────────────────────────────
// In-memory token-bucket rate limiter per user UID.
// Two tiers: generation limit (expensive AI calls) and general limit (all API).

const buckets = new Map();

// Generation: 20 trees per day (expensive Claude Opus calls)
const GENERATION_LIMIT = { windowMs: 24 * 60 * 60 * 1000, max: 20 };
// General: 60 requests per minute (all API calls)
const GENERAL_LIMIT = { windowMs: 60 * 1000, max: 60 };

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

function getGenerationCount(userId) {
  const key = `gen:${userId}`;
  const bucket = buckets.get(key);
  if (!bucket) return { used: 0, limit: GENERATION_LIMIT.max };
  const now = Date.now();
  if (now - bucket.windowStart > GENERATION_LIMIT.windowMs) {
    return { used: 0, limit: GENERATION_LIMIT.max };
  }
  return { used: bucket.count, limit: GENERATION_LIMIT.max };
}

/**
 * generationLimit — blocks if user exceeded daily generation quota.
 * Apply to expensive routes: /api/generate, /api/generate-multi, etc.
 */
function generationLimit(req, res, next) {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Auth required' });

  const key = `gen:${uid}`;
  const result = checkLimit(key, GENERATION_LIMIT);
  if (!result.allowed) {
    return res.status(429).json({
      error: 'Daily generation limit reached',
      limit: GENERATION_LIMIT.max,
      remaining: 0,
      resetMs: result.resetMs,
    });
  }

  // Attach usage info to response headers
  res.setHeader('X-RateLimit-Limit', GENERATION_LIMIT.max);
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

module.exports = { generationLimit, generalLimit, getGenerationCount, GENERATION_LIMIT };
