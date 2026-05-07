# Google Ads Deep Analysis — Design Spec

## Goal

Add a "Deep Analysis" slide-over panel to the Google Ads dashboard that runs a Claude-powered 80-check audit based on the claude-ads skill framework. Produces a weighted health score (0–100), per-category findings (PASS/WARNING/FAIL), quick wins, and AI insights that go beyond what the existing rule-based AuditPanel can catch.

## Architecture

Three new files, zero changes to existing routes or components:

| Action | File |
|--------|------|
| Create | `src/app/api/claude/google-deep-analysis/route.js` |
| Create | `src/lib/googleDeepAnalysisPrompt.js` |
| Create | `src/app/dashboard/google/ads/components/DeepAnalysisPanel.jsx` |
| Modify | `src/app/dashboard/google/ads/page.js` — add button + panel mount |

## Entry Point

A "Deep Analysis" button in the dashboard toolbar alongside the existing Audit and Ad Copy buttons. Clicking it pushes `?panel=deep-analysis` to the URL. `page.js` reads `panelParam === "deep-analysis"` and renders `<DeepAnalysisPanel>`.

## Panel Behavior

`DeepAnalysisPanel.jsx` is a right slide-over (same shell as `AuditPanel` — fixed header, scrollable body, backdrop). It is self-contained:

1. On open, fetches `/api/googleads/audit?customerId=X` for structured data
2. Immediately POSTs to `/api/claude/google-deep-analysis` with that data
3. Caches the result in `sessionStorage` keyed by `deepAnalysis:{customerId}:{YYYY-MM-DD}`
4. Re-opening a cached result skips the Claude call entirely
5. "Re-run" button in the header clears cache and re-fires

No "Run" button required — analysis starts automatically on open, same as the account brief.

## Claude Route

**File:** `src/app/api/claude/google-deep-analysis/route.js`

Follows the standard pattern: session auth, `allowedEmailDomain` check, daily limit (5/day, `GOOGLE_DEEP_ANALYSIS_DAILY_LIMIT` env var), admin bypass, monthly budget cap, `logApiUsage`, `export const maxDuration = 120`.

**Request body:**
```json
{
  "customerId": "string",
  "campaigns": [...],
  "auditData": {
    "keywords": [...],
    "campaignConfig": [...],
    "adStrength": [...],
    "conversionActions": [...],
    "campaignSearchTerms": [...],
    "geoPerformance": [...],
    "daypartPerformance": [...],
    "conversionLag": [...],
    "pmaxAssetGroups": [...],
    "pmaxBrandExclusions": [...]
  }
}
```

**Validation:** `customerId` required; `campaigns` must be non-empty array.

**Claude response schema:**
```json
{
  "healthScore": 72,
  "grade": "B",
  "summary": "One-sentence account summary.",
  "categories": {
    "conversionTracking": {
      "score": 65,
      "weight": 25,
      "findings": [
        { "label": "Enhanced Conversions active", "status": "FAIL", "detail": "No enhanced conversion action found..." }
      ]
    },
    "wastedSpend":      { "score": 80, "weight": 20, "findings": [...] },
    "accountStructure": { "score": 70, "weight": 15, "findings": [...] },
    "keywords":         { "score": 75, "weight": 15, "findings": [...] },
    "ads":              { "score": 68, "weight": 15, "findings": [...] },
    "settings":         { "score": 85, "weight": 10, "findings": [...] }
  },
  "quickWins": [
    { "action": "string", "impact": "string", "effort": "low" }
  ],
  "aiInsights": [
    { "title": "string", "detail": "string" }
  ]
}
```

Grade mapping: A ≥90, B ≥75, C ≥60, D ≥45, F <45.

Result stored in `sessionStorage` by the panel; route itself does not cache.

## System Prompt

**File:** `src/lib/googleDeepAnalysisPrompt.js`

Exports `getGoogleDeepAnalysisSystemPrompt()`. Based on the claude-ads skill's 80-check framework across 6 weighted categories:

- **Conversion Tracking (25%):** gtag firing, Enhanced Conversions, Consent Mode v2, attribution model (data-driven preferred), conversion lag, offline conversions
- **Wasted Spend (20%):** search term coverage, negative keyword adequacy (exact/phrase match only — never broad negatives), brand/non-brand separation, geo targeting precision, invalid clicks
- **Account Structure (15%):** campaign org logic, ad group theme tightness (≤20 keywords), RSA count per ad group, PMax structure, SKAG detection
- **Keywords (15%):** match type progression (exact→phrase→broad), QS distribution (target avg ≥7), keyword cannibalization across campaigns, impression share gaps
- **Ads (15%):** RSA headline count (≥8), description count (≥3), ad strength (Good/Excellent target), pin usage, extension coverage (sitelinks ≥4, callouts ≥4, structured snippets, image)
- **Settings (10%):** Smart Bidding adoption (flag ECPC as deprecated), budget pacing, ad schedule alignment, device bid adjustments, location targeting mode ("Presence" not "Presence or Interest"), Search Partners review

AI Insights focus on findings that rule-based systems miss: keyword cannibalization patterns, negative keyword over/under-blocking, Consent Mode v2 status, geo/daypart opportunity signals, AI Max for Search readiness, Demand Gen migration path (if Video Action Campaigns present).

Negative keyword rules (from skill): default Exact Match `[keyword]` for specific irrelevant queries; Phrase Match `"keyword"` for irrelevant intent patterns; never Broad Match negatives; source from actual search terms, not guesses.

Returns ONLY valid JSON — no markdown fences.

## Panel UI

Four sections rendered top-to-bottom:

### Health Score Card
- Large centered score (e.g. "72") + letter grade + `summary` sentence
- Six category bars: label, weight%, score, color-coded (green ≥75, amber 50–74, red <50)

### Findings
- Expandable section per category
- Each finding: status icon (✓ PASS / ⚠ WARNING / ✗ FAIL) + label
- Clicking a finding expands `detail` text
- Categories with all PASS collapsed by default; any WARNING/FAIL starts open

### Quick Wins
- Flat list sorted by effort (low first)
- Each row: action text, impact text, effort badge (Low / Medium / High)

### AI Insights
- Short list of title + 2–3 sentence detail
- Covers cannibalization, negative quality, consent mode, geo/daypart, AI Max readiness

### States
- **Loading:** skeleton pulse animation (reuses existing `briefPulse` keyframe)
- **Error:** message + "Try again" button that clears state and re-fires
- **Cached:** renders immediately from `sessionStorage`, Re-run button visible

## Data Flow

```
page.js
  → DeepAnalysisPanel (open=true, selectedCustomer)
      → GET /api/googleads/audit?customerId=X       (existing endpoint)
      → POST /api/claude/google-deep-analysis       (new endpoint)
          → getGoogleDeepAnalysisSystemPrompt()     (new prompt file)
          → Claude claude-sonnet-4-6
      → sessionStorage cache
      → render UI
```

## Testing

- `src/__tests__/api/google-deep-analysis.test.js` — node env
  - Returns 400 when `customerId` missing
  - Returns 400 when `campaigns` empty
  - Returns 401 on bad session (mock getServerSession to return null)

- `src/__tests__/dashboard/DeepAnalysisPanel.test.jsx` — jsdom env
  - Renders nothing when `open=false`
  - Shows loading skeleton when open (mock fetch pending)
  - Renders health score when fetch resolves
  - "Re-run" button clears cache and re-fetches
