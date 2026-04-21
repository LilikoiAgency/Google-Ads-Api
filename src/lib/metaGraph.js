// src/lib/metaGraph.js
// Shared Meta Graph API helpers. Used by /api/meta-ads and any route that
// proxies Meta's Graph endpoints. Keep this the ONLY place that knows the
// API version and token layout.

import { getCredentials } from './dbFunctions';

export const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Resolves the Meta access token from Mongo credentials.
 * Throws if no token is configured.
 */
export async function getMetaAccessToken() {
  const creds = await getCredentials();
  const token = creds?.meta_access_token;
  if (!token) throw new Error('meta_access_token not configured in credentials');
  return token;
}

/**
 * Thin wrapper around the Meta Graph REST API. Handles URL building and
 * error unwrapping. Objects are JSON-encoded as query params (Meta expects
 * this for fields like `time_range`).
 */
export async function graphGet(path, params, token) {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.searchParams.set('access_token', token);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v == null) return;
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const res = await fetch(url.toString(), { cache: 'no-store' });
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || `Meta API error on /${path}`);
    err.status = res.status;
    err.code = json.error.code;
    err.subcode = json.error.error_subcode;
    throw err;
  }
  return json;
}

/**
 * Resolves a preset range label ("7d", "28d", "mtd", "3m", "6m", "custom")
 * to Meta's {since, until} shape. `custom` requires startDate + endDate.
 */
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
