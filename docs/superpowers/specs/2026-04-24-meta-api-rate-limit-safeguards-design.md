# Meta API Rate Limit Safeguards Design

**Date:** 2026-04-24

## Goal

Prevent the app from hitting Meta's Business Use Case (BUC) rate limits by enforcing a per-account hourly call cap inside the central `graphGet()` helper, and eliminating redundant Meta calls by caching the audit route. When the limit is reached, users see a clear message with how long to wait.

## Background

- All Meta Graph API calls go through `src/lib/metaGraph.js` `graphGet()` — one enforcement point covers every current and future route.
- Meta's BUC rate limits are **per ad account per Business Use Case**. All Marketing API endpoints (insights, campaigns, ad sets, ads, previews) share one quota per account. Hitting the limit on one endpoint throttles all others for that account.
- The app uses a **system user token** — a single shared token across all dashboard users. Multiple users hitting the same account simultaneously all draw from the same quota pool.
- `ApiCallLog` (MongoDB, 7-day TTL) already records every `graphGet()` call with endpoint, status, durationMs, and timestamp. Adding `accountId` enables per-account counting.
- The audit route (`/api/meta/audit`) fires 8-10 Meta calls per load and has no caching — the highest-risk single endpoint.

## Rate Limit Numbers

Meta's BUC quota depends on the app's Marketing API access tier:
- **Development tier:** low quota (exact number not published, typically ~100-200 calls/hour/account)
- **Standard access:** higher quota, scales with usage
- **Advanced access:** highest quota

Default enforcement threshold: **150 calls/hour per account** (conservative, safe for development tier, adjustable in `Settings` collection without a deploy). Key: `meta_hourly_limit`.

## Architecture

### 1. `ApiCallLog` — add `accountId` field

Extract `accountId` from the path inside `graphGet()` using regex `/(act_\d+)/`. Paths already follow the pattern `act_123456789/campaigns`. For batch calls (empty path, uses `?ids=`), falls back to `'batch'`. Log the `accountId` alongside existing fields.

Existing documents without `accountId` are ignored by the per-account count query — no migration needed.

### 2. Per-account hourly count cache in `graphGet()`

Module-level `Map<accountId, { count: number, fetchedAt: number }>` with 30-second TTL.

Before every Meta call:
1. Extract `accountId` from path
2. Check cache — if entry exists and `Date.now() - fetchedAt < 30_000`, use cached count
3. If stale or missing: query `ApiCallLog` — `countDocuments({ accountId, timestamp: { $gte: oneHourAgo } })`
4. Store result in cache with current timestamp
5. Read `meta_hourly_limit` from `Settings` (cached separately for 60 seconds, defaults to 150)
6. If `count >= limit` → throw structured rate limit error (see below)
7. If allowed → proceed with Meta call, log with `accountId`

### 3. Structured rate limit error

```js
const err = new Error('Meta API rate limit reached for this account');
err.code = 'META_RATE_LIMIT';
err.waitMinutes = Math.ceil((60 * 60 * 1000 - (Date.now() - oldestCallTimestamp)) / 60_000);
err.status = 429;
throw err;
```

The `waitMinutes` is derived from the oldest call in the current window: when that call ages out of the 1-hour window, the count drops by 1 and calls resume. Routes surface this as:

```json
{ "error": "Meta API rate limit reached. Try again in X minutes.", "code": "META_RATE_LIMIT", "waitMinutes": X }
```

with HTTP 429.

### 4. `Settings` cache for the limit value

A second module-level cache in `graphGet()` stores the `meta_hourly_limit` value with a 60-second TTL. Avoids a Settings DB read on every call while still picking up admin changes within a minute.

### 5. Audit route caching

Add `apiCache` (10-minute TTL) to `/api/meta/audit/route.js`. Cache key: `meta-audit:${accountId}:${range}:${startDate||''}:${endDate||''}`.

- On cache hit: return cached JSON immediately, zero Meta calls
- On cache miss: run the full fetch, store result, return
- Pattern is identical to `/api/meta-ads/route.js` which already uses `apiCache`

## Files Changed

| Action | File | Change |
|--------|------|--------|
| Modify | `src/lib/apiCallLogger.js` | Accept and store `accountId` param in `logMetaCall()` |
| Modify | `src/lib/metaGraph.js` | Per-account count cache + limit check + structured error; pass `accountId` to `logMetaCall()` |
| Modify | `src/app/api/meta/audit/route.js` | Add `apiCache` with 10-min TTL |

## Error Propagation

Routes already propagate `graphGet()` errors to the client as JSON. The structured error fields (`code`, `waitMinutes`, `status: 429`) will surface automatically. No UI changes required — existing error display in the Meta dashboard and audit page already renders the `error` string.

## What This Does NOT Cover

- **Enforcement of Meta's actual quota number** — the 150/hour threshold is a conservative proxy; the real limit depends on the app's access tier and is not exposed by Meta's API. The threshold is intentionally set below the known floor to provide a safety buffer.
- **Per-user throttling** — not needed; the system user token is app-level and the per-account cap covers the actual risk.
- **Automatic backoff on Meta 429 responses** — if Meta does return a 429 despite the local cap (e.g. because the real limit is lower than 150), the error propagates as-is. Adding retry/backoff is a future enhancement.
