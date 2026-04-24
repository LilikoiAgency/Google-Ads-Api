// src/lib/metaGraph.js
// Shared Meta Graph API helpers. Used by /api/meta-ads and any route that
// proxies Meta's Graph endpoints. Keep this the ONLY place that knows the
// API version and token layout.

import { getCredentials } from './dbFunctions';
import { logMetaCall } from './apiCallLogger';
import dbConnect from './mongoose';

export const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

// ── Per-account hourly call count cache (30-second TTL) ──────────────────────
// Map<accountId, { count: number, fetchedAt: number }>
const countCache = new Map();

// ── Settings cache for hourly limit value (60-second TTL) ────────────────────
let limitCache = { value: null, fetchedAt: 0 };

function extractAccountId(path) {
  const match = path && path.match(/act_(\d+)/);
  return match ? `act_${match[1]}` : 'batch';
}

async function getHourlyLimit() {
  const now = Date.now();
  if (limitCache.value !== null && now - limitCache.fetchedAt < 60_000) {
    return limitCache.value;
  }
  try {
    const client = await dbConnect();
    const doc = await client.db('tokensApi').collection('Settings').findOne({ key: 'meta_hourly_limit' });
    const value = doc?.value ?? 150;
    limitCache = { value, fetchedAt: now };
    return value;
  } catch {
    return limitCache.value ?? 150;
  }
}

async function checkAccountRateLimit(accountId) {
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);

  const cached = countCache.get(accountId);
  let count;
  if (cached && now - cached.fetchedAt < 30_000) {
    count = cached.count;
  } else {
    const client = await dbConnect();
    const col = client.db('tokensApi').collection('ApiCallLog');
    count = await col.countDocuments({ accountId, timestamp: { $gte: oneHourAgo } });
    countCache.set(accountId, { count, fetchedAt: now });
  }

  const limit = await getHourlyLimit();
  if (count >= limit) {
    const client = await dbConnect();
    const col = client.db('tokensApi').collection('ApiCallLog');
    const oldest = await col.findOne(
      { accountId, timestamp: { $gte: oneHourAgo } },
      { sort: { timestamp: 1 }, projection: { timestamp: 1 } },
    );
    const oldestTs = oldest?.timestamp?.getTime() ?? (now - 60 * 60 * 1000);
    const waitMinutes = Math.max(1, Math.ceil((60 * 60 * 1000 - (now - oldestTs)) / 60_000));

    const err = new Error('Meta API rate limit reached for this account');
    err.code = 'META_RATE_LIMIT';
    err.waitMinutes = waitMinutes;
    err.status = 429;
    throw err;
  }
}

export async function getMetaAccessToken() {
  const creds = await getCredentials();
  const token = creds?.meta_access_token;
  if (!token) throw new Error('meta_access_token not configured in credentials');
  return token;
}

export async function graphGet(path, params, token) {
  const accountId = extractAccountId(path);
  await checkAccountRateLimit(accountId);

  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.searchParams.set('access_token', token);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v == null) return;
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const t0 = Date.now();
  const res = await fetch(url.toString(), { cache: 'no-store' });
  const json = await res.json();
  logMetaCall(path || '/', res.status, Date.now() - t0, accountId).catch(() => {});
  if (json.error) {
    const err = new Error(json.error.message || `Meta API error on /${path}`);
    err.status = res.status;
    err.code = json.error.code;
    err.subcode = json.error.error_subcode;
    throw err;
  }
  return json;
}

export function getTimeRange(range, startDate, endDate) {
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const ago = (days) => fmt(new Date(today.getTime() - days * 86400000));
  switch ((range || '28d').toLowerCase()) {
    case '7d':  return { since: ago(7),   until: fmt(today) };
    case '28d': return { since: ago(28),  until: fmt(today) };
    case '3m':  return { since: ago(90),  until: fmt(today) };
    case '6m':  return { since: ago(180), until: fmt(today) };
    case 'mtd': {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      return { since: fmt(s), until: fmt(today) };
    }
    case 'custom':
      if (startDate && endDate) return { since: startDate, until: endDate };
      return { since: ago(28), until: fmt(today) };
    default:
      return { since: ago(28), until: fmt(today) };
  }
}
