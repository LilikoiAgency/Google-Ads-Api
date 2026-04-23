# Meta Creative Ad Review — Design Spec

**Date:** 2026-04-23  
**Status:** Approved for implementation

---

## Goal

Add AI-powered creative ad reviews (using the LeadsIcon ad-review rubric) to the existing creatives gallery page at `/dashboard/meta/creatives`. Users can review all visible creatives in bulk (fast text-only triage) or drill into a single ad for a full image-aware review.

---

## Architecture

Two components, one new file:

| File | Change |
|------|--------|
| `src/app/api/claude/ad-review/route.js` | **New** — Claude API route that accepts ad data and returns structured review JSON |
| `src/app/dashboard/meta/creatives/page.js` | **Modify** — add Review All button, per-card badges, review modal, batch orchestration |

**Data flow:**
1. Creatives page fetches top creatives via the existing `/api/meta-ads/top-creatives` route — no new Meta API calls
2. User clicks "Review All" or "Review" on a card — already-fetched data is sent to `/api/claude/ad-review`
3. For batch mode: creative text only (no images), 10 ads per Claude call, processed sequentially
4. For single mode: creative text + `image_url` as a multimodal Claude input
5. Results stored in component state `{ [adId]: reviewResult }` — in-session only (no MongoDB persistence in v1)
6. Each reviewed card gets a status badge; clicking opens a full review modal

---

## API Route — `/api/claude/ad-review`

**Method:** POST  
**Auth:** session email must end with `@allowedEmailDomain`  
**Daily limit:** `META_AD_REVIEW_DAILY_LIMIT` env var (default `10`), tracked in `UsageLimits` collection under field `adReviewCount`. Each POST = 1 usage unit regardless of batch size.

### Request body

```json
{
  "ads": [
    {
      "id": "123456789",
      "name": "Ad name",
      "title": "Headline text",
      "body": "Ad copy body text",
      "ctaType": "SHOP_NOW",
      "imageUrl": "https://...",
      "metrics": {
        "spend": 1234.56,
        "impressions": 50000,
        "clicks": 1200,
        "ctr": 0.024,
        "conversions": 45,
        "roas": 3.2,
        "frequency": 2.1,
        "cost_per_conversion": 27.43
      }
    }
  ],
  "mode": "batch",
  "accountId": "act_12345"
}
```

- `mode: "batch"` — text only, up to 10 ads, returns compact JSON array
- `mode: "single"` — includes `image_url` as multimodal content, returns single detailed review

### Response

```json
{
  "reviews": [
    {
      "adId": "123456789",
      "status": "APPROVED",
      "overallScore": 72,
      "scores": { "hook": 18, "proof": 20, "cta": 16, "visual": 18 },
      "summary": "Strong proof and CTA. Hook loses attention after second line.",
      "hook": {
        "strengths": ["Pattern interrupt in first frame"],
        "issues": ["Product revealed too early"],
        "recommendation": "Delay product reveal to 3s"
      },
      "proof": {
        "elements": ["Customer testimonial (high quality)", "Before/after result"],
        "missing": ["Authority/expert signal"],
        "recommendation": "Acceptable"
      },
      "cta": {
        "placement": "Just right",
        "clarity": "Clear",
        "urgency": "Natural",
        "recommendation": "Keep"
      },
      "visual": {
        "productionQuality": "UGC-native",
        "authenticity": "Genuine",
        "issues": []
      },
      "platformFit": ["Facebook Feed", "Instagram Reels"],
      "actionItems": {
        "required": ["Delay product name to 3s"],
        "recommended": ["Add authority signal (e.g. press mention)"]
      },
      "prediction": "High potential"
    }
  ],
  "usage": { "count": 3, "limit": 10, "remaining": 7 }
}
```

### Claude prompt

**System (both modes):**
```
You are an expert ad creative reviewer applying the LeadsIcon ad-review rubric.

Score each ad on four categories (25 pts each, 100 total):
- Hook (25): Stops scroll in 1–3s, creates curiosity, relevant to avatar, doesn't reveal product too soon
- Proof (25): Social proof, authority, results/data, believable demonstration
- CTA (25): Clear next step, natural urgency, risk reversal, correct placement (not too early)
- Visual (25): Platform-native quality (not over-produced), genuine/authentic feel, clear audio and text

Authenticity test: "Would comments call this fake?" If yes → needs work.
Platform native test: "Does this look like content or an ad?" Content = good.

Return ONLY a valid JSON array — no markdown, no explanation — with one object per ad.
Each object must have: adId, status ("APPROVED"|"REVISE"|"REJECT"), overallScore (0-100),
scores {hook, proof, cta, visual}, summary (one sentence), hook {strengths[], issues[], recommendation},
proof {elements[], missing[], recommendation}, cta {placement, clarity, urgency, recommendation},
visual {productionQuality, authenticity, issues[]}, platformFit (string[]),
actionItems {required[], recommended[]}, prediction ("High potential"|"Medium"|"Low").
```

**User message (batch mode):**
```
Review these {N} ads for account {accountId}:

--- Ad 1 ---
ID: {id}
Name: {name}
Headline: {title || "(none)"}
Copy: {body || "(none)"}
CTA Button: {ctaType || "(none)"}
Performance: ${spend} spend · {ctr}% CTR · {conversions} conversions · {roas}x ROAS · {frequency}x frequency

--- Ad 2 ---
...
```

**User message (single mode):** Same text fields plus the `imageUrl` passed as a Claude multimodal `image_url` content block so Claude can assess visual quality.

---

## Creatives Page Changes

### New state

```javascript
const [reviews, setReviews] = useState({});           // { [adId]: reviewResult }
const [reviewLoading, setReviewLoading] = useState(false);
const [reviewProgress, setReviewProgress] = useState({ current: 0, total: 0 });
const [reviewModal, setReviewModal] = useState(null); // adId | null
const [reviewUsage, setReviewUsage] = useState(null); // { count, limit, remaining }
```

### "Review All" button

Added to the top filter bar. Visible only when ads have loaded. Disabled while `reviewLoading` is true.

**Orchestration (inside the component):**
1. Split `filtered` ads into chunks of 10
2. For each chunk: POST to `/api/claude/ad-review` with `mode: "batch"`
3. Merge returned reviews into `reviews` state immediately (progressive display)
4. Update `reviewProgress` after each chunk
5. Wait 500 ms between chunks (rate-limiting courtesy delay)
6. If any chunk returns a limit error, stop and surface the error

Progress label: `"Reviewing 11–20 of 47…"` while running.

### "Review" button (per card)

Small pill button in the card header (see placement section below). Sends a single-ad POST with `mode: "single"`. Adds a loading spinner to that card only while in-flight. Disabled while a "Review All" batch is in progress.

### "Review" button (per card) — placement

Added to the card header row (same row as the rank badge `#1` and the activation status badge `ACTIVE/PAUSED`). Appears as a small pill button: `★ Review`. While a single-ad review is in-flight, the button shows a spinner and is disabled.

### Status badge (per card)

**Note:** The existing card already has an activation status badge (`ACTIVE` / `PAUSED`) in the card header. The review verdict badge is distinct and sits in the **card footer** — a full-width strip added below the metrics row when a review result exists.

Footer strip colors:
- `APPROVED` → green (`#16a34a`) background tint with score
- `REVISE` → amber (`#d97706`) background tint with score
- `REJECT` → red (`#dc2626`) background tint with score

Footer strip content: `[APPROVED]  82/100  →  View full review`

Clicking anywhere on the footer strip calls `setReviewModal(adId)`.

### Review modal

Full-screen overlay (z-index above everything). Sections:

1. **Header** — ad name, status badge, overall score `X / 100`
2. **Score grid** — Hook / Proof / CTA / Visual each as `X / 25`
3. **Hook review** — strengths, issues, recommendation
4. **Proof review** — elements present, missing, recommendation
5. **CTA review** — placement / clarity / urgency, recommendation
6. **Visual / Authenticity review** — production quality, authenticity, issues
7. **Platform fit** — chip list
8. **Action items** — Required (red) and Recommended (amber) checklists
9. **Prediction** — High / Medium / Low

ESC key and backdrop click close the modal. If the ad has an `image_url`, display it at the top of the modal alongside the review.

---

## Rate Limiting & Meta API Safety

- No new Meta Graph API calls are made during review — all data comes from the existing top-creatives fetch
- Images: `image_url` (Meta CDN URL) is passed directly to Claude's vision API; Claude fetches it, not us — no Graph API call
- Claude calls: sequential per batch, 500 ms gap between chunks
- Daily usage limit: tracked per user per day in the existing `UsageLimits` MongoDB collection
- "Review All" on a filtered set of 47 ads = 5 Claude calls (5 batches of 10/10/10/10/7) = 5 usage units

---

## Error Handling

- Daily limit reached → stop batch at that chunk, show usage warning in the UI, already-completed reviews remain visible
- Claude returns malformed JSON → skip that chunk's reviews, log warning, continue with next chunk
- Network error on a chunk → surface inline error, allow user to retry "Review All" (already-reviewed ads keep their badge)
- `imageUrl` missing on single review → Claude call proceeds without the image block; scores reflect text-only analysis

---

## What is NOT in v1

- MongoDB persistence of reviews (in-session only; refresh = reviews gone)
- Export / sharing of review results
- Comparison against historical reviews
- Review of ads not currently visible in the filtered set
