# GA4 Web Traffic Reports Implementation Plan


**Goal:** A dashboard page, Web Traffic (GA4), for exploring any connected client's GA4 traffic by channel, date range, comparison and view, with a Download button that saves a standalone BBT-style report.

**Architecture:** Pure shared modules (`ga4Channels`, `ga4Dates`, `ga4Report`, `ga4View`) hold all of the logic and are unit-tested. `ga4Client` does the GA I/O with the `lilikoi-reporting` service account. Two guarded API routes (`/api/ga4/properties`, `/api/ga4/report`) cache through `serverCache`. A client page fetches one normalized report per property/range/compare/granularity, and does all view switching locally through `selectView`. The download generator uses the same `selectView` output.

**Tech Stack:** Next.js 14 app router, `googleapis` (analyticsadmin v1beta, analyticsdata v1beta), Recharts, vitest, Chart.js 4.4.1 (cdnjs, download only).

**Spec:** `docs/superpowers/specs/2026-11-18-ga4-web-traffic-reports-design.md` (read it; channel table, definitions, response shape and page sketch live there). Visual target for the download: `docs/superpowers/specs/assets/bbt-web-traffic-oct-2026-example.html`.

## Global Constraints

- Work directly on `main`; no branches or worktrees. Commit after each task; Frank pushes.
- Auth env var: `GA4_SA_KEY` (single-quoted JSON in `.env`, same format as `GOOGLE_SHEETS_SA_KEY`). Scope: `https://www.googleapis.com/auth/analytics.readonly`.
- Channel dimension: `sessionPrimaryChannelGroup`. The users metric is `activeUsers`, exposed as `users` and labeled "Users".
- Metric set `M` = `{ users, newUsers, sessions, engagedSessions, engagementRate, keyEvents }`. GA names: `activeUsers, newUsers, sessions, engagedSessions, engagementRate, keyEvents`.
- View keys: `organic`, `nonPaid`, `paid`, `all`. Labels: "Organic search", "All non-paid", "Paid", "Everything".
- Totals for a view always come from a GA request filtered to that view's channels. Never add up channel rows to get users.
- API routes use `getAllowedSession()` from `src/lib/routeAuth.js`, returning 401 when it reports an error.
- No new npm dependencies.
- Download: Chart.js `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js` and the Archivo Google Font are the only external URLs. All data is inlined. The untagged-paid warning is never included.

## Review Focus

1. **A view or comparison range with zero rows** (new property, Paid view for a client with no ads, YoY before the property existed). Expect zeros and "—" deltas, never NaN, Infinity or a crash. Tests: Task 3 `normalizes empty responses`, Task 4 `delta is null when compare value is 0`.
2. **A channel GA returns that isn't in the bucket table** (e.g. "Organic Video" variants, future channels). Expect it shown under its own name and counted only in `all`. Tests: Task 1 `unknown channel buckets to unassigned`, Task 4 `unknown channel only appears in all`.
3. **Custom ranges crossing a year or including Feb 29**, and "Last month" in January. Expect correct comparison ranges. Tests: Task 2.
4. **Property IDs not visible to the service account, or tampered query params.** Expect 403/400, with no GA call. Tests: Task 5.
5. **A client name or page path containing `<`, `&` or quotes in the download.** Expect escaped HTML and no broken page or script injection. Test: Task 6 `escapes property name and page paths`.

---

### Task 1: Channel buckets, views and definitions

**Files:**
- Create: `src/lib/ga4Channels.js`
- Test: `src/__tests__/lib/ga4Channels.test.js`

**Interfaces:**
- Produces:
  - `BUCKETS` = `{ organic: ['Organic Search'], otherNonPaid: [...], paid: [...] }`, copied exactly from the spec's "Channel buckets" table.
  - `bucketFor(channel: string) -> 'organic'|'otherNonPaid'|'paid'|'unassigned'`
  - `VIEWS` = `[{ key:'organic', label:'Organic search', buckets:['organic'] }, { key:'nonPaid', label:'All non-paid', buckets:['organic','otherNonPaid'] }, { key:'paid', label:'Paid', buckets:['paid'] }, { key:'all', label:'Everything', buckets:['organic','otherNonPaid','paid','unassigned'] }]`
  - `channelsForView(viewKey) -> string[] | null`: the known channel names for the view; `null` for `all` (no filter).
  - `inView(channel, viewKey) -> boolean`
  - `CHANNEL_DEFINITIONS: Array<{ name, text }>`, using the exact wording from the spec's "Channel definitions" section, in that order.
  - `isSuspectedPaid(sourceMedium: string, bucket) -> boolean`: always false when the bucket is `paid`. Otherwise true if the source matches `/facebook|instagram|\bfb\b|\big\b|meta|tiktok|linkedin/i` and the medium matches `/cpc|ppc|paid|ads|cpm/i`, or if the medium alone matches `/^(cpc|ppc|paid)$/i`. `sourceMedium` has the GA format `"source / medium"`.
  - `CHANNEL_COLORS: Record<string,string>`: one stable color per known channel, plus `fallback`, so the in-app chart and the download match.

- [ ] **Step 1: Write the failing tests**

```js
import { bucketFor, VIEWS, channelsForView, inView, isSuspectedPaid, CHANNEL_DEFINITIONS } from '@/lib/ga4Channels';

it('buckets known channels', () => {
  expect(bucketFor('Organic Search')).toBe('organic');
  expect(bucketFor('Direct')).toBe('otherNonPaid');
  expect(bucketFor('AI Assistant')).toBe('otherNonPaid');
  expect(bucketFor('Cross-network')).toBe('paid');
  expect(bucketFor('Unassigned')).toBe('unassigned');
});
it('unknown channel buckets to unassigned', () => {
  expect(bucketFor('Something New')).toBe('unassigned');
  expect(inView('Something New', 'nonPaid')).toBe(false);
  expect(inView('Something New', 'all')).toBe(true);
});
it('views', () => {
  expect(VIEWS.map(v => v.key)).toEqual(['organic', 'nonPaid', 'paid', 'all']);
  expect(channelsForView('organic')).toEqual(['Organic Search']);
  expect(channelsForView('all')).toBeNull();
  expect(channelsForView('nonPaid')).toContain('Direct');
  expect(channelsForView('nonPaid')).not.toContain('Unassigned');
});
it('flags untagged paid social', () => {
  expect(isSuspectedPaid('facebook / cpc', 'otherNonPaid')).toBe(true);
  expect(isSuspectedPaid('ig / paid', 'otherNonPaid')).toBe(true);
  expect(isSuspectedPaid('google / cpc', 'otherNonPaid')).toBe(true);
  expect(isSuspectedPaid('facebook.com / referral', 'otherNonPaid')).toBe(false);
  expect(isSuspectedPaid('facebook / cpc', 'paid')).toBe(false);
  expect(isSuspectedPaid('instagram / social', 'otherNonPaid')).toBe(false);
});
it('has a definition for Organic Search using the BBT wording', () => {
  expect(CHANNEL_DEFINITIONS[0].name).toBe('Organic Search');
  expect(CHANNEL_DEFINITIONS[0].text).toMatch(/unpaid result on Google, Bing/);
});
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/__tests__/lib/ga4Channels.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/lib/ga4Channels.js`.** Pure ESM with no imports, so client components can use it too.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/lib/ga4Channels.js src/__tests__/lib/ga4Channels.test.js && git commit -m "feat(ga4): channel buckets, views and definitions"`

### Task 2: Date presets, comparison ranges, granularity and labels

**Files:**
- Create: `src/lib/ga4Dates.js`
- Test: `src/__tests__/lib/ga4Dates.test.js`

**Interfaces:**
- Produces (all dates are `'YYYY-MM-DD'` strings; date math is done in UTC on those strings, never on local `Date` parsing):
  - `PRESETS = [{key:'this_month',label:'This month'},{key:'last_month',label:'Last month'},{key:'last_7',label:'Last 7 days'},{key:'last_28',label:'Last 28 days'},{key:'last_90',label:'Last 90 days'},{key:'ytd',label:'Year to date'},{key:'custom',label:'Custom'}]`
  - `presetRange(key, today: 'YYYY-MM-DD') -> { startDate, endDate } | null`. `last_N` ends yesterday and covers N days. `this_month` and `ytd` end today. `custom` returns null.
  - `compareRange({ startDate, endDate }, mode: 'prev'|'yoy'|'none') -> { startDate, endDate } | null`, following the spec's rules (a full calendar month → the previous full month; YoY Feb 29 → Feb 28).
  - `autoGranularity({ startDate, endDate }) -> 'day'|'week'|'month'`: day if ≤ 92 days inclusive, week if ≤ 366, month otherwise.
  - `isValidRange({ startDate, endDate }) -> boolean`: valid format and real dates, start ≤ end, span ≤ 3×366 days.
  - `rangeLabel({ startDate, endDate }) -> string`: `'Oct 2026'` for a full month, otherwise `'Oct 3 – Nov 2, 2026'` (or with both years when they differ).

- [ ] **Step 1: Write the failing tests**

```js
import { presetRange, compareRange, autoGranularity, isValidRange, rangeLabel } from '@/lib/ga4Dates';

it('last_month in January', () => {
  expect(presetRange('last_month', '2026-01-15')).toEqual({ startDate: '2025-12-01', endDate: '2025-12-31' });
});
it('last_28 ends yesterday', () => {
  expect(presetRange('last_28', '2026-11-18')).toEqual({ startDate: '2026-10-21', endDate: '2026-11-17' });
});
it('prev of a full month is the previous full month', () => {
  expect(compareRange({ startDate: '2026-03-01', endDate: '2026-03-31' }, 'prev')).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' });
});
it('prev of an arbitrary range is the same length ending the day before', () => {
  expect(compareRange({ startDate: '2026-01-01', endDate: '2026-01-10' }, 'prev')).toEqual({ startDate: '2025-12-22', endDate: '2025-12-31' });
});
it('yoy maps Feb 29 to Feb 28', () => {
  expect(compareRange({ startDate: '2028-02-01', endDate: '2028-02-29' }, 'yoy')).toEqual({ startDate: '2027-02-01', endDate: '2027-02-28' });
});
it('none', () => { expect(compareRange({ startDate: '2026-10-01', endDate: '2026-10-31' }, 'none')).toBeNull(); });
it('granularity', () => {
  expect(autoGranularity({ startDate: '2026-08-01', endDate: '2026-10-31' })).toBe('day');
  expect(autoGranularity({ startDate: '2026-01-01', endDate: '2026-10-31' })).toBe('week');
  expect(autoGranularity({ startDate: '2024-01-01', endDate: '2026-10-31' })).toBe('month');
});
it('validates ranges', () => {
  expect(isValidRange({ startDate: '2026-10-31', endDate: '2026-10-01' })).toBe(false);
  expect(isValidRange({ startDate: '2026-02-30', endDate: '2026-03-01' })).toBe(false);
  expect(isValidRange({ startDate: '2020-01-01', endDate: '2026-01-01' })).toBe(false);
  expect(isValidRange({ startDate: '2026-10-01', endDate: '2026-10-31' })).toBe(true);
});
it('labels', () => {
  expect(rangeLabel({ startDate: '2026-10-01', endDate: '2026-10-31' })).toBe('Oct 2026');
  expect(rangeLabel({ startDate: '2025-12-20', endDate: '2026-01-05' })).toBe('Dec 20, 2025 – Jan 5, 2026');
});
```

- [ ] **Step 2: Run and confirm fail.** `npx vitest run src/__tests__/lib/ga4Dates.test.js`
- [ ] **Step 3: Implement `src/lib/ga4Dates.js`.** Pure, no imports.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit.** `feat(ga4): date presets, comparison ranges and labels`

### Task 3: GA request builder, response normalizer and client

**Files:**
- Create: `src/lib/ga4Report.js` (pure: build requests, normalize responses)
- Create: `src/lib/ga4Client.js` (I/O: auth, listProperties, fetchTrafficReport)
- Create: `src/__tests__/fixtures/ga4/` (recorded batch responses, trimmed)
- Test: `src/__tests__/lib/ga4Report.test.js`

**Interfaces:**
- Consumes: `channelsForView`, `bucketFor`, `isSuspectedPaid` (Task 1); `compareRange` (Task 2).
- Produces:
  - `buildReportRequests({ startDate, endDate, compareRange, granularity }) -> object[]`: 8 GA `RunReportRequest` bodies in this fixed order. Each one uses date ranges `[{…, name:'current'}, {…, name:'compare'}]` (or only current when there's no comparison), except series, sources and pages, which use current only:
    0. `channels`: dim `sessionPrimaryChannelGroup`, all 6 metrics
    1–4. `total:organic|nonPaid|paid|all`: no dims, all 6 metrics, `dimensionFilter` = `inListFilter` on `sessionPrimaryChannelGroup` with `channelsForView(key)` (`all` has no filter)
    5. `series`: dims `[timeDim, sessionPrimaryChannelGroup]` where timeDim = `date` | `isoYearIsoWeek` | `yearMonth`; metrics `activeUsers`; limit 100000
    6. `sources`: dims `sessionSourceMedium, sessionPrimaryChannelGroup`; metrics `sessions, activeUsers`; order by sessions desc; limit 1000. (This deliberately differs from the spec's "top 100", so that every view still has a full top 25 after filtering on the client.)
    7. `pages`: dims `landingPage, sessionPrimaryChannelGroup`; metrics `sessions, activeUsers, keyEvents`; order by sessions desc; limit 500
  - `normalizeTrafficReport(reports: GA RunReportResponse[8], ctx: { property, range, compareRange, granularity }) -> TrafficReport`: the exact response shape in the spec. Plus:
    - `series.labels` covers every bucket in the range: day `'Oct 1'`, week `'Wk of Oct 6'` (the ISO Monday, computed from `isoYearIsoWeek`), month `'Oct 2026'`. Missing values are filled with 0. `series.byChannel` only includes channels that have data.
    - `channels` is sorted by current sessions desc. `bucket` comes from `bucketFor`.
    - `sources[].suspectedPaid` comes from `isSuspectedPaid`.
    - `warnings` gets one string summarizing suspected-paid sessions per channel (when > 0), plus `"GA grouped some rows into (other)"` if any report's `metadata.dataLossFromOtherRow`, plus `"GA sampled this data"` if any report has `metadata.samplingMetadatas`.
    - GA returns metric values as strings. Convert to numbers; `engagementRate` stays a 0–1 fraction.
  - `ga4Client.js`:
    - `getGa4Auth() -> JWT`: throws `'GA4_SA_KEY env var not set'` or `'GA4_SA_KEY is not valid JSON'`.
    - `listProperties() -> Promise<Array<{ id:'properties/N', name, account }>>`: Admin API `accountSummaries.list` with pageSize 200, follows `nextPageToken`, sorted by account then name.
    - `fetchTrafficReport({ property, startDate, endDate, compare, granularity }) -> Promise<TrafficReport>`: computes `compareRange`, builds the 8 requests, sends them as two `properties.batchRunReports` calls in parallel (`[0..4]`, `[5..7]`), and normalizes. `property.name` / `account` come from the caller.

- [ ] **Step 1: Record fixtures.** Write a one-off script (not committed) that calls the real `batchRunReports` with `buildReportRequests` for Semper Solaris - GA4 (`properties/349447933`), Oct 1–31 2026, compare `prev`, granularity `day`. Save the two responses as `src/__tests__/fixtures/ga4/semper-oct-2026.json`, keeping only 5 days of series rows and 20 source/page rows. These fixtures don't exist until Step 3 creates `buildReportRequests`, so do Step 3's builder first, then record. Also add `empty.json`: 8 reports with no `rows` and `rowCount: 0`.
- [ ] **Step 2: Write the failing tests**

```js
import { buildReportRequests, normalizeTrafficReport } from '@/lib/ga4Report';
import semper from '../fixtures/ga4/semper-oct-2026.json';
import empty from '../fixtures/ga4/empty.json';
const ctx = { property: { id: 'properties/349447933', name: 'Semper Solaris - GA4', account: 'Semper Solaris' },
  range: { startDate: '2026-10-01', endDate: '2026-10-31' }, compareRange: { startDate: '2026-09-01', endDate: '2026-09-30' }, granularity: 'day' };

it('builds 8 requests with view filters', () => {
  const r = buildReportRequests({ ...ctx.range, compareRange: ctx.compareRange, granularity: 'week' });
  expect(r).toHaveLength(8);
  expect(r[1].dimensionFilter.filter.inListFilter.values).toEqual(['Organic Search']);
  expect(r[4].dimensionFilter).toBeUndefined();
  expect(r[5].dimensions[0].name).toBe('isoYearIsoWeek');
  expect(r[5].dateRanges).toHaveLength(1);
});
it('normalizes real responses', () => {
  const out = normalizeTrafficReport(semper.reports, ctx);
  expect(out.totalsByView.all.users).toBeGreaterThan(out.totalsByView.nonPaid.users);
  expect(typeof out.channels[0].current.sessions).toBe('number');
  expect(out.channels[0].current.sessions).toBeGreaterThanOrEqual(out.channels[1].current.sessions);
  expect(out.series.labels).toHaveLength(31);
  expect(out.series.labels[0]).toBe('Oct 1');
  expect(out.totalsByViewCompare).not.toBeNull();
});
it('normalizes empty responses', () => {
  const out = normalizeTrafficReport(empty.reports, ctx);
  expect(out.totalsByView.organic).toEqual({ users: 0, newUsers: 0, sessions: 0, engagedSessions: 0, engagementRate: 0, keyEvents: 0 });
  expect(out.channels).toEqual([]);
  expect(out.series.labels).toHaveLength(31);
});
it('labels ISO weeks by Monday', () => {
  // build a minimal series report with isoYearIsoWeek '202641' → Monday Oct 5 2026
  // expect label 'Wk of Oct 5'
});
```

  (Fill in the last test inline with a hand-built report object: one row `['202641','Direct']` with value `'10'`, range Oct 5–11 2026.)

- [ ] **Step 3: Implement `ga4Report.js`, record the fixtures (Step 1), then implement `ga4Client.js`.**
- [ ] **Step 4: Run and confirm pass.** `npx vitest run src/__tests__/lib/ga4Report.test.js`
- [ ] **Step 5: Commit.** `feat(ga4): GA request builder, normalizer and service-account client`

### Task 4: View selector (shared by the page and the download)

**Files:**
- Create: `src/lib/ga4View.js`
- Test: `src/__tests__/lib/ga4View.test.js`

**Interfaces:**
- Consumes: `TrafficReport` (Task 3); `inView`, `VIEWS` (Task 1).
- Produces:
  - `delta(cur: number, prev: number|null) -> number|null`: fractional change. Null when `prev` is null or 0.
  - `selectView(report, viewKey) -> { view, totals: M, totalsCompare: M|null, deltas: Record<keyof M, number|null>, channels: Array<{ channel, bucket, current, compare, deltas }>, series: { labels, datasets: Array<{ channel, data }> }, sources: top 25 in view, pages: top 25 in view after summing page rows across the view's channels (sessions/users/keyEvents; users summed per page is labeled approximate in the UI), suspected: { sessions, byChannel } }`
  - For `engagementRate`, the delta is the **difference in points** (cur − prev), not a fraction. `deltas.engagementRate` is null without a comparison.

- [ ] **Step 1: Write the failing tests** using `normalizeTrafficReport(semper.reports, ctx)` from Task 3's fixture:

```js
it('organic view only has Organic Search', () => {
  const v = selectView(report, 'organic');
  expect(v.channels.map(c => c.channel)).toEqual(['Organic Search']);
  expect(v.totals).toEqual(report.totalsByView.organic);
  expect(v.series.datasets.map(d => d.channel)).toEqual(['Organic Search']);
});
it('unknown channel only appears in all', () => { /* inject a channel 'Brand New' into a copy of report.channels and series.byChannel */ });
it('delta is null when compare value is 0', () => { expect(delta(5, 0)).toBeNull(); expect(delta(110, 100)).toBeCloseTo(0.1); });
it('engagementRate delta is points', () => { /* totals 0.6 vs 0.5 → 0.1 */ });
it('sources and pages are filtered to the view and capped at 25', () => { /* every source in nonPaid view has bucket organic|otherNonPaid; length <= 25 */ });
```

- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement `src/lib/ga4View.js`.** Pure.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit.** `feat(ga4): view selector`

### Task 5: API routes

**Files:**
- Create: `src/app/api/ga4/properties/route.js`
- Create: `src/app/api/ga4/report/route.js`
- Test: `src/__tests__/api/ga4.test.js`

**Interfaces:**
- Consumes: `listProperties`, `fetchTrafficReport` (Task 3); `isValidRange` (Task 2); `getCached` / `setCached` from `src/lib/serverCache.js`; `getAllowedSession`.
- Produces:
  - `GET /api/ga4/properties` → `200 { properties: [...] }`. Cache key `ga4:properties`, TTL 1h. `?refresh=1` bypasses the cache (used by the page's "Refresh list" link, so newly granted clients show up immediately).
  - `GET /api/ga4/report?property=properties/N&startDate&endDate&compare=prev|yoy|none&granularity=day|week|month` → `200 TrafficReport`
  - Errors return `{ error: code, message }`: 401 `unauthorized`; 400 `bad_params` (any param missing or invalid; property must match `/^properties\/\d+$/`); 403 `no_access` (property not in `listProperties()`); 429 `quota` (GA code 429 / RESOURCE_EXHAUSTED); 500 `missing_key` when `GA4_SA_KEY` is missing; 502 `ga_error` otherwise (GA 403 → `no_access`).
  - Report cache key `ga4:report:${property}:${startDate}:${endDate}:${compare}:${granularity}`. TTL is 15 min if `endDate >= yesterday (UTC)`, otherwise 6h.
  - Both routes: `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1: Write the failing tests.** Mock `next/server`, `next-auth`, `@/lib/auth` (as in `src/__tests__/api/command-center.test.js`), `@/lib/serverCache` (getCached → null, setCached → noop) and `@/lib/ga4Client`. Cases:
  - `401 when session is not lilikoi` (getServerSession → `{user:{email:'x@gmail.com'}}`)
  - `400 for bad dates` (`startDate=2026-10-31&endDate=2026-10-01`)
  - `400 for bad compare` (`compare=lastweek`)
  - `403 when property not visible`. `listProperties` returns only `properties/1`; request `properties/2`; `fetchTrafficReport` is not called.
  - `200 passes property name/account into fetchTrafficReport`, and calls `setCached` with the key above.
  - `429 maps GA quota error`. `fetchTrafficReport` rejects with `{ code: 429 }`.
- [ ] **Step 2: Run and confirm fail.** `npx vitest run src/__tests__/api/ga4.test.js`
- [ ] **Step 3: Implement both routes.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Live smoke test.** `npm run dev`, then in a browser signed in as Frank, open `/api/ga4/properties` (expect 9 properties) and `/api/ga4/report?property=properties/548858762&startDate=2026-10-01&endDate=2026-10-31&compare=prev&granularity=day` (expect Ranger Electric data with `totalsByView.all.sessions` = 690). Stop the dev server.
- [ ] **Step 6: Commit.** `feat(ga4): properties and report API routes`

### Task 6: Downloadable report HTML

**Files:**
- Create: `src/lib/ga4ReportHtml.js`
- Test: `src/__tests__/lib/ga4ReportHtml.test.js`

**Interfaces:**
- Consumes: `selectView`, `delta` (Task 4); `VIEWS`, `CHANNEL_DEFINITIONS`, `CHANNEL_COLORS` (Task 1); `rangeLabel` (Task 2).
- Produces:
  - `generateTrafficReportHtml(report: TrafficReport, { view }) -> string`
  - `reportFilename(report) -> string`: `` `${property.name} Web Traffic - ${rangeLabel(range)}.html` ``, with characters invalid in Windows filenames (`\/:*?"<>|`) removed.
  - `downloadTrafficReport(report, { view })`: Blob + anchor download, same pattern as `downloadReportAsHtml` in `src/lib/reportHtml.js`.

Structure and styling follow the BBT example asset closely: its CSS variables and dark mode, Archivo font, `main` max-width 1040px, h1 + sub, KPI row, segmented toggle, 420px chart, table with a bold total row, definitions, source note. Differences from the example:
- The title is `` `${property.name}: Web Traffic, ${rangeLabel}` ``.
- The toggle has all 4 views, and the HTML opens on `view`.
- KPIs are Users, Sessions, New users, Engagement rate and Key events, each with a delta vs the comparison (`▲ 12% vs Sep 2026`; engagement rate in pts). Key events are hidden when 0 in both periods.
- The table columns are Channel, Users, Δ, Sessions, Δ, Engagement rate, Key events. The total row uses the deduplicated view totals and is labeled "Total (unique users)".
- Below the table are "Top sources" and "Top landing pages" tables (top 15 each).
- Data for all 4 views is inlined as one JSON blob, built from `selectView` once per view. The toggle re-renders KPIs, chart and tables from it.
- If `window.Chart` is undefined after load, the chart box is replaced with the text "Chart needs an internet connection; all figures are in the tables below."
- The source note reads: "Source: Google Analytics 4, Session primary channel group, {range}. Compared with {compare range}. Users are unique visitors for the whole period; the chart counts users per {day|week|month}, so someone who visits in several periods appears in each."
- Leave out `warnings` and `suspected`.
- Escape every string from GA (property name, channels, sources, page paths) when it's put into HTML. Put the JSON into the `<script>` with `<` replaced by `\u003c`.

- [ ] **Step 1: Write the failing tests** (using Task 3's fixture report):

```js
it('includes title, all views and opens on the chosen view', () => {
  const html = generateTrafficReportHtml(report, { view: 'nonPaid' });
  expect(html).toContain('Semper Solaris - GA4: Web Traffic, Oct 2026');
  for (const l of ['Organic search', 'All non-paid', 'Paid', 'Everything']) expect(html).toContain(l);
  expect(html).toMatch(/let mode\s*=\s*'nonPaid'/);
});
it('only external URLs are pinned Chart.js and Google Fonts', () => {
  const urls = generateTrafficReportHtml(report, { view: 'all' }).match(/https?:\/\/[^"')\s]+/g);
  for (const u of urls) expect(u).toMatch(/^https:\/\/(cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/4\.4\.1\/|fonts\.googleapis\.com|fonts\.gstatic\.com)/);
});
it('omits internal warnings', () => {
  const html = generateTrafficReportHtml({ ...report, warnings: ['UNTAGGED-PAID-XYZ'] }, { view: 'all' });
  expect(html).not.toContain('UNTAGGED-PAID-XYZ');
});
it('escapes property name and page paths', () => {
  const evil = { ...report, property: { ...report.property, name: 'A&B <script>x</script>' } };
  const html = generateTrafficReportHtml(evil, { view: 'all' });
  expect(html).toContain('A&amp;B &lt;script&gt;');
  expect(html).not.toContain('<script>x</script>');
});
it('filename', () => { expect(reportFilename(report)).toBe('Semper Solaris - GA4 Web Traffic - Oct 2026.html'); });
```

  (The `let mode` regex fixes the name of the in-file state variable. Keep it.)
- [ ] **Step 2: Run and confirm fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass. Then write the fixture's HTML to the scratchpad and open it in a browser.** Check light and dark, the view toggle, and the narrow-width layout.
- [ ] **Step 5: Commit.** `feat(ga4): downloadable web traffic report`

### Task 7: Dashboard page and navigation

**Files:**
- Create: `src/app/dashboard/google/analytics/page.js` (state, URL sync, fetching, layout)
- Create: `src/app/dashboard/google/analytics/components/` with `PropertyPicker.jsx`, `RangeControls.jsx`, `ViewToggle.jsx`, `KpiRow.jsx`, `TrafficChart.jsx`, `ChannelTable.jsx`, `SourcesAndPages.jsx`, `ChannelDefinitions.jsx`
- Modify: `src/app/dashboard/components/DashboardIcons.jsx` (add `AnalyticsIcon`, a simple bar-chart glyph in the same style as its neighbors)
- Modify: `src/app/dashboard/components/DashboardSidebar.jsx:25-31` and `src/app/dashboard/components/MobileNavSheet.jsx` (add `{ href: "/dashboard/google/analytics", label: "Web Traffic (GA4)" }` right after Google Organic)
- Modify: `src/app/dashboard/page.js` (tile after "Google Search Organic", tag "Organic", desc "GA4 website traffic by channel: organic vs paid, any date range, with period comparisons and downloadable client reports.")
- Modify: `src/app/api/admin/usage/route.js:13` (map `/dashboard/google/analytics` → `"Web Traffic (GA4)"`)
- Test: `src/__tests__/dashboard/Ga4Components.test.jsx`

**Interfaces:**
- Consumes: the API routes (Task 5), `selectView` / `delta` (Task 4), `PRESETS` / `presetRange` / `autoGranularity` / `rangeLabel` (Task 2), `VIEWS` / `CHANNEL_DEFINITIONS` / `CHANNEL_COLORS` (Task 1), `downloadTrafficReport` (Task 6).
- Components are presentational and take `selectView` output, e.g. `<KpiRow totals deltas compareLabel />`, `<ChannelTable channels totals hasCompare />`, `<TrafficChart series />`.

Page behavior (see the spec's page sketch and Behavior list):
- Follow `src/app/dashboard/google/organic/page.js` for the session guard (`useSession` → redirect to `/?callbackUrl=/dashboard/google/analytics`), `DashboardToolHeader` (icon `AnalyticsIcon`, title "Web Traffic (GA4)", subtitle "Google Analytics traffic by channel"), `DashboardLoader`, `MobileFilterSheet` for the controls on mobile, and theme CSS variables from `globals.css`.
- URL params: `property, range (preset key), start, end (custom only), compare, view, gran`. Defaults: the last property from localStorage (`ga4:lastProperty`, wrapped in try/catch), otherwise the first property; `range=last_month`, `compare=prev`, `view=nonPaid`, `gran` = `autoGranularity`. Use `router.replace` when params change (no history spam).
- PropertyPicker: a searchable list grouped by account, plus a "Refresh list" link that calls `?refresh=1`.
- The fetch is keyed on property/start/end/compare/gran. Abort an in-flight request when the key changes (AbortController), so a slow earlier response can't overwrite a newer one. Keep a module-level `Map` cache of responses for the session.
- View toggle, chart legend clicks (hide/show a channel) and table sorting are local state only.
- KPI deltas: green ▲ / red ▼; "—" when null. Engagement rate is shown as `58.2%` with `▼ 1.1 pts`.
- The warnings banner (amber) lists `report.warnings`. When `selectView(...).suspected.sessions > 0`, a "See sources" link scrolls to the sources table, where suspected rows get a "Likely paid" tag.
- Pages table header: "Users (approx.)".
- Empty and error states (exact copy):
  - No properties: "No Google Analytics properties are connected yet. Ask the client's GA admin to add lilikoi-reporting@lilikoi-ads-analytics.iam.gserviceaccount.com as a Viewer (Admin → Account access management), then click Refresh list."
  - `no_access`: "lilikoi-reporting doesn't have access to this property anymore."
  - `quota`: "Google Analytics is rate-limiting us. Try again in a minute."
  - `missing_key`: "GA4_SA_KEY isn't set on this server."
  - No data: "No traffic recorded for this range."
- The Download button is disabled while loading or when there's no data. It calls `downloadTrafficReport(report, { view })`.

- [ ] **Step 1: Write failing component tests** (jsdom, React Testing Library, as in `src/__tests__/dashboard/DashboardToolHeader.test.jsx`):
  - `KpiRow shows — for null deltas and pts for engagement rate`
  - `ChannelTable renders total row labeled "Total (unique users)" using totals, not the sum of rows` (rows 10 + 10 users, totals.users 15 → shows 15)
  - `SourcesAndPages tags suspected rows "Likely paid"`
  - Update `src/__tests__/dashboard/DashboardSidebar.test.jsx`: `renders nav links for all main tools` now also expects "Web Traffic (GA4)".
- [ ] **Step 2: Run and confirm fail.** `npx vitest run src/__tests__/dashboard/Ga4Components.test.jsx src/__tests__/dashboard/DashboardSidebar.test.jsx`
- [ ] **Step 3: Implement the components, page, icon and nav entries.**
- [ ] **Step 4: Run the full suite.** `npm test`. Expected: all pass. Then `npm run lint`: no new errors.
- [ ] **Step 5: Verify in the browser.** `npm run dev` and open `/dashboard/google/analytics`. Check:
  - Ranger Electric, Last month: KPIs and chart render.
  - Switch to Semper Solaris and change views: no network request on a view switch (DevTools Network).
  - YoY comparison and a custom range of more than 92 days (week bars) both work.
  - Reload with the URL: the same screen comes back.
  - Download: the file opens and matches the screen.
  - Mobile width (390px): the filter sheet works and there's no horizontal scroll.
  - Dark mode.
- [ ] **Step 6: Commit.** `feat(ga4): Web Traffic (GA4) dashboard page`

### Task 8: Parity check and deployment notes

**Files:**
- Create: `docs/ga4-web-traffic-setup.md`

- [ ] **Step 1: Parity check.** For Semper Solaris - GA4 and Ranger Electric, Oct 1–31 2026, compare the page's channel table (Everything view) with GA4's Traffic acquisition report (Session primary channel group) for **Users and Sessions per channel**. They must match exactly. A script against `/api/ga4/report` output is fine for our side. Frank, or a browser session, reads GA's side. If something doesn't match, stop and debug before continuing.
- [ ] **Step 2: Write `docs/ga4-web-traffic-setup.md`** (short): what the page does; the service account email; how to connect a new client (the GA admin adds it as Viewer at the account level, Notify unticked, then click Refresh list); the `GA4_SA_KEY` Vercel env var (paste the raw JSON with no wrapping quotes, Production + Preview, then redeploy); why Users is `activeUsers`; and Unassigned handling.
- [ ] **Step 3: Commit.** `docs: GA4 web traffic setup`
- [ ] **Step 4: Remind Frank** to add `GA4_SA_KEY` in Vercel before pushing, and to delete `C:\Users\frank\Downloads\lilikoi-ads-analytics-888265baa904.json`.
