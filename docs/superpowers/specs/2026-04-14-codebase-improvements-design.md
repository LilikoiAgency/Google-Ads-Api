# Codebase Improvements Design
**Date:** 2026-04-14  
**Branch:** feature/seo-audit  
**Author:** Frank Hernandez

---

## Overview

This spec covers four groups of improvements to the Google Ads Dashboard (Lik) codebase. TypeScript migration is explicitly deferred. All changes target the `feature/seo-audit` branch and are structured as a sequence of independent, verifiable commits.

---

## Group A — SEO Audit Fixes

### 1. Daily Limit Enforcement

**File:** `src/app/api/seo-audit/analyze/route.js`

The constant `DAILY_LIMIT = 5` is defined but never checked before invoking Claude. Fix: query the count of today's audits for the requesting user *before* calling the Anthropic SDK. If the count meets or exceeds the limit, return `429` with `{ error: "Daily audit limit reached", requestId }`.

### 2. Force Re-audit Param

**File:** `src/app/api/seo-audit/analyze/route.js`

Add `force=true` as an optional query param. When present, skip the same-day cache lookup and always run a fresh Claude analysis. The result upserts today's MongoDB entry (matched by user + domain + date), replacing the cached analysis in place. This allows users to re-audit after fixing issues without waiting until midnight.

### 3. Crawl Page Depth Cap

**File:** `src/lib/seoCrawler.js`

Add a `MAX_PAGES = 50` constant. After page discovery (nav links + sitemap), truncate the crawl queue to 50 URLs before beginning fetches. Log a warning when truncation occurs so it's visible in Vercel logs.

### 4. In-Memory Rate Limiter

**File:** `src/app/api/seo-audit/analyze/route.js`

Add a module-level `Map` keyed by user email storing the last request timestamp. Reject requests arriving within 30 seconds of the previous one for the same user with `429`. This is sufficient at current scale — no Redis needed. The map resets on Lambda cold start, which is acceptable.

---

## Group B + C — API Quality (Split + Validation)

### 5. Split Monolithic Google Ads Route

**Current:** `src/app/api/route.js` (~900 lines, handles all resource types)

**Target structure:**
```
src/app/api/googleads/
  campaigns/route.js
  ads/route.js
  audiences/route.js
  metrics/route.js
```

Each file handles one resource type. The existing query parameter shapes are preserved, but the URL structure changes from `/api` to `/api/googleads/campaigns` etc., which requires updating the corresponding `fetch()` calls in dashboard components.

**Migration approach:** Move code resource-by-resource, keeping the old route alive until all consumers are updated, then delete it.

### 6. Zod Input Validation

**Install:** `zod`

Each new `googleads/*/route.js` and each `seo-audit/*/route.js` gets a Zod schema for its request inputs (query params + body). Invalid requests return `400` with `{ error: <zod message>, requestId }`. This replaces ad-hoc manual checks.

### 7. Standardized Response Shape

All API routes return one of:
```json
{ "data": <payload>, "requestId": "<uuid>" }
{ "error": "<message>", "requestId": "<uuid>" }
```

`requestId` is generated with `crypto.randomUUID()` at route entry. Every `console.error` in the handler includes the `requestId`.

---

## Group D — Infrastructure

### 8. MongoDB Cold-Start Guard

**File:** `src/lib/mongoose.js`

Current code caches the connection in a module-level variable but has a race window where two concurrent cold starts both find `conn === null` and both attempt `mongoose.connect()`. Fix: cache a `connecting` Promise alongside `conn`. If `conn` is null but `connecting` is set, `await` the in-flight promise instead of starting a new connection.

```js
let conn = null;
let connecting = null;

export async function connectDB() {
  if (conn) return conn;
  if (connecting) return connecting;
  connecting = mongoose.connect(process.env.MONGODB_URI).then(m => {
    conn = m;
    connecting = null;
    return m;
  });
  return connecting;
}
```

### 9. Vercel Cron Idempotency

**File:** Audience Lab sync API route handlers (the routes referenced by cron entries in `vercel.json`)

Each cron handler checks a `lastRun` document in MongoDB at the start of execution. If `lastRun` is within the last 8 minutes, the handler exits early with `200`. After successful completion, it upserts `lastRun` with the current timestamp. This prevents overlapping executions if Vercel fires a job while a previous one is still running.

---

## Group E — Tests (Vitest)

### 10. Test Framework Setup

**Install:** `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `msw`, `@vitejs/plugin-react`

**Config:** `vitest.config.js` at root, with `jsdom` environment for component tests and `node` environment for API route/utility tests.

**Test location:** `src/__tests__/` with subdirectories matching `src/` structure.

### 11. Test Coverage Targets

Focus on the critical path — not exhaustive UI coverage:

| Test | File | What it verifies |
|------|------|-----------------|
| Daily limit enforced | `seo-audit/analyze.test.js` | Returns 429 when count >= 5 |
| Force param bypasses cache | `seo-audit/analyze.test.js` | Cache skipped when `force=true` |
| Crawl depth cap | `seoCrawler.test.js` | >50 URLs truncated to 50 |
| Rate limiter | `seo-audit/ratelimit.test.js` | Second request within 30s rejected |
| Zod schemas | `googleads/schemas.test.js` | Invalid params return 400 |
| Mongoose guard | `mongoose.test.js` | Concurrent calls don't double-connect |
| Cron idempotency | `cron.test.js` | Handler skips if lastRun < 8 min ago |

---

## Delivery Order

Commits in this order to keep the branch bisectable:

1. Group D: MongoDB cold-start guard
2. Group D: Cron idempotency
3. Group A: Crawl depth cap + rate limiter + daily limit + force param
4. Group B+C: Split monolith + Zod schemas + standardized responses
5. Group E: Vitest setup + all tests

---

## Out of Scope

- TypeScript migration (deferred, separate initiative)
- Playwright/headless browser for crawler (deferred, separate initiative)
- Redis-based rate limiting (overkill at current scale)
- Frontend component test coverage beyond the critical path
