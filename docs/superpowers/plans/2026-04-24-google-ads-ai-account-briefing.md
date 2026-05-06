# Google Ads AI Account Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an auto-generated Claude briefing at the top of the Google Ads dashboard whenever the selected account has spend > 0. Briefing covers top/bottom performing campaigns, key actions, and can be re-run for any date range.

**Architecture:** New POST route `/api/claude/account-brief` accepts pre-processed campaign data already in client state — zero extra Google Ads API calls. Response cached 4 hours in `apiCache`. UI card auto-triggers on account switch, re-runnable with custom date picker. Spend gate: if `totalSpend === 0`, card is hidden entirely.

**Tech Stack:** Next.js App Router, Anthropic SDK, existing `apiCache` (L1+L2), existing `usageLogger`, existing budget cap pattern

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Create | `src/app/api/claude/account-brief/route.js` | New POST route — Claude briefing with 4h cache |
| Modify | `src/app/dashboard/google/ads/page.js` | Add `AccountBriefCard` component + wire-up |

---

## Data Shape Reference

**Campaign object** (from `allCampaignData[n].campaigns[n]`):
```js
{
  campaignId: string,
  campaignName: string,
  status: number,          // 2=ENABLED, 3=PAUSED, 4=REMOVED
  cost: number,            // micros — divide by 1_000_000 for dollars
  conversions: number,
  clicks: number,
  optimizationScore: number | null,  // 0–100
  searchTerms: [{ searchTerm, clicks, conversions, cost_micros, ctr }],
}
```

**Selected account object:**
```js
const selectedCustomer = allCampaignData.find(
  (item) => String(item.customer.customer_client.id) === String(selectedCustomerId)
);
// selectedCustomer.campaigns — array of campaigns above
// selectedCustomer.customer.customer_client.descriptive_name — account name
```

**Total spend check** (micros → dollars):
```js
const totalSpend = (selectedCustomer?.campaigns || [])
  .reduce((sum, c) => sum + (c.cost || 0), 0) / 1_000_000;
const hasSpend = totalSpend > 0;
```

---

## Task 1: Create `/api/claude/account-brief/route.js`

**Files:**
- Create: `src/app/api/claude/account-brief/route.js`

- [ ] **Step 1: Write the route file**

```js
// src/app/api/claude/account-brief/route.js
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { apiCache } from '../../../../lib/apiCache';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';

const MODEL = 'claude-haiku-4-5-20251001';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { customerId, customerName, campaigns, dateLabel, forceRefresh } = body;
  if (!customerId || !Array.isArray(campaigns)) {
    return NextResponse.json({ error: 'customerId and campaigns required' }, { status: 400 });
  }

  // Spend gate — don't call Claude if account has no spend
  const totalSpendMicros = campaigns.reduce((sum, c) => sum + (c.cost || 0), 0);
  if (totalSpendMicros === 0) {
    return NextResponse.json({ skipped: true, reason: 'no_spend' });
  }

  // Cache check
  const cacheKey = `account-brief:${customerId}:${dateLabel || 'LAST_30_DAYS'}`;
  if (!forceRefresh) {
    const cached = await apiCache.get(cacheKey);
    if (cached) return NextResponse.json({ ...cached, fromCache: true });
  }

  // Budget cap
  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached.`, limitReached: true },
      { status: 429 },
    );
  }

  // Pre-process campaigns into top/bottom performers
  const totalSpend = totalSpendMicros / 1_000_000;
  const withSpend = campaigns
    .filter((c) => c.cost > 0)
    .map((c) => ({
      name: c.campaignName,
      spend: +(c.cost / 1_000_000).toFixed(2),
      conversions: +(c.conversions || 0).toFixed(1),
      clicks: c.clicks || 0,
      cpa: c.conversions > 0 ? +((c.cost / 1_000_000) / c.conversions).toFixed(2) : null,
      status: c.status === 2 ? 'ACTIVE' : c.status === 3 ? 'PAUSED' : 'OTHER',
      optimizationScore: c.optimizationScore != null ? Math.round(c.optimizationScore * 100) : null,
    }));

  const byConversions = [...withSpend].sort((a, b) => b.conversions - a.conversions);
  const topPerformers = byConversions.slice(0, 3);
  const bottomPerformers = [...withSpend]
    .sort((a, b) => {
      // Sort by worst: zero conversions first (by spend desc), then high CPA
      const aScore = a.conversions === 0 ? a.spend * 1000 : -(a.cpa || 0);
      const bScore = b.conversions === 0 ? b.spend * 1000 : -(b.cpa || 0);
      return bScore - aScore;
    })
    .filter((c) => !topPerformers.some((t) => t.name === c.name))
    .slice(0, 3);

  const userPrompt = `You are a senior Google Ads strategist. Analyze this account and return a JSON briefing.

ACCOUNT: ${customerName || customerId}
PERIOD: ${dateLabel || 'Last 30 days'}
TOTAL SPEND: $${totalSpend.toFixed(2)}
TOTAL CONVERSIONS: ${campaigns.reduce((s, c) => s + (c.conversions || 0), 0).toFixed(1)}
ACTIVE CAMPAIGNS: ${withSpend.filter((c) => c.status === 'ACTIVE').length} of ${campaigns.length}

TOP PERFORMING CAMPAIGNS (by conversions):
${topPerformers.map((c) => `- ${c.name}: $${c.spend} spend, ${c.conversions} conv, CPA ${c.cpa ? '$' + c.cpa : 'N/A'}`).join('\n') || 'None with conversions'}

UNDERPERFORMING CAMPAIGNS (zero conv or high CPA):
${bottomPerformers.map((c) => `- ${c.name}: $${c.spend} spend, ${c.conversions} conv, CPA ${c.cpa ? '$' + c.cpa : 'N/A'}, status: ${c.status}`).join('\n') || 'None identified'}

Return ONLY valid JSON in this exact shape (no markdown, no explanation):
{
  "headline": "one sentence with dollar figure summarizing account health",
  "topPerformers": [
    { "name": "...", "metric": "short performance summary", "insight": "why it works, 1 sentence" }
  ],
  "bottomPerformers": [
    { "name": "...", "issue": "what is wrong, specific", "recommendation": "exact action to take" }
  ],
  "actions": [
    { "priority": 1, "action": "specific action", "impact": "expected result" }
  ]
}

Rules: reference specific campaign names and dollar amounts. topPerformers and bottomPerformers max 3 each. actions max 3. Be direct and specific, no filler.`;

  try {
    const credentials = await getCredentials();
    const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: userPrompt }],
    });

    logApiUsage({
      type: 'claude_tokens',
      email,
      model: MODEL,
      feature: 'account_brief',
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      totalTokens: (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0),
      estimatedCostUsd: estimateClaudeCost(MODEL, message.usage?.input_tokens ?? 0, message.usage?.output_tokens ?? 0),
    }).catch(() => {});

    const raw = message.content[0]?.text || '';
    let briefing;
    try {
      briefing = JSON.parse(raw);
    } catch {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      briefing = JSON.parse(cleaned);
    }

    const result = { briefing, generatedAt: new Date().toISOString() };
    apiCache.setBackground(cacheKey, result, CACHE_TTL_MS);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[account-brief] Claude error:', err.message);
    return NextResponse.json({ error: err.message || 'Briefing failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the file exists and imports are correct**

```bash
grep -n "^import" src/app/api/claude/account-brief/route.js
```

Expected: 8 import lines — NextResponse, Anthropic, getServerSession, authOptions/allowedEmailDomain, getCredentials, apiCache, logApiUsage/etc.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/claude/account-brief/route.js
git commit -m "feat: add /api/claude/account-brief route with spend gate and 4h cache"
```

---

## Task 2: `AccountBriefCard` component + wire-up in `page.js`

**Files:**
- Modify: `src/app/dashboard/google/ads/page.js`

This task has two parts: (A) add the `AccountBriefCard` component function, and (B) render it in the page with the right data.

### Part A — Add the component

- [ ] **Step 1: Find where to insert the component in page.js**

The component goes near the bottom of the file, before the default export. Search for where other component functions are defined (e.g., `AccountDropdown`, `SelectPill`, or similar).

- [ ] **Step 2: Add `AccountBriefCard` component**

Insert this function before the page's default export:

```jsx
const DATE_BRIEF_OPTIONS = [
  { value: 'LAST_7_DAYS',  label: 'Last 7 days'  },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
  { value: 'LAST_90_DAYS', label: 'Last 90 days' },
  { value: 'THIS_MONTH',   label: 'This month'   },
];

function AccountBriefCard({ selectedCustomer, currentDateRange }) {
  const [briefRange, setBriefRange] = useState(
    DATE_BRIEF_OPTIONS.some((o) => o.value === currentDateRange) ? currentDateRange : 'LAST_30_DAYS'
  );
  const [state, setState] = useState({ status: 'idle', briefing: null, generatedAt: null, error: null });
  const [collapsed, setCollapsed] = useState(false);
  const fetchingRef = useRef(false);

  const customerId = String(selectedCustomer?.customer?.customer_client?.id || '');
  const customerName = selectedCustomer?.customer?.customer_client?.descriptive_name || '';
  const campaigns = selectedCustomer?.campaigns || [];
  const totalSpend = campaigns.reduce((sum, c) => sum + (c.cost || 0), 0) / 1_000_000;

  async function fetchBrief(force = false) {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const res = await fetch('/api/claude/account-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, customerName, campaigns, dateLabel: briefRange, forceRefresh: force }),
      });
      const json = await res.json();
      if (json.skipped) {
        setState({ status: 'no_spend', briefing: null, generatedAt: null, error: null });
      } else if (!res.ok || json.error) {
        setState({ status: 'error', briefing: null, generatedAt: null, error: json.error || `Error ${res.status}` });
      } else {
        setState({ status: 'done', briefing: json.briefing, generatedAt: json.generatedAt, error: null });
        setCollapsed(false);
      }
    } catch (err) {
      setState({ status: 'error', briefing: null, generatedAt: null, error: err.message });
    } finally {
      fetchingRef.current = false;
    }
  }

  // Auto-trigger when account changes and has spend
  useEffect(() => {
    if (!customerId || totalSpend === 0) {
      setState({ status: 'no_spend', briefing: null, generatedAt: null, error: null });
      return;
    }
    fetchBrief(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // Don't render if no spend
  if (totalSpend === 0 || state.status === 'no_spend') return null;

  const { status, briefing, generatedAt, error } = state;
  const genTime = generatedAt ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div style={{ margin: '0 0 20px 0', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: collapsed ? 'none' : '1px solid #f3f4f6', background: '#fafafa' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>AI Briefing</span>
        {genTime && <span style={{ fontSize: 11, color: '#9ca3af' }}>Generated {genTime}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={briefRange}
            onChange={(e) => setBriefRange(e.target.value)}
            style={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 6px', background: '#fff', color: '#374151' }}
          >
            {DATE_BRIEF_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => fetchBrief(true)}
            disabled={status === 'loading'}
            style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: status === 'loading' ? '#93c5fd' : '#4f46e5', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: status === 'loading' ? 'not-allowed' : 'pointer' }}
          >
            {status === 'loading' ? 'Running…' : 'Re-run'}
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}
          >
            {collapsed ? '▼ Show' : '▲ Hide'}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: '14px 16px' }}>
          {status === 'loading' && (
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              {[120, 80, 100].map((w, i) => (
                <div key={i} style={{ height: 12, width: `${w}%`, maxWidth: w * 3, background: '#f3f4f6', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
            </div>
          )}
          {status === 'error' && (
            <p style={{ fontSize: 12, color: '#ef4444' }}>{error}</p>
          )}
          {status === 'done' && briefing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Headline */}
              <p style={{ fontSize: 13, fontWeight: 600, color: '#111', margin: 0 }}>{briefing.headline}</p>

              {/* Top / Bottom grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Top performers */}
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#16a34a', marginBottom: 8 }}>Top Performers</p>
                  {(briefing.topPerformers || []).map((p, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#111', margin: '0 0 2px 0' }}>{p.name}</p>
                      <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 2px 0' }}>{p.metric}</p>
                      <p style={{ fontSize: 11, color: '#374151', margin: 0 }}>{p.insight}</p>
                    </div>
                  ))}
                </div>

                {/* Bottom performers */}
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#dc2626', marginBottom: 8 }}>Needs Attention</p>
                  {(briefing.bottomPerformers || []).map((p, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#111', margin: '0 0 2px 0' }}>{p.name}</p>
                      <p style={{ fontSize: 11, color: '#ef4444', margin: '0 0 2px 0' }}>{p.issue}</p>
                      <p style={{ fontSize: 11, color: '#374151', margin: 0 }}>→ {p.recommendation}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              {(briefing.actions || []).length > 0 && (
                <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#4f46e5', marginBottom: 8 }}>Priority Actions</p>
                  {briefing.actions.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#4f46e5', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{a.priority}</span>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{a.action}</span>
                        {a.impact && <span style={{ fontSize: 11, color: '#6b7280' }}> — {a.impact}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Part B — Wire up the component in the page

- [ ] **Step 3: Find where the main content renders in the page**

Search for where `ContentArea` or the campaign table is rendered — this is where `AccountBriefCard` should appear above it. Look for the main return JSX of the page component.

- [ ] **Step 4: Compute `selectedCustomer` if it isn't already in scope at render time**

The pattern from the existing code is:
```js
const selectedCustomer = allCampaignData.find(
  (item) => String(item.customer.customer_client.id) === String(selectedCustomerId)
);
```

If this is already computed somewhere in the page, use that variable. If not, add it near the other derived state.

- [ ] **Step 5: Render `AccountBriefCard` above the main content area**

Find the JSX that renders the campaign data (likely inside a div wrapping `ContentArea` or a campaign table). Insert `AccountBriefCard` above it, gated on having a selected account and loaded data:

```jsx
{selectedCustomerId && allCampaignData.length > 0 && selectedCustomer && (
  <AccountBriefCard
    selectedCustomer={selectedCustomer}
    currentDateRange={dateRange}
  />
)}
```

Where `dateRange` is the page's current date range state variable (likely `selectedDateRange` based on the localStorage key `SELECTED_DATE_RANGE_KEY`).

- [ ] **Step 6: Add pulse animation for skeleton loader**

Check if `@keyframes pulse` is already defined in a `<style>` tag in the page (the creatives page had `ccSpin`). If not, add it alongside any existing animation:

```jsx
<style>{`
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
`}</style>
```

- [ ] **Step 7: Verify no lint errors**

```bash
cd "C:\Users\frank\Documents\GitHub\Google-Ads-Api" && npx next lint src/app/dashboard/google/ads/page.js 2>&1 | tail -20
```

Fix any unused variable warnings.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/google/ads/page.js
git commit -m "feat: AccountBriefCard — auto AI briefing with spend gate, date picker, re-run"
```

---

## Self-Review Against Requirements

| Requirement | Covered by |
|------------|------------|
| Auto-triggers on account open | Task 2, `useEffect` on `customerId` change |
| Only shows if account has spend > 0 | Task 1 server-side spend gate + Task 2 client-side guard (double gated) |
| Inactive accounts with no spend — hidden | Both gates ensure card never renders |
| Top/bottom performers | Task 1, pre-processing + Claude structured JSON |
| What Claude would change | Task 1, `actions` array in response |
| Re-run for specific dates | Task 2, date dropdown + Re-run button with `forceRefresh: true` |
| 4-hour cache (one Claude call per workday) | Task 1, `apiCache.setBackground` with `CACHE_TTL_MS` |
| Budget cap enforcement | Task 1, `getMonthlyClaudeCost` + `getClaudeBudgetCap` check |
| Usage logging | Task 1, `logApiUsage` with feature `'account_brief'` |
| Collapsible | Task 2, `collapsed` state + Hide/Show toggle |
| Loading skeleton | Task 2, skeleton divs shown when `status === 'loading'` |
