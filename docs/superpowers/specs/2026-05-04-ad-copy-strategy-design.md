# Ad Copy Strategy Generator — Design Spec
**Date:** 2026-05-04  
**Status:** Approved

## Overview

A data-backed ad copy strategy feature on the Google Ads dashboard page. Users click "Generate Ad Copy", fill in five context fields, and receive a per-campaign strategy with concrete example headlines and descriptions grounded in live performance data — search terms, QS scores, current ad copy, and campaign verdicts.

---

## Placement

Section on `/dashboard/google/ads`, rendered below `AccountBriefCard` and above `ContentArea`. Only visible when an account is selected and has at least one underperforming campaign (verdict: PAUSE, OPTIMIZE, or FIX_QS).

---

## User Flow

1. User selects a Google Ads account on the dashboard
2. "Generate Ad Copy" button appears below the AI briefing card
3. Clicking it opens a slide-in panel from the right (same portal + backdrop + transform pattern as `AuditPanel`)
4. **Form state**: user fills in 5 context fields; campaign checklist shows underperforming campaigns pre-checked, all others available but unchecked
5. User clicks "Generate"
6. **Results state**: panel switches to streaming output — one campaign section renders at a time as the response arrives
7. "Regenerate" button in panel header returns to form state

---

## Context Form Fields

Business, audience, and USPs are required. Tone has a default. Offer is optional:

| Field | Type | Required |
|---|---|---|
| Business / product description | Textarea | Yes |
| Target audience | Text input | Yes |
| Unique selling points | Textarea | Yes |
| Tone / voice | Select (Professional / Urgent / Friendly / Direct / Trust-building, default: Professional) | No — has default |
| Current offer or promotion | Text input | No — leave blank if none |

Below the fields: a campaign checklist. Underperforming campaigns (PAUSE / OPTIMIZE / FIX_QS verdict) are pre-checked. Healthy campaigns are listed but unchecked. User can adjust freely.

---

## Data Flow

When the panel opens, it fetches deep audit data from `/api/googleads/audit?customerId=...` (same endpoint used by `AuditPanel`). This fetch happens once on panel open, before the user submits the form. A loading state covers the form while this fetch is in progress.

At generation time, no additional API calls are made. The API route receives everything it needs in the POST body.

Data passed per selected campaign:
- Campaign name, verdict, spend, CTR, CPA, conversions (from main page campaign data)
- Current RSA headlines and descriptions (from `/api/googleads/ads`, already fetched when campaign is selected)
- Top 5 converting search terms (from audit deep data)
- Bottom 5 keywords by QS score + which component is failing (Expected CTR / Ad Relevance / Landing Page Experience) (from audit deep data)
- Match type spend distribution (Exact / Phrase / Broad percentages) (from audit deep data)
- Any flags: broad match > 60%, zero conversions with real spend, budget-constrained

---

## API Route

**`POST /api/claude/ad-copy-strategy`**

Request body:
```json
{
  "customerId": "string",
  "context": {
    "business": "string",
    "audience": "string",
    "usps": "string",
    "tone": "string",
    "offer": "string"
  },
  "campaigns": [
    {
      "campaignName": "string",
      "verdict": "PAUSE | OPTIMIZE | FIX_QS",
      "cost": 0,
      "ctr": 0,
      "cpa": 0,
      "conversions": 0,
      "currentHeadlines": ["string"],
      "currentDescriptions": ["string"],
      "topConvertingTerms": ["string"],
      "bottomKeywords": [{ "text": "string", "qs": 0, "failingComponent": "string" }],
      "matchTypeSpend": { "EXACT": 0, "PHRASE": 0, "BROAD": 0 },
      "flags": ["string"]
    }
  ]
}
```

Response: streaming text via `ReadableStream`, same pattern as `/api/claude/google-ads-audit`. Returns structured per-campaign sections.

---

## Claude Prompt Structure

The system prompt establishes Claude as a senior PPC strategist. The user message is structured as:

```
BUSINESS CONTEXT:
- Business: {business}
- Target audience: {audience}
- USPs: {usps}
- Tone: {tone}
- Current offer: {offer}

CAMPAIGN ANALYSIS:
For each campaign:

[Campaign Name] — Verdict: {verdict}
Spend: ${cost} | CTR: {ctr}% | CPA: ${cpa} | Conversions: {conversions}

Current headlines: {currentHeadlines}
Current descriptions: {currentDescriptions}

Top converting search terms: {topConvertingTerms}
Bottom QS keywords:
  - "{keyword}" QS {score} — failing: {failingComponent}

Match type spend: Exact {x}% / Phrase {y}% / Broad {z}%
Flags: {flags}

TASK:
For each campaign:
1. Diagnose the specific copy problem using the data above (reference actual search terms and keywords — not generic advice)
2. Explain the strategy to fix it in 2-3 sentences
3. Write 4-5 headline variants (max 30 chars each) that address the diagnosis
4. Write 2 description variants (max 90 chars each)
5. Explain why each headline addresses a specific data point

Do not invent claims not supported by the USPs provided. Ground every suggestion in the actual search terms, QS failures, or performance data shown.
```

This produces output like: *"Your top converting term 'emergency AC repair same day' appears in zero current headlines. Here are 4 headlines that incorporate it directly..."* rather than generic suggestions.

---

## UI Components

### `AdCopyPanel.jsx`
`src/app/dashboard/google/ads/components/AdCopyPanel.jsx`

- Renders via `createPortal` to `document.body`
- Backdrop + slide-in from right, same animation as `AuditPanel`
- Width: 600px (wider than AuditPanel's 560px to accommodate two-column form)
- Two internal views: `form` and `results`
- Streams response text, parses campaign sections client-side as they arrive
- "Regenerate" button in header resets to form view

### Button in `page.js`
Inline in the Google Ads page, below `AccountBriefCard`. Passes `selectedCustomer` campaign data as props to the panel. Only renders when underperforming campaigns exist.

---

## Caching

- Results are **not cached** — regeneration is intentional and on-demand
- Context form values are preserved in component state while the panel is open; cleared on close
- No session/localStorage persistence for generated copy

---

## Error Handling

- `NO_CREDITS` error code → friendly message matching existing Claude routes
- No campaigns selected → "Generate" button disabled with tooltip "Select at least one campaign"
- Streaming error mid-response → show partial results + error banner at bottom
- No underperforming campaigns in account → button hidden entirely, no empty state needed

---

## Files Affected

| File | Change |
|---|---|
| `src/app/dashboard/google/ads/components/AdCopyPanel.jsx` | New file |
| `src/app/dashboard/google/ads/page.js` | Add button + panel below `AccountBriefCard` |
| `src/app/api/claude/ad-copy-strategy/route.js` | New API route |
