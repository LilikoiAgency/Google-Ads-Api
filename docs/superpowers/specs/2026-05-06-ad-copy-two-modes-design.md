# Ad Copy Generator — Two Modes Design

## Goal

Redesign the Google Ads and Meta ad copy panels to support two distinct modes: **New campaign** (generate from scratch using user-provided context) and **Existing campaign** (pull current ad copy and generate improvement recommendations).

## Architecture

### Components changed

- `src/app/dashboard/google/ads/components/AdCopyPanel.jsx` — add mode toggle, new campaign form, existing campaign copy preview
- `src/app/dashboard/meta/components/MetaAdCopyPanel.jsx` — same, with audience field instead of keywords

### New API routes + prompts

- `src/app/api/claude/ad-copy-new/route.js` — Google Ads new campaign generation
- `src/lib/adCopyNewPrompt.js` — system prompt for new campaign (no existing data to reference)
- `src/app/api/claude/meta-ad-copy-new/route.js` — Meta new campaign generation
- `src/lib/metaAdCopyNewPrompt.js` — system prompt for Meta new campaign

### Updated API routes + prompts

- `src/app/api/claude/ad-copy-strategy/route.js` — update system prompt framing to "improvement recommendations on current copy"
- `src/lib/adCopyStrategyPrompt.js` — update framing
- `src/app/api/claude/meta-ad-copy/route.js` — same update
- `src/lib/metaAdCopyPrompt.js` — same update

### Test files

- `src/__tests__/api/ad-copy-new.test.js` — new
- `src/__tests__/api/meta-ad-copy-new.test.js` — new
- `src/__tests__/components/AdCopyPanel.test.jsx` — update for toggle and new form
- `src/__tests__/components/MetaAdCopyPanel.test.jsx` — update for toggle and new form

---

## UI Design

### Mode toggle

Both panels open with a segmented toggle at the top:

```
[ New campaign ]  [ Existing campaign ]
```

Default: **Existing campaign** when underperforming campaigns exist (preserves current behavior); **New campaign** otherwise.

The form below the toggle updates immediately on switch. State for each mode is kept separately so switching back does not clear the other mode's inputs.

---

### Google Ads — New campaign form

**Required fields:**

| Field | Input type | Placeholder / hint |
|---|---|---|
| What are you selling? | Single-line text | "e.g. Emergency plumbing repair services in Miami" |
| Target keywords | Single-line text | "e.g. emergency plumber, burst pipe repair — separate with commas" |
| What makes you different? | Textarea (3 rows) | "e.g. Licensed & insured, 60-min response, upfront pricing, 5-star rated" |
| Main offer or CTA | Single-line text | "e.g. Free estimate · Call now · 20% off first visit" |

**Optional fields:**

| Field | Input type | Options |
|---|---|---|
| Campaign goal | Single-select pills | Leads / Sales / Awareness / Traffic |
| Tone | Single-select pills | Professional / Friendly / Urgent / Bold |
| Landing page URL | Text + "Fetch" button | Reuses `/api/fetch-page-content` — fetched content sent as `pageContent` |

Generate button label: **"Generate ad copy"**

---

### Google Ads — Existing campaign form

**Campaign selector:**
- Radio list of all campaigns (not filtered to underperforming)
- Each row shows: campaign name, spend, CTR, conversions, verdict badge (color-coded)
- Underperforming campaigns pre-selected by default if any exist

**Current copy preview:**
- Displayed automatically when a campaign is selected
- Shows current RSA headlines (as chips) and descriptions (as text)
- Labeled: "Current ad copy · pulled from your account"
- Read-only

**Optional field:**
- "Anything specific to focus on?" — single-line text
- Placeholder: "e.g. Improve CTR, descriptions feel generic" or "We just added financing"

Generate button label: **"Generate recommendations"**

---

### Meta — New campaign form

Identical to Google Ads new campaign form except:

- **"Target keywords"** is replaced with **"Target audience"**
  - Placeholder: "e.g. Homeowners 30–55, interested in home improvement"

All other fields (selling, USPs, CTA, goal, tone, landing page) are identical.

Generate button label: **"Generate ad copy"**

---

### Meta — Existing campaign form

Identical to Google Ads existing campaign form.

Current copy preview shows: primary text and headline from the top creative for the selected campaign (already available from the existing `/api/meta-ads/top-creatives` fetch).

Generate button label: **"Generate recommendations"**

---

## API Design

### New: `POST /api/claude/ad-copy-new`

**Request body:**
```json
{
  "product": "string (required)",
  "keywords": "string (required, comma-separated)",
  "usps": "string (required)",
  "cta": "string (required)",
  "goal": "Leads | Sales | Awareness | Traffic (optional)",
  "tone": "Professional | Friendly | Urgent | Bold (optional)",
  "pageContent": "string (optional, ≤20000 chars, from fetch-page-content)"
}
```

**Response:** Same JSON schema as existing `ad-copy-strategy` — array of headline variants (≤30 chars each) and description variants (≤90 chars each), with rationale per variant.

**Limits:** Same daily cap (10/day default) and monthly budget cap as existing routes.

---

### New: `POST /api/claude/meta-ad-copy-new`

**Request body:**
```json
{
  "product": "string (required)",
  "audience": "string (required)",
  "usps": "string (required)",
  "cta": "string (required)",
  "goal": "Leads | Sales | Awareness | Traffic (optional)",
  "tone": "Professional | Friendly | Urgent | Bold (optional)",
  "pageContent": "string (optional, ≤20000 chars)"
}
```

**Response:** Same JSON schema as existing `meta-ad-copy` — primary text variants (≤125 chars), headline variants (≤40 chars), description variants (≤30 chars), CTA recommendation.

---

### Updated: `POST /api/claude/ad-copy-strategy`

No input changes. System prompt updated: output is framed as "improvement recommendations on the current copy" — Claude must reference the existing headlines/descriptions by name, identify what's weak and why, then provide replacement variants that fix the specific issues.

---

### Updated: `POST /api/claude/meta-ad-copy`

Same prompt framing update as above.

---

## System Prompt Rules

### New campaign prompts (Google + Meta)

- Never invent claims not supported by the provided product description, USPs, or page content
- Every headline must contain or mirror at least one provided keyword (Google) / speak directly to the provided audience (Meta)
- Provide 5 headline variants and 2 description variants (Google) / 3 primary text variants and 3 headline variants (Meta)
- Each variant must include a one-line rationale explaining the angle

### Existing campaign prompts (updated framing)

- Reference the current copy by name: "Your current headline 'X' has low Ad Relevance because..."
- Do not repeat what is already working — focus output on what needs to change and why
- Replacement variants must be meaningfully different from the originals, not minor rewrites

---

## Error States

- No campaigns available → show empty state message, disable generate button
- Fetch page content fails → show inline error, clear URL field, allow user to retry or proceed without it
- Daily cap reached → show message: "You've used your daily AI limit. Try again tomorrow."
- Monthly budget cap reached → show message: "Monthly AI budget reached. Contact your admin."
- Claude API error → show generic retry message

---

## Out of Scope

- Saving or favoriting generated copy
- History of past generations
- Streaming responses
- Batch generation across multiple campaigns simultaneously
