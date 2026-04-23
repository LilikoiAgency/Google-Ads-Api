# Meta Ads Ad-Level View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users click an ad set row on `/dashboard/meta` and see every ad with pixel-accurate Meta-rendered previews, placement tabs, and per-ad metrics.

**Architecture:** Slide-out panel (mirrors existing `AuditPanel` pattern) + two new read-only Meta Graph API proxy routes + server-side 15-min in-memory cache for preview HTML. No persistence — live read-through of Meta's API.

**Tech Stack:** Next.js App Router, React client components, Meta Graph API v19.0 with `ads_read` scope (existing token), inline-styled components matching the codebase's pattern, MongoDB (reuses `getCredentials()` from `src/lib/dbFunctions`).

**Spec:** `docs/superpowers/specs/2026-04-21-meta-ads-ad-level-view-design.md`

**Testing note:** This codebase has no automated UI/integration test suite (confirmed by looking at the existing `/dashboard/google/ads/audit` pages). Per the plan conventions, each task's "test" step is a **concrete manual verification command or browser action** with exact expected output. Do NOT skip these — they are the only protection against regression.

---

## File structure

### New files
- `src/lib/metaGraph.js` — shared helpers extracted from existing `/api/meta-ads/route.js` (Meta Graph base URL, `graphGet()`, `getTimeRange()`, token loader)
- `src/app/api/meta-ads/ad-set/[adSetId]/ads/route.js` — GET ads list with insights
- `src/app/api/meta-ads/ad/[adId]/preview/route.js` — GET proxied preview HTML with in-memory cache
- `src/app/dashboard/meta/components/MetaAdPreview.jsx` — single ad card (tabs + iframe + metrics + fallback)
- `src/app/dashboard/meta/components/MetaAdsPanel.jsx` — slide-out panel wrapper (header + sort + filter + list)

### Modified files
- `src/app/api/meta-ads/route.js` — swap inline helpers for imports from `src/lib/metaGraph.js` (no behavior change)
- `src/app/dashboard/meta/page.js` — make ad set table rows clickable, mount the new panel

### Responsibility boundaries
- `metaGraph.js` is the only place that knows the Graph URL / token layout
- The two new API routes are the only places that shape Meta responses into our JSON contracts
- `MetaAdPreview` knows nothing about panels — it's a single-ad card that renders whatever ad is passed to it
- `MetaAdsPanel` knows nothing about Meta Graph — it fetches from our API routes and renders cards
- The Meta page only knows how to open/close the panel and which ad set is selected

---

## Task 1: Extract shared Meta Graph helpers

**Files:**
- Create: `src/lib/metaGraph.js`
- Modify: `src/app/api/meta-ads/route.js`

- [ ] **Step 1: Read the existing route to confirm what to extract**

Run:
```bash
grep -n "GRAPH_BASE\|async function graphGet\|function getTimeRange\|getCredentials\|meta_access_token" src/app/api/meta-ads/route.js
```

Expected output: line numbers for `GRAPH_BASE` (line ~7), `graphGet` (line ~46), `getTimeRange` (line ~11), `getCredentials` usage (line ~97-98). Confirm the function bodies match what you'll copy below.

- [ ] **Step 2: Create the shared helpers module**

Create `src/lib/metaGraph.js`:

```javascript
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
```

- [ ] **Step 3: Update the existing Meta ads route to use the shared module**

Open `src/app/api/meta-ads/route.js`.

Replace the top of the file (imports + duplicated helpers) so it uses the library. The imports and the two helper function definitions (`getTimeRange` at ~line 11, `graphGet` at ~line 46) and the `GRAPH_BASE` constant should all be removed from this file.

Old imports at top:

```javascript
import { NextResponse } from "next/server";
import { getCredentials } from "../../../lib/dbFunctions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const GRAPH_BASE = "https://graph.facebook.com/v19.0";
```

Replace with:

```javascript
import { NextResponse } from "next/server";
import { graphGet, getTimeRange, getMetaAccessToken } from "../../../lib/metaGraph";

export const dynamic = "force-dynamic";
export const revalidate = 0;
```

Delete the local `getTimeRange` function (~line 11-31) and the local `graphGet` function (~line 46-56) and the `const GRAPH_BASE = ...` line.

The existing body that reads `creds.meta_access_token` (~line 97-98) should be replaced with `const token = await getMetaAccessToken();` (which also keeps the current fallback path of throwing if not configured).

- [ ] **Step 4: Verify the existing route still works**

Start the dev server:
```bash
npm run dev
```

In a second terminal, hit the existing endpoint with an account you know has data (check the dashboard for a valid `accountId`):
```bash
curl "http://localhost:3000/api/meta-ads?accountId=ACT_XXXXX&range=28d" -H "Cookie: <your-session-cookie>" | head -50
```

Expected: JSON with `data.account.totals`, `data.account.campaigns`, `data.account.trend`. Same shape as before. No 500s. Confirm by loading `/dashboard/meta` in the browser — every existing widget should render identically.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metaGraph.js src/app/api/meta-ads/route.js
git commit -m "refactor: extract shared Meta Graph helpers to src/lib/metaGraph.js

No behavior change. Prepares for new ad-level and preview routes
that need the same Graph/token/time-range helpers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Ads list API route

**Files:**
- Create: `src/app/api/meta-ads/ad-set/[adSetId]/ads/route.js`

- [ ] **Step 1: Create the route file with auth guard**

Create `src/app/api/meta-ads/ad-set/[adSetId]/ads/route.js`:

```javascript
// src/app/api/meta-ads/ad-set/[adSetId]/ads/route.js
// Returns the ads within a given ad set with creative summary + insights
// for the requested date range.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../../lib/auth';
import { graphGet, getTimeRange, getMetaAccessToken } from '../../../../../../lib/metaGraph';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function sumActions(actions, ...keywords) {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, a) => {
    if (keywords.some((k) => a.action_type?.includes(k))) {
      return sum + parseFloat(a.value || 0);
    }
    return sum;
  }, 0);
}

function shapeAd(ad) {
  const ins = ad.insights?.data?.[0] || {};
  const spend = parseFloat(ins.spend || 0);
  const revenue = sumActions(ins.action_values, 'purchase', 'omni_purchase');
  const conversions = sumActions(ins.actions, 'purchase', 'omni_purchase', 'lead', 'complete_registration');

  return {
    id: ad.id,
    name: ad.name,
    status: ad.status,
    effective_status: ad.effective_status,
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
    insights: {
      spend,
      impressions: parseInt(ins.impressions || 0, 10),
      clicks: parseInt(ins.clicks || 0, 10),
      ctr: parseFloat(ins.ctr || 0) / 100, // Meta returns % not ratio
      cpc: parseFloat(ins.cpc || 0),
      cpm: parseFloat(ins.cpm || 0),
      conversions,
      cost_per_conversion: conversions > 0 ? spend / conversions : null,
      revenue,
      roas: spend > 0 ? revenue / spend : null,
    },
  };
}

export async function GET(request, { params }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { adSetId } = await params;
  if (!adSetId) return NextResponse.json({ error: 'adSetId required' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || '28d';
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const timeRange = getTimeRange(range, startDate, endDate);

  try {
    const token = await getMetaAccessToken();

    // Fetch ads (up to 50) with creative details AND inline insights via the
    // `insights.time_range(...)` field expansion pattern so we do one round-trip.
    const insightsFields = 'spend,impressions,clicks,ctr,cpc,cpm,actions,action_values';
    const fields = [
      'id',
      'name',
      'status',
      'effective_status',
      'creative{id,title,body,call_to_action_type,image_url,thumbnail_url,object_story_id}',
      `insights.time_range(${JSON.stringify(timeRange)}){${insightsFields}}`,
    ].join(',');

    const resp = await graphGet(adSetId, { fields, limit: 50 }, token);

    // When calling the Node at `{adSetId}` with `fields=` Meta returns the
    // ad set object with no `.data` array. We need the edge call instead.
    // Fall back: if `resp.id === adSetId` without an `ads` edge, hit `/ads`.
    let adsRaw = Array.isArray(resp?.data) ? resp.data : resp?.ads?.data;
    if (!adsRaw) {
      const edgeResp = await graphGet(`${adSetId}/ads`, { fields, limit: 50 }, token);
      adsRaw = edgeResp?.data || [];
    }

    const data = adsRaw.map(shapeAd);
    return NextResponse.json({ data, dateRange: timeRange });
  } catch (err) {
    const status = err?.status || 500;
    return NextResponse.json(
      { error: err?.message || 'Meta API error', code: err?.code },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
```

- [ ] **Step 2: Start the dev server and test the new route**

In terminal A:
```bash
npm run dev
```

In terminal B, call the endpoint with a known ad set ID (find one via `/dashboard/meta` — pick any account, drill into a campaign, pick an ad set, copy its ID from the network tab or DOM):

```bash
curl "http://localhost:3000/api/meta-ads/ad-set/<ADSET_ID>/ads?range=28d" \
  -H "Cookie: <your-session-cookie>" | python -m json.tool | head -60
```

Expected output: a JSON object with a `data` array. Each entry should have `id`, `name`, `status`, `creative` (with `image_url` OR `null`), and `insights` with numeric fields. If `insights.spend` is `0` across all ads, try a wider `range=3m` — that confirms the endpoint works but the test ad set just has no recent spend.

If you see `{ "error": "Unauthorized" }`, you forgot the session cookie — grab it from DevTools → Application → Cookies under your running session.

If you see `{ "error": "(#200) Permissions error" }` or similar, the existing access token doesn't have `ads_read` on this account. Check with the product owner — but the spec notes this should already be granted for every account that shows up in `/dashboard/meta`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/meta-ads/ad-set/\[adSetId\]/ads/route.js
git commit -m "feat: add /api/meta-ads/ad-set/[adSetId]/ads route

Returns all ads within an ad set with creative summary and
per-ad insights for the requested date range. Read-only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Preview API route with in-memory cache

**Files:**
- Create: `src/app/api/meta-ads/ad/[adId]/preview/route.js`

- [ ] **Step 1: Create the route with a module-level cache Map**

Create `src/app/api/meta-ads/ad/[adId]/preview/route.js`:

```javascript
// src/app/api/meta-ads/ad/[adId]/preview/route.js
// Proxies Meta's /{adId}/previews endpoint. Returns raw HTML (an <iframe>
// snippet) for the requested ad format. Cached in-memory for 15 minutes
// because preview HTML is deterministic until the ad itself is edited.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../../lib/auth';
import { graphGet, getMetaAccessToken } from '../../../../../../lib/metaGraph';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// Key: `${adId}:${format}` → { html, expiresAt }
const previewCache = new Map();

const ALLOWED_FORMATS = new Set([
  'MOBILE_FEED_STANDARD',
  'DESKTOP_FEED_STANDARD',
  'INSTAGRAM_STANDARD',
  'INSTAGRAM_STORY',
  'INSTAGRAM_REELS',
  'FACEBOOK_REELS_MOBILE',
  'FACEBOOK_STORY_MOBILE',
]);

export async function GET(request, { params }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { adId } = await params;
  if (!adId) return NextResponse.json({ error: 'adId required' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'MOBILE_FEED_STANDARD';
  if (!ALLOWED_FORMATS.has(format)) {
    return NextResponse.json({ error: `unsupported format: ${format}` }, { status: 400 });
  }

  const cacheKey = `${adId}:${format}`;
  const hit = previewCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json({ html: hit.html, format, cached: true });
  }

  try {
    const token = await getMetaAccessToken();
    const resp = await graphGet(`${adId}/previews`, { ad_format: format }, token);
    // Meta returns { data: [{ body: "<iframe ...></iframe>" }] }
    const html = resp?.data?.[0]?.body || null;

    if (!html) {
      return NextResponse.json({ html: null, format, unsupported: true });
    }

    previewCache.set(cacheKey, { html, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ html, format, cached: false });
  } catch (err) {
    // Common: "Unsupported ad format" when an ad can't render in this placement.
    if (/unsupported|Invalid parameter/i.test(err?.message || '')) {
      return NextResponse.json({ html: null, format, unsupported: true });
    }
    const status = err?.status || 500;
    return NextResponse.json(
      { error: err?.message || 'Meta API error' },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
```

- [ ] **Step 2: Test the preview route with a known active ad ID**

Use an `id` from the response of Task 2's test. With the dev server running:

```bash
curl "http://localhost:3000/api/meta-ads/ad/<AD_ID>/preview?format=MOBILE_FEED_STANDARD" \
  -H "Cookie: <your-session-cookie>" | python -m json.tool | head -20
```

Expected: `{ "html": "<iframe src=\"https://www.facebook.com/...\"></iframe>", "format": "MOBILE_FEED_STANDARD", "cached": false }`. Run it twice; the second call should return `"cached": true` and respond instantly.

Then test an unsupported format on a feed-only ad to verify the fallback path:

```bash
curl "http://localhost:3000/api/meta-ads/ad/<AD_ID>/preview?format=INSTAGRAM_STORY" \
  -H "Cookie: <your-session-cookie>"
```

Expected: either `{ "html": "<iframe ..." }` (if the ad supports stories) or `{ "html": null, "format": "INSTAGRAM_STORY", "unsupported": true }`. No 500.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/meta-ads/ad/\[adId\]/preview/route.js
git commit -m "feat: add /api/meta-ads/ad/[adId]/preview route with 15m cache

Proxies Meta's /previews endpoint and caches the returned HTML in
an in-memory Map for 15 minutes (preview HTML is deterministic
until the ad is edited). Gracefully returns { unsupported: true }
when Meta can't render the ad in the requested placement.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `MetaAdPreview` component — single ad card

**Files:**
- Create: `src/app/dashboard/meta/components/MetaAdPreview.jsx`

- [ ] **Step 1: Make the components directory**

```bash
mkdir -p src/app/dashboard/meta/components
```

- [ ] **Step 2: Create the card component**

Create `src/app/dashboard/meta/components/MetaAdPreview.jsx`:

```jsx
// src/app/dashboard/meta/components/MetaAdPreview.jsx
"use client";

import { useEffect, useState } from "react";

const FORMATS = [
  { key: "MOBILE_FEED_STANDARD",  label: "Mobile" },
  { key: "DESKTOP_FEED_STANDARD", label: "Desktop" },
  { key: "INSTAGRAM_STANDARD",    label: "IG Feed" },
  { key: "FACEBOOK_REELS_MOBILE", label: "Reels" },
];

const C = {
  card:     "#1a1a2e",
  cardAlt:  "#13131f",
  border:   "rgba(255,255,255,0.08)",
  accent:   "#e94560",
  teal:     "#4ecca3",
  amber:    "#f5a623",
  textPri:  "#ffffff",
  textSec:  "rgba(255,255,255,0.55)",
  textMut:  "rgba(255,255,255,0.35)",
};

const STATUS_COLORS = {
  ACTIVE:     C.teal,
  PAUSED:     C.textMut,
  DELETED:    C.accent,
  ARCHIVED:   C.textMut,
};

function fmtCurrency(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(2) + "%";
}
function fmtRoas(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2) + "x";
}

export default function MetaAdPreview({ ad }) {
  const [activeFormat, setActiveFormat] = useState(FORMATS[0].key);
  // Local cache: { [format]: { html, unsupported, loading, error } }
  const [previews, setPreviews] = useState({});

  // Lazy-fetch the active format if we haven't seen it yet.
  useEffect(() => {
    if (previews[activeFormat]) return;
    let cancelled = false;
    setPreviews((p) => ({ ...p, [activeFormat]: { loading: true } }));
    fetch(`/api/meta-ads/ad/${ad.id}/preview?format=${activeFormat}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setPreviews((p) => ({
          ...p,
          [activeFormat]: {
            html: j.html || null,
            unsupported: !!j.unsupported,
            error: j.error || null,
            loading: false,
          },
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviews((p) => ({ ...p, [activeFormat]: { loading: false, error: err.message } }));
      });
    return () => { cancelled = true; };
  }, [activeFormat, ad.id, previews]);

  const current = previews[activeFormat] || { loading: true };
  const statusColor = STATUS_COLORS[ad.effective_status] || STATUS_COLORS[ad.status] || C.textMut;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ad.name}>
            {ad.name}
          </p>
          {ad.creative?.title && (
            <p style={{ fontSize: 11, color: C.textSec, margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ad.creative.title}
            </p>
          )}
        </div>
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", padding: "3px 8px", borderRadius: 10, color: statusColor, border: `1px solid ${statusColor}55`, background: `${statusColor}18` }}>
          {ad.effective_status || ad.status}
        </span>
      </div>

      {/* Placement tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, background: C.cardAlt, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {FORMATS.map((f) => (
          <button
            key={f.key}
            onClick={() => setActiveFormat(f.key)}
            style={{
              flexShrink: 0,
              padding: "8px 12px",
              fontSize: 11,
              fontWeight: 700,
              background: "transparent",
              color: activeFormat === f.key ? C.textPri : C.textSec,
              border: "none",
              borderBottom: `2px solid ${activeFormat === f.key ? C.accent : "transparent"}`,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Preview */}
      <div style={{ background: "#0a0a12", minHeight: 360, display: "flex", alignItems: "stretch", justifyContent: "center" }}>
        {current.loading && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMut, fontSize: 12, alignSelf: "center" }}>Loading preview…</div>
        )}
        {!current.loading && current.html && (
          <div
            style={{ width: "100%", minHeight: 360 }}
            dangerouslySetInnerHTML={{ __html: current.html }}
          />
        )}
        {!current.loading && !current.html && current.unsupported && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMut, fontSize: 12, alignSelf: "center" }}>
            This ad doesn&apos;t render in {FORMATS.find((f) => f.key === activeFormat)?.label}.
            {ad.creative?.image_url && (
              <img src={ad.creative.image_url} alt="" style={{ maxWidth: "100%", marginTop: 16, borderRadius: 8 }} />
            )}
          </div>
        )}
        {!current.loading && !current.html && current.error && (
          <div style={{ padding: 40, textAlign: "center", color: C.amber, fontSize: 12, alignSelf: "center" }}>
            Preview unavailable. {ad.creative?.image_url && <><br /><img src={ad.creative.image_url} alt="" style={{ maxWidth: "100%", marginTop: 12, borderRadius: 8 }} /></>}
            {ad.creative?.body && <p style={{ color: C.textSec, marginTop: 12 }}>{ad.creative.body}</p>}
          </div>
        )}
      </div>

      {/* Metrics */}
      <div style={{ padding: "12px 14px", background: C.card }}>
        <MetricRow items={[
          { label: "Spend",   value: fmtCurrency(ad.insights?.spend) },
          { label: "Impr",    value: fmtInt(ad.insights?.impressions) },
          { label: "Clicks",  value: fmtInt(ad.insights?.clicks) },
          { label: "CTR",     value: fmtPct(ad.insights?.ctr) },
        ]} />
        <div style={{ height: 8 }} />
        <MetricRow items={[
          { label: "Conv",   value: fmtInt(ad.insights?.conversions) },
          { label: "CPA",    value: fmtCurrency(ad.insights?.cost_per_conversion) },
          { label: "ROAS",   value: fmtRoas(ad.insights?.roas) },
        ]} />
      </div>
    </div>
  );
}

function MetricRow({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 8 }}>
      {items.map((it) => (
        <div key={it.label}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "rgba(255,255,255,0.5)", margin: 0 }}>{it.label}</p>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#ffffff", margin: "2px 0 0" }}>{it.value}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Syntax-check the file compiles**

```bash
node --check src/app/dashboard/meta/components/MetaAdPreview.jsx
```

Note: Node can't parse JSX. `node --check` will error with "Unexpected token '<'" — that's expected. Run instead:

```bash
npx next lint --file src/app/dashboard/meta/components/MetaAdPreview.jsx 2>&1 | head -20
```

Expected: no errors. Warnings about `<img>` in place of `next/image` are expected and OK for this use case (the creative URL is external and short-lived).

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/meta/components/MetaAdPreview.jsx
git commit -m "feat: add MetaAdPreview card component

Renders a single ad with placement tabs, Meta-rendered preview
iframe (lazy-loaded per format), client-side per-format cache,
and per-ad metrics. Falls back to creative image + body text
when the preview API returns unsupported or errors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `MetaAdsPanel` slide-out panel

**Files:**
- Create: `src/app/dashboard/meta/components/MetaAdsPanel.jsx`

- [ ] **Step 1: Create the panel component**

Create `src/app/dashboard/meta/components/MetaAdsPanel.jsx`:

```jsx
// src/app/dashboard/meta/components/MetaAdsPanel.jsx
"use client";

import { useEffect, useMemo, useState } from "react";
import MetaAdPreview from "./MetaAdPreview";

const C = {
  bg:       "#0f0f17",
  card:     "#1a1a2e",
  cardAlt:  "#13131f",
  border:   "rgba(255,255,255,0.08)",
  accent:   "#e94560",
  teal:     "#4ecca3",
  amber:    "#f5a623",
  textPri:  "#ffffff",
  textSec:  "rgba(255,255,255,0.55)",
  textMut:  "rgba(255,255,255,0.35)",
};

const SORT_OPTIONS = [
  { key: "spend",       label: "Spend" },
  { key: "impressions", label: "Impressions" },
  { key: "ctr",         label: "CTR" },
  { key: "conversions", label: "Conversions" },
  { key: "roas",        label: "ROAS" },
];

export default function MetaAdsPanel({ open, onClose, adSet, campaignName, range, startDate, endDate }) {
  const [ads, setAds] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("spend");
  const [activeOnly, setActiveOnly] = useState(true);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Fetch ads when panel opens or inputs change
  useEffect(() => {
    if (!open || !adSet?.id) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setAds(null);

    const params = new URLSearchParams({ range: range || "28d" });
    if (range === "custom" && startDate && endDate) {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }

    fetch(`/api/meta-ads/ad-set/${adSet.id}/ads?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : r.json().then((j) => { throw new Error(j.error || `HTTP ${r.status}`); }))
      .then((j) => { setAds(j.data || []); })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message || "Failed to load ads");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [open, adSet?.id, range, startDate, endDate]);

  const visibleAds = useMemo(() => {
    if (!ads) return [];
    let list = activeOnly ? ads.filter((a) => a.effective_status === "ACTIVE" || a.status === "ACTIVE") : ads;
    list = [...list].sort((a, b) => {
      const av = a.insights?.[sortKey] ?? 0;
      const bv = b.insights?.[sortKey] ?? 0;
      return (bv || 0) - (av || 0);
    });
    return list;
  }, [ads, sortKey, activeOnly]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 40,
          background: "rgba(0,0,0,0.5)", transition: "opacity 0.2s",
        }}
      />
      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41,
        width: 560, maxWidth: "100vw",
        background: C.bg,
        borderLeft: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 18px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: C.accent, margin: "0 0 4px" }}>ADS IN AD SET</p>
              {campaignName && (
                <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {campaignName}
                </p>
              )}
              <p style={{ fontSize: 15, fontWeight: 700, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={adSet?.name}>
                {adSet?.name || "Ad set"}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ flexShrink: 0, background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: C.textSec, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <label style={{ fontSize: 11, color: C.textSec, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
              />
              Active only
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: C.textSec }}>Sort:</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                style={{ background: C.cardAlt, color: C.textPri, border: `1px solid ${C.border}`, borderRadius: 5, padding: "4px 8px", fontSize: 12 }}
              >
                {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <span style={{ fontSize: 11, color: C.textMut, marginLeft: "auto" }}>
              {ads ? `${visibleAds.length} of ${ads.length} ads` : ""}
            </span>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 40px" }}>
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: C.textSec, fontSize: 13 }}>Loading ads…</div>
          )}
          {!loading && error && (
            <div style={{ padding: 18, background: "rgba(233,69,96,0.1)", border: "1px solid rgba(233,69,96,0.3)", borderRadius: 8, color: C.accent, fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && visibleAds.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: C.textMut, fontSize: 13 }}>
              {ads?.length === 0 ? "No ads in this ad set." : "No ads match the current filter."}
            </div>
          )}
          {!loading && !error && visibleAds.map((ad) => (
            <MetaAdPreview key={ad.id} ad={ad} />
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Lint-check the file**

```bash
npx next lint --file src/app/dashboard/meta/components/MetaAdsPanel.jsx 2>&1 | head -20
```

Expected: no errors. Warnings about apostrophes in strings are acceptable as long as no JSX text contains an unescaped `'` — if any fail, escape with `&apos;`.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/meta/components/MetaAdsPanel.jsx
git commit -m "feat: add MetaAdsPanel slide-out component

Right-slide panel with header (ad set + campaign breadcrumb),
active-only toggle (default ON), sort dropdown (default spend
desc), and a scrollable list of MetaAdPreview cards. ESC +
backdrop click to dismiss; aborts outstanding fetches on close.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire the panel into the Meta dashboard page

**Files:**
- Modify: `src/app/dashboard/meta/page.js`

- [ ] **Step 1: Locate the ad set table rendering in `page.js`**

```bash
grep -n "Ad Set\|adSet\|ad_set_name\|AdSetTable\|campaign.*ads" src/app/dashboard/meta/page.js | head -20
```

Find the component that renders the ad set rows. Note the row container's element/style and the variable name holding the current ad set array — call it `ADSET_ROW_PROPS` below. Write down (a) the component file, (b) the loop variable inside `.map((adSet) => ...)` or similar, (c) the existing row `<tr>` or `<div>` opening tag.

- [ ] **Step 2: Add panel state and imports at the top of the component**

Open `src/app/dashboard/meta/page.js`. Near the top of the component (after the other `useState` declarations), add:

```javascript
const [adsPanelAdSet, setAdsPanelAdSet] = useState(null);
```

In the imports block at the top of the file, add:

```javascript
import MetaAdsPanel from "./components/MetaAdsPanel";
```

- [ ] **Step 3: Make each ad set row clickable**

Find the ad set row's opening tag (from Step 1). If it's a `<tr>`, add:

```jsx
<tr
  onClick={() => setAdsPanelAdSet(adSet)}
  style={{ /* ...existing... */, cursor: "pointer" }}
  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
  onMouseLeave={(e) => e.currentTarget.style.background = ""}
>
```

If it's a `<div>`, do the equivalent.

Then at the END of the last `<td>` / column of each row, insert a chevron cell:

```jsx
<td style={{ width: 24, textAlign: "right", color: "rgba(255,255,255,0.35)", fontSize: 16 }}>›</td>
```

(If it's a div-based layout, add a trailing `<span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.35)" }}>›</span>` inside the row.)

Add a matching empty `<th></th>` at the end of the table head row so columns align.

**Ensure existing onClick handlers inside the row (e.g. sort buttons, checkboxes) call `e.stopPropagation()`** so they don't open the panel. Example:

```jsx
<button onClick={(e) => { e.stopPropagation(); doSomething(); }}>…</button>
```

- [ ] **Step 4: Mount the panel at the bottom of the page JSX**

Just before the closing tag of the page's outermost container, add:

```jsx
<MetaAdsPanel
  open={!!adsPanelAdSet}
  onClose={() => setAdsPanelAdSet(null)}
  adSet={adsPanelAdSet}
  campaignName={selectedCampaign?.name || null}
  range={dateRange}
  startDate={customDateRange?.startDate}
  endDate={customDateRange?.endDate}
/>
```

If the page uses different prop names for the current campaign / custom dates, substitute them — grep for `selectedCampaign`, `dateRange`, and `customDateRange` in `page.js` to find the actual identifiers.

- [ ] **Step 5: Browser test the full flow (desktop)**

Start the dev server:
```bash
npm run dev
```

Navigate to `http://localhost:3000/dashboard/meta`. Log in, pick an account with active campaigns, pick a campaign. In the ad set table:

- Hover an ad set row → background lightens, chevron visible on the right
- Click a row → slide-out panel opens from the right
- Confirm header shows: "ADS IN AD SET" → campaign name → ad set name
- Confirm "Active only" checkbox is ON and sort is "Spend"
- Wait ~1s — ad cards populate in spend desc order. Each card should show a Meta preview iframe rendering the actual ad
- Click a card's "Desktop" tab → the iframe re-fetches and shows the desktop format
- Click a card's "Reels" tab → either renders or shows the fallback "This ad doesn't render in Reels" message with the creative image
- Click the "Active only" checkbox OFF → paused/archived ads appear
- Change the sort dropdown → cards reorder
- Press ESC → panel closes
- Click another ad set row → opens for that ad set (previous cache discarded, fresh ads list)
- Click the backdrop (outside the panel) → panel closes

Any failure here is a bug — do NOT commit until all checks pass. If the iframe fails to render, open DevTools Network tab and inspect the preview request; look for 401 (session issue), 400 (format issue), or HTML that's being stripped by a CSP.

- [ ] **Step 6: Browser test mobile (DevTools device toolbar)**

In the browser's DevTools, open device toolbar (Cmd/Ctrl+Shift+M), pick "iPhone 14 Pro" (390×844).

Navigate to `/dashboard/meta`. Open the mobile filter sheet, pick an account and campaign, close the sheet. Scroll down to the ad set table. Tap a row.

Expected:
- Panel slides in and covers the entire viewport (no horizontal scroll)
- Iframe fits within ~390px wide without horizontal scroll
- Header controls (Active only, Sort, count) wrap to a second line cleanly
- Close button is tappable (at least 32px square)
- Tab bar ("Mobile | Desktop | IG Feed | Reels") is horizontally scrollable if it doesn't fit

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/meta/page.js
git commit -m "feat: open ad-level panel from ad set rows on Meta dashboard

Clicking any ad set row opens MetaAdsPanel with that set's ads.
Row gets a hover highlight and a trailing chevron to signal
clickability. Existing per-cell controls stop propagation so
they don't accidentally open the panel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Self-QA checklist + final polish

**Files:** none modified unless a regression is found.

- [ ] **Step 1: Regression check the existing Meta dashboard**

With dev server running, hit `/dashboard/meta` and walk through:
- Account picker still works (dropdown opens, selecting changes accounts)
- Campaign picker still works
- 12 KPI cards still render with correct numbers + delta badges
- Trend chart still renders
- Date range pickers still work (7d, 28d, MTD, 3m, 6m, Custom)
- Campaign table still sortable + searchable
- Ad set table appears when a campaign is selected
- No new console errors, no new failed network requests (aside from expected `/ads` and `/preview` calls)

If anything above is broken, git-bisect between Task 1 and Task 6 to identify which task introduced the regression and fix it in a follow-up commit.

- [ ] **Step 2: Preview cache behavior check**

With the dev server running, open the ads panel on an ad set. Note the Network tab: you should see one `/preview?format=MOBILE_FEED_STANDARD` request per ad.

Close the panel. Re-open it within 15 minutes. The preview requests should return faster (check response times in the Network tab). The JSON body should include `"cached": true`.

Wait 16+ minutes and open again — `"cached": false` again. This verifies the TTL.

- [ ] **Step 3: Error path manual tests**

Edit `src/app/api/meta-ads/ad/[adId]/preview/route.js` temporarily to force an error (add `throw new Error("test");` before the try block). Restart the dev server. Open the ads panel. Confirm each card renders the fallback: "Preview unavailable" text + creative image + body copy, and the panel itself does not crash. Revert the change.

Do the same for `/api/meta-ads/ad-set/[adSetId]/ads/route.js` — force a 500. Confirm the panel shows an error banner and the close button still works.

- [ ] **Step 4: Update the dashboard home "What's New" banner**

Open `src/app/dashboard/page.js` and update the `WHATS_NEW_TITLE` and `WHATS_NEW_BODY` constants:

```javascript
const WHATS_NEW_TITLE = "Meta ad-level view with live creative previews";
const WHATS_NEW_BODY  = "Click any ad set row on the Meta Ads page to open a slide-out panel with every ad's real Meta-rendered preview, per-placement tabs (Mobile Feed, Desktop, Instagram, Reels), and full per-ad metrics — spend, CTR, conversions, ROAS. Read-only; never pages through Meta Ads Manager.";
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.js
git commit -m "docs: announce Meta ad-level view in What's New banner

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Done

At the end of Task 7, the feature is complete:
- Shared Meta Graph lib with extracted helpers
- Two new read-only API routes (ads list + preview, with cache)
- Two new components (MetaAdsPanel + MetaAdPreview)
- Page wired up with clickable rows
- Regression + error path + mobile verified manually
- What's New banner refreshed

Phase 2 (Meta Ads Audit) can now build on the ad-level data infrastructure this phase introduces. The ads list endpoint is reusable verbatim for the audit's creative-diversity and ad-fatigue pillars.
