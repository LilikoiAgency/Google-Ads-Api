# Meta API Rate Limit Safeguards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a per-account hourly Meta API call cap inside `graphGet()` and cache the audit route to prevent hitting Meta BUC rate limits.

**Architecture:** Add `accountId` tracking to `ApiCallLog`, then gate every `graphGet()` call with a DB-backed per-account hourly count (30s in-memory cache). Cache the expensive audit route (9 calls/load) with a 10-minute `apiCache` TTL.

**Tech Stack:** Next.js App Router, MongoDB native driver, existing `apiCache` (L1+L2), existing `ApiCallLog` collection

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `src/lib/apiCallLogger.js` | Add `accountId` param to `logMetaCall()` and document |
| Modify | `src/lib/metaGraph.js` | Module-level caches + `extractAccountId` + `getHourlyLimit` + `checkAccountRateLimit` + update `graphGet()` |
| Modify | `src/app/api/meta/audit/route.js` | Import `apiCache`, add 10-min cache around the full fetch |

---

## Task 1: Add `accountId` to `apiCallLogger.js`

**Files:**
- Modify: `src/lib/apiCallLogger.js`

Current file (25 lines):
```js
// src/lib/apiCallLogger.js
import dbConnect from './mongoose';

const DB = 'tokensApi';
const COLLECTION = 'ApiCallLog';

let indexEnsured = false;

async function ensureTtlIndex(col) {
  if (indexEnsured) return;
  await col.createIndex({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
  indexEnsured = true;
}

export async function logMetaCall(endpoint, status, durationMs) {
  try {
    const client = await dbConnect();
    const col = client.db(DB).collection(COLLECTION);
    await ensureTtlIndex(col);
    await col.insertOne({ api: 'meta', endpoint, status, durationMs, timestamp: new Date() });
  } catch (err) {
    console.error('[apiCallLogger]', err.message);
  }
}
```

- [ ] **Step 1: Add `accountId` param with default**

Replace the file with:

```js
// src/lib/apiCallLogger.js
import dbConnect from './mongoose';

const DB = 'tokensApi';
const COLLECTION = 'ApiCallLog';

let indexEnsured = false;

async function ensureTtlIndex(col) {
  if (indexEnsured) return;
  await col.createIndex({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
  indexEnsured = true;
}

export async function logMetaCall(endpoint, status, durationMs, accountId = 'unknown') {
  try {
    const client = await dbConnect();
    const col = client.db(DB).collection(COLLECTION);
    await ensureTtlIndex(col);
    await col.insertOne({ api: 'meta', endpoint, status, durationMs, accountId, timestamp: new Date() });
  } catch (err) {
    console.error('[apiCallLogger]', err.message);
  }
}
```

- [ ] **Step 2: Verify no other callers broke**

Run:
```bash
grep -rn "logMetaCall" src/
```

Expected: only `src/lib/metaGraph.js` calls `logMetaCall`. The new `accountId` param has a default of `'unknown'` so the existing call site still compiles without changes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/apiCallLogger.js
git commit -m "feat: add accountId field to ApiCallLog documents"
```

---

## Task 2: Per-account rate limit enforcement in `metaGraph.js`

**Files:**
- Modify: `src/lib/metaGraph.js`

This is the critical task. The full replacement for `src/lib/metaGraph.js`:

- [ ] **Step 1: Replace the file with rate-limit-aware version**

```js
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
```

- [ ] **Step 2: Verify the file looks correct**

```bash
node --input-type=module --eval "import('./src/lib/metaGraph.js').then(() => console.log('OK'))" 2>&1 | head -5
```

If the project doesn't support bare node ESM check, just read the file and visually confirm:
- `extractAccountId` uses `act_\d+` regex and returns `'batch'` fallback
- `checkAccountRateLimit` throws with `err.code = 'META_RATE_LIMIT'` and `err.waitMinutes`
- `graphGet` calls `checkAccountRateLimit(accountId)` BEFORE the fetch
- `logMetaCall` is called with 4 args including `accountId`

- [ ] **Step 3: Confirm error propagation works for the audit route**

The audit route's catch block at line 232-245 already forwards `err.status` to the HTTP response:
```js
const status = err?.status || 500;
return NextResponse.json(
  { error: err?.message || 'Meta API error', code: err?.code, subcode: err?.subcode },
  { status: status >= 400 && status < 600 ? status : 500 },
);
```

The `META_RATE_LIMIT` error has `err.status = 429` so it will return HTTP 429. The `code` field will be `'META_RATE_LIMIT'`. The `waitMinutes` field is NOT in this response shape — add it by also forwarding `err.waitMinutes`:

In `src/app/api/meta/audit/route.js`, find the catch block and update the JSON body:
```js
return NextResponse.json(
  { error: err?.message || 'Meta API error', code: err?.code, subcode: err?.subcode, waitMinutes: err?.waitMinutes },
  { status: status >= 400 && status < 600 ? status : 500 },
);
```

Apply this edit to `src/app/api/meta/audit/route.js` lines 241-244 now (before Task 3 which will rewrite more of the file).

- [ ] **Step 4: Commit**

```bash
git add src/lib/metaGraph.js src/app/api/meta/audit/route.js
git commit -m "feat: per-account Meta API rate limit enforcement in graphGet()"
```

---

## Task 3: Cache the audit route with 10-minute TTL

**Files:**
- Modify: `src/app/api/meta/audit/route.js`

The audit route fires 9 parallel `graphGet()` calls every load. With the rate limit check now in place, repeated loads by multiple users burn through the hourly quota fast. A 10-minute cache means at most 6 full audit fetches per hour per account/range combination, down from potentially dozens.

- [ ] **Step 1: Add `apiCache` import to the audit route**

At the top of `src/app/api/meta/audit/route.js`, the current imports end at line 8:
```js
import { graphGet, getTimeRange, getMetaAccessToken } from '../../../../lib/metaGraph';
```

Add the `apiCache` import after it:
```js
import { graphGet, getTimeRange, getMetaAccessToken } from '../../../../lib/metaGraph';
import { apiCache } from '../../../../lib/apiCache';
```

- [ ] **Step 2: Add cache check before the `try` block and cache store after success**

The current `GET` function structure (simplified):
```js
export async function GET(request) {
  // auth check...
  // param parsing (accountId, range, startDate, endDate, actId)...

  try {
    const token = await getMetaAccessToken();
    const [...results] = await Promise.all([...9 graphGet calls...]);
    // shape data...
    return NextResponse.json({ data: { ... } });
  } catch (err) {
    // error handling...
  }
}
```

After the `actId` line (line 61 currently), add the cache key and check:
```js
  const cacheKey = `meta-audit:${actId}:${range}:${startDate || ''}:${endDate || ''}`;
  const cached = await apiCache.get(cacheKey);
  if (cached) return NextResponse.json(cached);
```

After building the response data object (but before `return NextResponse.json(...)`), store it in the cache:
```js
    const responseData = {
      data: {
        account: { ... },
        campaigns,
        adSets,
        ads,
        pixels,
        accountInsights,
        dateRange: timeRange,
      },
    };
    apiCache.setBackground(cacheKey, responseData, 10 * 60 * 1000);
    return NextResponse.json(responseData);
```

The complete updated `GET` function — replace the entire function body of `src/app/api/meta/audit/route.js` starting at line 47:

```js
export async function GET(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  const range = searchParams.get('range') || '28d';
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const timeRange = getTimeRange(range, startDate, endDate);
  const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  const cacheKey = `meta-audit:${actId}:${range}:${startDate || ''}:${endDate || ''}`;
  const cached = await apiCache.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const token = await getMetaAccessToken();

    const insightsFields = 'spend,impressions,clicks,ctr,cpm,cpc,frequency,actions,action_values';
    const timeRangeJson = JSON.stringify(timeRange);
    const activeFilter = JSON.stringify([
      { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] },
    ]);

    const [
      accountRow,
      campaignsResp,
      adSetsResp,
      adsResp,
      pixelsResp,
      accountInsightsResp,
      campaignInsightsResp,
      adSetInsightsResp,
      adInsightsResp,
    ] = await Promise.all([
      graphGet(actId, { fields: 'name,currency,account_status,business' }, token),
      graphGet(`${actId}/campaigns`, {
        fields: 'id,name,objective,status,effective_status,buying_type,special_ad_categories,bid_strategy,daily_budget,lifetime_budget',
        filtering: activeFilter,
        limit: 200,
      }, token),
      graphGet(`${actId}/adsets`, {
        fields: 'id,name,campaign_id,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,frequency_control_specs,learning_stage_info,is_dynamic_creative,targeting{flexible_spec,custom_audiences,targeting_automation,publisher_platforms}',
        filtering: activeFilter,
        limit: 300,
      }, token),
      graphGet(`${actId}/ads`, {
        fields: 'id,name,ad_set_id,status,effective_status,creative{id,title,body,call_to_action_type,image_url,thumbnail_url,object_story_id}',
        filtering: activeFilter,
        limit: 500,
      }, token),
      graphGet(`${actId}/adspixels`, { fields: 'id,name,last_fired_time' }, token).catch(() => ({ data: [] })),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        fields: insightsFields,
      }, token),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        level: 'campaign',
        fields: `campaign_id,${insightsFields}`,
        limit: 500,
      }, token).catch((err) => {
        console.warn('[meta/audit] campaign-level insights fetch failed:', err?.message);
        return { data: [] };
      }),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        level: 'adset',
        fields: `adset_id,${insightsFields}`,
        limit: 1000,
      }, token).catch((err) => {
        console.warn('[meta/audit] adset-level insights fetch failed:', err?.message);
        return { data: [] };
      }),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        level: 'ad',
        fields: `ad_id,${insightsFields}`,
        limit: 1000,
      }, token).catch((err) => {
        console.warn('[meta/audit] ad-level insights fetch failed:', err?.message);
        return { data: [] };
      }),
    ]);

    const campaignNameById = Object.fromEntries((campaignsResp.data || []).map((c) => [c.id, c.name]));

    const campaignInsightsById = {};
    for (const row of campaignInsightsResp.data || []) {
      if (row.campaign_id) campaignInsightsById[row.campaign_id] = shapeInsights(row);
    }
    const adSetInsightsById = {};
    for (const row of adSetInsightsResp.data || []) {
      if (row.adset_id) adSetInsightsById[row.adset_id] = shapeInsights(row);
    }
    const adInsightsById = {};
    for (const row of adInsightsResp.data || []) {
      if (row.ad_id) adInsightsById[row.ad_id] = shapeInsights(row);
    }

    const zeroInsights = shapeInsights({});

    const campaigns = (campaignsResp.data || []).map((c) => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effective_status: c.effective_status,
      buying_type: c.buying_type,
      special_ad_categories: c.special_ad_categories,
      bid_strategy: c.bid_strategy,
      daily_budget: toNum(c.daily_budget) / 100,
      lifetime_budget: toNum(c.lifetime_budget) / 100,
      ...(campaignInsightsById[c.id] || zeroInsights),
    }));

    const adSets = (adSetsResp.data || []).map((as) => ({
      id: as.id,
      name: as.name,
      campaign_id: as.campaign_id,
      campaign_name: campaignNameById[as.campaign_id] || null,
      status: as.status,
      effective_status: as.effective_status,
      optimization_goal: as.optimization_goal,
      billing_event: as.billing_event,
      bid_strategy: as.bid_strategy,
      daily_budget: toNum(as.daily_budget) / 100,
      lifetime_budget: toNum(as.lifetime_budget) / 100,
      targeting: as.targeting || {},
      learning_stage_info: as.learning_stage_info || null,
      is_dynamic_creative: !!as.is_dynamic_creative,
      ...(adSetInsightsById[as.id] || zeroInsights),
    }));

    const ads = (adsResp.data || []).map((ad) => {
      const ins = adInsightsById[ad.id] || zeroInsights;
      return {
        id: ad.id,
        name: ad.name,
        ad_set_id: ad.ad_set_id,
        status: ad.status,
        effective_status: ad.effective_status,
        creative_id: ad.creative?.id || null,
        creative: ad.creative
          ? {
              id: ad.creative.id,
              title: ad.creative.title || null,
              body: ad.creative.body || null,
              call_to_action_type: ad.creative.call_to_action_type || null,
              image_url: ad.creative.image_url || ad.creative.thumbnail_url || null,
              object_story_id: ad.creative.object_story_id || null,
            }
          : null,
        ...ins,
        insights: ins,
      };
    });

    const pixels = (pixelsResp.data || []);
    const accountInsights = shapeInsights(accountInsightsResp.data?.[0]);

    const responseData = {
      data: {
        account: {
          id: accountRow.id,
          name: accountRow.name,
          currency: accountRow.currency,
          accountStatus: accountRow.account_status,
          business: accountRow.business,
        },
        campaigns,
        adSets,
        ads,
        pixels,
        accountInsights,
        dateRange: timeRange,
      },
    };
    apiCache.setBackground(cacheKey, responseData, 10 * 60 * 1000);
    return NextResponse.json(responseData);
  } catch (err) {
    console.error('[meta/audit] Meta API error:', {
      message: err?.message,
      status: err?.status,
      code: err?.code,
      subcode: err?.subcode,
      stack: err?.stack?.split('\n').slice(0, 3).join(' | '),
    });
    const status = err?.status || 500;
    return NextResponse.json(
      { error: err?.message || 'Meta API error', code: err?.code, subcode: err?.subcode, waitMinutes: err?.waitMinutes },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
```

- [ ] **Step 3: Verify the import was added**

```bash
grep -n "apiCache" src/app/api/meta/audit/route.js
```

Expected output includes two lines: the import and the `apiCache.get` call and `apiCache.setBackground` call.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/meta/audit/route.js
git commit -m "feat: cache Meta audit route with 10-minute TTL"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|------------|
| Add `accountId` to `ApiCallLog` | Task 1 |
| Extract `accountId` via `/(act_\d+)/` regex | Task 2, `extractAccountId()` |
| Batch calls fall back to `'batch'` | Task 2, `extractAccountId()` returns `'batch'` when no match |
| 30-second in-memory count cache | Task 2, `countCache` Map with `fetchedAt` check |
| Query `ApiCallLog` for hour window | Task 2, `countDocuments({ accountId, timestamp: { $gte: oneHourAgo } })` |
| `meta_hourly_limit` from Settings, 60s cache | Task 2, `getHourlyLimit()` |
| Default limit 150 | Task 2, `doc?.value ?? 150` |
| Structured error with `META_RATE_LIMIT` code | Task 2, `err.code = 'META_RATE_LIMIT'` |
| `waitMinutes` computed from oldest call | Task 2, `findOne` with `sort: { timestamp: 1 }` |
| HTTP 429 on limit | Task 2 + audit catch block forwards `err.status = 429` |
| `waitMinutes` in error response | Task 2 Step 3 + Task 3 Step 1 add `waitMinutes: err?.waitMinutes` to catch block |
| Audit route caching, 10-min TTL | Task 3 |
| Cache key includes accountId + range + dates | Task 3, `meta-audit:${actId}:${range}:${startDate\|\|''}:${endDate\|\|''}` |
| Cache hit = zero Meta calls | Task 3, early return before try block |

**No placeholders found.** All code is complete and specific.

**Type/name consistency:** `extractAccountId`, `getHourlyLimit`, `checkAccountRateLimit` — named consistently throughout Tasks 1-3. `apiCache.setBackground` matches the method name in `src/lib/apiCache.js` line 79.
