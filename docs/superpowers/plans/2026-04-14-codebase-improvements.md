# Codebase Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve reliability, maintainability, and safety of the Google Ads Dashboard across SEO audit, API quality, infrastructure, and test coverage.

**Architecture:** Group D (infrastructure) lands first since other tasks depend on a stable DB connection. Group A (SEO audit fixes) is next — isolated to the seo-audit feature. Group B+C (split + validation) refactors the Google Ads monolith. Tests are written alongside each task (TDD).

**Tech Stack:** Next.js 14 App Router, MongoDB (MongoClient), Vitest + React Testing Library + msw, Zod, Anthropic SDK

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/lib/mongoose.js` | Add production connection caching |
| Modify | `src/app/api/audience-lab/sync/route.js` | Add lastRun idempotency guard |
| Modify | `src/app/api/seo-audit/analyze/route.js` | Fix daily limit, add rate limiter, fix forceRerun upsert |
| Modify | `src/lib/seoCrawler.js` | Confirm crawl cap + add explicit log |
| Create | `src/lib/googleAdsHelpers.js` | Pure helper functions extracted from monolith |
| Create | `src/lib/googleAdsCustomer.js` | Per-customer query and response formatting |
| Create | `src/app/api/googleads/route.js` | Thin route handler with Zod + requestId |
| Delete | `src/app/api/route.js` | Replaced by googleads/route.js |
| Modify | `src/app/dashboard/google/ads/page.js` | Update fetch URL from `/api` to `/api/googleads` |
| Modify | `src/app/api/seo-audit/crawl/route.js` | Add Zod + requestId |
| Modify | `src/app/api/seo-audit/analyze/route.js` | Add Zod + requestId (same task as above) |
| Create | `vitest.config.js` | Vitest configuration |
| Create | `src/__tests__/lib/mongoose.test.js` | Connection caching tests |
| Create | `src/__tests__/lib/seoCrawler.test.js` | Crawl depth cap tests |
| Create | `src/__tests__/api/seo-audit/analyze.test.js` | Daily limit + rate limiter + forceRerun tests |
| Create | `src/__tests__/lib/googleAdsHelpers.test.js` | Helper function tests |
| Create | `src/__tests__/api/googleads/route.test.js` | Zod validation tests |
| Create | `src/__tests__/api/cron.test.js` | Cron idempotency tests |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Vitest and testing libraries**

```bash
npm install --save-dev vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @vitejs/plugin-react msw
```

- [ ] **Step 2: Install Zod**

```bash
npm install zod
```

- [ ] **Step 3: Add test script to package.json**

Open `package.json` and update the `scripts` block to:
```json
"scripts": {
  "dev": "node -e \"const{rmSync}=require('fs');try{rmSync('.next',{recursive:true,force:true})}catch(e){}\" && next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "clean": "node -e \"const{rmSync}=require('fs');try{rmSync('.next',{recursive:true,force:true})}catch(e){}\"",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

- [ ] **Step 4: Verify install succeeded**

```bash
npm ls vitest zod msw
```
Expected: versions printed with no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest, zod, msw, and testing libraries"
```

---

## Task 2: Configure Vitest

**Files:**
- Create: `vitest.config.js`

- [ ] **Step 1: Create vitest.config.js at repo root**

```js
// vitest.config.js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['src/__tests__/components/**', 'jsdom'],
    ],
    setupFiles: ['src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/app/api/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 2: Create test setup file**

Create `src/__tests__/setup.js`:
```js
import '@testing-library/jest-dom';
```

- [ ] **Step 3: Create test directory structure**

```bash
mkdir -p src/__tests__/lib src/__tests__/api/seo-audit src/__tests__/api/googleads
```

- [ ] **Step 4: Run vitest to confirm config loads**

```bash
npm test
```
Expected: `No test files found` or zero tests run — no errors about config.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js src/__tests__/setup.js
git commit -m "chore: configure vitest with jsdom for components and node for API tests"
```

---

## Task 3: Fix MongoDB Production Connection Caching

**Files:**
- Modify: `src/lib/mongoose.js`
- Create: `src/__tests__/lib/mongoose.test.js`

**Background:** The current production branch of `mongoose.js` calls `new MongoClient(uri)` and `client.connect()` at module-load time with no global cache. In development it correctly uses `global._mongoClientPromise` to avoid HMR creating duplicate connections — but production doesn't. Applying the same global pattern to production prevents connection pool exhaustion when the module is re-evaluated.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/mongoose.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock mongodb before importing the module under test
const mockConnect = vi.fn().mockResolvedValue('mock-client');
const MockMongoClient = vi.fn(() => ({ connect: mockConnect }));

vi.mock('mongodb', () => ({
  MongoClient: MockMongoClient,
}));

describe('dbConnect', () => {
  beforeEach(() => {
    // Clear the cached promise between tests by deleting the global
    delete global._mongoClientPromise;
    vi.resetModules();
    MockMongoClient.mockClear();
    mockConnect.mockClear();
  });

  it('returns the same promise on repeated calls without creating a second client', async () => {
    // Re-import the module fresh so module-level code runs with clean global
    const { default: dbConnect } = await import('@/lib/mongoose.js');

    const p1 = dbConnect();
    const p2 = dbConnect();

    expect(MockMongoClient).toHaveBeenCalledTimes(1);
    expect(await p1).toBe(await p2);
  });

  it('reuses the cached global promise across module reloads', async () => {
    const { default: dbConnect } = await import('@/lib/mongoose.js');
    await dbConnect();

    vi.resetModules(); // simulate module reload
    const { default: dbConnect2 } = await import('@/lib/mongoose.js');
    await dbConnect2();

    // MongoClient should only have been constructed once across both loads
    expect(MockMongoClient).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npm test -- mongoose
```
Expected: FAIL — `MockMongoClient` called twice (current code doesn't cache in production).

- [ ] **Step 3: Rewrite mongoose.js with unified global caching**

Replace the entire contents of `src/lib/mongoose.js` with:
```js
// src/lib/mongoose.js
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;

if (!global._mongoClientPromise) {
  const client = new MongoClient(uri);
  global._mongoClientPromise = client.connect();
}

const clientPromise = global._mongoClientPromise;

export default async function dbConnect() {
  return clientPromise;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npm test -- mongoose
```
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mongoose.js src/__tests__/lib/mongoose.test.js
git commit -m "fix: cache MongoDB connection globally in all environments to prevent cold-start pool exhaustion"
```

---

## Task 4: Add Cron Idempotency Guard

**Files:**
- Modify: `src/app/api/audience-lab/sync/route.js`
- Create: `src/__tests__/api/cron.test.js`

**Background:** Vercel fires up to 20 cron jobs in a 3-hour window. If a sync job runs longer than its interval, jobs can overlap. Add a `lastRun` check in MongoDB at the start of the handler — if a run completed within the last 8 minutes, exit early.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/api/cron.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';

// Extracted helper to test in isolation
import { shouldSkipCronRun } from '@/lib/cronGuard.js';

describe('shouldSkipCronRun', () => {
  it('returns true when lastRun was less than 8 minutes ago', () => {
    const lastRun = new Date(Date.now() - 4 * 60 * 1000); // 4 min ago
    expect(shouldSkipCronRun(lastRun)).toBe(true);
  });

  it('returns false when lastRun was more than 8 minutes ago', () => {
    const lastRun = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    expect(shouldSkipCronRun(lastRun)).toBe(false);
  });

  it('returns false when lastRun is null', () => {
    expect(shouldSkipCronRun(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npm test -- cron
```
Expected: FAIL — module `@/lib/cronGuard.js` not found.

- [ ] **Step 3: Create src/lib/cronGuard.js**

```js
// src/lib/cronGuard.js
const IDEMPOTENCY_WINDOW_MS = 8 * 60 * 1000; // 8 minutes

/**
 * Returns true if a cron job should be skipped because one ran recently.
 * @param {Date|null} lastRun - The timestamp of the last successful run.
 */
export function shouldSkipCronRun(lastRun) {
  if (!lastRun) return false;
  return Date.now() - new Date(lastRun).getTime() < IDEMPOTENCY_WINDOW_MS;
}

/**
 * Reads the lastRun timestamp for a named cron job from MongoDB.
 * @param {object} db - MongoDB Db instance
 * @param {string} jobName
 * @returns {Promise<Date|null>}
 */
export async function getCronLastRun(db, jobName) {
  const doc = await db.collection('CronLocks').findOne({ jobName });
  return doc?.lastRun ?? null;
}

/**
 * Upserts the lastRun timestamp after a successful cron run.
 * @param {object} db - MongoDB Db instance
 * @param {string} jobName
 */
export async function setCronLastRun(db, jobName) {
  await db.collection('CronLocks').updateOne(
    { jobName },
    { $set: { lastRun: new Date(), jobName } },
    { upsert: true }
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npm test -- cron
```
Expected: PASS — all three tests green.

- [ ] **Step 5: Add idempotency guard to the sync route**

Open `src/app/api/audience-lab/sync/route.js`. Find the exported `GET` function (it starts around line 1 of the handler logic). Add these imports at the top of the file alongside existing imports:

```js
import { shouldSkipCronRun, getCronLastRun, setCronLastRun } from '../../../../lib/cronGuard.js';
import dbConnect from '../../../../lib/mongoose.js';
```

Then at the very start of the `GET` handler body, before any sync logic begins, add:

```js
// ── Cron idempotency guard ────────────────────────────────────────────
const mongoClient = await dbConnect();
const guardDb = mongoClient.db('tokensApi');
const jobName = `audience-lab-sync-slot-${slot}`;
const lastRun = await getCronLastRun(guardDb, jobName);
if (shouldSkipCronRun(lastRun)) {
  return new Response(
    JSON.stringify({ skipped: true, reason: 'ran recently', lastRun }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
```

And at the end of the handler, just before the final success `return`, add:

```js
await setCronLastRun(guardDb, jobName);
```

- [ ] **Step 6: Verify the sync route still imports correctly**

```bash
npm run build 2>&1 | head -40
```
Expected: Build completes with no module-not-found errors for the sync route.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cronGuard.js src/app/api/audience-lab/sync/route.js src/__tests__/api/cron.test.js
git commit -m "feat: add cron idempotency guard to audience-lab sync to prevent overlapping executions"
```

---

## Task 5: Fix Daily Limit Bug + Add Rate Limiter

**Files:**
- Modify: `src/app/api/seo-audit/analyze/route.js`
- Create: `src/__tests__/api/seo-audit/analyze.test.js`

**Background:**
1. `checkAndIncrementUsage` increments the counter atomically and returns the before-value. It increments even when the user is over-limit. Fix: check first (read-only), return 429 without incrementing if over limit, then increment after check passes.
2. No per-request rate limiter exists. Add a 30s in-memory Map keyed by email.
3. `forceRerun` currently calls `insertOne`, creating duplicate records. Fix to upsert today's entry.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/api/seo-audit/analyze.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Test the rate limiter helper in isolation ────────────────────────────────
import { checkRateLimit, resetRateLimitMap } from '@/lib/seoRateLimit.js';

describe('checkRateLimit', () => {
  beforeEach(() => resetRateLimitMap());

  it('allows the first request from a user', () => {
    const result = checkRateLimit('user@test.com');
    expect(result.limited).toBe(false);
  });

  it('blocks a second request within 30 seconds', () => {
    checkRateLimit('user@test.com'); // first call
    const result = checkRateLimit('user@test.com'); // immediate second call
    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('allows a second request after 30 seconds have passed', () => {
    const map = new Map();
    map.set('user@test.com', Date.now() - 31_000); // 31s ago
    // Use the map-based overload for testing
    const result = checkRateLimit('user@test.com', map);
    expect(result.limited).toBe(false);
  });

  it('tracks users independently', () => {
    checkRateLimit('alice@test.com');
    const result = checkRateLimit('bob@test.com');
    expect(result.limited).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npm test -- analyze
```
Expected: FAIL — `@/lib/seoRateLimit.js` not found.

- [ ] **Step 3: Create src/lib/seoRateLimit.js**

```js
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm test -- analyze
```
Expected: PASS — all four tests green.

- [ ] **Step 5: Update analyze/route.js — fix daily limit + wire rate limiter + fix forceRerun upsert**

Open `src/app/api/seo-audit/analyze/route.js`. Apply these three changes:

**5a — Add import at top of file (after existing imports):**
```js
import { checkRateLimit } from '../../../../lib/seoRateLimit.js';
```

**5b — Replace the `checkAndIncrementUsage` function and its call:**

Remove the existing `checkAndIncrementUsage` function (lines 14–26) and replace with:
```js
async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.seoAuditCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { seoAuditCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true }
  );
}
```

**5c — Replace the rate-limit block (currently around line 82–91) with:**
```js
// ── Rate limit: per-request 30s window ──────────────────────────────────
const { limited, retryAfterSeconds } = checkRateLimit(email);
if (limited) {
  return NextResponse.json(
    { error: `Too many requests — wait ${retryAfterSeconds}s before retrying.` },
    { status: 429 }
  );
}

// ── Daily limit: check before calling Claude (admins exempt) ────────────
const isAdmin = ADMIN_EMAILS.includes(email);
const usedToday = await getDailyUsageCount(db, email);
if (!isAdmin && usedToday >= DAILY_LIMIT) {
  return NextResponse.json(
    { error: `Daily limit reached — you've used all ${DAILY_LIMIT} SEO audits for today. Resets at midnight.` },
    { status: 429 }
  );
}
await incrementDailyUsage(db, email);
```

**5d — Fix forceRerun to upsert instead of insertOne:**

Replace the save block (the `insertOne` call, around lines 181–196) with:
```js
let auditId = null;
try {
  const auditDoc = {
    email,
    domain,
    auditType: crawlData.audit_type || 'full',
    scores: {
      seo: audit.audit_summary?.scores?.seo?.score ?? null,
      geo: audit.audit_summary?.scores?.geo?.score ?? null,
      aeo: audit.audit_summary?.scores?.aeo?.score ?? null,
      combined: audit.audit_summary?.scores?.combined?.score ?? null,
    },
    pagesCrawled: crawlData.pages_crawled?.length || 0,
    crawlData,
    auditResult: audit,
    createdAt: new Date(),
  };

  if (forceRerun) {
    // Upsert: replace today's record if it exists, otherwise insert
    const result = await db.collection(COLLECTION).findOneAndReplace(
      { domain, email, createdAt: { $gte: todayStart } },
      auditDoc,
      { upsert: true, returnDocument: 'after' }
    );
    auditId = result?._id?.toString() ?? null;
  } else {
    const insertResult = await db.collection(COLLECTION).insertOne(auditDoc);
    auditId = insertResult.insertedId.toString();
  }
} catch (saveErr) {
  console.error('[seo-audit/analyze] Failed to save audit:', saveErr.message);
}
```

- [ ] **Step 6: Run all seo-audit tests**

```bash
npm test -- analyze
```
Expected: PASS — all tests green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/seoRateLimit.js src/app/api/seo-audit/analyze/route.js src/__tests__/api/seo-audit/analyze.test.js
git commit -m "fix: enforce daily audit limit before Claude call, add 30s rate limiter, fix forceRerun to upsert"
```

---

## Task 6: Confirm and Document Crawl Depth Cap

**Files:**
- Modify: `src/lib/seoCrawler.js`
- Create: `src/__tests__/lib/seoCrawler.test.js`

**Background:** `seoCrawler.js` already has `MAX_PAGES_FULL = 25`. Per the spec, cap at 50. Update the constant and add an explicit log warning when truncation occurs so it's visible in Vercel logs.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/seoCrawler.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { prioritizePages } from '@/lib/seoCrawler.js';

// Export note: prioritizePages is currently unexported. Step 3 exports it.

describe('prioritizePages', () => {
  it('caps output at maxPages', () => {
    const urls = Array.from({ length: 100 }, (_, i) => `https://example.com/page-${i}`);
    const result = prioritizePages(urls, 'example.com', 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('returns all URLs when count is under the cap', () => {
    const urls = ['https://example.com/', 'https://example.com/about'];
    const result = prioritizePages(urls, 'example.com', 50);
    expect(result.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- seoCrawler
```
Expected: FAIL — `prioritizePages` is not exported.

- [ ] **Step 3: Update seoCrawler.js**

In `src/lib/seoCrawler.js`:

**3a — Change `MAX_PAGES_FULL` from 25 to 50:**
```js
const MAX_PAGES_FULL = 50;
```

**3b — Export `prioritizePages` (add `export` keyword to the function declaration):**
```js
export function prioritizePages(urls, domain, maxPages) {
```

**3c — Add a log warning in `crawlSite` after the `prioritizePages` call when truncation occurs:**

Find the block in `crawlSite` that calls `prioritizePages`:
```js
pagesToCrawl = prioritizePages(discovery.urls, domain, maxPages);
```
Replace with:
```js
pagesToCrawl = prioritizePages(discovery.urls, domain, maxPages);
if (discovery.urls.length > maxPages) {
  console.warn(
    `[seoCrawler] Discovered ${discovery.urls.length} pages for ${domain} — truncated to ${maxPages}`
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm test -- seoCrawler
```
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seoCrawler.js src/__tests__/lib/seoCrawler.test.js
git commit -m "fix: increase crawl page cap to 50 and log truncation warning"
```

---

## Task 7: Extract Google Ads Helper Functions

**Files:**
- Create: `src/lib/googleAdsHelpers.js`
- Create: `src/__tests__/lib/googleAdsHelpers.test.js`

**Background:** The ~900-line `src/app/api/route.js` contains pure helper functions that have no dependency on the request context. Extract them to a testable module first.

- [ ] **Step 1: Write tests for the helpers**

Create `src/__tests__/lib/googleAdsHelpers.test.js`:
```js
import { describe, it, expect } from 'vitest';
import {
  isValidDateLiteral,
  buildDateFilter,
  getCampaignStatusCondition,
  normalizeLandingPageUrl,
  sortPerformanceRows,
} from '@/lib/googleAdsHelpers.js';

describe('isValidDateLiteral', () => {
  it('accepts YYYY-MM-DD', () => expect(isValidDateLiteral('2026-01-15')).toBe(true));
  it('rejects non-date strings', () => expect(isValidDateLiteral('yesterday')).toBe(false));
  it('rejects empty string', () => expect(isValidDateLiteral('')).toBe(false));
});

describe('buildDateFilter', () => {
  it('throws on CUSTOM with invalid dates', () => {
    expect(() => buildDateFilter('CUSTOM', 'bad', 'bad')).toThrow('Invalid custom date range');
  });

  it('throws on CUSTOM when start > end', () => {
    expect(() => buildDateFilter('CUSTOM', '2026-02-01', '2026-01-01')).toThrow();
  });

  it('returns a dateFilter SQL fragment and dateWindow for LAST_7_DAYS', () => {
    const { dateFilter, dateWindow } = buildDateFilter('LAST_7_DAYS');
    expect(dateFilter).toContain('segments.date BETWEEN');
    expect(dateWindow).toHaveProperty('startDate');
    expect(dateWindow).toHaveProperty('endDate');
  });
});

describe('getCampaignStatusCondition', () => {
  it('returns ENABLED + SERVING for ACTIVE', () => {
    expect(getCampaignStatusCondition('ACTIVE')).toContain("campaign.status = 'ENABLED'");
  });

  it('returns PAUSED/REMOVED for INACTIVE', () => {
    expect(getCampaignStatusCondition('INACTIVE')).toContain('PAUSED');
  });
});

describe('normalizeLandingPageUrl', () => {
  it('strips query string and hash', () => {
    expect(normalizeLandingPageUrl('https://ex.com/page?foo=1#bar')).toBe('https://ex.com/page');
  });

  it('returns null for falsy input', () => {
    expect(normalizeLandingPageUrl(null)).toBeNull();
  });
});

describe('sortPerformanceRows', () => {
  it('sorts by conversions descending', () => {
    const rows = [{ conversions: 2 }, { conversions: 5 }, { conversions: 1 }];
    const sorted = [...rows].sort(sortPerformanceRows);
    expect(sorted[0].conversions).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npm test -- googleAdsHelpers
```
Expected: FAIL — `@/lib/googleAdsHelpers.js` not found.

- [ ] **Step 3: Create src/lib/googleAdsHelpers.js**

Create the file by copying the helper functions out of `src/app/api/route.js`:

```js
// src/lib/googleAdsHelpers.js

export const ALLOWED_DATE_RANGES = new Set([
  'LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH', 'CUSTOM',
]);

export const ALLOWED_CAMPAIGN_STATUS_FILTERS = new Set([
  'ACTIVE', 'INACTIVE', 'ALL',
]);

export const USER_LIST_TYPE = {
  0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'REMARKETING', 3: 'LOGICAL',
  4: 'EXTERNAL_REMARKETING', 5: 'RULE_BASED', 6: 'SIMILAR', 7: 'CRM_BASED',
};

export const JOB_STATUS = {
  0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'PENDING', 3: 'RUNNING',
  4: 'SUCCESS', 5: 'FAILED',
};

export function formatDateLiteral(date) {
  return date.toISOString().slice(0, 10);
}

export function isValidDateLiteral(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function getDateWindow(dateRange) {
  const endDate = new Date();
  const startDate = new Date(endDate);
  switch (dateRange) {
    case 'LAST_7_DAYS':   startDate.setDate(endDate.getDate() - 6); break;
    case 'LAST_30_DAYS':  startDate.setDate(endDate.getDate() - 29); break;
    case 'LAST_90_DAYS':  startDate.setDate(endDate.getDate() - 89); break;
    case 'THIS_MONTH':    startDate.setDate(1); break;
    default:              startDate.setDate(endDate.getDate() - 6);
  }
  return { startDate: formatDateLiteral(startDate), endDate: formatDateLiteral(endDate) };
}

export function buildDateFilter(dateRange, customStartDate, customEndDate) {
  let dateWindow;
  if (dateRange === 'CUSTOM') {
    if (!isValidDateLiteral(customStartDate) || !isValidDateLiteral(customEndDate)) {
      throw new Error('Invalid custom date range');
    }
    if (customStartDate > customEndDate) {
      throw new Error('Custom start date must be on or before the end date');
    }
    dateWindow = { startDate: customStartDate, endDate: customEndDate };
  } else {
    dateWindow = getDateWindow(dateRange);
  }
  const { startDate, endDate } = dateWindow;
  return {
    dateFilter: `segments.date BETWEEN '${startDate}' AND '${endDate}'`,
    dateWindow,
  };
}

export function getCampaignStatusCondition(statusFilter, { includeServingStatus = true } = {}) {
  switch (statusFilter) {
    case 'INACTIVE': return "campaign.status IN ('PAUSED', 'REMOVED')";
    case 'ALL':      return 'campaign.id IS NOT NULL';
    case 'ACTIVE':
    default:
      return includeServingStatus
        ? "campaign.status = 'ENABLED' AND campaign.serving_status = 'SERVING'"
        : "campaign.status = 'ENABLED'";
  }
}

export function normalizeLandingPageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    url.search = '';
    url.hash = '';
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return String(value).trim() || null;
  }
}

export function sortPerformanceRows(a, b) {
  if ((b.conversions || 0) !== (a.conversions || 0)) return (b.conversions || 0) - (a.conversions || 0);
  if ((b.clicks || 0) !== (a.clicks || 0)) return (b.clicks || 0) - (a.clicks || 0);
  return (b.impressions || 0) - (a.impressions || 0);
}

export function sortDeviceRows(a, b) {
  if ((b.conversions || 0) !== (a.conversions || 0)) return (b.conversions || 0) - (a.conversions || 0);
  if ((b.clicks || 0) !== (a.clicks || 0)) return (b.clicks || 0) - (a.clicks || 0);
  return (b.cost || 0) - (a.cost || 0);
}

export function mapUserListType(v) {
  return typeof v === 'number' ? USER_LIST_TYPE[v] || String(v) : v;
}

export function mapJobStatus(v) {
  return typeof v === 'number' ? JOB_STATUS[v] || String(v) : v;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm test -- googleAdsHelpers
```
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/googleAdsHelpers.js src/__tests__/lib/googleAdsHelpers.test.js
git commit -m "refactor: extract Google Ads date/filter/sort helpers to googleAdsHelpers.js"
```

---

## Task 8: Extract Per-Customer Query Logic

**Files:**
- Create: `src/lib/googleAdsCustomer.js`

**Background:** The bulk of `api/route.js` is a large async function inside the `Promise.all` that fetches and formats data per customer account. Extract it so `route.js` becomes a thin orchestrator.

- [ ] **Step 1: Create src/lib/googleAdsCustomer.js**

Create the file with the per-customer logic. This is a direct extraction — no behavior changes.

```js
// src/lib/googleAdsCustomer.js
import {
  getCampaignStatusCondition,
  normalizeLandingPageUrl,
  sortPerformanceRows,
  sortDeviceRows,
  mapUserListType,
  mapJobStatus,
} from './googleAdsHelpers.js';

/**
 * Fetches all data for a single Google Ads customer account.
 * Returns the shaped response object or null if the customer should be skipped.
 *
 * @param {object} params
 * @param {object} params.client - GoogleAdsApi client instance
 * @param {object} params.customerClient - customer_client row from MCC query
 * @param {string} params.credentials - credentials object with refresh_token, customer_id
 * @param {string} params.dateFilter - GAQL date filter string
 * @param {object} params.dateWindow - { startDate, endDate }
 * @param {string} params.campaignStatusCondition - GAQL WHERE clause for campaigns
 * @param {string} params.campaignStatusConditionWithoutServing - GAQL WHERE without serving_status
 */
export async function fetchCustomerData({
  client,
  customerClient,
  credentials,
  dateFilter,
  dateWindow,
  campaignStatusCondition,
  campaignStatusConditionWithoutServing,
}) {
  const customerId = customerClient.customer_client.id;

  // Skip the MCC account itself
  if (customerId === credentials.customer_id) {
    console.log(`Skipping MCC account: ${customerId}`);
    return null;
  }

  const customer = client.Customer({
    customer_id: customerId,
    refresh_token: credentials.refresh_token,
    login_customer_id: credentials.customer_id,
  });

  let optimizationScore = null;
  let recommendations = [];
  let trendRows = [];
  let searchTermRows = [];
  let landingPageRows = [];
  let deviceRows = [];
  let userListRows = [];
  let offlineJobRows = [];

  try {
    const customerSummary = await customer.query(`
      SELECT customer.id, customer.optimization_score FROM customer LIMIT 1
    `);
    optimizationScore = customerSummary?.[0]?.customer?.optimization_score ?? null;
  } catch (err) {
    console.error(`Error fetching optimization score for ${customerId}:`, err);
  }

  try {
    const rows = await customer.query(`
      SELECT recommendation.resource_name, recommendation.type, recommendation.campaign
      FROM recommendation LIMIT 10
    `);
    recommendations = rows.map((r) => ({
      resource_name: r.recommendation.resource_name || '',
      type: r.recommendation.type || 'UNSPECIFIED',
      campaign_resource_name: r.recommendation.campaign || '',
    }));
  } catch (err) {
    console.error(`Error fetching recommendations for ${customerId}:`, err);
  }

  try {
    trendRows = await customer.query(`
      SELECT campaign.id, segments.date, metrics.clicks, metrics.all_conversions, metrics.cost_micros
      FROM campaign
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
        AND ${dateFilter}
      ORDER BY segments.date
    `);
  } catch (err) {
    console.error(`Error fetching trends for ${customerId}:`, err);
  }

  try {
    searchTermRows = await customer.query(`
      SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
        search_term_view.search_term, metrics.clicks, metrics.impressions,
        metrics.ctr, metrics.all_conversions, metrics.cost_micros
      FROM search_term_view
      WHERE ${campaignStatusConditionWithoutServing}
        AND campaign.advertising_channel_type = 'SEARCH'
        AND ${dateFilter}
      ORDER BY metrics.clicks DESC LIMIT 100
    `);
  } catch (err) {
    console.error(`Error fetching search terms for ${customerId}:`, err);
  }

  try {
    landingPageRows = await customer.query(`
      SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
        ad_group_ad.ad.final_urls, metrics.clicks, metrics.impressions,
        metrics.ctr, metrics.all_conversions, metrics.cost_micros
      FROM ad_group_ad
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
        AND ad_group.status = 'ENABLED'
        AND ad_group_ad.status = 'ENABLED'
        AND ${dateFilter}
    `);
  } catch (err) {
    console.error(`Error fetching landing pages for ${customerId}:`, err);
  }

  try {
    deviceRows = await customer.query(`
      SELECT campaign.id, campaign.name, segments.device,
        metrics.clicks, metrics.impressions, metrics.ctr,
        metrics.all_conversions, metrics.cost_micros
      FROM campaign
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
        AND ${dateFilter}
    `);
  } catch (err) {
    console.error(`Error fetching devices for ${customerId}:`, err);
  }

  try {
    userListRows = await customer.query(`
      SELECT user_list.resource_name, user_list.id, user_list.name,
        user_list.type, user_list.size_for_display, user_list.size_for_search,
        user_list.membership_status
      FROM user_list
      WHERE user_list.type IN ('CRM_BASED') AND user_list.membership_status = 'OPEN'
    `);
  } catch (err) {
    console.error(`Error fetching user lists for ${customerId}:`, err.message);
  }

  try {
    offlineJobRows = await customer.query(`
      SELECT offline_user_data_job.resource_name, offline_user_data_job.id,
        offline_user_data_job.status, offline_user_data_job.type,
        offline_user_data_job.failure_reason,
        offline_user_data_job.customer_match_user_list_metadata.user_list
      FROM offline_user_data_job
      WHERE offline_user_data_job.type = 'CUSTOMER_MATCH_USER_LIST'
      ORDER BY offline_user_data_job.id DESC LIMIT 200
    `);
  } catch (err) {
    console.error(`Error fetching offline jobs for ${customerId}:`, err.message);
  }

  // ── Build audience sync status ─────────────────────────────────────────
  const latestJobByUserList = new Map();
  offlineJobRows.forEach((row) => {
    const job = row.offline_user_data_job;
    const userListResourceName = job?.customer_match_user_list_metadata?.user_list;
    if (!userListResourceName || latestJobByUserList.has(userListResourceName)) return;
    latestJobByUserList.set(userListResourceName, {
      jobId: job.id,
      status: mapJobStatus(job.status),
      failureReason: job.failure_reason || null,
    });
  });

  const audiences = userListRows.map((row) => {
    const ul = row.user_list;
    const latestJob = latestJobByUserList.get(ul.resource_name) || null;
    return {
      id: ul.id,
      name: ul.name || 'Unnamed List',
      type: mapUserListType(ul.type),
      sizeForDisplay: ul.size_for_display ?? null,
      sizeForSearch: ul.size_for_search ?? null,
      membershipStatus: ul.membership_status || null,
      lastSyncStatus: latestJob?.status || null,
      lastSyncJobId: latestJob?.jobId || null,
      failureReason: latestJob?.failureReason || null,
    };
  });

  // ── Fetch campaigns ────────────────────────────────────────────────────
  let campaigns = [];
  try {
    campaigns = await customer.query(`
      SELECT campaign.id, campaign.name, campaign.status,
        campaign.optimization_score, campaign.advertising_channel_type,
        campaign.resource_name, metrics.clicks, metrics.all_conversions, metrics.cost_micros
      FROM campaign
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
        AND ${dateFilter}
      ORDER BY campaign.name
    `);
  } catch (err) {
    console.error(`Error fetching campaigns for ${customerId}:`, err);
  }

  if (!campaigns || campaigns.length === 0) {
    console.log(`No campaigns found for customer ID ${customerId}`);
    return {
      customer: customerClient,
      accountSearchImpressionShareAverage: null,
      optimizationScore,
      recommendations,
      searchTerms: [],
      landingPages: [],
      devices: [],
      trend: [],
      audiences,
      campaigns: [],
    };
  }

  // ── Build aggregation maps ─────────────────────────────────────────────
  const trendDataByCampaignId = {};
  const customerTrendMap = new Map();
  const searchTermsByCampaignId = {};
  const landingPagesByCampaignId = {};
  const accountLandingPagesMap = new Map();
  const devicesByCampaignId = {};
  const accountDevicesMap = new Map();

  searchTermRows.forEach((row) => {
    const id = row.campaign.id;
    if (!searchTermsByCampaignId[id]) searchTermsByCampaignId[id] = [];
    searchTermsByCampaignId[id].push({
      term: row.search_term_view.search_term || '',
      campaignId: id,
      campaignName: row.campaign.name || '',
      adGroupId: row.ad_group.id || null,
      adGroupName: row.ad_group.name || '',
      clicks: row.metrics.clicks || 0,
      impressions: row.metrics.impressions || 0,
      ctr: row.metrics.ctr || 0,
      conversions: row.metrics.all_conversions || 0,
      cost: row.metrics.cost_micros || 0,
    });
  });

  landingPageRows.forEach((row) => {
    const id = row.campaign.id;
    const normalizedUrl = normalizeLandingPageUrl(row.ad_group_ad?.ad?.final_urls?.[0]);
    if (!normalizedUrl) return;

    const base = {
      url: normalizedUrl, campaignId: id, campaignName: row.campaign.name || '',
      adGroupId: row.ad_group.id || null, adGroupName: row.ad_group.name || '',
      clicks: row.metrics.clicks || 0, impressions: row.metrics.impressions || 0,
      conversions: row.metrics.all_conversions || 0, cost: row.metrics.cost_micros || 0, ctr: 0,
    };

    if (!landingPagesByCampaignId[id]) landingPagesByCampaignId[id] = new Map();
    const camp = landingPagesByCampaignId[id];
    const existing = camp.get(normalizedUrl) || { ...base };
    existing.clicks += base.clicks; existing.impressions += base.impressions;
    existing.conversions += base.conversions; existing.cost += base.cost;
    existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
    camp.set(normalizedUrl, existing);

    const acct = accountLandingPagesMap.get(normalizedUrl) || { ...base };
    acct.clicks += base.clicks; acct.impressions += base.impressions;
    acct.conversions += base.conversions; acct.cost += base.cost;
    acct.ctr = acct.impressions > 0 ? acct.clicks / acct.impressions : 0;
    accountLandingPagesMap.set(normalizedUrl, acct);
  });

  deviceRows.forEach((row) => {
    const id = row.campaign.id;
    const device = row.segments.device || 'UNSPECIFIED';

    if (!devicesByCampaignId[id]) devicesByCampaignId[id] = new Map();
    const camp = devicesByCampaignId[id];
    const existing = camp.get(device) || {
      device, campaignId: id, campaignName: row.campaign.name || '',
      clicks: 0, impressions: 0, conversions: 0, cost: 0, ctr: 0,
    };
    existing.clicks += row.metrics.clicks || 0;
    existing.impressions += row.metrics.impressions || 0;
    existing.conversions += row.metrics.all_conversions || 0;
    existing.cost += row.metrics.cost_micros || 0;
    existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
    camp.set(device, existing);

    const acct = accountDevicesMap.get(device) || { device, clicks: 0, impressions: 0, conversions: 0, cost: 0, ctr: 0 };
    acct.clicks += row.metrics.clicks || 0;
    acct.impressions += row.metrics.impressions || 0;
    acct.conversions += row.metrics.all_conversions || 0;
    acct.cost += row.metrics.cost_micros || 0;
    acct.ctr = acct.impressions > 0 ? acct.clicks / acct.impressions : 0;
    accountDevicesMap.set(device, acct);
  });

  trendRows.forEach((row) => {
    const id = row.campaign.id;
    const point = {
      date: row.segments.date,
      clicks: row.metrics.clicks || 0,
      conversions: row.metrics.all_conversions || 0,
      cost: row.metrics.cost_micros || 0,
    };
    if (!trendDataByCampaignId[id]) trendDataByCampaignId[id] = [];
    trendDataByCampaignId[id].push(point);

    const cp = customerTrendMap.get(row.segments.date) || { date: row.segments.date, clicks: 0, conversions: 0, cost: 0 };
    cp.clicks += point.clicks; cp.conversions += point.conversions; cp.cost += point.cost;
    customerTrendMap.set(row.segments.date, cp);
  });

  // ── Fetch optimization + impression share per campaign ─────────────────
  let optimizationDetailsByCampaignId = {};
  let impressionShareByCampaignId = {};

  try {
    const rows = await customer.query(`
      SELECT campaign.id, metrics.optimization_score_url, metrics.optimization_score_uplift
      FROM campaign WHERE ${campaignStatusConditionWithoutServing}
    `);
    optimizationDetailsByCampaignId = Object.fromEntries(
      rows.map((r) => [r.campaign.id, {
        optimizationScoreUrl: r.metrics?.optimization_score_url || '',
        optimizationScoreUplift: r.metrics?.optimization_score_uplift || null,
      }])
    );
  } catch (err) {
    console.error(`Error fetching optimization metrics for ${customerId}:`, err);
  }

  try {
    const rows = await customer.query(`
      SELECT campaign.id, metrics.search_impression_share,
        metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
      FROM campaign
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type = 'SEARCH'
    `);
    impressionShareByCampaignId = Object.fromEntries(
      rows.map((r) => [r.campaign.id, {
        searchImpressionShare: r.metrics?.search_impression_share ?? null,
        searchBudgetLostImpressionShare: r.metrics?.search_budget_lost_impression_share ?? null,
        searchRankLostImpressionShare: r.metrics?.search_rank_lost_impression_share ?? null,
      }])
    );
  } catch (err) {
    console.error(`Error fetching impression share for ${customerId}:`, err);
  }

  // ── Fetch ads per campaign ─────────────────────────────────────────────
  const adsData = await Promise.all(
    campaigns.map(async (campaign) => {
      const campaignResourceName = campaign.campaign.resource_name;
      const optDetails = optimizationDetailsByCampaignId[campaign.campaign.id] || {};
      const isDetails = impressionShareByCampaignId[campaign.campaign.id] || {};

      let ads = [];
      try {
        ads = await customer.query(`
          SELECT ad_group_ad.ad.responsive_search_ad.descriptions,
            ad_group_ad.ad.final_urls, ad_group_ad.ad.app_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.headlines
          FROM ad_group_ad
          WHERE ad_group.campaign = '${campaignResourceName}'
            AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'
        `);
      } catch (err) {
        console.error(`Error fetching ads for campaign ${campaign.campaign.id}:`, err);
      }

      return {
        campaignId: campaign.campaign.id,
        campaignName: campaign.campaign.name,
        resourceName: campaign.campaign.resource_name,
        status: campaign.campaign.status || 'UNKNOWN',
        channelType: campaign.campaign.advertising_channel_type || 'UNKNOWN',
        optimizationScore: campaign.campaign.optimization_score ?? null,
        optimizationScoreUrl: optDetails.optimizationScoreUrl || '',
        optimizationScoreUplift: optDetails.optimizationScoreUplift || null,
        searchImpressionShare: isDetails.searchImpressionShare ?? null,
        searchBudgetLostImpressionShare: isDetails.searchBudgetLostImpressionShare ?? null,
        searchRankLostImpressionShare: isDetails.searchRankLostImpressionShare ?? null,
        conversions: campaign.metrics.all_conversions,
        clicks: campaign.metrics.clicks,
        cost: campaign.metrics.cost_micros,
        trend: trendDataByCampaignId[campaign.campaign.id] || [],
        searchTerms: (searchTermsByCampaignId[campaign.campaign.id] || []).sort(sortPerformanceRows).slice(0, 12),
        landingPages: Array.from((landingPagesByCampaignId[campaign.campaign.id] || new Map()).values()).sort(sortPerformanceRows).slice(0, 12),
        devices: Array.from((devicesByCampaignId[campaign.campaign.id] || new Map()).values()).sort(sortDeviceRows),
        ads: ads.map((ad) => {
          const adData = ad.ad_group_ad?.ad || {};
          const rsa = adData.responsive_search_ad;
          return {
            resource_name: adData.resource_name || '',
            headlines: rsa?.headlines?.map((h) => h.text) || [],
            descriptions: rsa?.descriptions?.map((d) => d.text) || [],
            final_urls: adData.final_urls || [],
          };
        }),
      };
    })
  );

  const campaignNameByResourceName = Object.fromEntries(
    adsData.map((c) => [c.resourceName, c.campaignName])
  );

  const impressionValues = adsData.map((c) => c.searchImpressionShare).filter((v) => v != null);

  return {
    accountSearchImpressionShareAverage: impressionValues.length
      ? impressionValues.reduce((s, v) => s + Number(v || 0), 0) / impressionValues.length
      : null,
    customer: customerClient,
    optimizationScore,
    recommendations: recommendations.map((r) => ({
      ...r,
      campaignName: campaignNameByResourceName[r.campaign_resource_name] || null,
    })),
    searchTerms: searchTermRows.map((row) => ({
      term: row.search_term_view.search_term || '',
      campaignId: row.campaign.id,
      campaignName: row.campaign.name || '',
      adGroupId: row.ad_group.id || null,
      adGroupName: row.ad_group.name || '',
      clicks: row.metrics.clicks || 0,
      impressions: row.metrics.impressions || 0,
      ctr: row.metrics.ctr || 0,
      conversions: row.metrics.all_conversions || 0,
      cost: row.metrics.cost_micros || 0,
    })).sort(sortPerformanceRows).slice(0, 20),
    landingPages: Array.from(accountLandingPagesMap.values()).sort(sortPerformanceRows).slice(0, 20),
    devices: Array.from(accountDevicesMap.values()).sort(sortDeviceRows),
    trend: Array.from(customerTrendMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    audiences,
    campaigns: adsData,
  };
}
```

- [ ] **Step 2: Verify the file parses (no syntax errors)**

```bash
node --input-type=module < src/lib/googleAdsCustomer.js 2>&1 | head -5
```
Expected: no output (no errors). If there's a `SyntaxError`, fix it before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/lib/googleAdsCustomer.js
git commit -m "refactor: extract per-customer Google Ads query logic to googleAdsCustomer.js"
```

---

## Task 9: Create New /api/googleads/route.js and Delete Old Route

**Files:**
- Create: `src/app/api/googleads/route.js`
- Delete: `src/app/api/route.js`
- Create: `src/__tests__/api/googleads/route.test.js`

- [ ] **Step 1: Write the validation test first**

Create `src/__tests__/api/googleads/route.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';

// Mock Next.js and auth dependencies so we can import the route module in tests
vi.mock('next/server', () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/dbFunctions', () => ({ getCredentials: vi.fn() }));
vi.mock('google-ads-api', () => ({ GoogleAdsApi: vi.fn() }));
vi.mock('@/lib/googleAdsCustomer', () => ({ fetchCustomerData: vi.fn() }));
vi.mock('node:util', () => ({ default: { inspect: vi.fn((e) => String(e)) } }));

// Import schema after mocks are in place
const { googleAdsQuerySchema } = await import('@/app/api/googleads/route.js');

describe('googleAdsQuerySchema', () => {
  it('accepts valid params', () => {
    const result = googleAdsQuerySchema.safeParse({
      dateRange: 'LAST_7_DAYS',
      statusFilter: 'ACTIVE',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown dateRange', () => {
    const result = googleAdsQuerySchema.safeParse({ dateRange: 'LAST_999_DAYS' });
    expect(result.success).toBe(false);
  });

  it('defaults statusFilter to ACTIVE when omitted', () => {
    const result = googleAdsQuerySchema.safeParse({ dateRange: 'LAST_30_DAYS' });
    expect(result.success).toBe(true);
    expect(result.data.statusFilter).toBe('ACTIVE');
  });

  it('requires both startDate and endDate for CUSTOM range', () => {
    const result = googleAdsQuerySchema.safeParse({
      dateRange: 'CUSTOM',
      startDate: '2026-01-01',
      // endDate missing
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- "route.test"
```
Expected: FAIL — `@/app/api/googleads/route.js` not found.

- [ ] **Step 3: Create src/app/api/googleads/route.js**

```bash
mkdir -p src/app/api/googleads
```

Create `src/app/api/googleads/route.js`:
```js
// src/app/api/googleads/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { GoogleAdsApi } from 'google-ads-api';
import util from 'node:util';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../lib/auth';
import { getCredentials } from '../../../lib/dbFunctions';
import {
  ALLOWED_DATE_RANGES,
  ALLOWED_CAMPAIGN_STATUS_FILTERS,
  buildDateFilter,
  getCampaignStatusCondition,
} from '../../../lib/googleAdsHelpers';
import { fetchCustomerData } from '../../../lib/googleAdsCustomer';

// ── Zod schema for query params ────────────────────────────────────────────
export const googleAdsQuerySchema = z
  .object({
    dateRange: z.enum([...ALLOWED_DATE_RANGES]).default('LAST_7_DAYS'),
    statusFilter: z.enum([...ALLOWED_CAMPAIGN_STATUS_FILTERS]).default('ACTIVE'),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (data) => data.dateRange !== 'CUSTOM' || (data.startDate && data.endDate),
    { message: 'startDate and endDate are required for CUSTOM dateRange' }
  );

export async function GET(request) {
  const requestId = crypto.randomUUID();

  try {
    const session = await getServerSession(authOptions);
    const sessionEmail = session?.user?.email?.toLowerCase() || '';

    if (!sessionEmail.endsWith(`@${allowedEmailDomain}`)) {
      return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
    }

    // ── Validate query params ──────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const parsed = googleAdsQuerySchema.safeParse({
      dateRange: searchParams.get('dateRange') ?? undefined,
      statusFilter: searchParams.get('statusFilter') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message, requestId },
        { status: 400 }
      );
    }

    const { dateRange, statusFilter, startDate, endDate } = parsed.data;
    const { dateFilter, dateWindow } = buildDateFilter(dateRange, startDate, endDate);
    const campaignStatusCondition = getCampaignStatusCondition(statusFilter);
    const campaignStatusConditionWithoutServing = getCampaignStatusCondition(statusFilter, {
      includeServingStatus: false,
    });

    // ── Credentials + API client ───────────────────────────────────────────
    const credentials = await getCredentials();
    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    });

    const mccCustomer = client.Customer({
      customer_id: credentials.customer_id,
      refresh_token: credentials.refresh_token,
      login_customer_id: credentials.customer_id,
    });

    const customerClients = await mccCustomer.query(`
      SELECT customer_client.level, customer_client.descriptive_name, customer_client.id
      FROM customer_client
      WHERE customer_client.level = 1 AND customer_client.status = 'ENABLED'
    `);

    if (!customerClients || customerClients.length === 0) {
      return NextResponse.json({ error: 'No accessible customers found', requestId }, { status: 404 });
    }

    // ── Fetch all customer data in parallel ────────────────────────────────
    const allCampaignData = await Promise.all(
      customerClients.map((customerClient) =>
        fetchCustomerData({
          client,
          customerClient,
          credentials,
          dateFilter,
          dateWindow,
          campaignStatusCondition,
          campaignStatusConditionWithoutServing,
        })
      )
    );

    const validCampaignsData = allCampaignData.filter(Boolean);

    const response = NextResponse.json({
      data: { validCampaignsData, dateRange, dateWindow, statusFilter },
      requestId,
    });
    response.headers.set('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return response;
  } catch (error) {
    console.error(`[googleads] Error [${requestId}]:`, util.inspect(error, { depth: null, colors: false }));
    return NextResponse.json(
      { error: 'Failed to fetch campaign data', requestId },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test -- "route.test"
```
Expected: PASS — all schema tests green.

- [ ] **Step 5: Delete the old route**

```bash
rm src/app/api/route.js
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/googleads/route.js src/__tests__/api/googleads/route.test.js
git rm src/app/api/route.js
git commit -m "refactor: split Google Ads monolith into googleads/route.js with Zod validation and requestId"
```

---

## Task 10: Update Dashboard Fetch URL

**Files:**
- Modify: `src/app/dashboard/google/ads/page.js`

**Background:** The Google Ads dashboard calls `fetch('/api?${queryParams}')`. Now that the route is at `/api/googleads`, update this one call. Also update the response destructure since the response shape changed from `{ validCampaignsData, ... }` to `{ data: { validCampaignsData, ... } }`.

- [ ] **Step 1: Open the file and find the fetch call**

In `src/app/dashboard/google/ads/page.js`, find line 364:
```js
const response = await fetch(`/api?${queryParams.toString()}`, { cache: "no-store" });
```

Replace with:
```js
const response = await fetch(`/api/googleads?${queryParams.toString()}`, { cache: "no-store" });
```

- [ ] **Step 2: Update the response destructure**

Find where the response JSON is destructured after the fetch. It likely looks like:
```js
const { validCampaignsData, dateRange, dateWindow, statusFilter } = await response.json();
```

Replace with:
```js
const { data } = await response.json();
const { validCampaignsData, dateRange, dateWindow, statusFilter } = data ?? {};
```

- [ ] **Step 3: Start the dev server and verify the dashboard loads**

```bash
npm run dev
```
Open `http://localhost:3000/dashboard/google/ads` in a browser. Confirm campaign data loads without console errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/google/ads/page.js
git commit -m "fix: update Google Ads dashboard fetch URL from /api to /api/googleads"
```

---

## Task 11: Add Zod + requestId to SEO Audit Routes

**Files:**
- Modify: `src/app/api/seo-audit/crawl/route.js`
- Modify: `src/app/api/seo-audit/analyze/route.js`
- Modify: `src/app/api/seo-audit/history/route.js`

- [ ] **Step 1: Update crawl/route.js**

Add Zod schema and requestId. Replace the top of the `POST` handler in `src/app/api/seo-audit/crawl/route.js` with:

**Add import at the top:**
```js
import { z } from 'zod';
```

**Add schema before the handler:**
```js
const crawlBodySchema = z.object({
  domain: z.string().min(1),
  auditType: z.enum(['full', 'quick']).default('full'),
  pageUrls: z.array(z.string().url()).optional(),
  forceRerun: z.boolean().optional(),
});
```

**Update the POST handler opening** to add requestId and Zod validation (replace the existing manual checks):
```js
export async function POST(request) {
  const requestId = crypto.randomUUID();
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body', requestId }, { status: 400 });
  }

  const parsed = crawlBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message, requestId },
      { status: 400 }
    );
  }

  const { domain, auditType, pageUrls, forceRerun } = parsed.data;

  // Normalize domain — strip protocol, trailing slash, www
  const cleanDomain = domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .toLowerCase();

  if (!cleanDomain || cleanDomain.includes(' ')) {
    return NextResponse.json({ error: 'Invalid domain format', requestId }, { status: 400 });
  }
  // ... rest of handler unchanged, add requestId to error/success responses
```

Also update the success response at the end:
```js
return NextResponse.json({ data: crawlResult, requestId });
```
And the error response in the catch block:
```js
return NextResponse.json({ error: err.message || 'Crawl failed', requestId }, { status: 500 });
```

- [ ] **Step 2: Update analyze/route.js**

**Add import at the top:**
```js
import { z } from 'zod';
```

**Add schema before the handler:**
```js
const analyzeBodySchema = z.object({
  crawlData: z.object({ pages_crawled: z.array(z.any()).min(1), domain: z.string().optional() }).passthrough(),
  gscData: z.any().optional(),
  adsData: z.any().optional(),
  seoToolData: z.any().optional(),
  forceRerun: z.boolean().optional(),
});
```

**Update the POST handler opening** to add requestId and Zod validation (replace the manual body check and manual crawlData check):
```js
export async function POST(request) {
  const requestId = crypto.randomUUID();
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body', requestId }, { status: 400 });
  }

  const parsed = analyzeBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message, requestId },
      { status: 400 }
    );
  }

  const { crawlData, gscData, adsData, seoToolData, forceRerun } = parsed.data;
  // ... rest of handler unchanged
```

Add `requestId` to all `NextResponse.json` return calls in the handler. For example, the daily limit 429:
```js
return NextResponse.json({ error: `Daily limit reached...`, requestId }, { status: 429 });
```
The final success response:
```js
return NextResponse.json({ data: { audit, auditId, remainingToday: DAILY_LIMIT - usedToday - 1 }, requestId });
```
And error returns in the catch:
```js
return NextResponse.json({ error: err.message || 'Analysis failed', requestId }, { status: 500 });
```

- [ ] **Step 3: Update history/route.js**

Add requestId to the GET handler's responses. Add at the top of the GET handler:
```js
const requestId = crypto.randomUUID();
```
Update all return statements to include `requestId`.

- [ ] **Step 4: Run all tests to confirm nothing broke**

```bash
npm test
```
Expected: all previously passing tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/seo-audit/crawl/route.js src/app/api/seo-audit/analyze/route.js src/app/api/seo-audit/history/route.js
git commit -m "feat: add Zod validation and requestId to all seo-audit API routes"
```

---

## Task 12: Run Full Test Suite + Final Verification

- [ ] **Step 1: Run all tests**

```bash
npm test
```
Expected output: all test suites green. Note any failures and fix before proceeding.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Run build to confirm no import errors**

```bash
npm run build 2>&1 | tail -20
```
Expected: build succeeds with no module-not-found or syntax errors.

- [ ] **Step 4: Final commit if any cleanup was needed**

```bash
git add -A
git status  # review what's staged
git commit -m "chore: final cleanup and lint fixes"
```

---

## Summary of Changes

| Group | What Changed | Key Files |
|-------|-------------|-----------|
| D — Infrastructure | MongoDB caching in all envs | `mongoose.js` |
| D — Infrastructure | Cron idempotency via lastRun guard | `cronGuard.js`, `audience-lab/sync/route.js` |
| A — SEO Audit | Daily limit checked before Claude, no wasted increment | `analyze/route.js` |
| A — SEO Audit | 30s per-user rate limiter | `seoRateLimit.js` |
| A — SEO Audit | forceRerun upserts instead of inserting duplicates | `analyze/route.js` |
| A — SEO Audit | Crawl cap raised to 50, truncation logged | `seoCrawler.js` |
| B+C — API Quality | Google Ads monolith split into 3 focused files | `googleAdsHelpers.js`, `googleAdsCustomer.js`, `googleads/route.js` |
| B+C — API Quality | Zod validation on all modified routes | all route.js files |
| B+C — API Quality | requestId on all API responses | all route.js files |
| E — Tests | Full Vitest setup with 7 test files | `src/__tests__/**` |
