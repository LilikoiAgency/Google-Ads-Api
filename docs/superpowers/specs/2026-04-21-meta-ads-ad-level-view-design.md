# Meta Ads — Ad-Level View with Creative Previews (Phase 1)

**Date:** 2026-04-21
**Status:** Design approved, ready for implementation plan
**Owner:** Frank (lilikoi agency)

## Context

The Meta Ads dashboard at `/dashboard/meta` currently drills down only to the ad-set level (campaign → ad set). No ad-level visibility exists — users can't see individual creatives, ad copy, or per-ad metrics without leaving the app for Meta Ads Manager.

This gap hits three of four primary use cases:
- **Troubleshooting** (hard to diagnose why a campaign underperforms without seeing the ads themselves)
- **Creative review** (no way to browse creatives)
- **Client reporting** (no per-ad performance data)

This is Phase 1 of a two-phase Meta enhancement. Phase 2 (Meta Ads Audit — AI-powered health check) is a separate design, expected to land after Phase 1 ships so it can build on the ad-level data infrastructure this phase introduces.

## Goal

Let a user click an ad set row on the Meta dashboard and see every ad in that ad set with:
- Meta's real rendered ad preview (pixel-accurate, as it appears on Facebook / Instagram)
- Ability to switch placement formats (Mobile Feed / Desktop Feed / Instagram Feed / Reels)
- Per-ad performance metrics for the current date range

## Non-goals (out of scope)

- Ad-level actions (pause, edit budget, duplicate)
- Bulk operations
- Cross-ad comparison views (side-by-side benchmarking)
- AI insights / audit scoring — that's Phase 2
- Server-side persistence of ad data (this is a read-through of Meta's API)
- Creative library / tagging
- Creative asset uploads

## Components

### `MetaAdsPanel` (new)
Slide-out panel component matching the existing `AuditPanel` pattern in `src/app/dashboard/google/ads/components/AuditPanel.jsx`:
- Fixed-position right slide-in, `width: 560px`, `maxWidth: 100vw` (full-screen on mobile)
- Backdrop click / ESC key dismiss
- Receives `adSet`, `dateRange`, `dateWindow` props
- Manages its own data fetching state (ads list, sort, active-only filter)

### `MetaAdPreview` (new, inside panel)
Single ad card:
- Header: ad name (truncate), status pill
- Placement tab bar: `Mobile | Desktop | IG Feed | Reels` — lazy loaded
- Preview area: sandboxed iframe rendering Meta's returned HTML, OR fallback to creative image + body text if preview fetch fails
- Metrics row: Spend / Impressions / Clicks / CTR on row 1; Conversions / CPA / ROAS on row 2

### Ad set table update (in existing `src/app/dashboard/meta/page.js`)
- Each row becomes clickable (cursor pointer, hover highlight)
- Subtle `›` chevron on the right edge
- Click handler opens `MetaAdsPanel` with the selected ad set

## API routes (new)

### `GET /api/meta-ads/ad-set/[adSetId]/ads`
Returns the list of ads within the ad set + metrics for the requested date range.

**Query params:**
- `range=LAST_7_DAYS | LAST_28_DAYS | ...` OR `startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

**Response shape:**
```json
{
  "data": [
    {
      "id": "120204567890",
      "name": "Spring launch — v3 video",
      "status": "ACTIVE",
      "effective_status": "ACTIVE",
      "creative": {
        "id": "9876...",
        "title": "Limited-time offer",
        "body": "Get 20% off…",
        "call_to_action_type": "SHOP_NOW",
        "image_url": "https://…",
        "object_story_id": null
      },
      "insights": {
        "spend": 1234.56,
        "impressions": 45234,
        "clicks": 1240,
        "ctr": 0.0274,
        "cpc": 0.99,
        "cpm": 27.31,
        "conversions": 34,
        "cost_per_conversion": 36.31,
        "revenue": 3021.45,
        "roas": 2.45
      }
    }
  ]
}
```

**Meta Graph endpoints hit:**
- `GET /{adSetId}/ads?fields=id,name,status,effective_status,creative{id,title,body,call_to_action_type,image_url,object_story_id}&limit=50`
- `GET /{adId}/insights?fields=spend,impressions,clicks,ctr,cpc,cpm,actions,action_values&time_range=...` (one request per ad, or batch via `ids=` param)

**Auth:** reuses existing `accessToken` handling from `/api/meta-ads`.

### `GET /api/meta-ads/ad/[adId]/preview?format=<FORMAT>`
Proxies Meta's `/previews` endpoint. Returns raw HTML string for client-side iframe injection.

**Query params:**
- `format` — one of `MOBILE_FEED_STANDARD`, `DESKTOP_FEED_STANDARD`, `INSTAGRAM_STANDARD`, `INSTAGRAM_STORY`, `FACEBOOK_REELS_MOBILE` (default: `MOBILE_FEED_STANDARD`)

**Response shape:**
```json
{ "html": "<iframe src='https://…'></iframe>", "format": "MOBILE_FEED_STANDARD", "cached": true }
```

**Meta Graph endpoint:**
- `GET /{adId}/previews?ad_format={format}`

**Caching:**
In-memory `Map` keyed `${adId}:${format}` with 15-min TTL. Preview HTML is deterministic until the ad is edited, so cache safety is high. Map lives for the warm Vercel function container; cold starts repopulate.

**Error handling:**
- If Meta returns `400 Unsupported ad format` (common — e.g. a Reels ad has no desktop feed preview), respond `{ html: null, unsupported: true }`. Client renders a placeholder message.

## Data flow

```
User on /dashboard/meta
  ├─ selects account + campaign
  ├─ ad sets table renders
  └─ clicks an ad set row
       └─ MetaAdsPanel opens
            ├─ fetches /api/meta-ads/ad-set/[id]/ads
            ├─ renders ad cards (stacked, scroll)
            └─ each card on mount:
                 ├─ fetches /api/meta-ads/ad/[id]/preview?format=MOBILE_FEED_STANDARD
                 └─ renders HTML in sandboxed iframe
       User clicks "Desktop" tab on a card:
            ├─ check client cache
            ├─ if miss, fetch /api/meta-ads/ad/[id]/preview?format=DESKTOP_FEED_STANDARD
            └─ store in card's local state
```

## UI details

### Panel header
- Breadcrumb: `{campaign.name} › {adSet.name}`
- Date range display (read-only, inherited from main page)
- Sort dropdown — default: **Spend desc**. Options: Spend / Impressions / CTR / Conversions / ROAS
- Active-only toggle — default: **ON** (hides ads with status != ACTIVE)
- Ad count: "X ads" (filtered count after toggle)
- Close button + ESC to dismiss

### Ad card visual hierarchy
```
┌──────────────────────────────────┐
│ Ad name                    Status │   ← 14px title, status pill right
│ [Mobile | Desktop | IG | Reels]   │   ← tab bar, 12px
│ ┌────────────────────────────┐   │
│ │    Meta preview iframe     │   │   ← sandboxed, ~400-500px tall
│ │    (real rendered ad)      │   │
│ └────────────────────────────┘   │
│                                  │
│ Spend   Impr    Clicks   CTR     │   ← 4-col metrics, 12px label / 15px value
│ $1,234  45.2k   1.2k    2.1%     │
│ Conv    CPA     ROAS             │   ← 3-col secondary metrics
│ 34      $36.29  2.45x            │
└──────────────────────────────────┘
```

### Empty / error states
- **No ads in set:** centered empty state with icon + "This ad set has no ads yet"
- **Preview fetch failed:** card still renders; iframe area replaced with `{creative.image_url} + {creative.body}` fallback, small "(preview unavailable)" note
- **Ads list fetch failed:** panel shows error banner with retry button; closes on escape

### Mobile
- Panel fills full viewport (`maxWidth: 100vw` already on AuditPanel pattern)
- Iframes render at ~360px wide → Meta's mobile format looks native
- Tab bar remains horizontally scrollable if placements wrap

## Performance considerations

- **Lazy preview loading** — only fetch the placement format the user views, not all 4 up front. Saves 75% of preview API calls for the common case.
- **Server-side cache** — 15 min per `(adId, format)` — Meta's preview HTML doesn't change unless the ad is edited; most re-opens of the panel hit the cache.
- **Client cache** — previews fetched during a panel session stay cached in component state. Closing the panel drops the cache (simple, no memory leak).
- **Batch insights** — use Meta's `ids=` param to fetch insights for up to 50 ads in a single request instead of N requests.

## Error handling

| Scenario | Behavior |
|---|---|
| `/ads` endpoint 401 | Surface "Meta access token expired" toast + link to re-auth |
| `/ads` endpoint 429 / rate-limit | Inline banner with countdown, retry button |
| `/previews` 400 unsupported format | Show "This ad doesn't render in [format]" placeholder |
| `/previews` 5xx | Fall back to `creative.image_url + body` |
| Empty ad set | Empty-state card |
| User closes panel mid-fetch | Cancel outstanding requests (AbortController) |

## Testing plan

- Manual: test with an existing client's Meta account that has multiple ads per ad set, verify preview renders correctly for all 4 placements
- Test the fallback path by forcing a 500 on preview fetch (e.g. invalid ad ID)
- Verify row click + keyboard accessibility (Enter opens panel, ESC closes)
- Verify panel respects current date range from parent page
- Verify active-only toggle filter
- Verify sort options
- Mobile: verify panel is usable on 360px and 390px screens, iframe doesn't overflow

## Dependencies

- Meta Graph API access — **existing**, already used by `/api/meta-ads`
- **Read-only scope (`ads_read`)** — the existing token already has this for reading insights. `/{adId}/previews` works with `ads_read` when you're previewing an existing ad by ID, which is what we're doing. No token re-auth needed; no write scope requested.
- No new npm packages required

## Open questions (to resolve in implementation)

- Video ads: Meta's preview endpoint handles video ads, but falls back gracefully for animated/dynamic creatives. Verify this works for CMK/BBT/SMP accounts specifically.
- Ad set with > 50 ads: for v1, cap at 50 (most ad sets don't exceed this). Add pagination if needed later.

## Success criteria

- Click any ad set row → panel opens in under 500ms with ads list visible
- Each ad card renders Meta's real preview within 2s of card becoming visible
- Placement switching feels instant after first fetch (client cache)
- No regression to existing ad set / campaign views
- Works on mobile (360px) with usable preview sizing
