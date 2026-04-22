# Meta Ads Audit — Phase 2 Design

**Date:** 2026-04-22
**Status:** Design approved in conversation, ready for implementation plan
**Owner:** Frank (lilikoi agency)

## Context

Phase 1 shipped the ad-level view with creative previews (commits `f276633` → `c7abefa`). Phase 2 builds an AI-powered Meta Ads audit that mirrors the existing Google Ads audit (`/dashboard/google/ads/audit`): deterministic pillar scoring plus an optional Claude-generated narrative, saved to Mongo, shared across the team.

## Goal

Let users run a scored audit against any connected Meta ad account. Produce 8 pillar scores 1-10, an account grade A-F, and (optionally) a Claude-generated executive summary with prioritized recommendations and per-campaign insights.

## Non-goals (v1)

- Audience overlap analysis (requires non-read Meta scope)
- Campaign-level or ad-set-level audits (account-level only, matches Google Ads pattern)
- Auto-fix / mutation actions (read-only product)
- Audit email delivery
- AI insight required for a graded audit (runs fine without; AI fills in scores + narrative when the user opts in)
- Public share links

## Architecture

Mirrors the Google Ads audit exactly:

- Route: `src/app/dashboard/meta/audit/page.js` — three-pane layout (Accounts rail, Audit History rail, Content), same component pattern as `src/app/dashboard/google/ads/audit/page.js`
- Pure audit logic: `src/lib/metaAudit.js` — analogous to `googleAdsAudit.js`. Exports `runAudit(accountData)` returning `{ summary, campaigns, creative, audience, placements, bidding, tracking, performance, actionPlan }` plus helpers.
- Server fetch route: `src/app/api/meta/audit/route.js` — pulls all Meta data needed for an audit in one call.
- AI route: `src/app/api/claude/meta-audit/route.js` — mirrors `/api/claude/google-ads-audit/route.js` (auth-gated, daily-limit-gated, Claude Sonnet).
- AI system prompt: `src/lib/metaAuditPrompt.js`.
- Mongo: new collection `MetaAudits` with the same schema shape as `GoogleAdsAudits`.
- Save / history routes: `src/app/api/meta/audit/save` + `src/app/api/meta/audit/history` + `src/app/api/meta/audit/accounts` — mirror existing Google Ads audit API routes.

## Data flow

1. User opens `/dashboard/meta/audit` → picks an account from the left rail
2. Clicks "Run Audit" → `GET /api/meta/audit?accountId=ACT_X&dateRange=LAST_30_DAYS` fetches in parallel:
   - Campaigns: `id, name, objective, status, buying_type, special_ad_categories, daily_budget, lifetime_budget, bid_strategy`
   - Ad sets: `id, name, campaign_id, status, optimization_goal, billing_event, targeting, bid_strategy, daily_budget, lifetime_budget, frequency_control_specs, learning_stage_info, is_dynamic_creative`
   - Ads: `id, ad_set_id, status, creative{id}` (creative details are optional here; Phase 1 already handles deep creative)
   - Insights at campaign + ad-set level: `spend, impressions, clicks, ctr, cpm, cpc, frequency, actions, action_values`
   - Account-level pixel check: `/act_X/adspixels?fields=id,name,last_fired_time`
3. Client calls `metaAudit.runAudit(accountData)` → returns parsed audit data shape
4. UI renders 7 data tabs (Overview / Campaigns / Creative / Audience / Placements / Bidding / Performance) + "Action Plan" + "AI Insight"
5. If user clicks "Run AI Analysis": payload is built (values converted to whole USD), POST to `/api/claude/meta-audit` → Claude returns scored JSON
6. Save to `MetaAudits` with upsert-by-`_id` (same pattern we fixed for Google Ads audit)
7. History list is shared: GET routes don't filter by email; DELETE still scoped to author or admin

## Pillar scoring

Each pillar returns `{ score: 1-10, status, key_takeaway, data }`. Deterministic scoring runs locally in `metaAudit.js`; AI may override the score with context.

### 1. Account Structure
- Count of active campaigns, objective distribution, CBO-vs-ABO usage
- **9-10:** consolidated structure, objectives match funnel stage, CBO where appropriate
- **4-5:** some campaign fragmentation, occasional objective mismatch
- **1-3:** dozens of low-budget campaigns, scattered objectives

### 2. Ad Fatigue (Frequency)
- % of spend on ad sets with frequency > 4; recency of creative refreshes per ad set
- **9-10:** < 5% of spend on high-frequency ad sets
- **4-5:** 15-30%
- **1-3:** > 50%

### 3. Creative Diversity
- Average active creatives per ad set; image-only vs mixed media; dynamic creative usage
- **9-10:** 4+ creatives per ad set, video + image mix
- **4-5:** 2 creatives average
- **1-3:** predominantly single-creative ad sets

### 4. Audience Targeting
- % of spend on broad vs detailed targeting; lookalike presence; age/gender expansion enabled
- **9-10:** broad + strong creative leverage
- **4-5:** mixed — some over-narrow stacks
- **1-3:** heavy stacked detailed targeting, no expansion

### 5. Placements
- % of campaigns using Advantage+ Placements; distribution of spend across placements when manual
- **9-10:** 80%+ Advantage+
- **4-5:** 40-60% Advantage+
- **1-3:** mostly manual, Feed-only

### 6. Bidding & Budget
- Bid strategy fit (Lowest Cost default, Cost Cap only with sufficient data); count of ad sets in learning phase
- **9-10:** smart bidding with data, < 10% in learning
- **4-5:** mixed; some bid caps without data
- **1-3:** heavy bid caps without volume, > 50% in learning

### 7. Conversion Tracking
- Pixel attached, has Purchase / Lead events firing in the window, attribution window set
- **9-10:** Pixel fires recently, standard events present
- **4-5:** Pixel exists but limited events
- **1-3:** no Pixel or silent Pixel

### 8. Performance
- CPA / ROAS sanity, zero-conversion high-spend ad sets, clear performance outliers
- **9-10:** CPA on target, no 0-conversion waste
- **4-5:** some waste, uneven ad-set performance
- **1-3:** > 20% of spend on 0-conversion entities

### Account grade
From average of non-null pillar scores: A ≥ 8.0, B 6.5-7.9, C 5.0-6.4, D 3.5-4.9, F < 3.5.

## AI prompt shape

`src/lib/metaAuditPrompt.js` — copy the `GOOGLE_ADS_AUDIT_SYSTEM_PROMPT` structure and replace Google-specific sections with Meta equivalents. Return shape (Claude responds with this JSON):

```
{
  "executive_summary": "3-5 sentences with actual account names, spend, ad-set names",
  "account_grade": "A|B|C|D|F",
  "pillar_scores": {
    "account_structure":    { "score": 1-10, "status": "...", "key_takeaway": "..." },
    "ad_fatigue":           { "score": 1-10, ... },
    "creative_diversity":   { "score": 1-10, ... },
    "audience_targeting":   { "score": 1-10, ... },
    "placements":           { "score": 1-10, ... },
    "bidding_budget":       { "score": 1-10, ... },
    "conversion_tracking":  { "score": 1-10, ... },
    "performance":          { "score": 1-10, ... }
  },
  "top_3_priorities": ["...", "...", "..."],
  "biggest_strength": "One sentence with specific evidence",
  "campaign_insights": [{ "campaign_name", "verdict", "ai_assessment", "recommended_action" }],
  "recommendations": [{ "priority", "category", "issue", "action", "expected_impact", "examples": [] }],
  "client_summary": "2-3 sentences for business owner, zero jargon"
}
```

CRITICAL RULE carried over from Google Ads audit fix: all monetary fields in the payload are whole US dollars, not micros or cents. The payload builder in the page converts at build time. System prompt reinforces this.

Daily limit: `META_AI_AUDIT_DAILY_LIMIT` env var, default 5 per user per day (same pattern as Google Ads).

## Mongo storage

Collection: `MetaAudits`. Schema mirrors `GoogleAdsAudits`:

```js
{
  _id: ObjectId,
  email,              // creator's email
  accountId: String,  // Meta ad account (ACT_X)
  accountName,
  dateRange,          // LAST_7_DAYS, LAST_30_DAYS, CUSTOM, etc.
  dateWindow: { startDate, endDate } | null,
  dateLabel,
  summary: {
    totalSpend,
    totalConversions,
    blendedCPA,
    roas,
    accountGrade,
    criticalCount,
    warningCount,
    auditId,          // self-reference for upsert
  },
  aiInsight: { ...claude response... } | null,
  savedAt,
}
```

Save-and-retry pattern: same `auditId`-upsert fix we applied to Google Ads (one record per run, AI updates the same record instead of inserting a duplicate).

History / accounts endpoints: `/api/meta/audit/history`, `/api/meta/audit/accounts`, `/api/meta/audit/save`. History is visible to anyone in `@lilikoiagency.com`; DELETE still gated to the creator OR admins.

## Component reuse from Phase 1

- `MetaAdsPanel` + `MetaAdPreview` — embedded in the audit's **Creative** tab so users can open a flagged ad set and browse its ads without leaving the audit
- `metaGraph.js` — used for all Meta Graph API calls (including the new `/api/meta/audit` fetch route)
- Existing `authOptions`, `allowedEmailDomain`, `isAdmin` — same auth pattern as all other dashboard API routes

## API routes summary

New:
- `GET /api/meta/audit?accountId=...&dateRange=...` — fetch + parse, returns audit data
- `POST /api/meta/audit/save` — upsert by auditId
- `GET /api/meta/audit/history?accountId=...` — list, no email filter (team-shared)
- `GET /api/meta/audit/history?id=...` — single
- `DELETE /api/meta/audit/history?id=...` — creator or admin only
- `GET /api/meta/audit/accounts` — list accounts previously audited (for the left rail)
- `POST /api/claude/meta-audit` — Claude AI layer, daily-limit-gated

## Env vars

New (optional, default provided):
- `META_AI_AUDIT_DAILY_LIMIT=5` (mirrors `GOOGLE_ADS_AI_AUDIT_DAILY_LIMIT`)

Existing (already configured):
- `META_ACCESS_TOKEN` (read scope)
- `ANTHROPIC_API_KEY`
- `MONGODB_URI`

## UI structure

New page `src/app/dashboard/meta/audit/page.js`:
- Top bar with Back / Account name / Date range / Critical/Warnings counter (same as Google Ads)
- Three-pane layout with `.audit-three-pane` (reuses existing responsive CSS from Phase 1):
  - Left: accounts sidebar (audited accounts)
  - Middle: audit history for selected account
  - Right: tab content
- Tabs: Overview / Campaigns / Creative / Audience / Placements / Bidding / Performance / Action Plan / AI Insight
- "Run Audit" button opens same modal pattern as Google Ads (date range + include AI toggle)
- Responsive stacks on mobile via existing `.audit-three-pane` media queries
- Sidebar nav entry added: Meta Ads Audit, under "Paid Media" section (alongside Meta Ads)

## Testing

- Manual: pick a live Meta account, run audit, verify pillar scores make sense vs. the manual audit you would do today
- Preview the AI insight on at least one account and verify dollar figures match the Overview tab (guard against the micros-in-prompt regression we caught for Google Ads)
- Verify save/history upsert: run an audit without AI, then enable AI — single record in Mongo, not two
- Mobile: verify the three-pane stacks correctly on 360px and 390px widths
- Regression: existing Meta dashboard (`/dashboard/meta`) unaffected

## Open questions

- **Meta API rate limits**: account-level audits can fire 6-8 Graph calls per run. Use field-expansion where possible (single call fetches campaigns + nested ad sets + nested insights) to stay well under limits. Plan should verify limit consumption during testing.
- **Daily AI limit default (5)**: carry over from Google Ads. Adjust after usage patterns emerge.

## Success criteria

- Run an audit in under 10 seconds for a typical account (50 campaigns, 200 ad sets)
- All 8 pillars produce sensible scores on real accounts
- AI insight runs in under 30 seconds
- One record per audit run in Mongo (no duplicates)
- History visible to the entire team, DELETE still restricted
- Mobile layout usable on 360px
