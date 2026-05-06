# API Usage Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track every Meta Graph API call and enforce a configurable monthly Claude spend cap, surfaced in a new "API Health" section on the existing admin usage page.

**Architecture:** A new `ApiCallLog` MongoDB collection (7-day TTL) stores every Meta Graph API call logged fire-and-forget from the central `metaGraph.js` helper. A `Settings` collection holds the monthly Claude budget cap. Each Claude route checks current-month spend against the cap before calling Anthropic. A new `/api/admin/api-health` endpoint aggregates both data sources; the admin usage dashboard gains an API Health section with two cards.

**Tech Stack:** Next.js App Router, MongoDB native driver (already connected via `src/lib/mongoose.js`), existing `usageLogger.js` + `metaGraph.js` patterns.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/lib/apiCallLogger.js` | `logMetaCall()` + TTL index bootstrap |
| Modify | `src/lib/metaGraph.js` | Wrap `graphGet()` to fire-and-forget log |
| Modify | `src/lib/usageLogger.js` | Add `getMonthlyClaudeCost()` + `getClaudeBudgetCap()` |
| Modify | `src/app/api/claude/meta-audit/route.js` | Monthly budget check |
| Modify | `src/app/api/claude/google-ads-audit/route.js` | Monthly budget check |
| Modify | `src/app/api/claude/ad-review/route.js` | Monthly budget check |
| Modify | `src/app/api/report/analyze/route.js` | Monthly budget check |
| Modify | `src/app/api/seo-audit/analyze/route.js` | Monthly budget check |
| Create | `src/app/api/admin/api-health/route.js` | Admin GET — Meta call counts + Claude spend |
| Modify | `src/app/dashboard/admin/usage/page.js` | Add API Health section |

---

## Task 1: Create `src/lib/apiCallLogger.js`

**Files:**
- Create: `src/lib/apiCallLogger.js`

- [ ] **Step 1: Create the file**

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

- [ ] **Step 2: Verify the file saved cleanly**

Open `src/lib/apiCallLogger.js` and confirm it exports `logMetaCall`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/apiCallLogger.js
git commit -m "feat: add Meta API call logger with 7-day TTL"
```

---

## Task 2: Instrument `metaGraph.js`

**Files:**
- Modify: `src/lib/metaGraph.js`

- [ ] **Step 1: Add import at the top of `src/lib/metaGraph.js`**

After the existing `import { getCredentials } from './dbFunctions';` line, add:

```js
import { logMetaCall } from './apiCallLogger';
```

- [ ] **Step 2: Wrap `graphGet()` to time and log every call**

Replace the existing `graphGet` function body with:

```js
export async function graphGet(path, params, token) {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.searchParams.set('access_token', token);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v == null) return;
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const t0 = Date.now();
  const res = await fetch(url.toString(), { cache: 'no-store' });
  const json = await res.json();
  logMetaCall(path || '/', res.status, Date.now() - t0).catch(() => {});
  if (json.error) {
    const err = new Error(json.error.message || `Meta API error on /${path}`);
    err.status = res.status;
    err.code = json.error.code;
    err.subcode = json.error.error_subcode;
    throw err;
  }
  return json;
}
```

- [ ] **Step 3: Verify — load the Meta Ads dashboard and check MongoDB**

Start the dev server (`npm run dev`), open the Meta Ads dashboard, then in MongoDB Atlas (or Compass) run:

```js
db.ApiCallLog.findOne()
// Expected: { api: 'meta', endpoint: '...', status: 200, durationMs: 123, timestamp: ISODate(...) }
```

Also confirm the TTL index exists:

```js
db.ApiCallLog.getIndexes()
// Expected: one index with key { timestamp: 1 } and expireAfterSeconds: 604800
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/metaGraph.js
git commit -m "feat: log every Meta Graph API call to ApiCallLog"
```

---

## Task 3: Add budget helpers to `usageLogger.js`

**Files:**
- Modify: `src/lib/usageLogger.js`

- [ ] **Step 1: Add `getMonthlyClaudeCost` and `getClaudeBudgetCap` at the bottom of `src/lib/usageLogger.js`**

Append after the existing `logApiUsage` function:

```js
export async function getMonthlyClaudeCost() {
  try {
    const client = await dbConnect();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const result = await client.db(DB).collection(COLLECTION).aggregate([
      { $match: { type: 'claude_tokens', timestamp: { $gte: monthStart } } },
      { $group: { _id: null, totalCost: { $sum: '$estimatedCostUsd' } } },
    ]).toArray();
    return result[0]?.totalCost ?? 0;
  } catch {
    return 0;
  }
}

export async function getClaudeBudgetCap() {
  try {
    const client = await dbConnect();
    const doc = await client.db(DB).collection('Settings').findOne({ key: 'claude_monthly_budget_usd' });
    return doc?.value ?? 50;
  } catch {
    return 50;
  }
}
```

- [ ] **Step 2: Verify the exports are correct**

The file should now export: `estimateClaudeCost`, `logApiUsage`, `getMonthlyClaudeCost`, `getClaudeBudgetCap`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/usageLogger.js
git commit -m "feat: add monthly Claude cost + budget cap helpers"
```

---

## Task 4: Add monthly budget check to all Claude routes

**Files:**
- Modify: `src/app/api/claude/meta-audit/route.js`
- Modify: `src/app/api/claude/google-ads-audit/route.js`
- Modify: `src/app/api/claude/ad-review/route.js`
- Modify: `src/app/api/report/analyze/route.js`
- Modify: `src/app/api/seo-audit/analyze/route.js`

The same two-line change applies to each route. The budget check runs after auth + daily-limit checks, before the Anthropic SDK call.

### 4a — `src/app/api/claude/meta-audit/route.js`

- [ ] **Step 1: Add import**

Find the existing import line:
```js
import { logApiUsage, estimateClaudeCost } from '../../../../lib/usageLogger';
```
Replace with:
```js
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
```

- [ ] **Step 2: Add budget check**

Find this block (it runs after the daily-limit check):
```js
  await incrementDailyUsage(db, email);
```
After that line, add:
```js
  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, limitReached: true, requestId },
      { status: 429 },
    );
  }
```

### 4b — `src/app/api/claude/google-ads-audit/route.js`

- [ ] **Step 3: Add import**

Find:
```js
import { logApiUsage, estimateClaudeCost } from '../../../../lib/usageLogger';
```
Replace with:
```js
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
```

- [ ] **Step 4: Add budget check**

Find the `incrementDailyUsage` call in this route and add the same block immediately after it:
```js
  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, limitReached: true, requestId },
      { status: 429 },
    );
  }
```

### 4c — `src/app/api/claude/ad-review/route.js`

- [ ] **Step 5: Add import**

Find:
```js
import { logApiUsage, estimateClaudeCost } from '../../../../lib/usageLogger';
```
Replace with:
```js
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
```

- [ ] **Step 6: Add budget check**

In this route the daily-limit check ends with an early return if over limit. Find the block that returns a 429 for the daily limit, then immediately after its closing brace add:
```js
  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, limitReached: true },
      { status: 429 },
    );
  }
```

### 4d — `src/app/api/report/analyze/route.js`

- [ ] **Step 7: Add import**

Find:
```js
import { logApiUsage, estimateClaudeCost } from '../../../../lib/usageLogger';
```
Replace with:
```js
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
```

- [ ] **Step 8: Add budget check**

This route has no daily-limit check. Add the budget check immediately before the `new Anthropic(...)` call:
```js
  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, limitReached: true },
      { status: 429 },
    );
  }
```

### 4e — `src/app/api/seo-audit/analyze/route.js`

- [ ] **Step 9: Add import**

Find:
```js
import { logApiUsage, estimateClaudeCost } from '../../../../lib/usageLogger';
```
Replace with:
```js
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
```

- [ ] **Step 10: Add budget check**

Add immediately before the `new Anthropic(...)` call:
```js
  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, limitReached: true },
      { status: 429 },
    );
  }
```

- [ ] **Step 11: Commit all five route changes**

```bash
git add src/app/api/claude/meta-audit/route.js \
        src/app/api/claude/google-ads-audit/route.js \
        src/app/api/claude/ad-review/route.js \
        src/app/api/report/analyze/route.js \
        src/app/api/seo-audit/analyze/route.js
git commit -m "feat: block Claude calls when monthly budget cap is exceeded"
```

---

## Task 5: Create `/api/admin/api-health/route.js`

**Files:**
- Create: `src/app/api/admin/api-health/route.js`

- [ ] **Step 1: Create the route file**

```js
// src/app/api/admin/api-health/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await dbConnect();
  const db = client.db(DB);

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const callLog = db.collection('ApiCallLog');
  const apiUsage = db.collection('ApiUsage');
  const settings = db.collection('Settings');

  const [
    metaLastHour,
    metaToday,
    metaDailyTrend,
    claudeMonthly,
    claudeByFeature,
    budgetCapDoc,
  ] = await Promise.all([
    callLog.countDocuments({ api: 'meta', timestamp: { $gte: oneHourAgo } }),
    callLog.countDocuments({ api: 'meta', timestamp: { $gte: todayStart } }),
    callLog.aggregate([
      { $match: { api: 'meta', timestamp: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, calls: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', calls: 1, _id: 0 } },
    ]).toArray(),
    apiUsage.aggregate([
      { $match: { type: 'claude_tokens', timestamp: { $gte: monthStart } } },
      { $group: { _id: null, totalCost: { $sum: '$estimatedCostUsd' }, calls: { $sum: 1 }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' } } },
    ]).toArray(),
    apiUsage.aggregate([
      { $match: { type: 'claude_tokens', timestamp: { $gte: monthStart } } },
      { $group: { _id: '$feature', cost: { $sum: '$estimatedCostUsd' }, calls: { $sum: 1 } } },
      { $sort: { cost: -1 } },
      { $project: { feature: '$_id', cost: 1, calls: 1, _id: 0 } },
    ]).toArray(),
    settings.findOne({ key: 'claude_monthly_budget_usd' }),
  ]);

  const budgetCap = budgetCapDoc?.value ?? 50;
  const monthly = claudeMonthly[0] ?? { totalCost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };

  return NextResponse.json({
    meta: {
      callsLastHour: metaLastHour,
      callsToday: metaToday,
      hourlyLimit: 200,
      dailyTrend: metaDailyTrend,
    },
    claude: {
      monthlySpend: monthly.totalCost,
      monthlyCalls: monthly.calls,
      monthlyInputTokens: monthly.inputTokens,
      monthlyOutputTokens: monthly.outputTokens,
      budgetCap,
      budgetUsedPct: budgetCap > 0 ? (monthly.totalCost / budgetCap) * 100 : 0,
      byFeature: claudeByFeature,
    },
  });
}
```

- [ ] **Step 2: Verify the endpoint**

With the dev server running, open a browser tab as an admin user and navigate to:
`http://localhost:3000/api/admin/api-health`

Expected response shape:
```json
{
  "meta": { "callsLastHour": 0, "callsToday": 0, "hourlyLimit": 200, "dailyTrend": [] },
  "claude": { "monthlySpend": 0, "monthlyCalls": 0, "budgetCap": 50, "budgetUsedPct": 0, "byFeature": [] }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/api-health/route.js
git commit -m "feat: add /api/admin/api-health endpoint for Meta + Claude usage"
```

---

## Task 6: Add API Health section to admin usage page

**Files:**
- Modify: `src/app/dashboard/admin/usage/page.js`

- [ ] **Step 1: Add `apiHealth` state and fetch to the existing `useEffect` block**

Find the state declarations at the top of `UsageAnalyticsPage`:
```js
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
```
Replace with:
```js
  const [data, setData] = useState(null);
  const [apiHealth, setApiHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
```

- [ ] **Step 2: Fetch api-health alongside existing data**

Find the existing fetch `useEffect`:
```js
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    fetch("/api/admin/usage")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load usage data");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [authStatus]);
```
Replace with:
```js
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    Promise.all([
      fetch("/api/admin/usage").then((r) => { if (!r.ok) throw new Error("Failed to load usage data"); return r.json(); }),
      fetch("/api/admin/api-health").then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([usageData, healthData]) => { setData(usageData); setApiHealth(healthData); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [authStatus]);
```

- [ ] **Step 3: Add the `ApiHealthSection` component**

Add this component definition before the `export default function UsageAnalyticsPage()` line:

```js
function ApiHealthSection({ health }) {
  if (!health) return null;
  const { meta, claude } = health;
  const pct = Math.min(100, Math.round(claude.budgetUsedPct));
  const barColor = pct >= 90 ? "#e74c3c" : pct >= 70 ? "#e67e22" : "#27ae60";

  return (
    <>
      <SectionTitle>API Health</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>

        {/* Meta card */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <p style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.8px", color: "#1877F2", marginBottom: 16 }}>Meta Graph API</p>
          <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Last Hour</p>
              <p style={{ fontSize: 28, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>{meta.callsLastHour}</p>
              <p style={{ fontSize: 11, color: "#bbb", marginTop: 4 }}>of {meta.hourlyLimit} limit</p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Today</p>
              <p style={{ fontSize: 28, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>{meta.callsToday}</p>
            </div>
          </div>
          {meta.dailyTrend?.length > 0 && (
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={meta.dailyTrend} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#ccc" }} tickFormatter={(d) => { const p = d.split("-"); return `${p[1]}/${p[2]}`; }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} formatter={(v) => [v, "calls"]} />
                <Bar dataKey="calls" fill="#1877F2" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Claude card */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <p style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.8px", color: "#8e44ad", marginBottom: 16 }}>Claude API — This Month</p>
          <p style={{ fontSize: 28, fontWeight: 800, color: "#1a1a2e", lineHeight: 1, marginBottom: 6 }}>
            ${claude.monthlySpend.toFixed(2)}
            <span style={{ fontSize: 14, fontWeight: 400, color: "#999" }}> / ${claude.budgetCap.toFixed(2)}</span>
          </p>
          <div style={{ background: "#f0f0f0", borderRadius: 999, height: 8, marginBottom: 6, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, background: barColor, height: "100%", borderRadius: 999, transition: "width 0.4s" }} />
          </div>
          <p style={{ fontSize: 11, color: "#999", marginBottom: 16 }}>{pct}% of monthly budget used · {claude.monthlyCalls} calls</p>
          {claude.byFeature?.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {claude.byFeature.map((f) => (
                  <tr key={f.feature} style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <td style={{ padding: "5px 0", color: "#555" }}>{f.feature || "—"}</td>
                    <td style={{ padding: "5px 0", textAlign: "right", color: "#8e44ad", fontWeight: 700 }}>{f.calls} calls</td>
                    <td style={{ padding: "5px 0", textAlign: "right", color: "#e67e22", fontWeight: 700, paddingLeft: 12 }}>${f.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </>
  );
}
```

- [ ] **Step 4: Render `ApiHealthSection` in the page**

Find the opening of the main content `div` — just before the `{/* KPI Cards */}` comment — and insert the `ApiHealthSection` right after the error block:

```js
        <ApiHealthSection health={apiHealth} />
```

It should appear directly after this block:
```js
        {error && (
          <div style={{ ... }}>
            {error}
          </div>
        )}
```

So the order becomes: `error block → ApiHealthSection → KPI Cards → …`

- [ ] **Step 5: Verify in the browser**

Navigate to `http://localhost:3000/dashboard/admin/usage`. You should see the "API Health" section above the KPI cards with:
- A Meta card showing calls last hour / today and a 7-day bar chart
- A Claude card showing `$0.00 / $50.00`, a green progress bar at 0%, and the feature breakdown table

Trigger a Claude call from any dashboard feature (e.g. run a Meta Ads AI Audit), then refresh the admin page and confirm the Claude card updates.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/admin/usage/page.js
git commit -m "feat: add API Health section to admin usage dashboard"
```

---

## Changing the monthly budget cap

The default cap is $50. To change it, upsert one document in MongoDB:

```js
db.Settings.updateOne(
  { key: 'claude_monthly_budget_usd' },
  { $set: { value: 100 } },   // change 100 to whatever you want
  { upsert: true }
)
```

No deploy required — the cap is read live on every Claude request.
