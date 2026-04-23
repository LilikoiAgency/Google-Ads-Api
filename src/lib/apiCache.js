// src/lib/apiCache.js
// Shared MongoDB-backed API response cache with in-process L1.
// Survives hot-reloads, cold starts, and is shared across serverless instances.
//
// Usage:
//   const cached = await apiCache.get(key);
//   if (cached) return NextResponse.json(cached);
//   const result = await expensiveFetch();
//   await apiCache.set(key, result, ttlMs);
//   return NextResponse.json(result);

import dbConnect from './mongoose';

const DB = 'tokensApi';
const COLLECTION = 'ApiCache';

// L1: in-process Map — zero-latency hits within a warm serverless instance
const l1 = new Map(); // key → { value, expiresAt }
const L1_MAX = 200;

function l1Get(key) {
  const hit = l1.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) { l1.delete(key); return null; }
  return hit.value;
}

function l1Set(key, value, ttlMs) {
  if (l1.size >= L1_MAX) {
    const first = l1.keys().next().value;
    if (first !== undefined) l1.delete(first);
  }
  l1.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function getDb() {
  const client = await dbConnect();
  return client.db(DB).collection(COLLECTION);
}

export const apiCache = {
  async get(key) {
    // L1
    const fast = l1Get(key);
    if (fast !== null) return fast;

    // L2 MongoDB
    try {
      const col = await getDb();
      const doc = await col.findOne({ _id: key });
      if (!doc) return null;
      if (doc.expiresAt < new Date()) {
        col.deleteOne({ _id: key }).catch(() => {});
        return null;
      }
      l1Set(key, doc.value, doc.expiresAt - Date.now());
      return doc.value;
    } catch {
      return null; // cache miss on DB error — fall through to live fetch
    }
  },

  async set(key, value, ttlMs) {
    l1Set(key, value, ttlMs);
    try {
      const col = await getDb();
      const expiresAt = new Date(Date.now() + ttlMs);
      await col.updateOne(
        { _id: key },
        { $set: { value, expiresAt, cachedAt: new Date() } },
        { upsert: true },
      );
    } catch {
      // non-fatal — response is already returned from L1
    }
  },

  // Fire-and-forget set (doesn't block the response)
  setBackground(key, value, ttlMs) {
    this.set(key, value, ttlMs).catch(() => {});
  },
};
