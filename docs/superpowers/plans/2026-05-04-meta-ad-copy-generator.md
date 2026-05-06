# Meta Ad Copy Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Meta Ad Copy Generator — a slide-in panel on the Meta Ads page that takes business context + one underperforming campaign and returns a diagnosis, strategy, 3 primary text variants, 3 headlines, 2 descriptions, and a CTA recommendation from Claude.

**Architecture:** Claude system prompt in `src/lib/metaAdCopyPrompt.js`. API route at `POST /api/claude/meta-ad-copy` mirrors the ad-copy-strategy pattern (auth, budget cap, daily limit, logApiUsage). `MetaAdCopyPanel` is a portal-based slide-in panel mounted directly in the Meta page. On open it fetches top creatives from the existing `/api/meta-ads/top-creatives` endpoint to enrich the campaign payload. The Meta page reads `?panel=meta-copy` via `useSearchParams` and opens the panel.

**Tech Stack:** Next.js App Router, React, `@anthropic-ai/sdk`, `next/navigation`, `react-dom/createPortal`, Vitest + React Testing Library

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/metaAdCopyPrompt.js` | Create | Claude system prompt for Meta ad copy |
| `src/app/api/claude/meta-ad-copy/route.js` | Create | POST API route — validate, call Claude, return JSON |
| `src/__tests__/api/meta-ad-copy.test.js` | Create | Node-env tests: 400 validation, 401 auth, 429 budget + limit |
| `src/app/dashboard/meta/components/MetaAdCopyPanel.jsx` | Create | Slide-in panel: form → loading → results |
| `src/__tests__/dashboard/MetaAdCopyPanel.test.jsx` | Create | jsdom tests: render, no account state, no spend state, close |
| `src/app/dashboard/meta/page.js` | Modify | Import panel, add `useSearchParams`, sync `?panel=meta-copy` |

---

## Task 1: Prompt + API route + tests

**Files:**
- Create: `src/lib/metaAdCopyPrompt.js`
- Create: `src/app/api/claude/meta-ad-copy/route.js`
- Create: `src/__tests__/api/meta-ad-copy.test.js`

- [ ] **Step 1: Create the system prompt**

```js
// src/lib/metaAdCopyPrompt.js
export function getMetaAdCopySystemPrompt() {
  return `You are a senior Meta (Facebook & Instagram) Ads copywriter with 10 years of experience writing high-converting social ad copy.

You will receive business context and a single campaign's performance data including current ad creative details. Write new ad copy variants that address the specific performance issues you identify from the data.

Rules:
- Primary text must feel conversational and story-driven — never like a search ad. Start with a strong hook in the first sentence.
- Headlines are short and punchy — create intrigue or deliver a clear benefit in ≤40 characters
- Descriptions are supplementary — ≤30 characters, support the headline
- Never invent claims not supported by the provided USPs
- Reference specific metrics (ROAS, CTR, CPA, spend) or current creative details in your diagnosis and rationale
- Each primary text variant must take a different angle: e.g., problem-aware, curiosity-driven, social proof, offer-led
- If current creative is provided, explain what may be causing underperformance based on the data

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON object.

Response schema:
{
  "diagnosis": "string — 1-2 sentences naming the specific data-backed problem",
  "strategy": "string — 2-3 sentences on the fix approach",
  "primaryTexts": [
    { "text": "string (≤125 chars)", "rationale": "string — names the specific angle or data point" },
    { "text": "string (≤125 chars)", "rationale": "string" },
    { "text": "string (≤125 chars)", "rationale": "string" }
  ],
  "headlines": [
    { "text": "string (≤40 chars)", "rationale": "string" },
    { "text": "string (≤40 chars)", "rationale": "string" },
    { "text": "string (≤40 chars)", "rationale": "string" }
  ],
  "descriptions": [
    { "text": "string (≤30 chars)", "rationale": "string" },
    { "text": "string (≤30 chars)", "rationale": "string" }
  ],
  "ctaRecommendation": { "cta": "string", "rationale": "string" }
}`;
}
```

- [ ] **Step 2: Create the API route**

```js
// src/app/api/claude/meta-ad-copy/route.js
export const maxDuration = 120;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { getMetaAdCopySystemPrompt } from '../../../../lib/metaAdCopyPrompt';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.META_AD_COPY_DAILY_LIMIT || '10');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.metaAdCopyCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { metaAdCopyCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true }
  );
}

function buildUserPrompt(context, campaign) {
  const offerLine = context.offer ? `- Current offer: ${context.offer}` : '';
  const creativeLine = campaign.currentTitle || campaign.currentBody
    ? `\nCurrent ad creative:\n  Title: ${campaign.currentTitle || '(none)'}\n  Body: ${campaign.currentBody || '(none)'}\n  CTA type: ${campaign.callToActionType || '(none)'}`
    : '';
  const flagsLine = campaign.flags?.length ? `\nPerformance flags: ${campaign.flags.join(', ')}` : '';
  const cpa = campaign.conversions > 0
    ? `$${(campaign.spend / campaign.conversions).toFixed(0)}`
    : 'no conversions';

  return `BUSINESS CONTEXT:
- Business: ${context.business}
- Target audience: ${context.audience}
- USPs: ${context.usps}
- Tone: ${context.tone || 'Professional'}
${offerLine}

CAMPAIGN DATA:
Campaign: ${campaign.campaignName}
Objective: ${campaign.objective || 'Unknown'}
Spend: $${Number(campaign.spend || 0).toFixed(0)} | CTR: ${(Number(campaign.ctr || 0) * 100).toFixed(2)}% | CPA: ${cpa} | ROAS: ${Number(campaign.roas || 0).toFixed(2)}x | Conversions: ${campaign.conversions || 0}${creativeLine}${flagsLine}`.trim();
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

  const { context, campaign } = body;

  if (!context?.business || !context?.audience || !context?.usps) {
    return NextResponse.json(
      { error: 'context.business, context.audience, and context.usps are required', requestId },
      { status: 400 }
    );
  }
  if (!campaign?.campaignName) {
    return NextResponse.json({ error: 'campaign.campaignName is required', requestId }, { status: 400 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const usedToday = await getDailyUsageCount(db, email);
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json({
        error: `Daily Meta ad copy limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
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
  const systemPrompt = getMetaAdCopySystemPrompt();
  const userPrompt = buildUserPrompt(context, campaign);

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('[claude/meta-ad-copy] Claude error:', err?.message);
    return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
  }

  if (response.stop_reason === 'max_tokens') {
    return NextResponse.json({ error: 'AI response was truncated. Please try again.', requestId }, { status: 500 });
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
    console.error('[claude/meta-ad-copy] JSON parse failed:', rawText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to parse AI response', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'meta_ad_copy',
    email,
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

- [ ] **Step 3: Write the failing tests**

```js
// src/__tests__/api/meta-ad-copy.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    db: () => ({ collection: () => ({ findOne: vi.fn().mockResolvedValue(null), updateOne: vi.fn() }) }),
  }),
}));
vi.mock('@/lib/usageLogger', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
  estimateClaudeCost: vi.fn().mockReturnValue(0.01),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));
vi.mock('@/lib/admins', () => ({ isAdmin: vi.fn().mockReturnValue(true) }));

import { POST } from '@/app/api/claude/meta-ad-copy/route.js';

function makeRequest(body) {
  return { json: async () => body };
}

const validCampaign = {
  campaignName: 'Spring Promo',
  objective: 'CONVERSIONS',
  spend: 500,
  ctr: 0.015,
  cpa: 0,
  roas: 0,
  conversions: 0,
  currentTitle: 'Get 20% Off',
  currentBody: 'Limited time offer.',
  callToActionType: 'SHOP_NOW',
  flags: ['Zero conversions with spend'],
};

const validContext = {
  business: 'Acme HVAC',
  audience: 'Homeowners in Phoenix',
  usps: 'Same-day service, 10-year warranty',
  tone: 'Professional',
};

describe('POST /api/claude/meta-ad-copy', () => {
  it('returns 400 when required context fields are missing', async () => {
    const res = await POST(makeRequest({ context: { tone: 'Pro' }, campaign: validCampaign }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/business|audience|usps/i);
  });

  it('returns 400 when campaign.campaignName is missing', async () => {
    const res = await POST(makeRequest({ context: validContext, campaign: { spend: 100 } }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/campaignName/i);
  });

  it('returns 401 when session email is not from allowed domain', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce({ user: { email: 'user@other.com' } });
    const res = await POST(makeRequest({ context: validContext, campaign: validCampaign }));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.error).toMatch(/unauthorized/i);
  });

  it('returns 429 with NO_CREDITS when budget cap is reached', async () => {
    const { getMonthlyClaudeCost } = await import('@/lib/usageLogger');
    getMonthlyClaudeCost.mockResolvedValueOnce(100);
    const res = await POST(makeRequest({ context: validContext, campaign: validCampaign }));
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.code).toBe('NO_CREDITS');
    expect(data.limitReached).toBe(true);
  });

  it('returns 429 with limitReached when daily limit is hit', async () => {
    const { isAdmin } = await import('@/lib/admins');
    isAdmin.mockReturnValueOnce(false);
    const mongoose = await import('@/lib/mongoose');
    mongoose.default.mockResolvedValueOnce({
      db: () => ({ collection: () => ({ findOne: vi.fn().mockResolvedValue({ metaAdCopyCount: 10 }), updateOne: vi.fn() }) }),
    });
    const res = await POST(makeRequest({ context: validContext, campaign: validCampaign }));
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.limitReached).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
npx vitest run src/__tests__/api/meta-ad-copy.test.js
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metaAdCopyPrompt.js src/app/api/claude/meta-ad-copy/route.js src/__tests__/api/meta-ad-copy.test.js
git commit -m "feat: add Meta ad copy API route and prompt"
```

---

## Task 2: MetaAdCopyPanel component + tests

**Files:**
- Create: `src/app/dashboard/meta/components/MetaAdCopyPanel.jsx`
- Create: `src/__tests__/dashboard/MetaAdCopyPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// src/__tests__/dashboard/MetaAdCopyPanel.test.jsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MetaAdCopyPanel from '@/app/dashboard/meta/components/MetaAdCopyPanel.jsx';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

global.fetch = vi.fn();

const makeAccount = () => ({ accountId: 'act_123', name: 'Test Account' });
const makeCampaign = (overrides = {}) => ({
  id: 'c1',
  name: 'Spring Promo',
  objective: 'CONVERSIONS',
  spend: 500,
  ctr: 0.015,
  cpc: 2.5,
  cpm: 15,
  frequency: 3,
  conversions: 0,
  revenue: 0,
  roas: 0,
  costPerResult: null,
  ...overrides,
});

beforeEach(() => {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] }),
  });
});

describe('MetaAdCopyPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <MetaAdCopyPanel open={false} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign()]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows "Select an account first" when no account is provided', () => {
    render(
      <MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={null} campaigns={[]} />
    );
    expect(screen.getByText(/select an account/i)).toBeTruthy();
  });

  it('shows "No campaigns with spend" when all campaigns have zero spend', async () => {
    render(
      <MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign({ spend: 0 })]} />
    );
    await waitFor(() => expect(screen.getByText(/no campaigns with spend/i)).toBeTruthy());
  });

  it('renders the form when open with an account and campaigns with spend', async () => {
    render(
      <MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign()]} />
    );
    await waitFor(() => expect(screen.getByLabelText(/business/i)).toBeTruthy());
    expect(screen.getByLabelText(/target audience/i)).toBeTruthy();
    expect(screen.getByLabelText(/unique selling points/i)).toBeTruthy();
  });

  it('pre-selects the first campaign with ROAS < 1 and spend > 0', async () => {
    render(
      <MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign()]} />
    );
    await waitFor(() => screen.getByLabelText(/business/i));
    const radio = screen.getByRole('radio', { name: /Spring Promo/i });
    expect(radio.checked).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail because component does not exist**

```bash
npx vitest run src/__tests__/dashboard/MetaAdCopyPanel.test.jsx
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create MetaAdCopyPanel.jsx**

```jsx
// src/app/dashboard/meta/components/MetaAdCopyPanel.jsx
"use client";
import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

const TONES = ["Professional", "Urgent", "Friendly", "Direct", "Trust-building"];

function buildCampaignPayload(campaign, creatives) {
  const flags = [];
  if ((campaign.roas || 0) < 1 && (campaign.spend || 0) > 0) flags.push("ROAS < 1");
  if ((campaign.conversions || 0) === 0 && (campaign.spend || 0) > 0) flags.push("Zero conversions with spend");
  if ((campaign.cpm || 0) > 25) flags.push("High CPM (> $25)");

  const topCreative = creatives?.[0]?.creative || null;

  return {
    campaignName: campaign.name,
    objective: campaign.objective || "",
    spend: campaign.spend || 0,
    ctr: campaign.ctr || 0,
    cpa: campaign.conversions > 0 ? (campaign.spend || 0) / campaign.conversions : 0,
    roas: campaign.roas || 0,
    conversions: campaign.conversions || 0,
    currentTitle: topCreative?.title || "",
    currentBody: topCreative?.body || "",
    callToActionType: topCreative?.call_to_action_type || "",
    flags,
  };
}

function charColor(len, max) {
  if (len <= max) return "#16a34a";
  return "#dc2626";
}

export default function MetaAdCopyPanel({ open, onClose, selectedAccount, campaigns }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState("form"); // "form" | "loading" | "results" | "error"

  const [creatives, setCreatives] = useState([]);
  const [creativesLoading, setCreativesLoading] = useState(false);

  const [business, setBusiness] = useState("");
  const [audience, setAudience] = useState("");
  const [usps, setUsps] = useState("");
  const [tone, setTone] = useState("Professional");
  const [offer, setOffer] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const [results, setResults] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [copied, setCopied] = useState({});

  const campaignsWithSpend = useMemo(
    () => (campaigns || []).filter((c) => (c.spend || 0) > 0),
    [campaigns]
  );

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
      const tid = setTimeout(() => {
        setView("form");
        setResults(null);
        setErrorMsg(null);
        setBusiness("");
        setAudience("");
        setUsps("");
        setTone("Professional");
        setOffer("");
        setSelectedId(null);
        setCopied({});
      }, 220);
      return () => clearTimeout(tid);
    }
  }, [open]);

  // Pre-select first underperforming campaign
  useEffect(() => {
    if (!open || !campaignsWithSpend.length) return;
    const under = campaignsWithSpend.find((c) => (c.roas || 0) < 1 || ((c.conversions || 0) === 0 && (c.spend || 0) > 0));
    setSelectedId(under?.id || campaignsWithSpend[0]?.id || null);
  }, [open, campaignsWithSpend]);

  // Fetch top creatives when panel opens
  useEffect(() => {
    if (!open || !selectedAccount?.accountId) return;
    const controller = new AbortController();
    setCreativesLoading(true);
    fetch(`/api/meta-ads/top-creatives?accountId=${encodeURIComponent(selectedAccount.accountId)}&limit=10`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json) => setCreatives(json?.data || []))
      .catch((err) => { if (err.name !== "AbortError") setCreatives([]); })
      .finally(() => setCreativesLoading(false));
    return () => controller.abort();
  }, [open, selectedAccount?.accountId]);

  const canGenerate = !!selectedId && business.trim() && audience.trim() && usps.trim() && !creativesLoading;

  const handleGenerate = async () => {
    setView("loading");
    setErrorMsg(null);
    const campaign = campaignsWithSpend.find((c) => c.id === selectedId);
    if (!campaign) { setErrorMsg("Campaign not found"); setView("error"); return; }
    const campaignPayload = buildCampaignPayload(campaign, creatives);
    try {
      const res = await fetch("/api/claude/meta-ad-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { business, audience, usps, tone, offer }, campaign: campaignPayload }),
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

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => setCopied((prev) => ({ ...prev, [id]: false })), 1500);
    });
  };

  if (!mounted || !open) return null;

  const inputStyle = { width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 10, outline: "none", boxSizing: "border-box", background: "#fff", color: "#111827" };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 };
  const panelStyle = { position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41, width: 620, maxWidth: "100vw", background: "#fff", borderLeft: "1px solid #e5e7eb", display: "flex", flexDirection: "column", transform: visible ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", boxShadow: "-8px 0 40px rgba(0,0,0,0.12)" };

  const content = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)", opacity: visible ? 1 : 0, transition: "opacity 0.2s" }} />
      <div style={panelStyle}>

        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#1877f2", margin: "0 0 4px" }}>AI — Meta Ads</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#111827", margin: 0 }}>Meta Ad Copy</h2>
          </div>
          <button onClick={onClose} aria-label="Close panel" style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── No account ── */}
          {!selectedAccount && (
            <p style={{ fontSize: 13, color: "#6b7280", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>Select an account first to generate Meta ad copy.</p>
          )}

          {/* ── No spend ── */}
          {selectedAccount && campaignsWithSpend.length === 0 && (
            <p style={{ fontSize: 13, color: "#6b7280", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>No campaigns with spend found for this account.</p>
          )}

          {/* ── Form view ── */}
          {selectedAccount && campaignsWithSpend.length > 0 && view === "form" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* Campaign selector */}
              <div>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 10px" }}>Select campaign</p>
                {campaignsWithSpend.map((c) => {
                  const isUnder = (c.roas || 0) < 1 || ((c.conversions || 0) === 0 && (c.spend || 0) > 0);
                  return (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: `1px solid ${selectedId === c.id ? "#1877f2" : "#e5e7eb"}`, borderRadius: 12, marginBottom: 6, cursor: "pointer", background: selectedId === c.id ? "#eff6ff" : "#fff" }}>
                      <input
                        type="radio"
                        name="meta-campaign"
                        value={c.id}
                        checked={selectedId === c.id}
                        onChange={() => setSelectedId(c.id)}
                        aria-label={c.name}
                        style={{ accentColor: "#1877f2" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</p>
                        <p style={{ fontSize: 11, color: "#6b7280", margin: "2px 0 0" }}>
                          ${Number(c.spend || 0).toFixed(0)} spend · {(Number(c.roas || 0)).toFixed(2)}x ROAS · {c.conversions || 0} conv.
                          {isUnder && <span style={{ marginLeft: 6, color: "#dc2626", fontWeight: 700 }}>⚠ underperforming</span>}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Context fields */}
              <div>
                <label htmlFor="meta-business" style={labelStyle}>Business <span style={{ color: "#dc2626" }}>*</span></label>
                <input id="meta-business" type="text" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="e.g. HVAC repair company in Phoenix, AZ" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="meta-audience" style={labelStyle}>Target audience <span style={{ color: "#dc2626" }}>*</span></label>
                <input id="meta-audience" type="text" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. Homeowners aged 30-55, Phoenix metro" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="meta-usps" style={labelStyle}>Unique selling points <span style={{ color: "#dc2626" }}>*</span></label>
                <textarea id="meta-usps" value={usps} onChange={(e) => setUsps(e.target.value)} placeholder="e.g. Same-day service, 10-year warranty, licensed & insured" rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
              </div>
              <div>
                <label htmlFor="meta-tone" style={labelStyle}>Tone</label>
                <select id="meta-tone" value={tone} onChange={(e) => setTone(e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
                  {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="meta-offer" style={labelStyle}>Current offer <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
                <input id="meta-offer" type="text" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. $99 tune-up, 20% off first service" style={inputStyle} />
              </div>

              {errorMsg && (
                <p style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", margin: 0 }}>{errorMsg}</p>
              )}

              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                style={{ padding: "12px 20px", fontSize: 13, fontWeight: 800, background: canGenerate ? "#1877f2" : "#e5e7eb", color: canGenerate ? "#fff" : "#9ca3af", border: "none", borderRadius: 12, cursor: canGenerate ? "pointer" : "not-allowed", transition: "background 0.15s" }}
              >
                {creativesLoading ? "Loading creatives…" : "Generate ad copy"}
              </button>
            </div>
          )}

          {/* ── Loading view ── */}
          {view === "loading" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
              {[80, 60, 90, 50, 70].map((w, i) => (
                <div key={i} style={{ height: 14, width: `${w}%`, background: "#e5e7eb", borderRadius: 8, animation: "pulse 1.5s ease-in-out infinite" }} />
              ))}
            </div>
          )}

          {/* ── Error view ── */}
          {view === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", margin: 0 }}>{errorMsg}</p>
              <button onClick={() => setView("form")} style={{ padding: "10px 20px", fontSize: 13, fontWeight: 700, background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 12, cursor: "pointer" }}>Try again</button>
            </div>
          )}

          {/* ── Results view ── */}
          {view === "results" && results && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

              {/* Diagnosis + Strategy */}
              <div style={{ background: "#0f172a", borderRadius: 14, padding: "15px 16px" }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: "#93c5fd", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Diagnosis</p>
                <p style={{ fontSize: 13, color: "#f8fafc", margin: "0 0 14px", lineHeight: 1.5 }}>{results.diagnosis}</p>
                <p style={{ fontSize: 11, fontWeight: 800, color: "#86efac", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Strategy</p>
                <p style={{ fontSize: 13, color: "#f8fafc", margin: 0, lineHeight: 1.5 }}>{results.strategy}</p>
              </div>

              {/* Primary texts */}
              <ResultSection
                label="Primary texts"
                hint="≤125 chars"
                items={results.primaryTexts || []}
                maxLen={125}
                copied={copied}
                onCopy={handleCopy}
                idPrefix="pt"
              />

              {/* Headlines */}
              <ResultSection
                label="Headlines"
                hint="≤40 chars"
                items={results.headlines || []}
                maxLen={40}
                copied={copied}
                onCopy={handleCopy}
                idPrefix="hl"
              />

              {/* Descriptions */}
              <ResultSection
                label="Descriptions"
                hint="≤30 chars"
                items={results.descriptions || []}
                maxLen={30}
                copied={copied}
                onCopy={handleCopy}
                idPrefix="desc"
              />

              {/* CTA Recommendation */}
              {results.ctaRecommendation && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#15803d", margin: "0 0 6px" }}>CTA recommendation</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>{results.ctaRecommendation.cta}</p>
                  <p style={{ fontSize: 12, color: "#374151", margin: 0, lineHeight: 1.5 }}>{results.ctaRecommendation.rationale}</p>
                </div>
              )}

              <button
                onClick={() => setView("form")}
                style={{ padding: "11px 20px", fontSize: 13, fontWeight: 700, background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 12, cursor: "pointer" }}
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}

function ResultSection({ label, hint, items, maxLen, copied, onCopy, idPrefix }) {
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 10px" }}>
        {label} <span style={{ fontWeight: 400, fontSize: 11, color: "#9ca3af" }}>{hint}</span>
      </p>
      {items.map((item, i) => {
        const len = (item.text || "").length;
        const over = len > maxLen;
        const copyId = `${idPrefix}-${i}`;
        return (
          <div key={i} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#111827", margin: "0 0 4px", lineHeight: 1.4 }}>{item.text}</p>
            <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 10px", lineHeight: 1.4 }}>{item.rationale}</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: over ? "#dc2626" : "#16a34a" }}>{len} / {maxLen} chars</span>
              <button
                onClick={() => onCopy(item.text, copyId)}
                style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", background: copied[copyId] ? "#d1fae5" : "#dbeafe", color: copied[copyId] ? "#065f46" : "#1e40af", border: "none", borderRadius: 8, cursor: "pointer" }}
              >
                {copied[copyId] ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
npx vitest run src/__tests__/dashboard/MetaAdCopyPanel.test.jsx
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/meta/components/MetaAdCopyPanel.jsx src/__tests__/dashboard/MetaAdCopyPanel.test.jsx
git commit -m "feat: add MetaAdCopyPanel component"
```

---

## Task 3: Wire MetaAdCopyPanel into the Meta page

**Files:**
- Modify: `src/app/dashboard/meta/page.js`

- [ ] **Step 1: Add useSearchParams to imports**

Find the existing import line at the top of `page.js`:
```js
import { useRouter } from "next/navigation";
```

Replace with:
```js
import { useRouter, useSearchParams } from "next/navigation";
```

- [ ] **Step 2: Import MetaAdCopyPanel**

Find the existing panel imports (near the top, after other component imports):
```js
import MetaAdsPanel from "./components/MetaAdsPanel";
import MetaAdPreview from "./components/MetaAdPreview";
```

Add after them:
```js
import MetaAdCopyPanel from "./components/MetaAdCopyPanel";
```

- [ ] **Step 3: Add panel state inside MetaDashboard()**

Find this line inside `MetaDashboard()`:
```js
const router = useRouter();
```

Add directly after it:
```js
  const searchParams = useSearchParams();
  const panelParam = searchParams.get("panel");
  const [metaCopyPanelOpen, setMetaCopyPanelOpen] = useState(false);
```

- [ ] **Step 4: Add useEffect to sync panel with URL param**

Find the first `useEffect` inside `MetaDashboard()`:
```js
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/?callbackUrl=/dashboard/meta");
  }, [status, router]);
```

Add a new `useEffect` directly after it:
```js
  useEffect(() => {
    setMetaCopyPanelOpen(panelParam === "meta-copy");
  }, [panelParam]);
```

- [ ] **Step 5: Add closePanel helper**

After the `useEffect` added in Step 4, add:
```js
  const closeMetaCopyPanel = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("panel");
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    router.replace(newUrl);
  };
```

- [ ] **Step 6: Mount the panel in the JSX**

Find the return statement's outermost closing `</div>` — the one that closes `<div className="flex flex-col flex-1">`. It's the last line before the closing of the component. Just before it, add the MetaAdCopyPanel mount.

Find the last `<MobileFilterSheet ...` block near the end of the JSX and add the panel after it:

Search for:
```jsx
      <MobileFilterSheet
```

The `MobileFilterSheet` block ends with `/>`. Add the MetaAdCopyPanel directly after the closing `/>` of `MobileFilterSheet`:
```jsx
      <MetaAdCopyPanel
        open={metaCopyPanelOpen}
        onClose={closeMetaCopyPanel}
        selectedAccount={selectedAccount}
        campaigns={data?.campaigns || []}
      />
```

- [ ] **Step 7: Verify end-to-end**

```bash
npm run dev
```

1. Open `/dashboard/meta`, select an account, wait for data to load
2. Click "Meta Ad Copy" in the AI Tools sidebar section
3. URL becomes `?panel=meta-copy`
4. Panel slides in — form shows campaigns with spend listed as radio buttons
5. First underperforming campaign (ROAS < 1 or zero conversions) is pre-selected
6. Fill in business context, click "Generate ad copy"
7. Loading state shows, then results slide in with diagnosis, strategy, copy variants
8. Close panel — URL param clears
9. On pages without a Meta account selected — panel shows "Select an account first"

- [ ] **Step 8: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/meta/page.js
git commit -m "feat: wire Meta ad copy panel into Meta page"
```
