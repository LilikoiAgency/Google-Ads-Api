# Ad Copy Strategy Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a data-backed ad copy strategy generator to the Google Ads page that takes 5 context fields, analyzes underperforming campaigns using live data, and returns per-campaign copy strategy + example headlines/descriptions grounded in actual search terms and QS data.

**Architecture:** A "Generate Ad Copy" button below `AccountBriefCard` opens a slide-in panel (`AdCopyPanel`). The panel fetches deep keyword data on open, then POSTs context + campaign data to `/api/claude/ad-copy-strategy`, which calls Claude and returns structured JSON. Results render per-campaign with diagnosis, strategy, and copy examples.

**Tech Stack:** Next.js App Router, React, Anthropic SDK (`claude-sonnet-4-6`), Vitest + React Testing Library

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/adCopyStrategyPrompt.js` | Create | System prompt for Claude — PPC strategist persona + JSON schema |
| `src/app/api/claude/ad-copy-strategy/route.js` | Create | POST handler: auth, budget, Claude call, return JSON |
| `src/app/dashboard/google/ads/components/AdCopyPanel.jsx` | Create | Slide-in panel: form state + results state |
| `src/app/dashboard/google/ads/page.js` | Modify | Add button below `AccountBriefCard`, mount `AdCopyPanel` |
| `src/__tests__/dashboard/AdCopyPanel.test.jsx` | Create | Component tests |

---

## Task 1: System prompt lib

**Files:**
- Create: `src/lib/adCopyStrategyPrompt.js`

- [ ] **Step 1: Create the prompt file**

```js
// src/lib/adCopyStrategyPrompt.js
export function getAdCopyStrategySystemPrompt() {
  return `You are a senior PPC strategist with 15 years of Google Ads experience. You write ad copy that is specific, data-driven, and grounded in actual account performance — never generic.

You will receive business context and campaign-level data including current ad copy, converting search terms, low quality score keywords, and match type spend distribution.

For each campaign, you must:
1. Diagnose the specific copy problem using the data provided — reference actual search terms, keyword text, and QS components by name
2. Write a 2-3 sentence strategy to fix it
3. Write 4-5 headline variants (STRICT max 30 characters each including spaces — Google will reject longer ones)
4. Write 2 description variants (STRICT max 90 characters each including spaces)
5. For each headline and description, provide a one-sentence rationale that names the specific data point it addresses

Rules:
- Never invent claims not supported by the USPs provided
- Never write generic headlines like "Best Quality!" or "Call Us Today!"
- Every headline must be traceable to a search term, keyword, USP, or performance insight from the data
- If a campaign has converting search terms not in current headlines, you must incorporate them
- If a campaign has keywords failing on Ad Relevance, headlines must more closely match keyword intent
- If broad match spend is over 60%, address intent specificity in your strategy

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON object.

Response schema:
{
  "campaigns": [
    {
      "campaignName": "string",
      "diagnosis": "string — 1-2 sentences naming the specific data-backed problem",
      "strategy": "string — 2-3 sentences on the fix approach",
      "headlines": [
        { "text": "string (max 30 chars)", "rationale": "string — names the specific data point" }
      ],
      "descriptions": [
        { "text": "string (max 90 chars)", "rationale": "string — names the specific data point" }
      ]
    }
  ]
}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/adCopyStrategyPrompt.js
git commit -m "feat: add ad copy strategy system prompt"
```

---

## Task 2: API route

**Files:**
- Create: `src/app/api/claude/ad-copy-strategy/route.js`

- [ ] **Step 1: Write the failing test for validation**

Create `src/__tests__/api/ad-copy-strategy.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { email: 'test@lilikoiagency.com' },
  }),
}));
vi.mock('../../../../src/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));
vi.mock('../../../../src/lib/dbFunctions', () => ({
  getCredentials: vi.fn().mockResolvedValue({ anthropic_api_key: 'test-key' }),
}));
vi.mock('../../../../src/lib/mongoose', () => ({ default: vi.fn().mockResolvedValue({ db: () => ({ collection: () => ({ findOne: vi.fn().mockResolvedValue(null), updateOne: vi.fn() }) }) }) }));
vi.mock('../../../../src/lib/usageLogger', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
  estimateClaudeCost: vi.fn().mockReturnValue(0.01),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));
vi.mock('../../../../src/lib/admins', () => ({ isAdmin: vi.fn().mockReturnValue(true) }));

import { POST } from '../../../../src/app/api/claude/ad-copy-strategy/route.js';

function makeRequest(body) {
  return { json: async () => body };
}

describe('POST /api/claude/ad-copy-strategy', () => {
  it('returns 400 when customerId is missing', async () => {
    const res = await POST(makeRequest({ context: {}, campaigns: [] }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/customerId/);
  });

  it('returns 400 when required context fields are missing', async () => {
    const res = await POST(makeRequest({
      customerId: '123',
      context: { tone: 'Professional' }, // missing business, audience, usps
      campaigns: [{ campaignName: 'Test' }],
    }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/business|audience|usps/i);
  });

  it('returns 400 when campaigns array is empty', async () => {
    const res = await POST(makeRequest({
      customerId: '123',
      context: { business: 'HVAC', audience: 'Homeowners', usps: 'Same-day', tone: 'Professional' },
      campaigns: [],
    }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/campaigns/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/api/ad-copy-strategy.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the route**

```js
// src/app/api/claude/ad-copy-strategy/route.js
export const maxDuration = 120;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { getAdCopyStrategySystemPrompt } from '../../../../lib/adCopyStrategyPrompt';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.AD_COPY_STRATEGY_DAILY_LIMIT || '10');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.adCopyStrategyCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { adCopyStrategyCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true }
  );
}

function buildUserPrompt(context, campaigns) {
  const offerLine = context.offer ? `- Current offer: ${context.offer}` : '';
  const header = `BUSINESS CONTEXT:
- Business: ${context.business}
- Target audience: ${context.audience}
- USPs: ${context.usps}
- Tone: ${context.tone || 'Professional'}
${offerLine}

CAMPAIGN DATA:
`;

  const campaignBlocks = campaigns.map((c) => {
    const ctr = c.clicks > 0 ? ((c.clicks / (c.impressions || 1)) * 100).toFixed(2) : '0';
    const cpa = c.conversions > 0 ? `$${((c.cost || 0) / 1_000_000 / c.conversions).toFixed(0)}` : 'no conversions';
    const spend = `$${((c.cost || 0) / 1_000_000).toFixed(0)}`;

    const headlines = c.currentHeadlines?.length
      ? c.currentHeadlines.join(' | ')
      : 'No headlines available';
    const descriptions = c.currentDescriptions?.length
      ? c.currentDescriptions.join(' | ')
      : 'No descriptions available';

    const searchTermsBlock = c.topConvertingTerms?.length
      ? `Top converting search terms: ${c.topConvertingTerms.join(', ')}`
      : 'No converting search terms';

    const bottomKwBlock = c.bottomKeywords?.length
      ? `Bottom QS keywords:\n${c.bottomKeywords.map((k) => `  - "${k.text}" QS ${k.qs} — failing: ${k.failingComponent}`).join('\n')}`
      : 'No QS data available';

    const matchBlock = c.matchTypeSpend
      ? `Match type spend: Exact ${Math.round((c.matchTypeSpend.EXACT || 0) * 100)}% / Phrase ${Math.round((c.matchTypeSpend.PHRASE || 0) * 100)}% / Broad ${Math.round((c.matchTypeSpend.BROAD || 0) * 100)}%`
      : '';

    const flagsBlock = c.flags?.length ? `Flags: ${c.flags.join(', ')}` : '';

    return `---
Campaign: ${c.campaignName}
Verdict: ${c.verdict}
Spend: ${spend} | CTR: ${ctr}% | CPA: ${cpa} | Conversions: ${c.conversions || 0}

Current headlines: ${headlines}
Current descriptions: ${descriptions}

${searchTermsBlock}
${bottomKwBlock}
${matchBlock}
${flagsBlock}`.trim();
  });

  return header + campaignBlocks.join('\n\n');
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

  const { customerId, context, campaigns } = body;

  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required', requestId }, { status: 400 });
  }
  if (!context?.business || !context?.audience || !context?.usps) {
    return NextResponse.json({ error: 'context.business, context.audience, and context.usps are required', requestId }, { status: 400 });
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
        error: `Daily ad copy limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
        limitReached: true,
        requestId,
      }, { status: 429 });
    }
  }

  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, code: 'NO_CREDITS', requestId },
      { status: 429 }
    );
  }

  const credentials = await getCredentials();
  const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured.' }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = getAdCopyStrategySystemPrompt();
  const userPrompt = buildUserPrompt(context, campaigns);

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('[claude/ad-copy-strategy] Claude error:', err?.message);
    return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
  }

  const rawText = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let result;
  try {
    const clean = rawText.replace(/^```json\s*/m, '').replace(/^```\s*$/m, '').trim();
    result = JSON.parse(clean);
  } catch {
    console.error('[claude/ad-copy-strategy] JSON parse failed:', rawText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to parse AI response', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'ad_copy_strategy',
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/api/ad-copy-strategy.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/claude/ad-copy-strategy/route.js src/__tests__/api/ad-copy-strategy.test.js
git commit -m "feat: add ad copy strategy API route"
```

---

## Task 3: AdCopyPanel component — form state

**Files:**
- Create: `src/app/dashboard/google/ads/components/AdCopyPanel.jsx`

- [ ] **Step 1: Write failing tests for form state**

Create `src/__tests__/dashboard/AdCopyPanel.test.jsx`:

```jsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdCopyPanel from '@/app/dashboard/google/ads/components/AdCopyPanel.jsx';

// Stub createPortal so it renders inline
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

global.fetch = vi.fn();

const makeCampaign = (overrides = {}) => ({
  campaignId: '1',
  campaignName: 'Brand Search',
  cost: 500_000_000,
  clicks: 1000,
  impressions: 20000,
  conversions: 10,
  searchBudgetLostImpressionShare: 0.05,
  searchRankLostImpressionShare: 0.35,
  ads: [{ headlines: ['Buy Now', 'Shop Today'], descriptions: ['Great deals'] }],
  searchTerms: [{ term: 'brand search', conversions: 5, cost: 100_000_000, clicks: 50 }],
  ...overrides,
});

const makeSelectedCustomer = (campaigns = [makeCampaign()]) => ({
  customer: { customer_client: { id: '123', descriptive_name: 'Test Co' } },
  campaigns,
  searchTerms: [{ term: 'brand search', conversions: 5, cost: 100_000_000, clicks: 50 }],
});

beforeEach(() => {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { keywords: [], campaignConfig: [], campaignAssets: [], adStrength: [] } }),
  });
});

describe('AdCopyPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <AdCopyPanel open={false} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the form when open', async () => {
    render(
      <AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    await waitFor(() => expect(screen.getByLabelText(/business/i)).toBeTruthy());
    expect(screen.getByLabelText(/target audience/i)).toBeTruthy();
    expect(screen.getByLabelText(/unique selling points/i)).toBeTruthy();
    expect(screen.getByLabelText(/tone/i)).toBeTruthy();
    expect(screen.getByLabelText(/offer/i)).toBeTruthy();
  });

  it('pre-checks underperforming campaigns (FIX_QS verdict)', async () => {
    render(
      <AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    await waitFor(() => screen.getByLabelText(/business/i));
    const checkbox = screen.getByRole('checkbox', { name: /Brand Search/i });
    expect(checkbox.checked).toBe(true);
  });

  it('disables Generate button when no campaigns are checked', async () => {
    render(
      <AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    await waitFor(() => screen.getByLabelText(/business/i));
    const checkbox = screen.getByRole('checkbox', { name: /Brand Search/i });
    fireEvent.click(checkbox); // uncheck the only campaign
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn.disabled).toBe(true);
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(
      <AdCopyPanel open={true} onClose={onClose} selectedCustomer={makeSelectedCustomer()} />
    );
    await waitFor(() => screen.getByLabelText(/business/i));
    fireEvent.click(screen.getByRole('button', { name: /✕/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/dashboard/AdCopyPanel.test.jsx
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the panel with form state**

```jsx
// src/app/dashboard/google/ads/components/AdCopyPanel.jsx
"use client";
import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { getCampaignVerdict, analyzeSearchTerms, analyzeKeywords } from "../../../../../lib/googleAdsAudit";

const UNDERPERFORMING = new Set(["FIX_QS", "OPTIMIZE", "INVESTIGATE"]);
const TONES = ["Professional", "Urgent", "Friendly", "Direct", "Trust-building"];

function buildCampaignPayload(campaign, auditData) {
  const verdict = getCampaignVerdict(campaign);

  const allKeywords = auditData?.keywords || [];
  const campaignKws = allKeywords.filter((k) => String(k.campaignId) === String(campaign.campaignId));
  const kwAnalysis = campaignKws.length > 0 ? analyzeKeywords(campaignKws) : null;

  const searchTerms = campaign.searchTerms || [];
  const stAnalysis = analyzeSearchTerms(searchTerms, campaignKws);
  const topConvertingTerms = stAnalysis.winners.slice(0, 5).map((t) => t.term);

  const bottom5 = (kwAnalysis?.bottom10 || []).slice(0, 5).map((k) => {
    const failingComponent =
      k.adRelevance === "BELOW_AVERAGE" ? "Ad Relevance" :
      k.expectedCtr === "BELOW_AVERAGE" ? "Expected CTR" :
      k.lpExperience === "BELOW_AVERAGE" ? "Landing Page Experience" :
      "QS";
    return { text: k.text, qs: k.qualityScore, failingComponent };
  });

  const matchTypeSpend = kwAnalysis?.matchTypeSpend || null;

  const flags = [];
  if ((matchTypeSpend?.BROAD || 0) > 0.6) flags.push("Broad match >60% of spend");
  if ((campaign.conversions || 0) === 0 && (campaign.cost || 0) > 300_000_000) flags.push("Zero conversions with real spend");
  if (campaign.searchBudgetLostImpressionShare > 0.25) flags.push("Budget-constrained — impression share lost to budget");

  const ads = campaign.ads || [];
  const currentHeadlines = ads.flatMap((ad) => ad.headlines || []).filter(Boolean).slice(0, 10);
  const currentDescriptions = ads.flatMap((ad) => ad.descriptions || []).filter(Boolean).slice(0, 4);

  return {
    campaignName: campaign.campaignName,
    verdict: verdict.key,
    cost: campaign.cost || 0,
    clicks: campaign.clicks || 0,
    impressions: campaign.impressions || 0,
    conversions: campaign.conversions || 0,
    currentHeadlines,
    currentDescriptions,
    topConvertingTerms,
    bottomKeywords: bottom5,
    matchTypeSpend,
    flags,
  };
}

export default function AdCopyPanel({ open, onClose, selectedCustomer }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [auditData, setAuditData] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [view, setView] = useState("form"); // "form" | "loading" | "results" | "error"
  const [results, setResults] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Form state
  const [business, setBusiness] = useState("");
  const [audience, setAudience] = useState("");
  const [usps, setUsps] = useState("");
  const [tone, setTone] = useState("Professional");
  const [offer, setOffer] = useState("");
  const [checkedIds, setCheckedIds] = useState(new Set());

  const campaigns = useMemo(() => selectedCustomer?.campaigns || [], [selectedCustomer]);
  const customerId = String(selectedCustomer?.customer?.customer_client?.id || "");

  // Pre-check underperforming campaigns when panel opens
  useEffect(() => {
    if (!open) return;
    const underperforming = campaigns
      .filter((c) => UNDERPERFORMING.has(getCampaignVerdict(c).key))
      .map((c) => String(c.campaignId));
    setCheckedIds(new Set(underperforming));
  }, [open, campaigns]);

  // Fetch deep audit data on open
  useEffect(() => {
    if (!open || !customerId) return;
    setAuditLoading(true);
    fetch(`/api/googleads/audit?customerId=${encodeURIComponent(customerId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json) => setAuditData(json?.data || null))
      .catch(() => setAuditData(null))
      .finally(() => setAuditLoading(false));
  }, [open, customerId]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
      setTimeout(() => {
        setView("form");
        setResults(null);
        setErrorMsg(null);
      }, 220);
    }
  }, [open]);

  const toggleCampaign = (campaignId) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(String(campaignId))) next.delete(String(campaignId));
      else next.add(String(campaignId));
      return next;
    });
  };

  const canGenerate = checkedIds.size > 0 && business.trim() && audience.trim() && usps.trim() && !auditLoading;

  const handleGenerate = async () => {
    setView("loading");
    setErrorMsg(null);
    const selectedCampaigns = campaigns
      .filter((c) => checkedIds.has(String(c.campaignId)))
      .map((c) => buildCampaignPayload(c, auditData));

    try {
      const res = await fetch("/api/claude/ad-copy-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          context: { business, audience, usps, tone, offer },
          campaigns: selectedCampaigns,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setErrorMsg(json.error || `Error ${res.status}`);
        setView("error");
        return;
      }
      setResults(json.data);
      setView("results");
    } catch (err) {
      setErrorMsg(err.message);
      setView("error");
    }
  };

  if (!mounted || !open) return null;

  const panelStyle = {
    position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41,
    width: 620, maxWidth: "100vw",
    background: "#fff",
    borderLeft: "1px solid #e5e7eb",
    display: "flex", flexDirection: "column",
    transform: visible ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
    boxShadow: "-8px 0 40px rgba(0,0,0,0.12)",
  };

  const content = (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(2px)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.2s",
        }}
      />

      {/* Panel */}
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#6366f1", margin: "0 0 4px" }}>AI — Ad Copy Strategy</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#111827", margin: 0 }}>
              {view === "results" ? "Copy Strategy" : "Generate Ad Copy"}
            </h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {view === "results" && (
              <button
                onClick={() => setView("form")}
                style={{ fontSize: 12, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}
              >
                Regenerate
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="✕"
              style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
          {view === "form" && (
            <FormView
              campaigns={campaigns}
              checkedIds={checkedIds}
              toggleCampaign={toggleCampaign}
              business={business} setBusiness={setBusiness}
              audience={audience} setAudience={setAudience}
              usps={usps} setUsps={setUsps}
              tone={tone} setTone={setTone}
              offer={offer} setOffer={setOffer}
              canGenerate={canGenerate}
              auditLoading={auditLoading}
              onGenerate={handleGenerate}
            />
          )}
          {view === "loading" && <LoadingView />}
          {view === "results" && results && <ResultsView results={results} />}
          {view === "error" && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", borderRadius: 12, padding: 16, color: "#dc2626", fontSize: 13 }}>
              {errorMsg || "Something went wrong. Try again."}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}

function FormView({ campaigns, checkedIds, toggleCampaign, business, setBusiness, audience, setAudience, usps, setUsps, tone, setTone, offer, setOffer, canGenerate, auditLoading, onGenerate }) {
  const labelStyle = { fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 };
  const inputStyle = { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#111827", outline: "none", boxSizing: "border-box", resize: "vertical" };
  const fieldWrap = { marginBottom: 16 };

  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20, lineHeight: 1.5 }}>
        Claude will analyze your underperforming campaigns using live data — search terms, keyword QS scores, current ad copy — and write a strategy + example headlines grounded in your actual account.
      </p>

      {/* Context fields */}
      <div style={fieldWrap}>
        <label htmlFor="cp-business" style={labelStyle}>Business / product description <span style={{ color: "#ef4444" }}>*</span></label>
        <textarea id="cp-business" aria-label="Business / product description" rows={2} placeholder="e.g. We provide emergency HVAC repair in Phoenix" value={business} onChange={(e) => setBusiness(e.target.value)} style={inputStyle} />
      </div>
      <div style={fieldWrap}>
        <label htmlFor="cp-audience" style={labelStyle}>Target audience <span style={{ color: "#ef4444" }}>*</span></label>
        <input id="cp-audience" type="text" aria-label="Target audience" placeholder="e.g. Homeowners 35–60, comparison shopping" value={audience} onChange={(e) => setAudience(e.target.value)} style={{ ...inputStyle, resize: undefined }} />
      </div>
      <div style={fieldWrap}>
        <label htmlFor="cp-usps" style={labelStyle}>Unique selling points <span style={{ color: "#ef4444" }}>*</span></label>
        <textarea id="cp-usps" aria-label="Unique selling points" rows={2} placeholder="e.g. Same-day service, 10-year warranty, financing available" value={usps} onChange={(e) => setUsps(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ ...fieldWrap, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label htmlFor="cp-tone" style={labelStyle}>Tone / voice</label>
          <select id="cp-tone" aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value)} style={{ ...inputStyle, resize: undefined }}>
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="cp-offer" style={labelStyle}>Current offer (optional)</label>
          <input id="cp-offer" type="text" aria-label="Offer" placeholder="e.g. $49 tune-up this month" value={offer} onChange={(e) => setOffer(e.target.value)} style={{ ...inputStyle, resize: undefined }} />
        </div>
      </div>

      {/* Campaign checklist */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ ...labelStyle, marginBottom: 10 }}>Campaigns to analyze</p>
        {auditLoading && (
          <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>Loading keyword data…</p>
        )}
        {campaigns.map((c) => {
          const verdict = getCampaignVerdict(c);
          const isChecked = checkedIds.has(String(c.campaignId));
          return (
            <label key={c.campaignId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}>
              <input
                type="checkbox"
                aria-label={c.campaignName}
                checked={isChecked}
                onChange={() => toggleCampaign(c.campaignId)}
              />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#111827" }}>{c.campaignName}</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: verdict.color, background: verdict.bg, borderRadius: 4, padding: "2px 7px", border: `1px solid ${verdict.color}40` }}>{verdict.key}</span>
            </label>
          );
        })}
      </div>

      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{
          width: "100%", padding: "12px", borderRadius: 10, border: "none",
          background: canGenerate ? "#4f46e5" : "#e5e7eb",
          color: canGenerate ? "#fff" : "#9ca3af",
          fontSize: 14, fontWeight: 800, cursor: canGenerate ? "pointer" : "not-allowed",
        }}
      >
        Generate Ad Copy Strategy
      </button>
    </div>
  );
}

function LoadingView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 14 }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid #e5e7eb", borderTopColor: "#4f46e5", animation: "spin 0.8s linear infinite" }} />
      <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>Analyzing campaigns and writing copy…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ResultsView({ results }) {
  const campaigns = results?.campaigns || [];
  return (
    <div>
      {campaigns.map((c, i) => (
        <div key={i} style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "#111827", margin: "0 0 6px" }}>{c.campaignName}</h3>

          <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: "#92400e", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Diagnosis</p>
            <p style={{ fontSize: 13, color: "#78350f", margin: 0, lineHeight: 1.5 }}>{c.diagnosis}</p>
          </div>

          <div style={{ background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: "#4c1d95", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Strategy</p>
            <p style={{ fontSize: 13, color: "#3730a3", margin: 0, lineHeight: 1.5 }}>{c.strategy}</p>
          </div>

          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Headlines</p>
            {(c.headlines || []).map((h, hi) => (
              <div key={hi} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 3px" }}>{h.text}</p>
                <p style={{ fontSize: 11, color: "#9ca3af", margin: 0, lineHeight: 1.4 }}>{h.rationale}</p>
              </div>
            ))}
          </div>

          <div>
            <p style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Descriptions</p>
            {(c.descriptions || []).map((d, di) => (
              <div key={di} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 3px" }}>{d.text}</p>
                <p style={{ fontSize: 11, color: "#9ca3af", margin: 0, lineHeight: 1.4 }}>{d.rationale}</p>
              </div>
            ))}
          </div>

          {i < campaigns.length - 1 && <div style={{ height: 1, background: "#e5e7eb", margin: "20px 0 0" }} />}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/__tests__/dashboard/AdCopyPanel.test.jsx
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/google/ads/components/AdCopyPanel.jsx src/__tests__/dashboard/AdCopyPanel.test.jsx
git commit -m "feat: add AdCopyPanel component"
```

---

## Task 4: Wire into page.js

**Files:**
- Modify: `src/app/dashboard/google/ads/page.js`

The button goes directly below `<AccountBriefCard ... />` in the render, and the panel is mounted at the end of the content div. Two changes total.

- [ ] **Step 1: Add the import at the top of page.js**

Find the existing imports block (around line 11–13 of page.js) and add:

```js
import AdCopyPanel from "./components/AdCopyPanel";
```

- [ ] **Step 2: Add panel open state**

Inside `GoogleAdsDashboard()`, after the existing `const [filterOpen, setFilterOpen] = useState(false);` line (~line 677), add:

```js
const [adCopyPanelOpen, setAdCopyPanelOpen] = useState(false);
```

- [ ] **Step 3: Add the button and panel into the content area**

Find this block in the render (~line 1394):

```jsx
{selectedCustomerId && allCampaignData.length > 0 && selectedCustomer && (
  <AccountBriefCard selectedCustomer={selectedCustomer} currentDateRange={dateRange} />
)}
```

Replace with:

```jsx
{selectedCustomerId && allCampaignData.length > 0 && selectedCustomer && (
  <>
    <AccountBriefCard selectedCustomer={selectedCustomer} currentDateRange={dateRange} />
    {(selectedCustomer.campaigns || []).some((c) => {
      const v = getCampaignVerdict(c);
      return v.key === 'FIX_QS' || v.key === 'OPTIMIZE' || v.key === 'INVESTIGATE';
    }) && (
      <div style={{ marginBottom: 22, display: 'flex' }}>
        <button
          onClick={() => setAdCopyPanelOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            border: 'none', borderRadius: 12, padding: '10px 18px',
            fontSize: 13, fontWeight: 800, color: '#fff',
            cursor: 'pointer', boxShadow: '0 4px 14px rgba(79,70,229,0.3)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          Generate Ad Copy Strategy
        </button>
      </div>
    )}
    <AdCopyPanel
      open={adCopyPanelOpen}
      onClose={() => setAdCopyPanelOpen(false)}
      selectedCustomer={selectedCustomer}
    />
  </>
)}
```

- [ ] **Step 4: Add the missing import for getCampaignVerdict**

Find the existing import at the top of page.js:

```js
import { sortWithPinned } from "../../../../lib/googleAdsHelpers";
```

Add after it:

```js
import { getCampaignVerdict } from "../../../../lib/googleAdsAudit";
```

- [ ] **Step 5: Verify the page renders without errors**

Start the dev server and open `/dashboard/google/ads`. The "Generate Ad Copy Strategy" button should appear below the AI briefing card when an account has underperforming campaigns. Clicking it should open the slide-in panel with the form.

```bash
npm run dev
```

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/google/ads/page.js
git commit -m "feat: wire AdCopyPanel into Google Ads page"
```

---

## Task 5: Smoke test the full flow

- [ ] **Step 1: Run the full test suite to catch any regressions**

```bash
npx vitest run
```

Expected: All existing tests pass, new tests pass.

- [ ] **Step 2: Manual smoke test**

1. Open `/dashboard/google/ads`, select an account with underperforming campaigns
2. Confirm the "Generate Ad Copy Strategy" button appears
3. Click it — panel opens, audit data loads (brief spinner)
4. Fill in: business, audience, USPs (tone defaults to Professional, offer optional)
5. Confirm underperforming campaigns are pre-checked; check/uncheck others
6. With no campaigns checked, confirm Generate button is disabled
7. Check at least one campaign and click Generate
8. Confirm loading state shows
9. Confirm results appear: diagnosis (yellow), strategy (purple), headlines + descriptions with rationale
10. Click Regenerate — form reappears with previous values
11. Click ✕ or backdrop — panel closes cleanly

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: data-backed ad copy strategy generator on Google Ads page"
```
