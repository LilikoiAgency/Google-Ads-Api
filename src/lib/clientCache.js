// src/lib/clientCache.js
// Module-level cache that lives for the lifetime of the browser tab.
// Persists across React navigation (component mount/unmount) but clears on refresh.
// Use this to avoid re-fetching data the user already loaded this session.

const cache = new Map(); // key → { value, expiresAt }

export const clientCache = {
  get(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) { cache.delete(key); return null; }
    return hit.value;
  },
  set(key, value, ttlMs = 10 * 60 * 1000) {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  },
  delete(key) {
    cache.delete(key);
  },
};
