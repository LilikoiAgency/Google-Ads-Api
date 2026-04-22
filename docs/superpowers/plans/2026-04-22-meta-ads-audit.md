# Meta Ads Audit — Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a scored Meta Ads audit at `/dashboard/meta/audit` with 8 pillar scores, optional Claude-generated narrative, shared team history, and embedded ad-level creative preview via the MetaAdsPanel from Phase 1.

**Architecture:** Mirrors the Google Ads audit (`/dashboard/google/ads/audit`). Data fetch + scoring is split: a server route pulls raw Meta data via the v19.0 Graph API (using the Phase-1 shared `metaGraph.js` helpers), and a pure library `src/lib/metaAudit.js` shapes it into pillar scores + action plan. A separate Claude route generates the AI insight on demand. History is saved to Mongo (`MetaAudits` collection) and shared across the team, same upsert-by-auditId pattern as Google Ads.

**Tech Stack:** Next.js App Router, React client components, Meta Graph API v19.0 (read-only), Anthropic SDK (`claude-sonnet-4-6`), MongoDB, inline-styled React components matching existing codebase pattern.

**Spec:** `docs/superpowers/specs/2026-04-22-meta-ads-audit-design.md`

**Template files to pattern-match when building:**
- `src/lib/googleAdsAudit.js` (683 lines) — structure for `metaAudit.js`
- `src/lib/googleAdsAuditPrompt.js` (115 lines) — structure for `metaAuditPrompt.js`
- `src/app/api/googleads/audit/route.js` (396 lines) — structure for Meta data-fetch route
- `src/app/api/googleads/audit/save/route.js` (59 lines) — exact same upsert pattern, swap collection name
- `src/app/api/googleads/audit/history/route.js` (83 lines) — already shared across team
- `src/app/api/googleads/audit/accounts/route.js` (48 lines) — already shared across team
- `src/app/api/claude/google-ads-audit/route.js` (137 lines) — structure for Claude route
- `src/app/dashboard/google/ads/audit/page.js` (1450 lines) — structure for audit page UI

**Testing note:** This codebase has no automated UI/integration test suite. Per the existing convention, verification is manual/browser-based. Every task below lists concrete verification commands and browser checks. Do NOT skip them.

---

## File structure

### New files
- `src/lib/metaAudit.js` — pure audit logic (pillar scoring, action plan builder, formatters)
- `src/lib/metaAuditPrompt.js` — Claude system prompt
- `src/app/api/meta/audit/route.js` — GET: fetch Meta data + return parsed audit payload
- `src/app/api/meta/audit/save/route.js` — POST: upsert audit by auditId (shared pattern)
- `src/app/api/meta/audit/history/route.js` — GET list/single + DELETE (team-shared, author/admin-only delete)
- `src/app/api/meta/audit/accounts/route.js` — GET: distinct audited accounts for the left rail
- `src/app/api/claude/meta-audit/route.js` — POST: Claude AI analysis with daily limit
- `src/app/dashboard/meta/audit/page.js` — UI page

### Modified files
- `src/app/dashboard/components/DashboardSidebar.jsx` — add "Meta Ads Audit" nav entry under Paid Media
- `src/app/dashboard/page.js` — update `WHATS_NEW_TITLE` / `WHATS_NEW_BODY`

### Responsibility boundaries
- `metaAudit.js` is the ONLY place that applies business-rule scoring. Keep all thresholds and pillar definitions here. Test with real Meta fixtures later.
- `metaAuditPrompt.js` is ONLY a string export. No code.
- `/api/meta/audit` is the only place that calls Meta's Graph API for audit purposes. Reuses Phase-1 `metaGraph.js` helpers.
- The page file is the only place that coordinates UI state (selected account, active tab, modal, AI run). All other logic lives in `metaAudit.js` or the API routes.

---

## Task 1: Pure audit logic library

**Files:**
- Create: `src/lib/metaAudit.js`

**Context:** This file mirrors `src/lib/googleAdsAudit.js`. Read that file's first 50 lines to see the style (inline formatters, verdict helpers, pure functions). We'll implement the Meta-specific scoring for the 8 pillars from the spec.

- [ ] **Step 1: Create the file scaffolding with formatters and verdict helpers**

Create `src/lib/metaAudit.js`:

```javascript
// src/lib/metaAudit.js
// Pure audit logic — no React, no side effects.
// Consumed by /api/meta/audit which fetches raw Meta data.

export function fmtCurrency(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function fmtPct(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

export function fmtCvr(clicks, conversions) {
  if (!clicks) return '—';
  return `${((conversions / clicks) * 100).toFixed(1)}%`;
}

// ── Campaign-level verdict ────────────────────────────────────────────────────
export function getCampaignVerdict(campaign) {
  const conv  = campaign.conversions || 0;
  const spend = campaign.spend || 0;
  const freq  = campaign.frequency || 0;
  if (conv === 0 && spend > 300) {
    return { key: 'PAUSE', label: 'PAUSE', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)', icon: '⚫' };
  }
  if (freq > 5 && spend > 100) {
    return { key: 'FATIGUED', label: 'FATIGUED', color: '#dd6b20', bg: 'rgba(221,107,32,0.14)', icon: '🔥' };
  }
  if (conv > 10 && spend > 0) {
    return { key: 'SCALE', label: 'SCALE', color: '#38a169', bg: 'rgba(56,161,105,0.14)', icon: '🚀' };
  }
  return { key: 'REVIEW', label: 'REVIEW', color: '#4ecca3', bg: 'rgba(78,204,163,0.12)', icon: '👀' };
}
```

- [ ] **Step 2: Add Pillar 1 (Account Structure) analyzer**

Append to `src/lib/metaAudit.js`:

```javascript
// ── Pillar 1: Account Structure ───────────────────────────────────────────────
export function analyzeStructure(campaigns) {
  const active = campaigns.filter((c) => c.status === 'ACTIVE' || c.effective_status === 'ACTIVE');
  const objectives = {};
  active.forEach((c) => {
    const k = c.objective || 'UNKNOWN';
    objectives[k] = (objectives[k] || 0) + 1;
  });
  const cboCount = active.filter((c) => c.budget_remaining != null || c.daily_budget != null || c.lifetime_budget != null).length;
  const cboPct   = active.length ? cboCount / active.length : 0;

  // Fragmentation: count of sub-$500-spend campaigns as % of all active
  const lowSpend = active.filter((c) => (c.spend || 0) < 500).length;
  const fragmentationRatio = active.length ? lowSpend / active.length : 0;

  let score = 7;
  if (active.length > 0) {
    if (fragmentationRatio > 0.6) score -= 3;
    else if (fragmentationRatio > 0.4) score -= 2;
    else if (fragmentationRatio > 0.2) score -= 1;
    if (cboPct >= 0.6) score += 1;
    if (Object.keys(objectives).length <= 3 && active.length > 5) score += 1;
  }
  score = Math.max(1, Math.min(10, score));

  return {
    activeCampaignCount: active.length,
    objectives,
    cboPct,
    fragmentationRatio,
    lowSpendCount: lowSpend,
    score,
  };
}
```

- [ ] **Step 3: Add Pillar 2 (Ad Fatigue) analyzer**

Append:

```javascript
// ── Pillar 2: Ad Fatigue (frequency) ──────────────────────────────────────────
export function analyzeFatigue(adSets) {
  const totalSpend = adSets.reduce((s, a) => s + (a.spend || 0), 0);
  const fatigued = adSets.filter((a) => (a.frequency || 0) > 4);
  const fatiguedSpend = fatigued.reduce((s, a) => s + (a.spend || 0), 0);
  const fatiguedPct = totalSpend > 0 ? fatiguedSpend / totalSpend : 0;

  let score;
  if (fatiguedPct < 0.05) score = 9;
  else if (fatiguedPct < 0.15) score = 7;
  else if (fatiguedPct < 0.30) score = 5;
  else if (fatiguedPct < 0.50) score = 3;
  else score = 1;

  return {
    fatiguedAdSets: fatigued.map((a) => ({
      id: a.id,
      name: a.name,
      campaignName: a.campaign_name,
      frequency: a.frequency,
      spend: a.spend,
    })),
    fatiguedSpendPct: fatiguedPct,
    fatiguedSpend,
    totalSpend,
    score,
  };
}
```

- [ ] **Step 4: Add Pillar 3 (Creative Diversity)**

Append:

```javascript
// ── Pillar 3: Creative Diversity ──────────────────────────────────────────────
export function analyzeCreative(adSets, ads) {
  const adsByAdSet = {};
  ads.forEach((ad) => {
    const k = ad.ad_set_id;
    if (!adsByAdSet[k]) adsByAdSet[k] = [];
    adsByAdSet[k].push(ad);
  });

  const perAdSetCounts = adSets.map((as) => (adsByAdSet[as.id] || []).length);
  const avgCreatives = perAdSetCounts.length
    ? perAdSetCounts.reduce((s, n) => s + n, 0) / perAdSetCounts.length
    : 0;

  const singleCreativeAdSets = adSets.filter((as) => (adsByAdSet[as.id] || []).length === 1).length;
  const singleCreativePct = adSets.length ? singleCreativeAdSets / adSets.length : 0;

  let score;
  if (avgCreatives >= 4) score = 9;
  else if (avgCreatives >= 3) score = 7;
  else if (avgCreatives >= 2) score = 5;
  else score = 2;
  if (singleCreativePct > 0.5) score = Math.max(1, score - 2);

  return {
    avgCreativesPerAdSet: avgCreatives,
    singleCreativeAdSetCount: singleCreativeAdSets,
    singleCreativePct,
    score,
  };
}
```

- [ ] **Step 5: Add Pillar 4 (Audience), 5 (Placements), 6 (Bidding), 7 (Tracking), 8 (Performance)**

Append:

```javascript
// ── Pillar 4: Audience Targeting ──────────────────────────────────────────────
export function analyzeAudience(adSets) {
  let broadSpend = 0;
  let narrowSpend = 0;
  let lookalikeCount = 0;
  let expansionCount = 0;

  adSets.forEach((as) => {
    const spend = as.spend || 0;
    const t = as.targeting || {};
    const hasDetailed = Array.isArray(t.flexible_spec) && t.flexible_spec.length > 0;
    const hasCustomAudience = Array.isArray(t.custom_audiences) && t.custom_audiences.length > 0;
    const hasLookalike = hasCustomAudience && (t.custom_audiences || []).some(
      (c) => (c.name || '').toLowerCase().includes('lookalike') || (c.name || '').toLowerCase().includes('lal'),
    );
    if (hasLookalike) lookalikeCount += 1;
    if (t.targeting_automation?.advantage_audience === 1 || t.targeting_automation?.individual_setting?.age === 1) {
      expansionCount += 1;
    }
    if (hasDetailed && !hasLookalike) narrowSpend += spend;
    else broadSpend += spend;
  });

  const totalSpend = broadSpend + narrowSpend;
  const broadPct = totalSpend > 0 ? broadSpend / totalSpend : 0;

  let score;
  if (broadPct >= 0.7) score = 9;
  else if (broadPct >= 0.5) score = 7;
  else if (broadPct >= 0.3) score = 5;
  else score = 3;
  if (lookalikeCount > 0) score = Math.min(10, score + 1);

  return { broadPct, broadSpend, narrowSpend, lookalikeCount, expansionCount, score };
}

// ── Pillar 5: Placements ──────────────────────────────────────────────────────
export function analyzePlacements(adSets) {
  const advantagePlacementCount = adSets.filter(
    (as) => as.targeting?.publisher_platforms == null, // null / undefined ⇒ Advantage+ default
  ).length;
  const advantagePct = adSets.length ? advantagePlacementCount / adSets.length : 0;

  let score;
  if (advantagePct >= 0.8) score = 9;
  else if (advantagePct >= 0.6) score = 7;
  else if (advantagePct >= 0.4) score = 5;
  else score = 3;

  return { advantagePlacementCount, advantagePct, score };
}

// ── Pillar 6: Bidding & Budget ────────────────────────────────────────────────
export function analyzeBidding(adSets, campaigns) {
  const learning = adSets.filter((as) => as.learning_stage_info?.status === 'LEARNING');
  const learningPct = adSets.length ? learning.length / adSets.length : 0;

  const bidStrategies = {};
  [...campaigns, ...adSets].forEach((x) => {
    const k = x.bid_strategy || 'UNKNOWN';
    bidStrategies[k] = (bidStrategies[k] || 0) + 1;
  });

  const lowestCostCount = bidStrategies['LOWEST_COST_WITHOUT_CAP'] || 0;
  const bidCapCount = (bidStrategies['LOWEST_COST_WITH_BID_CAP'] || 0) + (bidStrategies['COST_CAP'] || 0);
  const smartBidFit = lowestCostCount > bidCapCount;

  let score;
  if (learningPct < 0.1 && smartBidFit) score = 9;
  else if (learningPct < 0.25) score = 7;
  else if (learningPct < 0.5) score = 5;
  else score = 3;

  return {
    learningCount: learning.length,
    learningPct,
    bidStrategies,
    smartBidFit,
    score,
  };
}

// ── Pillar 7: Conversion Tracking ─────────────────────────────────────────────
export function analyzeTracking(pixels, accountInsights) {
  const hasPixel = Array.isArray(pixels) && pixels.length > 0;
  const recentlyFired = hasPixel && pixels.some((p) => {
    if (!p.last_fired_time) return false;
    const ago = Date.now() - new Date(p.last_fired_time).getTime();
    return ago < 7 * 24 * 3600 * 1000;
  });
  const accountConversions = accountInsights?.conversions || 0;

  let score;
  if (hasPixel && recentlyFired && accountConversions > 0) score = 9;
  else if (hasPixel && recentlyFired) score = 7;
  else if (hasPixel) score = 5;
  else score = 2;

  return {
    hasPixel,
    pixelCount: pixels?.length || 0,
    recentlyFired,
    conversions: accountConversions,
    score,
  };
}

// ── Pillar 8: Performance ─────────────────────────────────────────────────────
export function analyzePerformance(campaigns, adSets) {
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalConv  = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const blendedCPA = totalConv > 0 ? totalSpend / totalConv : null;

  const zeroConvHighSpend = adSets.filter((as) => (as.conversions || 0) === 0 && (as.spend || 0) > 100);
  const zeroConvSpend = zeroConvHighSpend.reduce((s, a) => s + (a.spend || 0), 0);
  const zeroConvPct = totalSpend > 0 ? zeroConvSpend / totalSpend : 0;

  let score;
  if (zeroConvPct < 0.05) score = 9;
  else if (zeroConvPct < 0.15) score = 7;
  else if (zeroConvPct < 0.30) score = 5;
  else score = 2;

  return {
    totalSpend,
    totalConversions: totalConv,
    blendedCPA,
    zeroConvHighSpend: zeroConvHighSpend.slice(0, 20),
    zeroConvPct,
    score,
  };
}
```

- [ ] **Step 6: Add the `runAudit` orchestrator + `buildActionPlan`**

Append:

```javascript
// ── Action Plan ───────────────────────────────────────────────────────────────
export function buildActionPlan({ structure, fatigue, creative, audience, placements, bidding, tracking, performance }) {
  const actions = [];
  if (fatigue.fatiguedSpendPct > 0.3) {
    actions.push({
      priority: 'critical',
      category: 'Ad Fatigue',
      issue: `${Math.round(fatigue.fatiguedSpendPct * 100)}% of spend on fatigued ad sets (frequency > 4)`,
      action: 'Refresh creative on top 3 fatigued ad sets this week',
      ice: 700,
    });
  }
  if (performance.zeroConvPct > 0.2) {
    actions.push({
      priority: 'critical',
      category: 'Performance',
      issue: `${Math.round(performance.zeroConvPct * 100)}% of spend producing zero conversions`,
      action: `Pause or restructure ${performance.zeroConvHighSpend.length} high-spend 0-conversion ad sets`,
      ice: 650,
    });
  }
  if (!tracking.hasPixel) {
    actions.push({
      priority: 'critical',
      category: 'Tracking',
      issue: 'No Meta Pixel attached to this ad account',
      action: 'Attach Pixel and set up standard events (Purchase, Lead, etc.)',
      ice: 800,
    });
  } else if (!tracking.recentlyFired) {
    actions.push({
      priority: 'high',
      category: 'Tracking',
      issue: 'Pixel exists but no events fired in last 7 days',
      action: 'Verify Pixel is installed on site and events are firing',
      ice: 500,
    });
  }
  if (placements.advantagePct < 0.5) {
    actions.push({
      priority: 'medium',
      category: 'Placements',
      issue: `Only ${Math.round(placements.advantagePct * 100)}% of ad sets use Advantage+ Placements`,
      action: 'Enable Advantage+ Placements on manual-placement campaigns to expand reach',
      ice: 350,
    });
  }
  if (creative.avgCreativesPerAdSet < 2) {
    actions.push({
      priority: 'medium',
      category: 'Creative',
      issue: `Average ${creative.avgCreativesPerAdSet.toFixed(1)} creatives per ad set — target 4+`,
      action: 'Add 3-4 creative variants to under-served ad sets to give Meta room to optimize',
      ice: 300,
    });
  }
  if (bidding.learningPct > 0.4) {
    actions.push({
      priority: 'high',
      category: 'Bidding',
      issue: `${Math.round(bidding.learningPct * 100)}% of ad sets stuck in learning phase`,
      action: 'Consolidate low-event ad sets so each gets 50+ optimization events per 7 days',
      ice: 450,
    });
  }
  if (audience.broadPct < 0.3) {
    actions.push({
      priority: 'medium',
      category: 'Audience',
      issue: `Only ${Math.round(audience.broadPct * 100)}% of spend on broad targeting`,
      action: 'Test broad audiences — Meta recommends creative leverage over narrow targeting',
      ice: 300,
    });
  }
  if (structure.fragmentationRatio > 0.5) {
    actions.push({
      priority: 'high',
      category: 'Structure',
      issue: `${structure.lowSpendCount} campaigns under $500 spend — heavy fragmentation`,
      action: 'Consolidate low-spend campaigns; Meta optimizes better with fewer, larger budgets',
      ice: 450,
    });
  }
  return actions.sort((a, b) => b.ice - a.ice);
}

export function runAudit(accountData) {
  const { campaigns = [], adSets = [], ads = [], pixels = [], accountInsights = {} } = accountData || {};

  const structure   = analyzeStructure(campaigns);
  const fatigue     = analyzeFatigue(adSets);
  const creative    = analyzeCreative(adSets, ads);
  const audience    = analyzeAudience(adSets);
  const placements  = analyzePlacements(adSets);
  const bidding     = analyzeBidding(adSets, campaigns);
  const tracking    = analyzeTracking(pixels, accountInsights);
  const performance = analyzePerformance(campaigns, adSets);

  const pillars = { structure, fatigue, creative, audience, placements, bidding, tracking, performance };
  const actionPlan = buildActionPlan(pillars);

  const scores = [structure.score, fatigue.score, creative.score, audience.score, placements.score, bidding.score, tracking.score, performance.score];
  const avg = scores.reduce((s, n) => s + n, 0) / scores.length;
  let grade;
  if (avg >= 8.0) grade = 'A';
  else if (avg >= 6.5) grade = 'B';
  else if (avg >= 5.0) grade = 'C';
  else if (avg >= 3.5) grade = 'D';
  else grade = 'F';

  return {
    summary: {
      totalSpend: performance.totalSpend,
      totalConversions: performance.totalConversions,
      blendedCPA: performance.blendedCPA,
      accountGrade: grade,
      avgScore: Math.round(avg * 10) / 10,
      criticalCount: actionPlan.filter((a) => a.priority === 'critical').length,
      warningCount:  actionPlan.filter((a) => a.priority === 'high').length,
      campaignCount: campaigns.length,
      adSetCount: adSets.length,
      adCount: ads.length,
    },
    pillars,
    campaigns: campaigns.map((c) => ({ ...c, verdict: getCampaignVerdict(c) })),
    adSets,
    ads,
    actionPlan,
  };
}
```

- [ ] **Step 7: Syntax check**

```bash
node --check src/lib/metaAudit.js
```

Expected: exit 0.

- [ ] **Step 8: Smoke-test `runAudit` with a minimal fixture**

Create a throwaway test script at `/tmp/meta-audit-smoke.mjs` (outside the repo to avoid committing):

```javascript
import { runAudit } from '../src/lib/metaAudit.js';
// NOTE: adjust the import path to an absolute Windows-safe path if needed
// Or: inline the file via `import('file:///...src/lib/metaAudit.js')`
const out = runAudit({
  campaigns: [
    { id: '1', name: 'Test A', objective: 'OUTCOME_SALES', status: 'ACTIVE', spend: 1000, conversions: 5 },
    { id: '2', name: 'Test B', objective: 'OUTCOME_SALES', status: 'ACTIVE', spend: 200, conversions: 0 },
  ],
  adSets: [
    { id: '10', campaign_id: '1', name: 'AS1', status: 'ACTIVE', spend: 1000, frequency: 2.1, conversions: 5, learning_stage_info: { status: 'SUCCESS' } },
    { id: '11', campaign_id: '2', name: 'AS2', status: 'ACTIVE', spend: 200, frequency: 5.4, conversions: 0, learning_stage_info: { status: 'LEARNING' } },
  ],
  ads: [
    { id: '100', ad_set_id: '10' },
    { id: '101', ad_set_id: '10' },
    { id: '102', ad_set_id: '11' },
  ],
  pixels: [{ id: 'px1', last_fired_time: new Date().toISOString() }],
  accountInsights: { conversions: 5 },
});
console.log(JSON.stringify(out.summary, null, 2));
console.log('Pillar scores:', Object.fromEntries(Object.entries(out.pillars).map(([k, v]) => [k, v.score])));
console.log('Actions:', out.actionPlan.length);
```

Run: `node /tmp/meta-audit-smoke.mjs` (adjust path style for Windows Git Bash).

Expected: prints a summary object with `totalSpend: 1200, totalConversions: 5, accountGrade: <letter>`, a `Pillar scores:` line showing all 8 keys, and `Actions:` as a number ≥ 1.

Delete the throwaway file after.

- [ ] **Step 9: Commit**

```bash
git add src/lib/metaAudit.js
git commit -m "feat: add pure Meta Ads audit logic

Exports runAudit(accountData) → scored audit with 8 pillars
(structure, fatigue, creative, audience, placements, bidding,
tracking, performance) and ICE-ranked action plan. No React,
no side effects. Ready for consumption by /api/meta/audit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Data-fetch API route

**Files:**
- Create: `src/app/api/meta/audit/route.js`

**Context:**
- Template: `src/app/api/googleads/audit/route.js` (396 lines). Pattern to mirror: auth guard → build query params → parallel fetches → shape + return data.
- Phase-1 helpers in `src/lib/metaGraph.js` — use `graphGet`, `getTimeRange`, `getMetaAccessToken`. DO NOT re-invent token or URL handling.
- Meta Graph batch fetch: use field expansion to pull campaigns + ad sets + ads + insights in a small number of calls. Example pattern: `/{actId}/campaigns?fields=id,name,objective,status,bid_strategy,daily_budget,lifetime_budget,insights.time_range({...}){spend,impressions,clicks,ctr,frequency,actions,action_values}`.

- [ ] **Step 1: Create the route with auth + param validation**

Create `src/app/api/meta/audit/route.js`:

```javascript
// src/app/api/meta/audit/route.js
// Fetches campaigns + ad sets + ads + insights + pixels for an audit.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { graphGet, getTimeRange, getMetaAccessToken } from '../../../../lib/metaGraph';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

function sumActions(actions, ...keywords) {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, a) => {
    if (keywords.some((k) => a.action_type?.includes(k))) {
      return sum + parseFloat(a.value || 0);
    }
    return sum;
  }, 0);
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function shapeInsights(ins) {
  const spend = toNum(ins?.spend);
  const revenue = sumActions(ins?.action_values, 'purchase', 'omni_purchase');
  const conversions = sumActions(ins?.actions, 'purchase', 'omni_purchase', 'lead', 'complete_registration');
  return {
    spend,
    impressions: toNum(ins?.impressions),
    clicks: toNum(ins?.clicks),
    ctr: toNum(ins?.ctr) / 100,
    cpm: toNum(ins?.cpm),
    cpc: toNum(ins?.cpc),
    frequency: toNum(ins?.frequency),
    conversions,
    revenue,
    cost_per_conversion: conversions > 0 ? spend / conversions : null,
    roas: spend > 0 ? revenue / spend : null,
  };
}

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

  try {
    const token = await getMetaAccessToken();

    const insightsFields = 'spend,impressions,clicks,ctr,cpm,cpc,frequency,actions,action_values';
    const timeRangeJson = JSON.stringify(timeRange);

    const [accountRow, campaignsResp, adSetsResp, adsResp, pixelsResp, accountInsightsResp] = await Promise.all([
      graphGet(actId, { fields: 'name,currency,account_status,business' }, token),
      graphGet(`${actId}/campaigns`, {
        fields: `id,name,objective,status,effective_status,buying_type,special_ad_categories,bid_strategy,daily_budget,lifetime_budget,insights.time_range(${timeRangeJson}){${insightsFields}}`,
        limit: 200,
      }, token),
      graphGet(`${actId}/adsets`, {
        fields: `id,name,campaign_id,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,frequency_control_specs,learning_stage_info,is_dynamic_creative,targeting{flexible_spec,custom_audiences,targeting_automation,publisher_platforms},insights.time_range(${timeRangeJson}){${insightsFields}}`,
        limit: 500,
      }, token),
      graphGet(`${actId}/ads`, {
        fields: 'id,name,ad_set_id,status,effective_status,creative{id}',
        limit: 1000,
      }, token),
      graphGet(`${actId}/adspixels`, { fields: 'id,name,last_fired_time' }, token).catch(() => ({ data: [] })),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        fields: insightsFields,
      }, token),
    ]);

    const campaignNameById = Object.fromEntries((campaignsResp.data || []).map((c) => [c.id, c.name]));

    const campaigns = (campaignsResp.data || []).map((c) => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effective_status: c.effective_status,
      buying_type: c.buying_type,
      special_ad_categories: c.special_ad_categories,
      bid_strategy: c.bid_strategy,
      daily_budget: toNum(c.daily_budget) / 100, // Meta returns budget in cents
      lifetime_budget: toNum(c.lifetime_budget) / 100,
      ...shapeInsights(c.insights?.data?.[0]),
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
      ...shapeInsights(as.insights?.data?.[0]),
    }));

    const ads = (adsResp.data || []).map((ad) => ({
      id: ad.id,
      name: ad.name,
      ad_set_id: ad.ad_set_id,
      status: ad.status,
      effective_status: ad.effective_status,
      creative_id: ad.creative?.id || null,
    }));

    const pixels = (pixelsResp.data || []);
    const accountInsights = shapeInsights(accountInsightsResp.data?.[0]);

    return NextResponse.json({
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
    });
  } catch (err) {
    const status = err?.status || 500;
    return NextResponse.json(
      { error: err?.message || 'Meta API error', code: err?.code },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
```

- [ ] **Step 2: Syntax check**

```bash
node --check src/app/api/meta/audit/route.js
```

Expected: exit 0.

- [ ] **Step 3: Manual browser verification (requires dev server)**

Start `npm run dev`. Find a known Meta account ID from the existing `/dashboard/meta` account picker (or from `sessionStorage`). Then:

```bash
curl "http://localhost:3000/api/meta/audit?accountId=act_XXX&range=28d" \
  -H "Cookie: <your-session-cookie>" | python -m json.tool | head -80
```

Expected: JSON with `data.account`, `data.campaigns` (array), `data.adSets` (array), `data.ads` (array), `data.pixels` (array or []), `data.accountInsights` (object), `data.dateRange`. Spend / impressions values should be sensible numbers, not `NaN` or `null` everywhere.

If you see `"error": "Unauthorized"`, missing session cookie. If `"(#100)..."`, a field name is wrong for this account — adjust.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/meta/audit/route.js
git commit -m "feat: add /api/meta/audit data-fetch route

Parallel Graph calls for campaigns + ad sets + ads + insights
+ pixels + account-level insights. Budget values converted from
cents to dollars. Read-only; no persistence at this layer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Save / history / accounts routes

**Files:**
- Create: `src/app/api/meta/audit/save/route.js`
- Create: `src/app/api/meta/audit/history/route.js`
- Create: `src/app/api/meta/audit/accounts/route.js`

**Context:** Mirror the existing Google Ads audit routes verbatim, swapping `GoogleAdsAudits` → `MetaAudits` and `customerId` → `accountId`.

- [ ] **Step 1: Create the save route**

Create `src/app/api/meta/audit/save/route.js`:

```javascript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions, allowedEmailDomain } from '../../../../../lib/auth';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLLECTION = 'MetaAudits';

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

  const { accountId, accountName, dateRange, dateWindow, dateLabel, summary, aiInsight, auditId } = body;
  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', requestId }, { status: 400 });
  }

  const client = await dbConnect();
  const db = client.db(DB);

  const doc = {
    email,
    accountId: String(accountId),
    accountName: accountName || 'Account',
    dateRange: dateRange || 'LAST_30_DAYS',
    dateWindow: dateWindow || null,
    dateLabel: dateLabel || dateRange || 'LAST_30_DAYS',
    summary: summary || {},
    aiInsight: aiInsight || null,
    savedAt: new Date(),
  };

  if (auditId) {
    let oid;
    try { oid = new ObjectId(auditId); } catch { oid = null; }
    if (oid) {
      const update = await db.collection(COLLECTION).updateOne(
        { _id: oid, email, accountId: String(accountId) },
        { $set: doc },
      );
      if (update.matchedCount > 0) {
        return NextResponse.json({ id: String(oid), requestId, updated: true });
      }
    }
  }

  const result = await db.collection(COLLECTION).insertOne(doc);
  return NextResponse.json({ id: String(result.insertedId), requestId, updated: false });
}
```

- [ ] **Step 2: Create the history route**

Create `src/app/api/meta/audit/history/route.js`:

```javascript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions, allowedEmailDomain } from '../../../../../lib/auth';
import { isAdmin } from '../../../../../lib/admins';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLLECTION = 'MetaAudits';
const DAILY_LIMIT = parseInt(process.env.META_AI_AUDIT_DAILY_LIMIT || '5');

async function getUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  const used = doc?.metaAiAuditCount ?? 0;
  return { count: used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used) };
}

export async function GET(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const accountId = searchParams.get('accountId');

  const client = await dbConnect();
  const db = client.db(DB);
  const usage = await getUsage(db, email);

  if (id) {
    let oid;
    try { oid = new ObjectId(id); }
    catch { return NextResponse.json({ error: 'Invalid id', requestId }, { status: 400 }); }
    const doc = await db.collection(COLLECTION).findOne({ _id: oid });
    if (!doc) return NextResponse.json({ error: 'Not found', requestId }, { status: 404 });
    return NextResponse.json({ data: doc, usage, requestId });
  }

  if (accountId) {
    const docs = await db.collection(COLLECTION)
      .find({ accountId: String(accountId) })
      .sort({ savedAt: -1 })
      .limit(20)
      .project({ aiInsight: 0 })
      .toArray();
    return NextResponse.json({ data: docs, usage, requestId });
  }

  return NextResponse.json({ error: 'accountId or id required', requestId }, { status: 400 });
}

export async function DELETE(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required', requestId }, { status: 400 });

  let oid;
  try { oid = new ObjectId(id); }
  catch { return NextResponse.json({ error: 'Invalid id', requestId }, { status: 400 }); }

  const client = await dbConnect();
  const coll = client.db(DB).collection(COLLECTION);
  const filter = isAdmin(email) ? { _id: oid } : { _id: oid, email };
  const result = await coll.deleteOne(filter);
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: 'Not found or not yours to delete', requestId }, { status: 404 });
  }
  return NextResponse.json({ ok: true, requestId });
}
```

- [ ] **Step 3: Create the accounts route**

Create `src/app/api/meta/audit/accounts/route.js`:

```javascript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../lib/auth';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLLECTION = 'MetaAudits';

export async function GET() {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  const client = await dbConnect();
  const db = client.db(DB);

  const accounts = await db.collection(COLLECTION).aggregate([
    { $sort: { savedAt: -1 } },
    {
      $group: {
        _id: '$accountId',
        accountName: { $first: '$accountName' },
        lastSavedAt: { $first: '$savedAt' },
        lastGrade: { $first: '$summary.accountGrade' },
        lastDateLabel: { $first: '$dateLabel' },
        auditCount: { $sum: 1 },
      },
    },
    { $sort: { lastSavedAt: -1 } },
    {
      $project: {
        _id: 0,
        accountId: '$_id',
        accountName: 1,
        lastSavedAt: 1,
        lastGrade: 1,
        lastDateLabel: 1,
        auditCount: 1,
      },
    },
  ]).toArray();

  return NextResponse.json({ data: accounts, requestId });
}
```

- [ ] **Step 4: Syntax check all three**

```bash
node --check src/app/api/meta/audit/save/route.js && \
node --check src/app/api/meta/audit/history/route.js && \
node --check src/app/api/meta/audit/accounts/route.js && \
echo OK
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/meta/audit/save/ src/app/api/meta/audit/history/ src/app/api/meta/audit/accounts/
git commit -m "feat: add Meta audit save/history/accounts routes

Upsert-by-auditId save pattern (one record per run, AI updates
same doc). History and accounts list visible to the whole team;
DELETE scoped to creator or admin.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Claude AI prompt + AI route

**Files:**
- Create: `src/lib/metaAuditPrompt.js`
- Create: `src/app/api/claude/meta-audit/route.js`

**Context:** Mirror `src/lib/googleAdsAuditPrompt.js` (115 lines) and `src/app/api/claude/google-ads-audit/route.js` (137 lines).

- [ ] **Step 1: Create the system prompt**

Create `src/lib/metaAuditPrompt.js`:

```javascript
// src/lib/metaAuditPrompt.js
// System prompt for the Claude-powered Meta Ads audit.
// Mirrors googleAdsAuditPrompt — structured input in, structured JSON out.

export const META_ADS_AUDIT_SYSTEM_PROMPT = `
You are a senior Meta Ads strategist with 10+ years managing 7-figure monthly Meta budgets. You follow Meta's current best practices (Advantage+ bias, creative over targeting, broad audiences, consolidation). You will receive structured Meta Ads account data and return a single comprehensive audit as a structured JSON object.

## YOUR METHODOLOGY — THE 8 AUDIT PILLARS

### Pillar 1 — Account Structure
Evaluate: campaign count, objective distribution, CBO vs ABO, campaign fragmentation (too many sub-$500 campaigns = Meta can't optimize). Meta prefers consolidated structure with fewer, larger campaigns.
Scoring: consolidated + right objectives + CBO → 9-10 | mostly consolidated → 7-8 | fragmented → 4-6 | scattered, dozens of low-spend campaigns → 1-3

### Pillar 2 — Ad Fatigue (Frequency)
Evaluate: % of spend on ad sets with frequency > 4. Fatigue kills CTR and conversion rate.
Scoring: <5% fatigued spend → 9-10 | 5-15% → 7-8 | 15-30% → 4-6 | 30-50% → 2-3 | >50% → 1

### Pillar 3 — Creative Diversity
Evaluate: average active creatives per ad set (target 4+), image vs video mix, dynamic creative usage. Meta's algorithm needs creative variety.
Scoring: 4+ avg creatives, video present → 9-10 | 2-3 creatives → 5-7 | single-creative ad sets dominant → 1-3

### Pillar 4 — Audience Targeting
Evaluate: broad vs detailed targeting by spend, lookalike usage, age/gender/interest expansion enabled. Meta's guidance: broad audiences with strong creative outperform narrow stacks.
Scoring: broad-dominant + lookalikes + expansion on → 9-10 | mixed → 5-7 | narrow, stacked detailed targeting → 1-3

### Pillar 5 — Placements
Evaluate: % of ad sets using Advantage+ Placements. Manual placement-limiting costs reach and often raises CPA.
Scoring: 80%+ Advantage+ → 9-10 | 60-80% → 7-8 | 40-60% → 5-6 | <40% → 1-4

### Pillar 6 — Bidding & Budget
Evaluate: bid strategy fit (Lowest Cost is the safe default; Cost Cap / Bid Cap only with enough data), % of ad sets stuck in LEARNING phase (needs 50 optimization events per 7 days).
Scoring: Lowest Cost dominant + <10% in learning → 9-10 | moderate → 5-7 | heavy bid caps + >50% in learning → 1-3

### Pillar 7 — Conversion Tracking
Evaluate: Pixel attached, events fired recently (last 7 days), standard events present (Purchase, Lead, etc.). Without tracking, Meta can't optimize.
Scoring: Pixel + recent events + conversions > 0 → 9-10 | Pixel + recent events → 7-8 | Pixel only → 4-5 | no Pixel → 1-2

### Pillar 8 — Performance
Evaluate: CPA / ROAS sanity, % of spend on zero-conversion high-spend ad sets, clear performance outliers.
Scoring: <5% waste → 9-10 | 5-15% → 7-8 | 15-30% → 4-6 | >30% → 1-3

## ACCOUNT GRADE
Calculate from average of pillar scores:
- A: 8.0+
- B: 6.5–7.9
- C: 5.0–6.4
- D: 3.5–4.9
- F: below 3.5

## RESPONSE FORMAT

Return ONLY valid JSON matching this exact structure. No markdown, no code fences, no preamble:

{
  "executive_summary": "3-5 sentences. Use actual campaign names, spend figures, and ad set names from the payload. What's the single biggest issue? The biggest opportunity?",
  "account_grade": "A | B | C | D | F",
  "pillar_scores": {
    "account_structure":    { "score": 1-10, "status": "Excellent | Good | Average | Below Average | Needs Work | Critical", "key_takeaway": "One sentence with specific data" },
    "ad_fatigue":           { "score": 1-10, "status": "...", "key_takeaway": "..." },
    "creative_diversity":   { "score": 1-10, "status": "...", "key_takeaway": "..." },
    "audience_targeting":   { "score": 1-10, "status": "...", "key_takeaway": "..." },
    "placements":           { "score": 1-10, "status": "...", "key_takeaway": "..." },
    "bidding_budget":       { "score": 1-10, "status": "...", "key_takeaway": "..." },
    "conversion_tracking":  { "score": 1-10, "status": "...", "key_takeaway": "..." },
    "performance":          { "score": 1-10, "status": "...", "key_takeaway": "..." }
  },
  "top_3_priorities": ["Priority 1 — specific action with data", "Priority 2", "Priority 3"],
  "biggest_strength": "One sentence with specific evidence from the data",
  "campaign_insights": [
    {
      "campaign_name": "Exact campaign name from data",
      "verdict": "SCALE | PAUSE | FATIGUED | OPTIMIZE | REVIEW",
      "ai_assessment": "2-3 sentences explaining why, referencing actual metrics",
      "recommended_action": "The single most important thing to do for this campaign right now"
    }
  ],
  "recommendations": [
    {
      "priority": "critical | high | medium | quick_win",
      "category": "Structure | Ad Fatigue | Creative | Audience | Placements | Bidding | Tracking | Performance",
      "issue": "Specific issue with actual numbers",
      "action": "Exactly what to do — specific enough to execute today",
      "expected_impact": "Measurable improvement + approximate timeline",
      "examples": ["specific campaign/ad-set name", "..."]
    }
  ],
  "client_summary": "2-3 sentences for a business owner, zero jargon — are the ads working, what's the one thing to change?"
}

## CRITICAL RULES
- Return ONLY the JSON object. No other text.
- All monetary values in the payload (spend, daily_budget, lifetime_budget, cpa) are in WHOLE US DOLLARS. Do NOT divide, multiply, or convert — quote them as-is with a "$" prefix.
- Every finding must reference specific data — actual campaign names, actual ad set names, actual dollar amounts and percentages from the payload.
- campaign_insights: include all PAUSE and SCALE verdicts; top 2-3 OPTIMIZE by spend; skip REVIEW if there are more than 5.
- recommendations: minimum 5, maximum 10. Sort critical first. Each must be specific enough to act on immediately.
- client_summary: zero jargon. A business owner should read it and immediately know if ads are working and what needs to change.
- If a data section is null or empty, acknowledge it but do not fabricate data.
- Score honestly. An account with 40% fatigued spend does NOT get a 7 on ad_fatigue regardless of other signals.
`;
```

- [ ] **Step 2: Create the Claude route**

Create `src/app/api/claude/meta-audit/route.js`:

```javascript
// src/app/api/claude/meta-audit/route.js
export const maxDuration = 180;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { META_ADS_AUDIT_SYSTEM_PROMPT } from '../../../../lib/metaAuditPrompt';
import { logApiUsage, estimateClaudeCost } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.META_AI_AUDIT_DAILY_LIMIT || '5');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.metaAiAuditCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { metaAiAuditCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true },
  );
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

  const { accountId, payload } = body;
  if (!accountId || !payload) {
    return NextResponse.json({ error: 'accountId and payload are required', requestId }, { status: 400 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const usedToday = await getDailyUsageCount(db, email);
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json({
        error: `Daily AI audit limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
        limitReached: true,
        usage: { count: usedToday, limit: DAILY_LIMIT, remaining: 0 },
        requestId,
      }, { status: 429 });
    }
  }

  const credentials = await getCredentials();
  const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Anthropic API key not configured — add ANTHROPIC_API_KEY to your credentials.' },
      { status: 500 },
    );
  }

  const client = new Anthropic({ apiKey });
  const userPrompt = `Analyze this Meta Ads account data and return the structured JSON audit:\n\n${JSON.stringify(payload, null, 2)}`;

  const RETRY_DELAYS = [5_000, 15_000];
  let response;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: META_ADS_AUDIT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });
      break;
    } catch (err) {
      if (err?.status === 529 && attempt < 2) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      console.error('[claude/meta-audit] Claude error:', err?.message);
      return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
    }
  }

  const rawText = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let auditResult;
  try {
    const clean = rawText.replace(/^```json\s*/m, '').replace(/^```\s*$/m, '').trim();
    auditResult = JSON.parse(clean);
  } catch (err) {
    console.error('[claude/meta-audit] JSON parse failed:', rawText.slice(0, 500));
    return NextResponse.json({ error: 'Failed to parse AI response as JSON', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'meta_audit',
    email,
    accountId: String(accountId),
    model: 'claude-sonnet-4-6',
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateClaudeCost('claude-sonnet-4-6', inputTokens, outputTokens),
  }).catch(() => {});

  let remainingToday = DAILY_LIMIT;
  if (!isAdmin(email)) {
    await incrementDailyUsage(db, email).catch(() => {});
    const newCount = await getDailyUsageCount(db, email).catch(() => DAILY_LIMIT);
    remainingToday = Math.max(0, DAILY_LIMIT - newCount);
  }

  return NextResponse.json({
    data: auditResult,
    requestId,
    usage: { count: DAILY_LIMIT - remainingToday, limit: DAILY_LIMIT, remaining: remainingToday },
  });
}
```

- [ ] **Step 3: Syntax check**

```bash
node --check src/lib/metaAuditPrompt.js && node --check src/app/api/claude/meta-audit/route.js && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/metaAuditPrompt.js src/app/api/claude/meta-audit/route.js
git commit -m "feat: add Claude AI route + prompt for Meta audit

Mirrors /api/claude/google-ads-audit pattern. 8-pillar scoring,
whole-USD values in payload, daily limit gated (META_AI_AUDIT_
DAILY_LIMIT env, default 5). Uses claude-sonnet-4-6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Audit UI page

**Files:**
- Create: `src/app/dashboard/meta/audit/page.js`

**Context:** The Google Ads audit page at `src/app/dashboard/google/ads/audit/page.js` (1450 lines) is the template. This task creates the Meta audit page by following that template's STRUCTURE but calling the Meta endpoints and rendering Meta-specific tabs.

This is the biggest task. Do it in sub-steps.

- [ ] **Step 1: Read the Google Ads audit page to understand the structure**

```bash
head -200 src/app/dashboard/google/ads/audit/page.js
```

Note the overall layout: `audit-root` → top bar → `audit-three-pane` → left rail (Accounts) + history rail + main content with tabs. All these CSS classes already exist in `globals.css` and are mobile-responsive.

- [ ] **Step 2: Create the scaffold with imports, color palette, and top-level state**

Create `src/app/dashboard/meta/audit/page.js`:

```jsx
"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useMemo, useEffect, Suspense } from "react";
import { runAudit, fmtCurrency, fmtPct } from "../../../../lib/metaAudit";
import MetaAdsPanel from "../components/MetaAdsPanel";

const TABS = ["Overview", "Campaigns", "Creative", "Audience", "Placements", "Bidding", "Performance", "Action Plan", "AI Insight"];

const C = {
  bg:      "#0f0f17",
  card:    "#1a1a2e",
  border:  "rgba(255,255,255,0.08)",
  accent:  "#1877F2",   // Meta blue
  pink:    "#e94560",
  teal:    "#4ecca3",
  amber:   "#f5a623",
  textPri: "#ffffff",
  textSec: "rgba(255,255,255,0.5)",
  textMut: "rgba(255,255,255,0.3)",
};

export default function MetaAuditPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: C.textSec }}>Loading…</div>}>
      <MetaAuditPageInner />
    </Suspense>
  );
}

function MetaAuditPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialAccountId = sp.get("accountId") || "";

  const [accountId,      setAccountId]      = useState(initialAccountId);
  const [accountName,    setAccountName]    = useState("");
  const [audit,          setAudit]          = useState(null);
  const [auditLoading,   setAuditLoading]   = useState(false);
  const [dateRange,      setDateRange]      = useState("LAST_30_DAYS");
  const [dateWindow,     setDateWindow]     = useState(null);
  const [tab,            setTab]            = useState(0);
  const [aiInsight,      setAiInsight]      = useState(null);
  const [aiLoading,      setAiLoading]      = useState(false);
  const [aiError,        setAiError]        = useState(null);
  const [history,        setHistory]        = useState([]);
  const [historyUsage,   setHistoryUsage]   = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [accounts,       setAccounts]       = useState([]);
  const [showRunModal,   setShowRunModal]   = useState(false);
  const [pendingAutoSave, setPendingAutoSave] = useState(false);
  const [pendingAi,      setPendingAi]      = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [adsPanelAdSet,  setAdsPanelAdSet]  = useState(null);

  // Load accounts list
  useEffect(() => {
    fetch("/api/meta/audit/accounts")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => { if (j?.data) setAccounts(j.data); })
      .catch(() => {});
  }, [historyVersion]);

  // Load history for current account
  useEffect(() => {
    if (!accountId) return;
    fetch(`/api/meta/audit/history?accountId=${encodeURIComponent(accountId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => {
        if (j?.data) setHistory(j.data);
        if (j?.usage) setHistoryUsage(j.usage);
      })
      .catch((err) => console.warn("[MetaAuditHistory]", err));
  }, [accountId, historyVersion]);

  async function doFetch(acctId, range, start, end) {
    setAudit(null);
    setAuditLoading(true);
    setAiInsight(null);
    setAiError(null);
    setActiveHistoryId(null);
    const params = new URLSearchParams({ accountId: acctId, range });
    if (range === "CUSTOM" && start && end) {
      params.set("startDate", start);
      params.set("endDate", end);
    }
    try {
      const r = await fetch(`/api/meta/audit?${params.toString()}`);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      if (j?.data) {
        setAccountName(j.data.account?.name || "");
        setAudit(runAudit(j.data));
        if (j.data.dateRange) setDateWindow(j.data.dateRange);
      }
    } catch (err) {
      console.warn("[MetaAuditPage]", err);
    } finally {
      setAuditLoading(false);
    }
  }

  // TODO placeholder — tab content rendered in subsequent steps
  return (
    <div className="audit-root" style={{ background: C.bg, color: C.textPri }}>
      <div className="audit-topbar" style={{ borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => router.back()} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.07)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: C.textSec, cursor: "pointer" }}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: C.accent, margin: "0 0 3px" }}>META ADS AUDIT</p>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {accountName || "Pick an account"}
          </h1>
        </div>
      </div>
      <div className="audit-three-pane">
        <div className="audit-sidebar" style={{ borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: C.textSec }}>Accounts</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {accounts.length === 0 ? (
              <p style={{ fontSize: 12, color: C.textSec, padding: "20px 14px", textAlign: "center", lineHeight: 1.6 }}>No accounts audited yet</p>
            ) : accounts.map((acc) => {
              const isActive = acc.accountId === accountId;
              return (
                <button key={acc.accountId} onClick={() => { setAccountId(acc.accountId); setAccountName(acc.accountName); }}
                  style={{ width: "100%", textAlign: "left", display: "block", padding: "12px 14px", border: "none", borderBottom: `1px solid ${C.border}`, borderLeft: `2px solid ${isActive ? C.accent : "transparent"}`, background: isActive ? "rgba(24,119,242,0.08)" : "transparent", cursor: "pointer" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: isActive ? "#fff" : "rgba(255,255,255,0.8)", margin: "0 0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={acc.accountName}>{acc.accountName}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {acc.lastGrade && <span style={{ fontSize: 12, fontWeight: 800, color: C.teal }}>{acc.lastGrade}</span>}
                    <span style={{ fontSize: 11, color: C.textSec }}>{acc.lastSavedAt ? new Date(acc.lastSavedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No audits"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="audit-history" style={{ borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 14px 12px", borderBottom: `1px solid ${C.border}` }}>
            <button onClick={() => setShowRunModal(true)} disabled={auditLoading || !accountId}
              style={{ width: "100%", background: auditLoading ? "rgba(24,119,242,0.3)" : C.accent, border: "none", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 700, color: "#fff", cursor: auditLoading ? "not-allowed" : "pointer" }}>
              {auditLoading ? "Running…" : "▶ Run Audit"}
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {history.length === 0 ? (
              <p style={{ fontSize: 12, color: C.textSec, padding: "20px 14px", textAlign: "center" }}>No audits yet for this account.</p>
            ) : history.map((entry) => (
              <div key={entry._id} onClick={() => loadHistoryEntry(entry)}
                style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: entry._id === activeHistoryId ? "rgba(24,119,242,0.08)" : "transparent" }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#fff", margin: 0 }}>{new Date(entry.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                <p style={{ fontSize: 11, color: C.textSec, margin: "2px 0 0" }}>{entry.dateLabel || entry.dateRange} · Grade {entry.summary?.accountGrade || "—"}</p>
                {entry.email && <p style={{ fontSize: 10, color: C.textMut, margin: "2px 0 0" }}>by {entry.email.split("@")[0]}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className="audit-content">
          <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 24px", display: "flex", overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch", flexShrink: 0 }}>
            {TABS.map((t, i) => (
              <button key={t} onClick={() => setTab(i)} style={{ flexShrink: 0, padding: "13px 16px", fontSize: 14, fontWeight: 600, background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", color: tab === i ? C.textPri : C.textSec, borderBottom: `2px solid ${tab === i ? C.accent : "transparent"}` }}>
                {t}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {audit ? (
              <div className="audit-tab-content">
                {tab === 0 && <OverviewTab audit={audit} />}
                {tab === 1 && <CampaignsTab campaigns={audit.campaigns} />}
                {tab === 2 && <CreativeTab audit={audit} onOpenAdSet={(as) => setAdsPanelAdSet(as)} />}
                {tab === 3 && <AudienceTab audit={audit} />}
                {tab === 4 && <PlacementsTab audit={audit} />}
                {tab === 5 && <BiddingTab audit={audit} />}
                {tab === 6 && <PerformanceTab audit={audit} />}
                {tab === 7 && <ActionPlanTab actions={audit.actionPlan} />}
                {tab === 8 && <AIInsightTab aiInsight={aiInsight} aiLoading={aiLoading} aiError={aiError} onRunAnalysis={runAiAnalysis} auditReady={!!audit && !auditLoading} />}
              </div>
            ) : auditLoading ? (
              <div style={{ padding: 60, textAlign: "center", color: C.textSec }}>Running audit…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, padding: 60 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(24,119,242,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>📘</div>
                <p style={{ fontSize: 18, fontWeight: 700, color: C.textPri, margin: 0 }}>No audit data yet</p>
                <p style={{ fontSize: 14, color: C.textSec, margin: 0, textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
                  {accountId ? "Click ▶ Run Audit in the sidebar" : "Pick an account from the left rail, then run an audit"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <MetaAdsPanel
        open={!!adsPanelAdSet}
        onClose={() => setAdsPanelAdSet(null)}
        adSet={adsPanelAdSet}
        campaignName={adsPanelAdSet?.campaign_name || null}
        range="28d"
      />

      {showRunModal && (
        <RunAuditModal
          onClose={() => setShowRunModal(false)}
          onRun={(range, start, end, includeAi) => {
            setShowRunModal(false);
            setDateRange(range);
            setPendingAutoSave(true);
            setPendingAi(!!includeAi);
            doFetch(accountId, range, start, end);
          }}
        />
      )}
    </div>
  );

  // Functions defined inside component so they capture state
  async function loadHistoryEntry(entry) {
    setActiveHistoryId(String(entry._id));
    if (!entry.summary?.accountGrade) return;
    try {
      const res = await fetch(`/api/meta/audit/history?id=${String(entry._id)}`);
      const j = await res.json();
      if (j?.data?.aiInsight) {
        setAiInsight(j.data.aiInsight);
        setTab(8);
      }
    } catch (err) { console.error("[loadHistoryEntry]", err); }
  }

  async function saveAudit(ai) {
    if (!audit || !accountId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/meta/audit/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId, accountName, dateRange,
          dateWindow, dateLabel: dateRange,
          auditId: activeHistoryId || null,
          summary: {
            totalSpend: audit.summary.totalSpend,
            totalConversions: audit.summary.totalConversions,
            blendedCPA: audit.summary.blendedCPA,
            accountGrade: ai?.account_grade ?? aiInsight?.account_grade ?? audit.summary.accountGrade,
            criticalCount: audit.summary.criticalCount,
            warningCount: audit.summary.warningCount,
          },
          aiInsight: ai ?? aiInsight ?? null,
        }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.id) setActiveHistoryId(String(j.id));
      }
      setHistoryVersion((v) => v + 1);
    } catch (err) { console.error("[saveMetaAudit]", err); } finally { setSaving(false); }
  }

  async function runAiAnalysis() {
    if (!audit || !accountId) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const payload = buildAuditPayload(audit, accountName, accountId, dateRange);
      const res = await fetch("/api/claude/meta-audit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, payload }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j?.data) {
        setAiInsight(j.data);
        if (j.usage) setHistoryUsage(j.usage);
        await saveAudit(j.data);
      } else if (j?.limitReached) {
        setAiError(j.error);
        if (j.usage) setHistoryUsage(j.usage);
        await saveAudit(null);
      } else {
        throw new Error("No data in response");
      }
    } catch (err) {
      console.error("[MetaAIInsight]", err);
      setAiError(err.message);
      saveAudit(null).catch(() => {});
    } finally { setAiLoading(false); }
  }
}

function buildAuditPayload(audit, accountName, accountId, dateRange) {
  const { summary, pillars, campaigns, adSets, actionPlan } = audit;
  const dollars = (n) => (n == null ? null : Math.round(n));
  return {
    accountName, accountId, dateRange,
    currency: 'USD',
    unitsNote: 'All cost, CPA, and budget values are in whole US dollars.',
    summary: {
      totalSpend: dollars(summary.totalSpend),
      totalConversions: summary.totalConversions,
      blendedCPA: dollars(summary.blendedCPA),
      accountGrade: summary.accountGrade,
      avgScore: summary.avgScore,
      campaignCount: summary.campaignCount,
      adSetCount: summary.adSetCount,
    },
    pillars: {
      account_structure: { score: pillars.structure.score, ...pillars.structure },
      ad_fatigue: { score: pillars.fatigue.score, fatiguedSpendPct: pillars.fatigue.fatiguedSpendPct, fatiguedSpend: dollars(pillars.fatigue.fatiguedSpend) },
      creative_diversity: { score: pillars.creative.score, avg: pillars.creative.avgCreativesPerAdSet, singlePct: pillars.creative.singleCreativePct },
      audience_targeting: { score: pillars.audience.score, broadPct: pillars.audience.broadPct, lookalikeCount: pillars.audience.lookalikeCount },
      placements: { score: pillars.placements.score, advantagePct: pillars.placements.advantagePct },
      bidding_budget: { score: pillars.bidding.score, learningPct: pillars.bidding.learningPct, strategies: pillars.bidding.bidStrategies },
      conversion_tracking: { score: pillars.tracking.score, hasPixel: pillars.tracking.hasPixel, recentlyFired: pillars.tracking.recentlyFired },
      performance: { score: pillars.performance.score, zeroConvPct: pillars.performance.zeroConvPct, blendedCPA: dollars(pillars.performance.blendedCPA) },
    },
    campaigns: campaigns.slice(0, 30).map((c) => ({
      campaignName: c.name,
      objective: c.objective,
      verdict: c.verdict?.key,
      spend: dollars(c.spend),
      conversions: c.conversions,
      frequency: c.frequency,
      ctr: c.ctr,
      cpa: c.cost_per_conversion ? dollars(c.cost_per_conversion) : null,
      roas: c.roas,
    })),
    actionPlan,
  };
}
```

- [ ] **Step 3: Add the tab components (Overview + Campaigns + remaining placeholders)**

Append before the final closing of the file (after `buildAuditPayload`), add these tab components:

```jsx
// ── Tab: Overview ──────────────────────────────────────────────────────────────
function OverviewTab({ audit }) {
  const { summary, pillars } = audit;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        <KPI label="Total Spend"   value={fmtCurrency(summary.totalSpend)} />
        <KPI label="Conversions"   value={summary.totalConversions?.toFixed(0) || "—"} />
        <KPI label="Blended CPA"   value={summary.blendedCPA ? fmtCurrency(summary.blendedCPA) : "—"} />
        <KPI label="Grade"         value={summary.accountGrade} accent={gradeColor(summary.accountGrade)} />
      </div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: "20px 0 12px" }}>Pillar Scores</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
        <PillarTile label="Structure"     score={pillars.structure.score} />
        <PillarTile label="Ad Fatigue"    score={pillars.fatigue.score} />
        <PillarTile label="Creative"      score={pillars.creative.score} />
        <PillarTile label="Audience"      score={pillars.audience.score} />
        <PillarTile label="Placements"    score={pillars.placements.score} />
        <PillarTile label="Bidding"       score={pillars.bidding.score} />
        <PillarTile label="Tracking"      score={pillars.tracking.score} />
        <PillarTile label="Performance"   score={pillars.performance.score} />
      </div>
    </div>
  );
}

function KPI({ label, value, accent }) {
  return (
    <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "rgba(255,255,255,0.5)", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 800, color: accent || "#fff", margin: "6px 0 0" }}>{value}</p>
    </div>
  );
}

function PillarTile({ label, score }) {
  const color = score >= 8 ? "#4ecca3" : score >= 6 ? "#f5a623" : score >= 4 ? "#f97316" : "#e94560";
  return (
    <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 800, color, margin: "4px 0 0" }}>{score}<span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>/10</span></p>
    </div>
  );
}

function gradeColor(g) {
  return { A: "#4ecca3", B: "#60d394", C: "#f5a623", D: "#f97316", F: "#e94560" }[g] || "#ffffff";
}

// ── Tab: Campaigns ─────────────────────────────────────────────────────────────
function CampaignsTab({ campaigns }) {
  const sorted = [...campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  return (
    <div>
      <div style={{ background: "#1a1a2e", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 100px 100px 90px 90px 90px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", minWidth: 720 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>Campaign</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "right" }}>Spend</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "right" }}>Conv</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "right" }}>CPA</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "right" }}>Freq</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>Verdict</span>
        </div>
        {sorted.map((c) => (
          <div key={c.id} style={{ display: "grid", gridTemplateColumns: "2fr 100px 100px 90px 90px 90px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", minWidth: 720, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</span>
            <span style={{ fontSize: 13, color: "#fff", textAlign: "right" }}>{fmtCurrency(c.spend)}</span>
            <span style={{ fontSize: 13, color: "#fff", textAlign: "right" }}>{(c.conversions || 0).toFixed(0)}</span>
            <span style={{ fontSize: 13, color: "#fff", textAlign: "right" }}>{c.cost_per_conversion ? fmtCurrency(c.cost_per_conversion) : "—"}</span>
            <span style={{ fontSize: 13, color: (c.frequency || 0) > 4 ? "#dd6b20" : "#fff", textAlign: "right" }}>{(c.frequency || 0).toFixed(2)}</span>
            <span style={{ fontSize: 11, fontWeight: 800, textAlign: "center", color: c.verdict?.color }}>{c.verdict?.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Creative ──────────────────────────────────────────────────────────────
function CreativeTab({ audit, onOpenAdSet }) {
  const { creative } = audit.pillars;
  const thin = audit.adSets.filter((as) => {
    const adCount = audit.ads.filter((ad) => ad.ad_set_id === as.id).length;
    return adCount <= 1 && (as.spend || 0) > 50;
  });
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Avg creatives / ad set" value={creative.avgCreativesPerAdSet.toFixed(1)} />
        <KPI label="Single-creative ad sets" value={creative.singleCreativeAdSetCount} />
        <KPI label="Single-creative %" value={fmtPct(creative.singleCreativePct)} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "14px 0 10px" }}>Thin-creative ad sets (click to open)</h3>
      <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, overflow: "auto" }}>
        {thin.length === 0 ? (
          <p style={{ padding: 20, color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: 13 }}>No thin-creative ad sets (good!).</p>
        ) : thin.map((as) => (
          <div key={as.id} onClick={() => onOpenAdSet(as)} style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ fontSize: 13, color: "#fff", margin: 0 }}>{as.name}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: "2px 0 0" }}>{as.campaign_name}</p>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{fmtCurrency(as.spend)}</span>
              <span style={{ fontSize: 16, color: "rgba(255,255,255,0.3)" }}>›</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Audience ──────────────────────────────────────────────────────────────
function AudienceTab({ audit }) {
  const { audience } = audit.pillars;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Broad targeting %" value={fmtPct(audience.broadPct)} />
        <KPI label="Broad spend" value={fmtCurrency(audience.broadSpend)} />
        <KPI label="Narrow spend" value={fmtCurrency(audience.narrowSpend)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
        <KPI label="Lookalike ad sets" value={audience.lookalikeCount} />
        <KPI label="Advantage+ Audience on" value={audience.expansionCount} />
      </div>
    </div>
  );
}

// ── Tab: Placements ────────────────────────────────────────────────────────────
function PlacementsTab({ audit }) {
  const { placements } = audit.pillars;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Advantage+ Placements %" value={fmtPct(placements.advantagePct)} />
        <KPI label="Ad sets using Advantage+" value={placements.advantagePlacementCount} />
      </div>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.7, margin: 0 }}>
        Advantage+ Placements lets Meta distribute spend across Facebook Feed, Instagram Feed, Reels, Stories, Audience Network, and Messenger for maximum efficiency. Manual placement-limiting usually raises CPA.
      </p>
    </div>
  );
}

// ── Tab: Bidding ───────────────────────────────────────────────────────────────
function BiddingTab({ audit }) {
  const { bidding } = audit.pillars;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Learning-phase ad sets" value={bidding.learningCount} />
        <KPI label="Learning %" value={fmtPct(bidding.learningPct)} />
        <KPI label="Smart-bid fit" value={bidding.smartBidFit ? "Yes" : "No"} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "14px 0 10px" }}>Bid strategy distribution</h3>
      <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 14 }}>
        {Object.entries(bidding.bidStrategies).map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{k}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Performance ───────────────────────────────────────────────────────────
function PerformanceTab({ audit }) {
  const { performance } = audit.pillars;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Total spend" value={fmtCurrency(performance.totalSpend)} />
        <KPI label="Blended CPA" value={performance.blendedCPA ? fmtCurrency(performance.blendedCPA) : "—"} />
        <KPI label="Zero-conv spend %" value={fmtPct(performance.zeroConvPct)} accent={performance.zeroConvPct > 0.2 ? "#e94560" : undefined} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "14px 0 10px" }}>Zero-conversion high-spend ad sets</h3>
      <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, overflow: "auto" }}>
        {performance.zeroConvHighSpend.length === 0 ? (
          <p style={{ padding: 20, color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: 13 }}>None — all high-spend ad sets are converting.</p>
        ) : performance.zeroConvHighSpend.map((as) => (
          <div key={as.id} style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#fff" }}>{as.name}</span>
            <span style={{ fontSize: 13, color: "#e94560", fontWeight: 700 }}>{fmtCurrency(as.spend)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Action Plan ───────────────────────────────────────────────────────────
function ActionPlanTab({ actions }) {
  const priorityColor = { critical: "#e94560", high: "#dd6b20", medium: "#f5a623", quick_win: "#4ecca3" };
  return (
    <div>
      {actions.length === 0 ? (
        <p style={{ padding: 20, color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: 13 }}>No issues flagged. Account is in good shape.</p>
      ) : actions.map((a, i) => (
        <div key={i} style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", padding: "2px 8px", borderRadius: 4, color: priorityColor[a.priority] || "#fff", border: `1px solid ${priorityColor[a.priority] || "#fff"}55` }}>{a.priority}</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{a.category}</span>
          </div>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "4px 0 6px" }}>{a.issue}</p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", margin: 0 }}>→ {a.action}</p>
        </div>
      ))}
    </div>
  );
}

// ── Tab: AI Insight ────────────────────────────────────────────────────────────
function AIInsightTab({ aiInsight, aiLoading, aiError, onRunAnalysis, auditReady }) {
  if (aiLoading) return <div style={{ padding: 60, textAlign: "center", color: "rgba(255,255,255,0.6)" }}>Claude is analyzing your account… this takes 20-30 seconds.</div>;
  if (!aiInsight) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        {aiError && <p style={{ color: "#e94560", marginBottom: 14 }}>{aiError}</p>}
        <button onClick={onRunAnalysis} disabled={!auditReady}
          style={{ background: auditReady ? "#1877F2" : "rgba(255,255,255,0.1)", color: "#fff", padding: "10px 20px", fontSize: 14, fontWeight: 700, borderRadius: 8, border: "none", cursor: auditReady ? "pointer" : "not-allowed" }}>
          ✦ Run AI Analysis
        </button>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 10 }}>Uses Claude to generate scored pillars + recommendations.</p>
      </div>
    );
  }
  return (
    <div>
      <div style={{ background: "rgba(24,119,242,0.1)", border: "1px solid rgba(24,119,242,0.3)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "#1877F2", margin: "0 0 8px" }}>Executive Summary</p>
        <p style={{ fontSize: 14, color: "#fff", lineHeight: 1.7, margin: 0 }}>{aiInsight.executive_summary}</p>
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "20px 0 10px" }}>Top 3 priorities</h3>
      {(aiInsight.top_3_priorities || []).map((p, i) => (
        <div key={i} style={{ padding: "10px 14px", background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, marginBottom: 8, fontSize: 13, color: "#fff" }}>{i + 1}. {p}</div>
      ))}
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "20px 0 10px" }}>Client summary</h3>
      <div style={{ padding: 14, background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.7 }}>{aiInsight.client_summary}</div>
    </div>
  );
}

// ── Run Audit modal ────────────────────────────────────────────────────────────
function RunAuditModal({ onClose, onRun }) {
  const [range, setRange] = useState("LAST_30_DAYS");
  const [includeAi, setIncludeAi] = useState(true);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#1a1a2e", borderRadius: 12, padding: 24, width: 400, maxWidth: "90vw" }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: "0 0 14px" }}>Run Meta Ads Audit</h3>
        <label style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", display: "block", marginBottom: 4 }}>Date range</label>
        <select value={range} onChange={(e) => setRange(e.target.value)} style={{ width: "100%", background: "#13131f", color: "#fff", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "8px 10px", fontSize: 13, marginBottom: 16 }}>
          <option value="LAST_7_DAYS">Last 7 days</option>
          <option value="LAST_30_DAYS">Last 30 days</option>
          <option value="LAST_90_DAYS">Last 90 days</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#fff", cursor: "pointer", marginBottom: 20 }}>
          <input type="checkbox" checked={includeAi} onChange={(e) => setIncludeAi(e.target.checked)} /> Include AI analysis (Claude) after fetch
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", color: "#fff", padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid rgba(255,255,255,0.14)", cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onRun(range, undefined, undefined, includeAi)} style={{ background: "#1877F2", color: "#fff", padding: "8px 14px", fontSize: 13, fontWeight: 700, borderRadius: 6, border: "none", cursor: "pointer" }}>▶ Run Audit</button>
        </div>
      </div>
    </div>
  );
}
```

Note: `doFetch` maps dateRange values. `LAST_30_DAYS` → `28d`, `LAST_7_DAYS` → `7d`, `LAST_90_DAYS` → `3m`. Adjust inside `doFetch` or let the API accept both (the API currently accepts `7d/28d/3m/6m/mtd/custom` — add a mapper in the page).

Update the `doFetch` call to map: find `doFetch(accountId, range, start, end)` where `range` comes from the modal as `LAST_30_DAYS`. Replace the entry into `doFetch` to translate: inside `onRun` of the modal-to-page wiring, change:

```javascript
onRun={(range, start, end, includeAi) => {
  setShowRunModal(false);
  setDateRange(range);
  setPendingAutoSave(true);
  setPendingAi(!!includeAi);
  const apiRange = ({ LAST_7_DAYS: '7d', LAST_30_DAYS: '28d', LAST_90_DAYS: '3m' }[range]) || '28d';
  doFetch(accountId, apiRange, start, end);
}}
```

- [ ] **Step 4: Trigger the auto-save + AI after fetch (useEffect)**

Add this effect inside `MetaAuditPageInner` right before the return statement:

```javascript
useEffect(() => {
  if (pendingAutoSave && !auditLoading && audit) {
    setPendingAutoSave(false);
    if (pendingAi) {
      setPendingAi(false);
      setTab(8);
      runAiAnalysis();
    } else {
      saveAudit(null);
    }
  }
}, [pendingAutoSave, auditLoading]);
```

- [ ] **Step 5: Lint-check the whole page**

```bash
npx next lint --file src/app/dashboard/meta/audit/page.js 2>&1 | head -30
```

Any apostrophe errors (`react/no-unescaped-entities`) must be escaped with `&apos;`. Warnings about `<img>` or `useEffect` exhaustive-deps are non-blocking if they match existing codebase patterns.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/meta/audit/page.js
git commit -m "feat: Meta Ads Audit page with 9 tabs + AI insight

Mirrors Google Ads audit UI pattern: three-pane layout, accounts
sidebar, history sidebar, tab content. Overview/Campaigns/Creative/
Audience/Placements/Bidding/Performance/Action Plan/AI Insight.
Creative tab opens MetaAdsPanel (Phase 1) for ad-level drill-down
on flagged ad sets. Run modal supports 7/30/90 day ranges + AI
toggle. Upsert-by-auditId save pattern (single record per run).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Browser test end-to-end**

Start dev server, log in, go to `/dashboard/meta/audit`. Expected behaviors:
- Empty state shows "Pick an account from the left rail"
- Left rail is empty on first visit (no accounts audited yet)
- Open with `?accountId=act_XXX` in URL → Run Audit button activates
- Click Run Audit → modal opens → pick 30 days + AI on → Run
- Loading state → audit populates → pillar scores visible in Overview
- Tabs navigate between content
- Creative tab → click a thin-creative ad set → MetaAdsPanel slides open with that set's ads
- AI Insight tab runs after the data audit and shows narrative
- Refresh page → left rail now shows audited account; history rail shows the saved audit
- Click the history entry → loads the cached audit including AI

Any bugs: report back before committing further work.

---

## Task 6: Sidebar nav + What's New banner

**Files:**
- Modify: `src/app/dashboard/components/DashboardSidebar.jsx`
- Modify: `src/app/dashboard/page.js`

- [ ] **Step 1: Add sidebar entry**

Open `src/app/dashboard/components/DashboardSidebar.jsx`. Find the "Paid Media" section in the NAV constant. After the `Meta Ads` item, add a new entry:

```javascript
{ href: "/dashboard/meta/audit",    label: "Meta Ads Audit",  icon: <SEOAuditIcon /> },
```

(Reuse the SEOAuditIcon — it's a generic audit icon already imported and used by the SEO audit entry.)

- [ ] **Step 2: Update the What's New banner**

Open `src/app/dashboard/page.js`. Replace the `WHATS_NEW_TITLE` and `WHATS_NEW_BODY` constants:

```javascript
const WHATS_NEW_TITLE = "Meta Ads Audit is live";
const WHATS_NEW_BODY  = "Score any Meta ad account across 8 pillars — structure, ad fatigue, creative diversity, audience targeting, placements, bidding, tracking, and performance. Add a Claude-generated executive summary, recommendations, and per-campaign verdicts. Click through to the ad-level view to review creatives in-line. Shared audit history across the team.";
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/components/DashboardSidebar.jsx src/app/dashboard/page.js
git commit -m "feat: sidebar entry + What's New for Meta Ads Audit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Done

End state:
- `/dashboard/meta/audit` fully functional — pick account → run → score → save
- 8 pillars deterministically scored in `metaAudit.js`
- Optional Claude AI insight tab (gated by daily limit)
- History visible to the team (same sharing model as Google Ads audit)
- Creative tab drills down into `MetaAdsPanel` from Phase 1
- Sidebar + What's New updated
- Mobile responsive via reused `.audit-three-pane` + `.audit-tab-content` classes

Phase 3 candidates (out of this plan's scope): scheduled automatic audits via cron, audit diffs between runs, Slack alerts on grade drops, email delivery of audit summary, audience overlap pillar (needs additional Meta scope).
