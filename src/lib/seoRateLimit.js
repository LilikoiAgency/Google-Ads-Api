// src/lib/seoRateLimit.js
const RATE_LIMIT_WINDOW_MS = 30_000;

// Module-level map — resets on Lambda cold start (acceptable at this scale)
const rateLimitMap = new Map();

/**
 * Checks if a user is rate-limited. Updates the map if allowed.
 * @param {string} email
 * @param {Map} [map] - optional map override for testing
 * @returns {{ limited: boolean, retryAfterSeconds: number }}
 */
export function checkRateLimit(email, map = rateLimitMap) {
  const now = Date.now();
  const last = map.get(email) ?? 0;
  const elapsed = now - last;

  if (elapsed < RATE_LIMIT_WINDOW_MS) {
    return {
      limited: true,
      retryAfterSeconds: Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000),
    };
  }

  map.set(email, now);
  return { limited: false, retryAfterSeconds: 0 };
}

/** Clears the map — for use in tests only */
export function resetRateLimitMap() {
  rateLimitMap.clear();
}
