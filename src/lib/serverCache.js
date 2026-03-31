/**
 * serverCache.js
 *
 * MongoDB-backed server-side cache for expensive API calls (Google Ads, Bing, Meta).
 * Stored in tokensApi.serverCache — each document: { key, data, expiresAt, updatedAt }
 *
 * Works reliably on Vercel because it's shared across all serverless function instances
 * (unlike in-memory caches which are per-instance and ephemeral).
 *
 * One-time MongoDB setup (run once in Atlas / Compass):
 *   db.serverCache.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
 * This TTL index auto-deletes expired documents so the collection stays small.
 */

import dbConnect from "./mongoose";

const CACHE_DB         = "tokensApi";
const CACHE_COLLECTION = "serverCache";

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve a cached value.
 * Returns the stored data, or null if missing / expired.
 */
export async function getCached(key) {
  try {
    const client = await dbConnect();
    const doc    = await client.db(CACHE_DB).collection(CACHE_COLLECTION).findOne({ key });
    if (!doc) return null;

    // Guard against documents that slipped past the TTL index
    if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
      client.db(CACHE_DB).collection(CACHE_COLLECTION).deleteOne({ key }).catch(() => {});
      return null;
    }

    console.log(`[serverCache] HIT  ${key}`);
    return doc.data;
  } catch (e) {
    console.warn("[serverCache] getCached error:", e.message);
    return null;
  }
}

/**
 * Store a value in the cache.
 * @param {string} key
 * @param {*}      data      — must be JSON-serialisable
 * @param {number} ttlMs     — time-to-live in milliseconds (default 1 hour)
 */
export async function setCached(key, data, ttlMs = 60 * 60 * 1000) {
  try {
    const client    = await dbConnect();
    const expiresAt = new Date(Date.now() + ttlMs);
    await client.db(CACHE_DB).collection(CACHE_COLLECTION).updateOne(
      { key },
      { $set: { key, data, expiresAt, updatedAt: new Date() } },
      { upsert: true }
    );
    console.log(`[serverCache] SET  ${key}  (expires ${expiresAt.toISOString()})`);
  } catch (e) {
    console.warn("[serverCache] setCached error:", e.message);
    // Non-fatal — callers proceed even if caching fails
  }
}

/**
 * Delete all cache entries whose key starts with `prefix`.
 * Useful for manual cache busting (e.g. after updating client ad accounts).
 */
export async function invalidateCacheByPrefix(prefix) {
  try {
    const client = await dbConnect();
    const result = await client.db(CACHE_DB).collection(CACHE_COLLECTION)
      .deleteMany({ key: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` } });
    console.log(`[serverCache] INVALIDATED ${result.deletedCount} entries matching "${prefix}*"`);
    return result.deletedCount;
  } catch (e) {
    console.warn("[serverCache] invalidateCacheByPrefix error:", e.message);
    return 0;
  }
}

/**
 * Delete a single cache entry by exact key.
 */
export async function invalidateCache(key) {
  try {
    const client = await dbConnect();
    await client.db(CACHE_DB).collection(CACHE_COLLECTION).deleteOne({ key });
    console.log(`[serverCache] INVALIDATED "${key}"`);
  } catch (e) {
    console.warn("[serverCache] invalidateCache error:", e.message);
  }
}
