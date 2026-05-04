# AI Tools Sidebar — Design Spec
**Date:** 2026-05-04
**Status:** Approved

## Overview

Add an "AI Tools" section to the dashboard sidebar that surfaces contextual AI-powered tools as slide-in panels. Tools are route-aware — only relevant tools appear based on the current page. A central config file drives the sidebar; URL query params connect sidebar entries to panel state on each page.

Five tools are in scope:
- **Account Brief** — existing card converted to panel (Google Ads)
- **Ads Audit** — existing panel, add sidebar entry (Google Ads)
- **Ad Copy Strategy** — existing panel, add sidebar entry (Google Ads)
- **SEO Meta Generator** — new tool, all pages
- **Meta Ad Copy Generator** — new tool (Meta Ads)

---

## Architecture

### Tool Config

`src/lib/aiToolsConfig.js` — single source of truth for all tools:

```js
export const AI_TOOLS = [
  { key: 'brief',     label: 'Account Brief',    icon: '📋', routes: ['/dashboard/google/ads'] },
  { key: 'audit',     label: 'Ads Audit',         icon: '🔍', routes: ['/dashboard/google/ads'] },
  { key: 'ad-copy',   label: 'Ad Copy Strategy',  icon: '✏️', routes: ['/dashboard/google/ads'] },
  { key: 'meta-copy', label: 'Meta Ad Copy',       icon: '✏️', routes: ['/dashboard/meta'] },
  { key: 'seo-meta',  label: 'SEO Meta',           icon: '📝', routes: ['*'] },
];

export function getToolsForRoute(pathname) {
  return AI_TOOLS.filter(
    (t) => t.routes.includes('*') || t.routes.some((r) => pathname.startsWith(r))
  );
}
```

### URL Param Convention

Clicking a tool in the sidebar sets `?panel=<key>` in the URL via `router.push`. Each host page reads `useSearchParams()` and opens the matching panel. Closing a panel clears the param with `router.replace`.

This makes panel state linkable and refreshable.

### Sidebar Section

`DashboardSidebar.jsx` gets a new "AI Tools" section below "Data Tools". It:
- Calls `getToolsForRoute(pathname)` to get relevant tools
- Renders tool buttons with icon + label
- Shows a count badge (`3`, `1`, etc.) next to the section label
- Hides the section entirely when `getToolsForRoute` returns an empty array

### In-Page Buttons

The existing "Generate Ad Copy Strategy" button and the audit trigger button on the Google Ads page stay — the sidebar is additive. Both the sidebar and in-page buttons set the same `?panel=<key>` param.

---

## Tool 1: Account Brief Panel (migration)

**File:** `src/app/dashboard/google/ads/components/AccountBriefPanel.jsx`

The existing `AccountBriefCard` component is wrapped in a slide-in panel using the same portal + backdrop + transform pattern as `AuditPanel` and `AdCopyPanel`. The embedded card area on the Google Ads page becomes a "View Account Brief" button that sets `?panel=brief`.

`AccountBriefPanel` receives `selectedCustomer` and `currentDateRange` as props and renders the existing `AccountBriefCard` content inside the panel body.

Width: 560px (matches `AuditPanel`).

---

## Tool 2: Ads Audit (sidebar entry only)

No panel changes. The Google Ads page reads `?panel=audit` and opens `AuditPanel` — same as the existing "Run Audit" button already does. The sidebar entry is a second trigger for the same panel.

---

## Tool 3: Ad Copy Strategy (sidebar entry only)

No panel changes. The Google Ads page reads `?panel=ad-copy` and opens `AdCopyPanel`. The existing "Generate Ad Copy Strategy" button stays as a second trigger.

---

## Tool 4: SEO Meta Description Generator

### Placement
Visible on all pages (`routes: ['*']`). No account or campaign context required.

### Panel: `SeoMetaPanel.jsx`
`src/app/dashboard/components/SeoMetaPanel.jsx`

Two views: `form` and `results`.

**Form fields:**

| Field | Type | Required |
|---|---|---|
| Page URL or title | Text input | Yes |
| Target keyword | Text input | No |
| Page type | Select (Homepage / Product / Service / Blog Post / Category, default: Page) | No |

**Results:**
- 3 meta title variants — each ≤60 chars with live character counter and copy button
- 3 meta description variants — each ≤160 chars with live character counter and copy button
- "Regenerate" button returns to form with previous values

Width: 560px.

### API Route: `POST /api/claude/seo-meta`

Request body:
```json
{
  "pageTitle": "string",
  "keyword": "string (optional)",
  "pageType": "string (optional)"
}
```

Response: `{ data: { titles: [string, string, string], descriptions: [string, string, string] }, requestId }`

Claude system prompt: SEO copywriter persona. Rules: titles must be 50–60 chars, descriptions 150–160 chars, include target keyword naturally if provided, no keyword stuffing, each variant takes a different angle.

Auth, budget cap, and `logApiUsage` follow the same pattern as `/api/claude/ad-copy-strategy`.

---

## Tool 5: Meta Ad Copy Generator

### Placement
Visible on Meta Ads page only (`routes: ['/dashboard/meta']`).

### Panel: `MetaAdCopyPanel.jsx`
`src/app/dashboard/meta/components/MetaAdCopyPanel.jsx`

Same structure as `AdCopyPanel`: form view → loading → results.

**On panel open:** fetches top creatives for the selected account from `/api/meta-ads/top-creatives?accountId=...` to get ad-level creative data (`title`, `body`, `call_to_action_type`). Campaign-level metrics (spend, CTR, ROAS, conversions) come from the `selectedCampaigns` prop already loaded on the Meta page — no second fetch for those.

**Form fields:** same 5 fields as Ad Copy Strategy (business, audience, USPs, tone, offer).

**Campaign selection:** radio button list of all Meta campaigns. First underperforming campaign (by ROAS < 1 or zero conversions with spend) pre-selected.

**Campaign payload per submission:**
- Campaign name, objective, spend, CTR, CPA, ROAS, conversions
- Current ad creative: `title`, `body`, `call_to_action_type` (from existing campaign data)
- Performance flags: ROAS < 1, zero conversions with real spend, high CPM (> $25)

**Results per campaign:**
- Diagnosis (1-2 sentences grounded in metrics)
- Strategy (2-3 sentences)
- 3 primary text variants (≤125 chars each) with rationale
- 3 headline variants (≤40 chars each) with rationale
- 2 description variants (≤30 chars each) with rationale
- CTA recommendation with rationale

Width: 620px (matches `AdCopyPanel`).

### API Route: `POST /api/claude/meta-ad-copy`

Request body:
```json
{
  "context": {
    "business": "string",
    "audience": "string",
    "usps": "string",
    "tone": "string",
    "offer": "string (optional)"
  },
  "campaign": {
    "campaignName": "string",
    "objective": "string",
    "spend": 0,
    "ctr": 0,
    "cpa": 0,
    "roas": 0,
    "conversions": 0,
    "currentTitle": "string",
    "currentBody": "string",
    "callToActionType": "string",
    "flags": ["string"]
  }
}
```

Response: `{ data: { diagnosis, strategy, primaryTexts, headlines, descriptions, ctaRecommendation }, requestId }`

Claude system prompt: senior Meta/Facebook Ads copywriter persona. Rules: primary text must not feel like a Google ad (conversational, story-driven), headline is short and punchy, never invent claims not in USPs, every variant references a specific metric or creative data point.

Auth, budget cap, daily limit, and `logApiUsage` same pattern as other Claude routes. `max_tokens: 4096` (single campaign, output is smaller than Google tool).

---

## Files Affected

| File | Change |
|---|---|
| `src/lib/aiToolsConfig.js` | New — tool registry + route filter |
| `src/app/dashboard/components/DashboardSidebar.jsx` | Modify — add AI Tools section |
| `src/app/dashboard/google/ads/page.js` | Modify — read `?panel` param, open matching panel |
| `src/app/dashboard/google/ads/components/AccountBriefPanel.jsx` | New — wrap AccountBriefCard as slide-in panel |
| `src/app/dashboard/components/SeoMetaPanel.jsx` | New — SEO meta generator panel |
| `src/app/dashboard/meta/page.js` | Modify — read `?panel` param, open matching panel |
| `src/app/dashboard/meta/components/MetaAdCopyPanel.jsx` | New — Meta ad copy panel |
| `src/app/api/claude/seo-meta/route.js` | New — SEO meta API route |
| `src/app/api/claude/meta-ad-copy/route.js` | New — Meta ad copy API route |
| `src/lib/metaAdCopyPrompt.js` | New — Claude system prompt for Meta ad copy |
| `src/lib/seoMetaPrompt.js` | New — Claude system prompt for SEO meta |

---

## Testing

Each new component gets a `src/__tests__/` test file using Vitest + React Testing Library (jsdom). Each new API route gets a node-environment test covering validation (400s), auth (401), and budget cap (429). Pattern matches existing tests in `src/__tests__/api/ad-copy-strategy.test.js` and `src/__tests__/dashboard/AdCopyPanel.test.jsx`.

---

## Error Handling

- `NO_CREDITS` → friendly message matching existing Claude routes
- No account selected when opening Google Ads / Meta tools → panel shows "Select an account first" instead of the form
- SEO Meta: empty page title → Generate button disabled
- Meta Ad Copy: no campaigns with spend → panel shows "No campaigns with spend found"
- Streaming error / parse failure → show error banner with "Try again" (same as ad copy panel)

---

## Caching

- Results not cached — regeneration is intentional
- Form values preserved in component state while panel is open; cleared on close
- No localStorage persistence
