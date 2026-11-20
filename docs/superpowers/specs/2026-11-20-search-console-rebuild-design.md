# Search Console (Organic) page rebuild — design

Date: 2026-11-20. Page: `/dashboard/google/organic`. Replaces the March 2026 version
(3 calls to `/api/organic`: top queries, top pages, daily trend).

## Problems fixed
1. **Totals understated.** Old totals summed query rows; Search Console drops anonymized
   and long-tail queries from query-level rows. Totals now come from a request with no
   dimensions (what Search Console's own chart shows).
2. **Average position wrong.** Old value was an unweighted mean of query positions.
   Now Google's impression-weighted position from the no-dimension request.
3. **`/api/organic` had no login check.** Removed; the new routes all use
   `getAllowedSession` (`@lilikoiagency.com` only).
4. **No caching.** Reports cache in Mongo (`serverCache`).

## Data (Search Console API v1, `google.searchconsole`)
All Search Analytics requests send `type` (web / image / video / news / discover /
googleNews) and `dataState: 'all'`, so the last 1-3 days appear; the response's
`metadata.firstIncompleteDate` marks where data is still preliminary.

Current range: totals, date, query (5k), page (5k), query+page (25k), device,
country, searchAppearance. Compare range (prev / yoy, same rules as GA4 via
`ga4Dates`): totals, date, query, page, device, country.
Brand split (only when brand terms are set): totals and date, each for
`includingRegex` and `excludingRegex` of the brand pattern, both ranges.
Anonymized = total - branded - non-branded (query filters drop anonymized queries).
Discover / Google News support no query dimension and no position: those parts
are skipped.

Sitemaps: `sitemaps.list` once per report.

Cache key `gsc:v1:report:{site}:{start}:{end}:{compare}:{type}:{brandHash}`;
30 min when the range ends in the last 4 days, else 12 h.

## Per-site settings
Mongo `tokensApi.gscSiteSettings`, one doc per `siteUrl`:
`{ siteUrl, brandTerms: string[], annotations: [{ id, date, label }], ga4Property, updatedAt, updatedBy }`.
`GET/PUT /api/gsc/settings`. Brand terms are matched case-insensitively as
substrings (RE2 `(?i)` pattern, terms regex-escaped). Annotations are manual
(site launches, algorithm updates) and draw as lines on the trend chart.

## Insights (pure, client side: `src/lib/gscInsights.js`)
- **Expected CTR by position:** the site's own median CTR per rounded position when
  that position has at least 5 queries with 20+ impressions, else a default curve.
- **Close to page one (striking distance):** queries at position 4-15 with real
  impressions, ranked by the extra clicks if they reached position 3.
- **Low CTR:** pages / queries in the top 10 whose CTR is under half the expected CTR
  for their position — rewrite the title or meta description.
- **Cannibalization:** queries (50+ impressions) where 2+ pages each get 10%+ of the
  impressions.
- **Page groups:** pages grouped by first path segment (`/services/*`, `/blog/*`,
  home = `/`), with compare-period deltas.
- Click a query to see its pages; click a page to see its queries.

## Index health
`POST /api/gsc/inspect { siteUrl, urls[≤10] }` → URL Inspection API per URL
(verdict, coverage, last crawl, Google vs user canonical, robots, rich results),
cached 24 h per URL. Quota is ~2,000 inspections/day/site, so it runs on demand
(button for the top pages, or per row), never automatically.

## Search Console + GA4 per landing page
`GET /api/gsc/ga4-pages?siteUrl&startDate&endDate` finds the GA4 property whose web
stream matches the site's host (or the one saved in settings), and pulls
`landingPage` x `sessionSourceMedium = google / organic`: sessions, engaged sessions,
key events. Joined on normalized path (no host, query or trailing slash) into the
Pages table: impressions → clicks → sessions → key events.

## Download
`src/lib/gscReportHtml.js`, standalone client HTML like the GA4 one: KPIs with
deltas, trend chart, branded vs non-branded, top queries, top pages, close to page
one, devices, countries. Internal-only lists (low CTR, cannibalization, index
checks) are not included.

## Not built
- Automatic Google algorithm-update markers (no API; add them as annotations).
- Business Profile data (separate approval, see the SEO audit reputation spec).
