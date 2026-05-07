# Google Ads Deep Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Deep Analysis" slide-over panel to the Google Ads dashboard that runs a Claude-powered 80-check audit with a weighted health score (0–100), per-category findings, quick wins, and AI insights.

**Architecture:** New prompt file + Claude API route + React panel + wiring in page.js. The panel self-fetches `/api/googleads/audit`, POSTs to `/api/claude/google-deep-analysis`, caches in sessionStorage, and renders results automatically on open. Zero changes to existing routes or components.

**Tech Stack:** Next.js App Router, Anthropic SDK (`claude-sonnet-4-6`), Vitest + React Testing Library, inline styles (existing dashboard pattern)

---

## File Map

| Action | File |
|--------|------|
| Create | `src/lib/googleDeepAnalysisPrompt.js` |
| Create | `src/app/api/claude/google-deep-analysis/route.js` |
| Create | `src/app/dashboard/google/ads/components/DeepAnalysisPanel.jsx` |
| Modify | `src/app/dashboard/google/ads/page.js` |
| Create | `src/__tests__/api/google-deep-analysis.test.js` |
| Create | `src/__tests__/dashboard/DeepAnalysisPanel.test.jsx` |

---

## Task 1: API Route Tests (failing first)

**Files:**
- Create: `src/__tests__/api/google-deep-analysis.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { email: 'test@lilikoiagency.com' },
  }),
}));
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));
vi.mock('@/lib/dbFunctions', () => ({
  getCredentials: vi.fn().mockResolvedValue({ anthropic_api_key: 'test-key' }),
}));
vi.mock('@/lib/mongoose', () => ({
  default: vi.fn().mockResolvedValue({
    db: () => ({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn(),
      }),
    }),
  }),
}));
vi.mock('@/lib/usageLogger', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
  estimateClaudeCost: vi.fn().mockReturnValue(0.01),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));
vi.mock('@/lib/admins', () => ({ isAdmin: vi.fn().mockReturnValue(true) }));

import { POST } from '@/app/api/claude/google-deep-analysis/route.js';

function makeRequest(body) {
  return { json: async () => body };
}

describe('POST /api/claude/google-deep-analysis', () => {
  it('returns 400 when customerId is missing', async () => {
    const res = await POST(makeRequest({ campaigns: [{ campaignId: '1' }], auditData: {} }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/customerId/);
  });

  it('returns 400 when campaigns array is empty', async () => {
    const res = await POST(makeRequest({ customerId: '123', campaigns: [], auditData: {} }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/campaigns/i);
  });

  it('returns 401 when session email is not from allowed domain', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce({ user: { email: 'hacker@evil.com' } });
    const res = await POST(makeRequest({ customerId: '123', campaigns: [{ campaignId: '1' }], auditData: {} }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/__tests__/api/google-deep-analysis.test.js --reporter=verbose
```

Expected: FAIL — `Cannot find module '@/app/api/claude/google-deep-analysis/route.js'`

---

## Task 2: System Prompt

**Files:**
- Create: `src/lib/googleDeepAnalysisPrompt.js`

- [ ] **Step 1: Create the prompt file**

```javascript
export function getGoogleDeepAnalysisSystemPrompt() {
  return `You are a senior Google Ads auditor with 15 years of experience. You evaluate accounts against a structured 80-check framework across 6 weighted categories and return a structured JSON health report.

You will receive account data including campaigns, keywords, search terms, ad strength, conversion actions, assets, PMax, geo, and daypart performance. Evaluate every applicable check.

CATEGORIES AND WEIGHTS:
1. Conversion Tracking (25%) — gtag setup, Enhanced Conversions active, Consent Mode v2 implemented, attribution model (data-driven preferred; last-click = WARNING), conversion lag patterns, conversion action configuration (primary vs secondary)
2. Wasted Spend (20%) — search term irrelevance (0-conv terms with spend), negative keyword coverage (shared lists + campaign-level), broad match used without Smart Bidding (FAIL), brand/non-brand campaigns separated, geo spend waste
3. Account Structure (15%) — campaign organization logic, ad group theme tightness (>20 keywords = WARNING), RSA count per ad group (<2 = FAIL, 2 = WARNING), PMax structure (brand exclusions, asset group count), SKAG patterns detected
4. Keywords (15%) — match type strategy (broad without Smart Bidding = FAIL), QS distribution (avg <5 = FAIL, 5-6 = WARNING, ≥7 = PASS), keyword cannibalization across campaigns (same/similar keywords in 2+ campaigns), low-QS keywords with meaningful spend
5. Ads (15%) — RSA headline count (<5 = FAIL, 5-7 = WARNING, ≥8 = PASS), ad strength distribution (Poor/Average dominant = WARNING), pin overuse (>2 pinned headlines = WARNING), sitelinks <4 = WARNING, callouts <4 = WARNING, structured snippets missing = WARNING
6. Settings (10%) — Smart Bidding adoption (ECPC = WARNING, Manual CPC without justification = WARNING), budget-limited campaigns (FAIL), location targeting mode ("Presence or Interest" = FAIL), Search Partners enabled without review = WARNING, ad schedule not set = WARNING

NEGATIVE KEYWORD RULES:
- Only evaluate negatives sourced from actual search term data provided — never guess
- Flag over-blocking risk: if converting search terms share words with negative keywords
- Recommend Exact Match [keyword] for specific irrelevant queries, Phrase Match for patterns
- Never recommend Broad Match negatives

SCORING:
- Start each category at 100
- FAIL finding: subtract 15 points; WARNING finding: subtract 7 points
- Floor at 0, cap at 100
- Overall health score = (conversionTracking × 0.25) + (wastedSpend × 0.20) + (accountStructure × 0.15) + (keywords × 0.15) + (ads × 0.15) + (settings × 0.10), rounded to nearest integer

GRADE: A ≥90, B ≥75, C ≥60, D ≥45, F <45

QUICK WINS: 3-5 actions where effort is low and impact is meaningful. Sort by effort ascending (low first).

AI INSIGHTS (3-5 items on things rule-based systems miss):
- Keyword cannibalization: same/similar keywords competing across campaigns, inflating CPCs
- Negative keyword quality: are existing negatives over-blocking converting queries?
- Consent Mode v2 gap: infer from attribution model and conversion lag — unusually long lag may indicate consent issues affecting modeled conversions
- Geo/daypart opportunity: top-converting geo or daypart with no bid adjustment set
- AI Max for Search readiness: does the account have strong negatives and enough conversion data to safely enable AI Max?
- Demand Gen opportunity: if no video/image campaigns exist, assess whether conversion volume supports Demand Gen

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON.

{
  "healthScore": number,
  "grade": "A"|"B"|"C"|"D"|"F",
  "summary": "One sentence with specific account detail — name a campaign or metric.",
  "categories": {
    "conversionTracking": { "score": number, "weight": 25, "findings": [{ "label": "string", "status": "PASS"|"WARNING"|"FAIL", "detail": "string referencing specific data" }] },
    "wastedSpend":        { "score": number, "weight": 20, "findings": [...] },
    "accountStructure":   { "score": number, "weight": 15, "findings": [...] },
    "keywords":           { "score": number, "weight": 15, "findings": [...] },
    "ads":                { "score": number, "weight": 15, "findings": [...] },
    "settings":           { "score": number, "weight": 10, "findings": [...] }
  },
  "quickWins": [{ "action": "string", "impact": "string", "effort": "low"|"medium"|"high" }],
  "aiInsights": [{ "title": "string", "detail": "string" }]
}

Rules:
- 3–7 findings per category; only include checks applicable to this account's data
- Every finding must reference specific account data (campaign name, keyword text, dollar amount, or percentage)
- Never invent data not present in the input`;
}
```

- [ ] **Step 2: Verify file was created**

```
npx vitest run src/__tests__/api/google-deep-analysis.test.js --reporter=verbose
```

Expected: Still FAIL — route file still missing.

---

## Task 3: Claude API Route

**Files:**
- Create: `src/app/api/claude/google-deep-analysis/route.js`

- [ ] **Step 1: Create the route**

```javascript
export const maxDuration = 120;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { getGoogleDeepAnalysisSystemPrompt } from '../../../../lib/googleDeepAnalysisPrompt';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.GOOGLE_DEEP_ANALYSIS_DAILY_LIMIT || '5');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.googleDeepAnalysisCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { googleDeepAnalysisCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true }
  );
}

function buildUserPrompt(campaigns, auditData) {
  const keywords = auditData?.keywords || [];
  const campaignConfig = auditData?.campaignConfig || [];
  const adStrength = auditData?.adStrength || [];
  const conversionActions = auditData?.conversionActions || [];
  const searchTerms = auditData?.campaignSearchTerms || [];
  const geoPerformance = auditData?.geoPerformance || [];
  const daypartPerformance = auditData?.daypartPerformance || [];
  const pmaxAssetGroups = auditData?.pmaxAssetGroups || [];
  const pmaxBrandExclusions = auditData?.pmaxBrandExclusions || [];
  const campaignAssets = auditData?.campaignAssets || [];
  const accountAssetTypes = auditData?.accountAssetTypes || [];

  const campaignLines = campaigns.map((c) => {
    const spend = ((c.cost || 0) / 1_000_000).toFixed(0);
    const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : '0';
    const cvr = c.clicks > 0 ? (((c.conversions || 0) / c.clicks) * 100).toFixed(2) : '0';
    const cpa = c.conversions > 0 ? (((c.cost || 0) / 1_000_000) / c.conversions).toFixed(2) : 'no conv';
    const cfg = campaignConfig.find((cc) => String(cc.campaignId) === String(c.campaignId)) || {};
    const lostBudget = c.searchBudgetLostImpressionShare != null ? `${(c.searchBudgetLostImpressionShare * 100).toFixed(0)}% IS lost to budget` : '';
    const lostRank = c.searchRankLostImpressionShare != null ? `${(c.searchRankLostImpressionShare * 100).toFixed(0)}% IS lost to rank` : '';
    return `${c.campaignName} (${c.channelType || 'SEARCH'}): $${spend} spend | ${c.clicks || 0} clicks | ${c.conversions || 0} conv | CTR ${ctr}% | CVR ${cvr}% | CPA $${cpa} | bidding: ${cfg.biddingStrategy || 'unknown'} | budget: $${cfg.budgetAmountMicros ? (cfg.budgetAmountMicros / 1_000_000).toFixed(0) : 'N/A'}/day | targetCPA: ${cfg.targetCpaMicros ? '$' + (cfg.targetCpaMicros / 1_000_000).toFixed(0) : 'N/A'} | ${lostBudget} ${lostRank}`.trim();
  }).join('\n');

  const kwLines = keywords.slice(0, 40).map((k) =>
    `"${k.text}" [${k.matchType}] QS:${k.qualityScore ?? 'N/A'} (CTR:${k.expectedCtr || '-'}, Rel:${k.adRelevance || '-'}, LP:${k.lpExperience || '-'}) $${((k.cost || 0) / 1_000_000).toFixed(2)} | ${k.conversions || 0} conv | ${k.campaignName || ''}`
  ).join('\n');

  const wastedTerms = searchTerms
    .filter((t) => (t.conversions || 0) === 0 && (t.cost || 0) > 500_000)
    .sort((a, b) => (b.cost || 0) - (a.cost || 0))
    .slice(0, 20);
  const convertingTerms = searchTerms
    .filter((t) => (t.conversions || 0) > 0)
    .sort((a, b) => (b.conversions || 0) - (a.conversions || 0))
    .slice(0, 20);

  const strengthLines = adStrength.map((a) =>
    `${a.campaignName} / ${a.adGroupName || 'N/A'}: strength=${a.adStrength || 'N/A'} | headlines=${a.headlineCount ?? 'N/A'} | pinned=${a.pinnedHeadlines ?? 0}`
  ).join('\n');

  const convLines = conversionActions.map((a) =>
    `${a.name}: status=${a.status || 'N/A'} | attribution=${a.attributionModel || 'N/A'} | primary=${a.isPrimary ?? 'N/A'}`
  ).join('\n');

  const acctAssets = accountAssetTypes.length ? accountAssetTypes.join(', ') : 'none';
  const campAssetLines = campaignAssets.slice(0, 15).map((ca) =>
    `${ca.campaignName}: ${(ca.assetTypes || []).join(', ') || 'none'}`
  ).join('\n');

  const pmaxLines = pmaxAssetGroups.map((pg) => {
    const hasBrandEx = pmaxBrandExclusions.some((ex) => String(ex.campaignId) === String(pg.campaignId));
    return `${pg.campaignName}: ${pg.assetGroupCount ?? 'N/A'} asset groups | brand exclusions: ${hasBrandEx ? 'YES' : 'NO'}`;
  }).join('\n');

  const geoLines = [...geoPerformance]
    .sort((a, b) => (b.cost || 0) - (a.cost || 0))
    .slice(0, 6)
    .map((g) => `${g.countryCriterionId || g.country || 'Unknown'}: $${((g.cost || 0) / 1_000_000).toFixed(0)} | ${g.conversions || 0} conv`)
    .join('\n');

  const daypartLines = [...daypartPerformance]
    .sort((a, b) => (b.conversions || 0) - (a.conversions || 0))
    .slice(0, 10)
    .map((d) => `${d.dayOfWeek || ''} hour ${d.hourOfDay ?? d.hour ?? '?'}: ${d.conversions || 0} conv | $${((d.cost || 0) / 1_000_000).toFixed(2)}`)
    .join('\n');

  return `CAMPAIGNS (${campaigns.length} total):
${campaignLines || 'No campaign data'}

KEYWORDS (top ${Math.min(keywords.length, 40)} of ${keywords.length}):
${kwLines || 'No keyword data'}

WASTED SEARCH TERMS (0 conversions, spend >$0.50):
${wastedTerms.map((t) => `"${t.searchTerm || t.term || 'N/A'}": $${((t.cost || 0) / 1_000_000).toFixed(2)} | ${t.clicks || 0} clicks`).join('\n') || 'None identified'}

CONVERTING SEARCH TERMS (top 20 by conversions):
${convertingTerms.map((t) => `"${t.searchTerm || t.term || 'N/A'}": ${t.conversions} conv | $${((t.cost || 0) / 1_000_000).toFixed(2)}`).join('\n') || 'None'}

AD STRENGTH:
${strengthLines || 'No ad strength data'}

CONVERSION ACTIONS:
${convLines || 'No conversion action data'}

ACCOUNT-LEVEL ASSETS: ${acctAssets}
CAMPAIGN ASSETS:
${campAssetLines || 'No campaign asset data'}

PERFORMANCE MAX:
${pmaxLines || 'No PMax campaigns'}

GEO PERFORMANCE (top 6 by spend):
${geoLines || 'No geo data'}

DAYPART PERFORMANCE (top 10 by conversions):
${daypartLines || 'No daypart data'}`;
}

export async function POST(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body', requestId }, { status: 400 }); }

  const { customerId, campaigns, auditData } = body;

  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required', requestId }, { status: 400 });
  }
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return NextResponse.json({ error: 'campaigns must be a non-empty array', requestId }, { status: 400 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const usedToday = await getDailyUsageCount(db, email);
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json({
        error: `Daily deep analysis limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
        limitReached: true,
        requestId,
      }, { status: 429 });
    }
  }

  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, code: 'NO_CREDITS', limitReached: true, requestId },
      { status: 429 }
    );
  }

  const credentials = await getCredentials();
  const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured.', requestId }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = getGoogleDeepAnalysisSystemPrompt();
  const userPrompt = buildUserPrompt(campaigns, auditData || {});

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('[google-deep-analysis] Claude error:', err?.message);
    return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
  }

  if (response.stop_reason === 'max_tokens') {
    return NextResponse.json({ error: 'AI response was too long. Try again.', requestId }, { status: 500 });
  }

  const rawText = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let result;
  try {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object found');
    result = JSON.parse(rawText.slice(start, end + 1));
  } catch {
    console.error('[google-deep-analysis] JSON parse failed:', rawText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to parse AI response', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'google_deep_analysis',
    email,
    customerId: String(customerId),
    model: 'claude-sonnet-4-6',
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateClaudeCost('claude-sonnet-4-6', inputTokens, outputTokens),
  }).catch(() => {});

  if (!isAdmin(email)) {
    await incrementDailyUsage(db, email).catch(() => {});
  }

  return NextResponse.json({ data: result, requestId });
}
```

- [ ] **Step 2: Run tests — expect them to pass**

```
npx vitest run src/__tests__/api/google-deep-analysis.test.js --reporter=verbose
```

Expected: 3 tests PASS

- [ ] **Step 3: Commit**

```
git add src/lib/googleDeepAnalysisPrompt.js src/app/api/claude/google-deep-analysis/route.js src/__tests__/api/google-deep-analysis.test.js
git commit -m "feat: add google deep analysis Claude route and prompt"
```

---

## Task 4: Panel Tests (failing first)

**Files:**
- Create: `src/__tests__/dashboard/DeepAnalysisPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DeepAnalysisPanel from '@/app/dashboard/google/ads/components/DeepAnalysisPanel.jsx';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

global.fetch = vi.fn();

const sessionStorageMock = (() => {
  let store = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock });

const makeSelectedCustomer = () => ({
  customer: { customer_client: { id: '123', descriptive_name: 'Test Co' } },
  campaigns: [{
    campaignId: '1', campaignName: 'Brand Search',
    cost: 500_000_000, clicks: 100, impressions: 2000, conversions: 5,
  }],
});

const makeDeepResult = () => ({
  healthScore: 72,
  grade: 'B',
  summary: 'Account performing well with room to improve keyword quality.',
  categories: {
    conversionTracking: { score: 65, weight: 25, findings: [{ label: 'Enhanced Conversions', status: 'FAIL', detail: 'Not configured.' }] },
    wastedSpend:        { score: 80, weight: 20, findings: [{ label: 'Negative keywords', status: 'PASS', detail: 'Good coverage.' }] },
    accountStructure:   { score: 70, weight: 15, findings: [] },
    keywords:           { score: 75, weight: 15, findings: [] },
    ads:                { score: 68, weight: 15, findings: [] },
    settings:           { score: 85, weight: 10, findings: [] },
  },
  quickWins: [{ action: 'Add sitelinks to Brand Search', impact: 'Improve CTR by ~10%', effort: 'low' }],
  aiInsights: [{ title: 'Keyword cannibalization', detail: 'Brand terms appear in two campaigns, inflating CPCs.' }],
});

const emptyAuditData = {
  keywords: [], campaignConfig: [], adStrength: [], conversionActions: [],
  campaignSearchTerms: [], geoPerformance: [], daypartPerformance: [],
  conversionLag: [], pmaxAssetGroups: [], pmaxBrandExclusions: [],
  campaignAssets: [], accountAssetTypes: [],
};

beforeEach(() => {
  sessionStorageMock.clear();
  global.fetch.mockImplementation((url) => {
    if (url.includes('/api/googleads/audit')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: emptyAuditData }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: makeDeepResult() }) });
  });
});

describe('DeepAnalysisPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <DeepAnalysisPanel open={false} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the health score when analysis resolves', async () => {
    render(<DeepAnalysisPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => expect(screen.getByText('72')).toBeTruthy());
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('shows all six category labels', async () => {
    render(<DeepAnalysisPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => screen.getByText('72'));
    expect(screen.getByText(/Conversion Tracking/i)).toBeTruthy();
    expect(screen.getByText(/Wasted Spend/i)).toBeTruthy();
    expect(screen.getByText(/Account Structure/i)).toBeTruthy();
    expect(screen.getByText(/Keywords/i)).toBeTruthy();
    expect(screen.getByText(/Ads/i)).toBeTruthy();
    expect(screen.getByText(/Settings/i)).toBeTruthy();
  });

  it('shows quick wins', async () => {
    render(<DeepAnalysisPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => expect(screen.getByText('Add sitelinks to Brand Search')).toBeTruthy());
  });

  it('shows AI insights', async () => {
    render(<DeepAnalysisPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => expect(screen.getByText('Keyword cannibalization')).toBeTruthy());
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<DeepAnalysisPanel open={true} onClose={onClose} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => screen.getByText('72'));
    fireEvent.click(screen.getByRole('button', { name: /✕/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/__tests__/dashboard/DeepAnalysisPanel.test.jsx --reporter=verbose
```

Expected: FAIL — `Cannot find module '@/app/dashboard/google/ads/components/DeepAnalysisPanel.jsx'`

---

## Task 5: DeepAnalysisPanel Component

**Files:**
- Create: `src/app/dashboard/google/ads/components/DeepAnalysisPanel.jsx`

- [ ] **Step 1: Create the component**

```jsx
"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const CATEGORY_LABELS = {
  conversionTracking: 'Conversion Tracking',
  wastedSpend:        'Wasted Spend',
  accountStructure:   'Account Structure',
  keywords:           'Keywords',
  ads:                'Ads',
  settings:           'Settings',
};

const STATUS_ICON = { PASS: '✓', WARNING: '⚠', FAIL: '✗' };
const STATUS_COLOR = { PASS: '#15803d', WARNING: '#b45309', FAIL: '#dc2626' };
const STATUS_BG    = { PASS: '#f0fdf4', WARNING: '#fffbeb', FAIL: '#fef2f2' };

function scoreColor(score) {
  if (score >= 75) return '#15803d';
  if (score >= 50) return '#b45309';
  return '#dc2626';
}

function gradeColor(grade) {
  if (grade === 'A') return '#15803d';
  if (grade === 'B') return '#1d4ed8';
  if (grade === 'C') return '#b45309';
  return '#dc2626';
}

function safeGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch {}
}

function SkeletonPulse() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
      <style>{`@keyframes briefPulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      <div style={{ height: 80, background: '#e5edff', borderRadius: 14, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
      {[0,1,2,3,4,5].map((i) => (
        <div key={i} style={{ height: 36, background: '#f1f5f9', borderRadius: 10, animation: 'briefPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

function CategoryBar({ name, score, weight }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ width: 140, fontSize: 12, color: '#374151', fontWeight: 600, flexShrink: 0 }}>
        {CATEGORY_LABELS[name]}
        <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 4 }}>{weight}%</span>
      </div>
      <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
      </div>
      <div style={{ width: 32, fontSize: 12, fontWeight: 800, color, textAlign: 'right', flexShrink: 0 }}>{score}</div>
    </div>
  );
}

function FindingRow({ finding }) {
  const [expanded, setExpanded] = useState(finding.status !== 'PASS');
  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 10px', marginBottom: 4, background: STATUS_BG[finding.status], border: `1px solid ${STATUS_COLOR[finding.status]}33` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: STATUS_COLOR[finding.status], flexShrink: 0 }}>{STATUS_ICON[finding.status]}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#111827', flex: 1 }}>{finding.label}</span>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && finding.detail && (
        <p style={{ fontSize: 11, color: '#6b7280', margin: '6px 0 0 21px', lineHeight: 1.5 }}>{finding.detail}</p>
      )}
    </div>
  );
}

function CategorySection({ name, category }) {
  const hasIssues = (category.findings || []).some((f) => f.status !== 'PASS');
  const [open, setOpen] = useState(hasIssues);
  const findings = category.findings || [];
  if (findings.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', marginBottom: open ? 8 : 0 }}
      >
        <span style={{ fontSize: 12, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {CATEGORY_LABELS[name]}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: scoreColor(category.score) }}>{category.score}/100</span>
          <span style={{ fontSize: 10, color: '#9ca3af' }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && findings.map((f, i) => <FindingRow key={i} finding={f} />)}
    </div>
  );
}

export default function DeepAnalysisPanel({ open, onClose, selectedCustomer }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef(null);

  const customerId = String(selectedCustomer?.customer?.customer_client?.id || '');
  const campaigns = selectedCustomer?.campaigns || [];

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !customerId || campaigns.length === 0) return;

    const cacheKey = `deepAnalysis:${customerId}:${new Date().toISOString().slice(0, 10)}`;
    const cached = safeGet(cacheKey);
    if (cached) {
      try { setResult(JSON.parse(cached)); setStatus('done'); return; } catch {}
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setResult(null);
    setErrorMsg('');

    (async () => {
      try {
        const auditRes = await fetch(`/api/googleads/audit?customerId=${encodeURIComponent(customerId)}`, { signal: controller.signal });
        const auditJson = auditRes.ok ? await auditRes.json() : { data: {} };
        const auditData = auditJson.data || {};

        const deepRes = await fetch('/api/claude/google-deep-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId, campaigns, auditData }),
          signal: controller.signal,
        });
        const deepJson = await deepRes.json();
        if (!deepRes.ok || deepJson.error) throw new Error(deepJson.error || `Error ${deepRes.status}`);
        safeSet(cacheKey, JSON.stringify(deepJson.data));
        setResult(deepJson.data);
        setStatus('done');
      } catch (err) {
        if (err.name === 'AbortError') return;
        setErrorMsg(err.message || 'Analysis failed');
        setStatus('error');
      }
    })();

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId]);

  function handleRerun() {
    const cacheKey = `deepAnalysis:${customerId}:${new Date().toISOString().slice(0, 10)}`;
    try { sessionStorage.removeItem(cacheKey); } catch {}
    setStatus('idle');
    setResult(null);
    // Re-trigger effect by toggling — use a local re-run trigger
    runAnalysis();
  }

  function runAnalysis() {
    if (!customerId || campaigns.length === 0) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setStatus('loading');
    setResult(null);
    setErrorMsg('');

    (async () => {
      try {
        const auditRes = await fetch(`/api/googleads/audit?customerId=${encodeURIComponent(customerId)}`, { signal: controller.signal });
        const auditJson = auditRes.ok ? await auditRes.json() : { data: {} };
        const auditData = auditJson.data || {};

        const deepRes = await fetch('/api/claude/google-deep-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId, campaigns, auditData }),
          signal: controller.signal,
        });
        const deepJson = await deepRes.json();
        if (!deepRes.ok || deepJson.error) throw new Error(deepJson.error || `Error ${deepRes.status}`);
        const cacheKey = `deepAnalysis:${customerId}:${new Date().toISOString().slice(0, 10)}`;
        safeSet(cacheKey, JSON.stringify(deepJson.data));
        setResult(deepJson.data);
        setStatus('done');
      } catch (err) {
        if (err.name === 'AbortError') return;
        setErrorMsg(err.message || 'Analysis failed');
        setStatus('error');
      }
    })();
  }

  if (!mounted || !open) return null;

  const content = (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)', opacity: visible ? 1 : 0, transition: 'opacity 0.2s' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 41, width: 600, maxWidth: '100vw', background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', transform: visible ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)', boxShadow: '-8px 0 40px rgba(0,0,0,0.12)' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#1d4ed8', margin: '0 0 4px' }}>AI — 80-Check Framework</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: '#111827', margin: 0 }}>Deep Analysis</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {status === 'done' && (
              <button onClick={handleRerun} style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', background: 'rgba(29,78,216,0.08)', border: '1px solid rgba(29,78,216,0.2)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                Re-run
              </button>
            )}
            <button onClick={onClose} aria-label="✕" style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
          {status === 'loading' && <SkeletonPulse />}

          {status === 'error' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>{errorMsg}</p>
              <button onClick={handleRerun} style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#1d4ed8', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>Try again</button>
            </div>
          )}

          {status === 'done' && result && (
            <>
              {/* Health Score Card */}
              <div style={{ textAlign: 'center', background: 'linear-gradient(135deg,#eef4ff,#fff)', border: '1px solid #dbe4ff', borderRadius: 16, padding: '24px 16px', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 56, fontWeight: 900, color: scoreColor(result.healthScore), lineHeight: 1 }}>{result.healthScore}</div>
                  <div style={{ fontSize: 40, fontWeight: 900, color: gradeColor(result.grade), lineHeight: 1, background: `${gradeColor(result.grade)}15`, borderRadius: 12, padding: '4px 14px' }}>{result.grade}</div>
                </div>
                <p style={{ fontSize: 13, color: '#374151', margin: '0 0 20px', lineHeight: 1.5 }}>{result.summary}</p>
                <div style={{ textAlign: 'left' }}>
                  {Object.entries(result.categories || {}).map(([key, cat]) => (
                    <CategoryBar key={key} name={key} score={cat.score} weight={cat.weight} />
                  ))}
                </div>
              </div>

              {/* Findings */}
              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 12px' }}>Findings</p>
                {Object.entries(result.categories || {}).map(([key, cat]) => (
                  <CategorySection key={key} name={key} category={cat} />
                ))}
              </div>

              {/* Quick Wins */}
              {(result.quickWins || []).length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 12px' }}>Quick Wins</p>
                  {result.quickWins.map((w, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, background: '#f8faff', border: '1px solid #e0e7ff', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: w.effort === 'low' ? '#15803d' : w.effort === 'medium' ? '#b45309' : '#dc2626', borderRadius: 6, padding: '3px 7px', flexShrink: 0, alignSelf: 'flex-start', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{w.effort}</span>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 700, color: '#111827', margin: '0 0 3px' }}>{w.action}</p>
                        <p style={{ fontSize: 11, color: '#6366f1', margin: 0 }}>{w.impact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* AI Insights */}
              {(result.aiInsights || []).length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 12px' }}>AI Insights</p>
                  {result.aiInsights.map((ins, i) => (
                    <div key={i} style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 800, color: '#111827', margin: '0 0 4px' }}>{ins.title}</p>
                      <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>{ins.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
```

- [ ] **Step 2: Run panel tests — expect them to pass**

```
npx vitest run src/__tests__/dashboard/DeepAnalysisPanel.test.jsx --reporter=verbose
```

Expected: 6 tests PASS

- [ ] **Step 3: Run full test suite**

```
npx vitest run
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```
git add src/app/dashboard/google/ads/components/DeepAnalysisPanel.jsx src/__tests__/dashboard/DeepAnalysisPanel.test.jsx
git commit -m "feat: add DeepAnalysisPanel component"
```

---

## Task 6: Wire into page.js

**Files:**
- Modify: `src/app/dashboard/google/ads/page.js`

- [ ] **Step 1: Add import at the top (after AuditPanel import on line 17)**

Add this line after `import AuditPanel from "./components/AuditPanel";`:

```javascript
import DeepAnalysisPanel from "./components/DeepAnalysisPanel";
```

- [ ] **Step 2: Add state variable (after `briefPanelOpen` state on line 456)**

Add after `const [briefPanelOpen, setBriefPanelOpen] = useState(false);`:

```javascript
const [deepAnalysisPanelOpen, setDeepAnalysisPanelOpen] = useState(false);
```

- [ ] **Step 3: Add to the panelParam useEffect (inside the existing useEffect at line 458)**

Change:
```javascript
  useEffect(() => {
    setAdCopyPanelOpen(panelParam === "ad-copy");
    setAuditPanelOpen(panelParam === "audit");
    setBriefPanelOpen(panelParam === "brief");
  }, [panelParam]);
```

To:
```javascript
  useEffect(() => {
    setAdCopyPanelOpen(panelParam === "ad-copy");
    setAuditPanelOpen(panelParam === "audit");
    setBriefPanelOpen(panelParam === "brief");
    setDeepAnalysisPanelOpen(panelParam === "deep-analysis");
  }, [panelParam]);
```

- [ ] **Step 4: Add the "Deep Analysis" button in DashboardToolHeader**

Find the "Specialized Audits" button block (around line 986):
```javascript
            <button
              onClick={() => {
                ...
                router.push(`/dashboard/google/ads/audit-types?${params.toString()}`);
              }}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--gads-control-bg)", border: "1px solid var(--gads-control-border)", borderRadius: 10, padding: "6px 14px", fontSize: 12, fontWeight: 700, color: "var(--gads-control-text)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Specialized Audits
            </button>
```

Add this new button immediately BEFORE "Specialized Audits":
```javascript
            <button
              onClick={() => {
                const p = new URLSearchParams(window.location.search);
                p.set("panel", "deep-analysis");
                router.push(`${window.location.pathname}?${p.toString()}`);
              }}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 10, padding: "6px 14px", fontSize: 12, fontWeight: 700, color: "#6366f1", cursor: "pointer", whiteSpace: "nowrap" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(99,102,241,0.2)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(99,102,241,0.1)"}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/>
              </svg>
              Deep Analysis
            </button>
```

- [ ] **Step 5: Mount the DeepAnalysisPanel (after the AuditPanel block ending at line 1230)**

After the `{auditPanelOpen && ( <AuditPanel ... /> )}` closing block, add:

```javascript
              {deepAnalysisPanelOpen && (
                <DeepAnalysisPanel
                  open={deepAnalysisPanelOpen}
                  onClose={closePanel}
                  selectedCustomer={selectedCustomer}
                />
              )}
```

- [ ] **Step 6: Run full test suite**

```
npx vitest run
```

Expected: All tests pass (count unchanged — page.js has no unit tests)

- [ ] **Step 7: Commit**

```
git add src/app/dashboard/google/ads/page.js
git commit -m "feat: add Deep Analysis button and panel to Google Ads dashboard"
```

---

## Self-Review

**Spec coverage:**
- ✅ Entry point button in DashboardToolHeader (Task 6 Step 4)
- ✅ `?panel=deep-analysis` URL pattern (Task 6 Steps 2–3)
- ✅ Auto-fetch on open, no "Run" button required (Task 5 — useEffect fires on open)
- ✅ Re-run button clears sessionStorage and re-fires (Task 5 — `handleRerun`)
- ✅ sessionStorage cache per customerId per day (Task 5)
- ✅ Daily limit 5/day, admin bypass (Task 3 route)
- ✅ Monthly budget cap (Task 3 route)
- ✅ Health score card with 6 category bars, color-coded (Task 5)
- ✅ Findings expandable per category, WARNING/FAIL open by default (Task 5 — `CategorySection`, `FindingRow`)
- ✅ Quick wins sorted by effort low-first (prompt instructs Claude, Task 2)
- ✅ AI insights section (Task 5)
- ✅ Loading skeleton (Task 5 — `SkeletonPulse`)
- ✅ Error state with retry (Task 5)
- ✅ Grade thresholds A≥90, B≥75, C≥60, D≥45, F<45 (Task 2 prompt)
- ✅ All 6 category names consistent across prompt, component, and tests

**Type consistency:** `CATEGORY_LABELS` keys match `result.categories` keys match what the prompt schema defines. `STATUS_ICON`/`STATUS_COLOR`/`STATUS_BG` all cover `PASS`, `WARNING`, `FAIL`. `effort` values `low`/`medium`/`high` consistent in prompt and UI.
