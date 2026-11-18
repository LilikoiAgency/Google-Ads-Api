# GA4 Web Traffic Reports — Design

Date: 2026-11-18
Status: Approved by Frank, 2026-11-18

## Intent and why

Frank needs to answer "how much traffic did client X's website get, and from where?" quickly, for any client, for any time frame, without logging into Google Analytics. Today it takes a manual GA4 export plus a hand-built page. The page he made for Big Bully Turf (copied to `docs/superpowers/specs/assets/bbt-web-traffic-oct-2026-example.html`) is the target look for a finished report. Two uses, both in scope:

1. **Exploring:** look around a client's traffic (organic and paid, any date range, compared against an earlier period) inside the dashboard.
2. **Handing off:** produce a polished standalone report like the BBT page to send to a client.

Frank's bar: "this needs to work amazingly."

## Goals

- A new dashboard page, **Web Traffic (GA4)**, at `/dashboard/google/analytics`, listed in the sidebar under "Organic & Reports".
- Choose any GA4 property the `lilikoi-reporting` service account can see. New clients appear automatically once they grant Viewer access; no code or config change.
- Choose a date range: This month, Last month, Last 7 / 28 / 90 days, Year to date, Custom.
- Compare to: Previous period (default; for "Last month" that is the month before), Same period last year, or None.
- Switch the view: **Organic search**, **All non-paid**, **Paid**, **Everything**.
- See, for the current view: headline totals with % change vs the comparison, traffic over time by channel, a channel table, top sources and top landing pages.
- Flag likely untagged paid traffic, such as Facebook or Instagram visits sitting in non-paid channels.
- **Download report:** a standalone HTML file in the style of the BBT example, for exactly what's on screen (property, range, comparison), that opens in any browser with no login.

## Non-goals (v1)

- Linking GA4 properties to Client Portals, or showing GA data inside client portals.
- Scheduled or emailed reports.
- Merging Search Console or Google Ads cost data into this page. The existing "Paid vs Organic" report covers Ads plus GSC.
- Custom GA4 channel groups, events explorer, audiences, e-commerce revenue.
- Granting GA access. That stays a manual step in GA4 by an Admin on each client's account.

## Anti-goals (would make this a failure even if it works)

- Numbers that don't match GA4's own Traffic acquisition report for the same property, range and channel grouping.
- Adding users across channels to get a total. That double-counts people who arrived through more than one channel. Totals must be deduplicated by GA.
- Showing "Unassigned" traffic as organic.
- A downloaded report that depends on a login or API calls, or that leaks other clients' data. (It may load Chart.js from the CDN like the BBT example. Without a connection it must still show all numbers and tables; only the chart drops out, with a one-line note.)
- A slow page: switching views or channels must not re-hit GA.

## Constraints and facts already established

- **Auth:** service account `lilikoi-reporting@lilikoi-ads-analytics.iam.gserviceaccount.com`. Its JSON key is in `.env` as `GA4_SA_KEY`, in the same single-quoted JSON format as `GOOGLE_SHEETS_SA_KEY` (see `src/lib/sheetsClient.js`). It must be added to Vercel env vars before deploy. Scope is `analytics.readonly`. The Analytics Data API and Analytics Admin API are both enabled in project `lilikoi-ads-analytics`.
- **Verified on 2026-11-18:** the account sees 3 GA accounts with 9 properties (lilikoi agency, Ranger Electric, Semper Solaris ×7). `runReport` works with `sessionPrimaryChannelGroup`, two named date ranges in one request (the comparison) and the `keyEvents` metric. Quota is generous: about 3 tokens per request against 200,000 per day.
- **Client library:** `googleapis` is already installed (`google.analyticsadmin` v1beta, `google.analyticsdata` v1beta). No new dependency is needed for the server side.
- **Channel dimension:** `sessionPrimaryChannelGroup`. This matches the GA4 Traffic acquisition default and the BBT example's source note. Observed values include Direct, Organic Search, Paid Search, Paid Social, Paid Video, Paid Other, Cross-network, Referral, Organic Social, Organic Shopping, Email, AI Assistant and Unassigned.
- **API route auth:** `getAllowedSession()` from `src/lib/routeAuth.js` (@lilikoiagency.com only). `middleware.js` only guards pages, not `/api`.
- **Page patterns to follow:** `src/app/dashboard/google/organic/page.js` (Search Console page): `DashboardToolHeader`, `DashboardLoader`, `MobileFilterSheet`, date presets, Recharts, `globals.css` theme variables. The in-app chart uses Recharts, which is already a dependency.
- **Caching:** `src/lib/serverCache.js` (`getCached` / `setCached` with TTL).
- **Tests:** vitest in `src/__tests__/`.
- **Git:** work goes directly on `main` (Frank's standing preference). Frank pushes.

## Approaches considered

- **A. Live report page with a Download button.** *(chosen by Frank)* One tool covers both exploring and client hand-offs; it's the most work.
- **B. Report generator only.** A form that outputs a BBT-style file. Faster, but you can't explore, and every question means re-generating.
- **C. On-demand by hand.** No UI; someone runs the pulls and builds the files each time. Cheapest to build, but manual every time.

## Users metric

Use GA4 **`activeUsers`**, labeled "Users". That is what GA4's Traffic acquisition report shows in its "Users" column, so the parity check can match exactly. (The hand-built BBT page's note says "Total users", so its numbers may differ slightly from the new tool's. That's expected.) `newUsers` is labeled "New users".

## Channel definitions (shown in the app and in the download; wording from the BBT example)

- **Organic Search:** visitors who clicked an unpaid result on Google, Bing or another search engine.
- **Direct:** visitors who typed the web address, used a bookmark, or came from a link Google Analytics couldn't trace, such as one in a text message or app.
- **Referral:** visitors who clicked a link to the site from another website.
- **Organic Social:** visitors who clicked an unpaid post or profile link on Facebook, Instagram, TikTok or another social platform.
- **Organic Shopping / Organic Video / Email / AI Assistant:** free shopping listings, unpaid video such as YouTube, email links, and AI tools like ChatGPT.
- New (same plain style): **Paid Search** (clicked a search ad, e.g. Google or Microsoft Ads), **Paid Social** (clicked a paid ad on Facebook, Instagram, TikTok, etc.), **Paid Video / Display / Cross-network / Paid Other** (other paid ads, including Performance Max for Cross-network), **Unassigned** (visits GA couldn't put in any channel, usually from links with incomplete tracking tags).

## Channel buckets (one shared module, used by the page, API and download)

| Bucket | Channels |
|---|---|
| Organic search | Organic Search |
| Other non-paid | Direct, Referral, Organic Social, Organic Video, Organic Shopping, Email, AI Assistant, SMS, Mobile Push Notifications |
| Paid | Paid Search, Paid Social, Paid Video, Paid Shopping, Paid Other, Display, Cross-network, Audio, Affiliates |
| Unassigned | Unassigned, plus any unrecognized value (shown by name and counted only under "Everything") |

Views: **Organic search** = Organic Search. **All non-paid** = Organic search + Other non-paid. **Paid** = Paid. **Everything** = all, including Unassigned.

Any channel name not in the table is treated as Unassigned in the buckets but shown under its real name in the channel table, so new GA channels aren't silently mislabeled.

## Design

### Server

**`src/lib/ga4Client.js`**
- `getGa4Auth()`: JWT from `GA4_SA_KEY`. Fails with a clear error if the variable is missing or malformed.
- `listProperties()`: Admin API `accountSummaries.list`, paginated. Returns `[{ id: "properties/…", name, account }]` sorted by account then property name.
- `fetchTrafficReport({ property, startDate, endDate, compare, granularity })`: makes all GA calls for one screen and returns one normalized object (below). Uses `batchRunReports` (up to 5 requests per batch) to keep it to 1–2 round trips.

**`src/lib/ga4Channels.js`**: the bucket table, `bucketFor(channel)`, view definitions, and plain-English channel definitions. Pure, so it's shared by client and server and unit-tested.

**`GET /api/ga4/properties`**: guarded by `getAllowedSession`. Cached 1 hour.

**`GET /api/ga4/report?property=&startDate=&endDate=&compare=prev|yoy|none&granularity=day|week|month`**: guarded. Validates inputs: the property must be in `listProperties()` (blocks probing arbitrary IDs), dates must be YYYY-MM-DD with start ≤ end, and the range can be at most 3 years. The comparison range is computed on the server:
- `prev`: the same number of days, ending the day before `startDate`. If the range is exactly a full calendar month, use the whole previous calendar month instead.
- `yoy`: the same dates one year earlier. Feb 29 maps to Feb 28.

Cache key includes every parameter. TTL is 6 hours when the range ended before today, and 15 minutes when it includes today.

**Response shape:**
```
{
  property: { id, name, account },
  range: { startDate, endDate }, compareRange: { startDate, endDate } | null,
  granularity,
  totalsByView: { organic: M, nonPaid: M, paid: M, all: M },    // deduplicated, current
  totalsByViewCompare: { …same } | null,
  channels: [ { channel, bucket, current: M, compare: M|null } ],  // sorted by sessions desc
  series: { labels: [...], byChannel: { [channel]: [users per bucket of time] } },
  sources: [ { sourceMedium, channel, bucket, sessions, users, suspectedPaid: bool } ],  // top 100
  landingPages: [ { page, channel, bucket, sessions, users, keyEvents } ],  // top 500 page×channel rows
  warnings: [ "…" ],
  fetchedAt
}
M = { users, newUsers, sessions, engagedSessions, engagementRate, keyEvents }
```

`totalsByView` is computed by GA with a channel filter for each view, **never by adding channel rows**. That means four filtered total requests per date range, which fits in one batch.

`suspectedPaid` is true when a non-paid row's source/medium matches `facebook|instagram|fb|ig|meta|tiktok|linkedin` together with a medium like `cpc|ppc|paid|ads|cpm`, or the medium alone is `cpc|ppc|paid`. `warnings` summarizes those rows ("~X sessions labeled Organic Social / Referral look like paid ads with missing UTM tags").

Granularity is chosen on the client by default: day up to 92 days, week up to about 1 year, month beyond that. The user can override it. GA dimensions: `date`, `yearWeek`, `yearMonth`.

### Page: `/dashboard/google/analytics`

Layout from top to bottom (desktop; collapses into `MobileFilterSheet` on mobile):

```
[Web Traffic (GA4)]                                       [Download report]
Property ▾ (search, grouped by account)   Range ▾ (Last month)   Compare ▾ (Previous period)
[ Organic search | All non-paid | Paid | Everything ]

 Users        Sessions     New users    Engagement rate   Key events
 1,440 ▲12%   1,912 ▲9%    1,301 ▲15%   58.2% ▼1.1 pts    87 ▲4%

 ▆▆▇▆▅▇█▇▆▅  stacked bars by channel over time (users)       Day | Week | Month
 legend: Organic Search · Direct · Referral · …   (only channels in the current view)

 Channel          Users  Δ     Sessions  Δ    Engaged  Eng. rate  Key events
 Organic Search   1,440  +12%  …
 Direct           …
 Total (deduped)  …

 ⚠ ~120 sessions in Organic Social look like untagged Facebook/Instagram ads  [see sources]

 Top sources / medium     |  Top landing pages
 (filtered to the view)   |  (filtered to the view)

 What each channel means (collapsible, same wording as the BBT report)
 Source: GA4, Session primary channel group, <dates>. Totals are unique users…
```

Behavior:
- One fetch per property/range/compare/granularity change. Switching views, sorting tables and hiding channels in the legend all happen locally, with no refetch.
- All state lives in URL query params (`?property=…&range=last_month&compare=prev&view=nonPaid`) so a link reproduces the exact screen for a teammate. The last property used is remembered in localStorage as the default.
- Comparison deltas appear in the KPI row and the channel table; the chart shows only the current period.
- Clear empty and error states: no properties visible (with the exact email and steps to grant Viewer), no data in range, GA error, and a missing `GA4_SA_KEY`.

### Download report

**`src/lib/ga4ReportHtml.js`**: `generateTrafficReportHtml(data, { view })` returns a full HTML string. It is triggered in the browser as a file download named `<Property name> Web Traffic - <Mon YYYY or start–end>.html`.

It mirrors the BBT example: the same structure, a light/dark theme with CSS variables, KPI row (now with comparison deltas), a view toggle inside the report (Organic search / All non-paid / Paid / Everything; it opens on the view selected in the dashboard), a stacked bar chart, the channel table with a deduplicated total, channel definitions and a source note. Chart.js comes from cdnjs with a pinned version, and all data is inlined, so the file has no other network calls and no auth. It includes only the selected property's data. Sources and landing pages are included as tables (top 15 each). The untagged-paid warning is **not** in the client report; it's an internal note.

### Errors and limits

- GA 403 on a property → "lilikoi-reporting doesn't have access to this property anymore."
- GA quota (429) → a message asking to retry shortly. The cache softens repeats.
- Ranges where GA returns sampled or thresholded data: show GA's metadata flags (`dataLossFromOtherRow`, `samplingMetadatas`) as a small notice.

## Testing

- Unit (vitest): `ga4Channels` (bucketing, unknown channels, views), comparison-range math (full month, arbitrary range, leap day, YoY), `suspectedPaid` matcher, response normalizer (GA rows → shape, using recorded fixtures), and the HTML generator (snapshot plus "no external URLs except the pinned Chart.js").
- API route tests with mocked `googleapis` and session: auth rejection, invalid params, property not in the list.
- **Manual parity check before calling it done:** for Semper Solaris - GA4 and Ranger Electric, October 2026, Users and Sessions by channel must equal GA4's Traffic acquisition report (Session primary channel group) exactly.

## Decided by Frank

- Approach A: a live page plus a downloadable standalone report.
- Use the `lilikoi-reporting` service account and connect other clients' GA accounts to it.

## Defaults chosen during design (open to correction)

- Page location and name: `/dashboard/google/analytics`, "Web Traffic (GA4)", under Organic & Reports.
- Unassigned isn't counted as non-paid.
- Default comparison is Previous period. Default range is Last month.
- The untagged-paid warning is internal only and left out of client downloads.
- Users = GA4 `activeUsers`, to match GA's own Traffic acquisition report.
- The download loads Chart.js from the CDN, as the BBT example does; without internet only the chart drops out.
- Key events are shown even though some clients may not have them set up; it shows "—" when 0 across the property.

## Left to the builder

File and component breakdown inside the page, exact styling within the existing theme variables, the cache TTL fine-tuning, and the batching layout of GA requests.
