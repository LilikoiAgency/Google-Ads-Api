# SEO Audit Reputation & Web Search Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google reviews (Places API, phase 1) and a capped Claude web-search check to SEO Audit v2, turned into a reputation pass, a Reputation tab and a report section.

**Architecture:** Two new job steps (`search`, `pass:reputation`) slot into the existing resumable pipeline; reviews are a new gather source. Raw public review text lives only in a TTL'd Mongo cache keyed by job id; the job keeps computed stats. The search runs as its own unstructured Claude call (web search can't be combined with structured output); the reputation pass is a normal structured pass.

**Tech Stack:** Next.js 14 App Router, MongoDB driver, Vitest, `@anthropic-ai/sdk` 0.80, Google Places API (New) over `fetch`.

**Spec:** `docs/superpowers/specs/2026-11-19-seo-audit-reputation-design.md`

## Global Constraints

- Model `AUDIT_MODEL` (`claude-opus-5-5`) via the existing key resolution in `src/lib/seoAuditV2/llm.js`; streaming + `server-side-fallback-2026-07-01` / `fallbacks: 'default'` like `runStructured`; usage logged with `feature: 'seo_audit_v2'`.
- Web search tool: `{ type: 'web_search_20260209', name: 'web_search', max_uses }`. No `output_config.format` on that call.
- Max 8 search queries (6 buyer + 2 brand); `max_uses` = queries + 2; `pause_turn` resumed at most 2 times; effort `medium`.
- Max 10 locations per audit. Managed reviews (phase 2) last 12 months, cap 150 per location.
- Places key: env `PLACES_API_KEY`. Missing key → source status `not_connected`.
- Public (Places) review text is never written to the job or result; it lives in `tokensApi.SeoAuditPlacesCache` with a 24h TTL and is deleted when the job finishes `done`. Saved picks and `options.locations` hold only `{ source, id, name }`.
- Quick audits: reviews only. `search` and `pass:reputation` are created already `done` with `skipped: true`; no extra Claude calls.
- Client-facing text never names an AI model or vendor (existing `NO_AUTOMATION` rule). The search section is labelled "What a web search finds" with the note "A web search run during this audit, not Google rankings." It shows appear / not appear only, never a position.
- Public data shown anywhere carries "Source: Google reviews".
- No live Claude calls and no full audit runs during the build. All tests mock `fetch`, `googleapis`, Mongo and the Anthropic client.
- Work on `main`. Commit messages have no AI attribution and no Co-Authored-By trailer.
- Test command: `npx vitest run <path>`. Full suite has 2 known failures in `googleAdsAudit.test.js`, unrelated.

## Review Focus

1. **Jobs created before this change** (no `search` / `pass:reputation` steps) must keep advancing and render with no reputation tab. → Task 1 test `old job without new steps still runs and finishes`.
2. **Prospect with no matching Google listing** (no place whose website matches the domain) → reviews gap `no_data`, audit continues, search still runs. → Task 4 test `no matching place gives no_data`.
3. **Places key missing on Vercel** → `not_connected` gap with plain wording, no crash. → Task 3 test `missing key is not_connected`, Task 9 gap wording test.
4. **Retry of a failed job after the 24h cache expired** → reputation pass runs on stats and search only, never fails for missing review text. → Task 7 test `reputation input without cached review text`.
5. **Brand-only Search Console data** (every top query contains the brand) → buyer queries fall back to service × city, still ≤ 8 total. → Task 6 test `falls back to services when all queries are brand`.

---

### Task 1: Job steps for search and reputation

**Files:**
- Modify: `src/lib/seoAuditV2/jobs.js`
- Modify: `src/lib/seoAuditV2/advance.js` (`STEP_LABELS`, `toProgress`)
- Test: `src/__tests__/lib/seoAuditV2/jobs.test.js`

**Interfaces:**
- Produces: `STEP_KEYS` = `['crawl','gather','search','pass:technical','pass:content','pass:local','pass:conversion','pass:reputation','synthesize']`; `newJob({ email, domain, auditType, now })` marks `search` and `pass:reputation` `{ status: 'done', skipped: true }` when `auditType === 'quick'`; step lookup treats a missing `search` / `pass:reputation` step as `{ status: 'done', skipped: true }`.

- [ ] **Step 1: Write failing tests** in `jobs.test.js`:
  - `quick jobs pre-skip search and reputation`: `newJob({..., auditType: 'quick'})` → those two steps `status 'done'`, `skipped true`; full job → both `pending`.
  - `search runs alongside passes after gather; reputation waits for search`: full job with crawl+gather done → `runnableSteps` contains `'search'` and the four old passes but not `'pass:reputation'`; after `search` is `done` (or `failed_final`) → `'pass:reputation'` is runnable.
  - `search failing does not fail the job`: search `failed_final`, all passes done, synthesize done → `jobStatus` is `'done'`.
  - `old job without new steps still runs and finishes`: a job whose `steps` lack both new keys → `runnableSteps` after gather returns the old passes, and with everything done `jobStatus` is `'done'`.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/lib/seoAuditV2/jobs.test.js` → the new tests fail.
- [ ] **Step 3: Implement** in `jobs.js`: new `STEP_KEYS`; `PASS_AREA['pass:reputation'] = 'Reputation'`; `find` returns `{ key, status: 'done', skipped: true }` for a missing optional step (`search`, `pass:reputation`) and still throws for others; in `runnableSteps` the post-gather group is `['search', ...PASS_KEYS]` minus done/failed_final, with `pass:reputation` excluded until `search` is `done` or `failed_final`; `jobStatus` keeps only `crawl`/`gather`/`synthesize` fatal. In `advance.js`: labels `search: 'Searching the web for the business'`, `'pass:reputation': 'Reviews & reputation'`; `toProgress` omits steps with `skipped: true`.
- [ ] **Step 4: Run** the jobs tests and `src/__tests__/lib/seoAuditV2` → all pass.
- [ ] **Step 5: Commit** `feat(seo-v2): search and reputation job steps; quick audits skip them`

### Task 2: Location options and saved picks

**Files:**
- Modify: `src/lib/seoAuditV2/options.js`
- Create: `src/lib/seoAuditV2/reputationStore.js`
- Test: `src/__tests__/lib/seoAuditV2/options.test.js`, `src/__tests__/lib/seoAuditV2/reputationStore.test.js`

**Interfaces:**
- Produces: `parseAuditOptions(raw, domain)` accepts `raw.locations: [{ source: 'gbp'|'places', id, name }]` → `options.locations` (max `MAX_LOCATIONS = 10`; `places` id `/^[A-Za-z0-9_-]{10,}$/`, `gbp` id `/^locations\/\d+$/`; name trimmed to 200; duplicates by id dropped; bad entry → `{ error: 'Pick locations from the list.' }`); `locations` alone makes options non-null.
- Produces (`reputationStore.js`, db `tokensApi`):
  - `getSavedLocations(domain) -> Promise<{ source, id, name }[] | null>` (collection `SeoAuditLocations`, keyed by bare domain)
  - `saveLocations(domain, locations) -> Promise<void>` (upsert, `updatedAt`)
  - `saveReviewTexts(jobId, byLocation) -> Promise<void>` (collection `SeoAuditPlacesCache`, doc `{ jobId, byLocation, createdAt }`, ensures TTL index `{ createdAt: 1 }, { expireAfterSeconds: 86400 }`)
  - `getReviewTexts(jobId) -> Promise<Record<id, Review[]> | null>`
  - `dropReviewTexts(jobId) -> Promise<void>`
  - `Review` = `{ stars: number, date: 'YYYY-MM-DD', text: string, replied?: boolean }`

- [ ] **Step 1: Write failing tests**: options — `locations parsed and capped at 10`, `rejects malformed location id`, `locations alone is an option`. Store (mock `../mongoose` like `jobStore` tests do) — `saveLocations upserts by bare domain` (`www.X.com` → `x.com`), `saveReviewTexts creates the TTL index once`, `getReviewTexts returns null when expired/missing`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement** both files. `describeOptions` adds "N locations" when set.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(seo-v2): location picks in audit options; saved picks and review cache store`

### Task 3: Places API client

**Files:**
- Create: `src/lib/seoAuditV2/places.js`
- Test: `src/__tests__/lib/seoAuditV2/places.test.js`

**Interfaces:**
- Produces:
  - `searchPlaces(textQuery, { bias } = {}) -> Promise<PlaceSummary[]>`; `PlaceSummary = { id, name, address, website, rating, count, mapsUrl }`. POST `https://places.googleapis.com/v1/places:searchText`, header `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri`.
  - `getPlace(id) -> Promise<PlaceDetail>`; `PlaceDetail = PlaceSummary & { city, region, reviews: Review[] }` (GET `places/{id}`, field mask adds `addressComponents,reviews`; `Review.date` from `publishTime`, `text` from `text.text`, `stars` from `rating`).
  - `resolveLocationInput(input) -> Promise<PlaceSummary[]>`: Google Maps URL (follows `maps.app.goo.gl` / `goo.gl` redirect with `redirect: 'manual'` and reads `Location`), then `place_id`/`query_place_id` param → `getPlace`; else `/maps/place/<name>/@lat,lng` → `searchPlaces(name, { bias: { lat, lng } })`; plain text → `searchPlaces(input)`. Max 5 returned.
  - `matchesDomain(website, domain) -> boolean` (bare host equality, `www.` ignored).
  - Errors: no key → throws `PlacesError` with `code: 'not_connected'`; HTTP 403 → `'permission'`; other → `'error'`.

- [ ] **Step 1: Write failing tests** with mocked `global.fetch`: `missing key is not_connected`; `searchPlaces sends the field mask and maps fields` (use the real shape from the earlier live check: `{ places: [{ id, displayName: { text }, formattedAddress, websiteUri }] }`); `getPlace maps reviews and city`; `resolves a short Maps link via its redirect`; `resolves a place_id link without searching`; `matchesDomain ignores www and trailing slash`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement** `places.js`.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(seo-v2): Places API client and Maps link resolver`

### Task 4: Reviews source in gather

**Files:**
- Create: `src/lib/seoAuditV2/reviews.js`
- Modify: `src/lib/seoAuditV2/gather.js` (`gatherAll`, `emptyData`, `describeGaps`)
- Modify: `src/lib/seoAuditV2/runStep.js` (`runGather`, `SOURCES`)
- Test: `src/__tests__/lib/seoAuditV2/reviews.test.js`, `gather.test.js`, `runStep.test.js`

**Interfaces:**
- Consumes: Task 3 `searchPlaces`, `getPlace`, `matchesDomain`; Task 2 `getSavedLocations`, `saveReviewTexts`.
- Produces:
  - `brandName(crawl, domain) -> string`: first of LocalBusiness/Organization schema `name` on the home page, `og:site_name`, home title before ` | ` / ` - ` / ` — `, else the domain's first label.
  - `reviewStats(reviews, { rating, count, coverage }, now) -> { rating, count, coverage, per_month: number|null, star_split: {1..5}|null, days_since_newest: number|null, reply_rate: number|null }` (`per_month`, `star_split`, `reply_rate` only for `coverage: 'full'`).
  - `fetchReviews({ domain, crawl, locations }) -> Promise<{ status, error?, locations: ReviewLocation[], texts: Record<id, Review[]> }>`; `ReviewLocation = { source, id, name, city, region, coverage: 'full'|'sample', stats }`. `locations` null → auto: `searchPlaces(brandName)` filtered by `matchesDomain`, max 10. None found → `status 'no_data'`.
  - `gatherAll({..., locations })` adds `data.reviews` (array of `ReviewLocation`) and returns `texts` as a third field: `{ data, gaps, reviewTexts }`.
  - `SOURCES.reviews = 'reviews'` in `runStep.js`; `runGather` passes `locations: job.options?.locations ?? await getSavedLocations(job.domain)` and calls `saveReviewTexts(job.id, reviewTexts)` when non-empty.

- [ ] **Step 1: Write failing tests**: `brandName prefers schema name`; `reviewStats sample coverage leaves per_month null`; `reviewStats full coverage computes reply_rate and per_month over 12 months` (fixed `now`); `fetchReviews auto-matches places by website and caps at 10`; `no matching place gives no_data`; `PlacesError not_connected becomes a not_connected gap` (in gather test); `runGather caches review text by job id and keeps it out of the patch` (assert `patch['data.sources'].reviews[0]` has no `reviews`/`text` keys).
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.** Reviews fetch runs in parallel with the other gather sources, wrapped in the existing `settle`/timeout helpers.
- [ ] **Step 4: Run** `src/__tests__/lib/seoAuditV2` → pass.
- [ ] **Step 5: Commit** `feat(seo-v2): Google reviews source with locations matched by website`

### Task 5: Locations API routes and saving picks on job start

**Files:**
- Create: `src/app/api/seo-audit/v2/locations/route.js` (GET `?domain=`)
- Create: `src/app/api/seo-audit/v2/locations/resolve/route.js` (POST `{ input }`)
- Modify: `src/app/api/seo-audit/v2/jobs/route.js` (save picks)
- Test: `src/__tests__/api/seoAuditV2Locations.test.js` (follow the pattern of existing route tests under `src/__tests__/api`, if any; else test handlers by importing `GET`/`POST` with mocked modules)

**Interfaces:**
- Consumes: Task 2 store, Task 3 `searchPlaces`/`resolveLocationInput`/`matchesDomain`, Task 4 nothing.
- Produces: `GET` → `{ saved: Location[]|null, found: PlaceSummary[], status }` where `found` = `searchPlaces(<domain's first label, spaced>)` + homepage-title brand search, filtered by `matchesDomain`, max 10; `status` `not_connected` when no key. `POST resolve` → `{ candidates: PlaceSummary[] }`. Same auth check as `jobs/route.js`. Jobs route calls `saveLocations(domain, options.locations)` after `createJob` when `options.locations` is set (failure logged, never blocks).

- [ ] **Step 1: Write failing tests**: `GET returns saved and found`, `GET without key reports not_connected`, `resolve returns candidates`, `jobs POST saves location picks`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(seo-v2): location lookup routes; remember picks per domain`

### Task 6: Web search check

**Files:**
- Create: `src/lib/seoAuditV2/search.js`
- Modify: `src/lib/seoAuditV2/llm.js` (export `resolveApiKey`, `estimateCost`, `usageOf`, `FALLBACK`, `CALL_TIMEOUT_MS` for reuse)
- Modify: `src/lib/seoAuditV2/runStep.js` (`runSearch`, `SOURCES.ai_search = 'aiSearch'`, dispatch `search`)
- Create: `src/__tests__/lib/seoAuditV2/fixtures/webSearch.js`
- Test: `src/__tests__/lib/seoAuditV2/search.test.js`, `runStep.test.js`

**Interfaces:**
- Consumes: Task 4 `brandName`, `data.reviews[0].city/region`.
- Produces:
  - `buildSearchQueries({ gscPages, crawl, brand, city }) -> string[]`: up to 6 buyer queries = top queries across `gscPages[].queries` by impressions, excluding any containing a brand token (brand lower-cased, split on spaces, tokens ≥ 3 chars, ignoring `company|co|inc|llc|the`), with ` <city>` appended when the query lacks the city; if fewer than 3 buyer queries, fill from home/service page H1s (pages whose path contains `service`) as `<h1> <city>`; then `"<brand> reviews"` and `"<brand>"`. De-duplicated, max 8.
  - `runWebSearch({ queries, brand, domain, city, region, email }) -> Promise<{ status: 'ok'|'error', error?, queries: [{ query, you_appear, results: [{ title, url, host }], error? }], notes }>`; one call, `tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: queries.length + 2, user_location: { type: 'approximate', city, region, country: 'US' } }]` (omit `user_location` when no city), `output_config: { effort: 'medium' }`, `max_tokens: 16000`. Results mapped from `web_search_tool_result` blocks by `tool_use_id` → the `server_tool_use.input.query`; a query with no matching tool call gets `error: 'not searched'`; error-object results set that query's `error`. `you_appear` = any result `host` bare-equals the domain. `notes` = concatenated text blocks. All queries errored → `status 'error'`. `pause_turn` → resend with the assistant content appended, at most 2 times.
  - `runSearch(job)` in runStep: never returns `ok: false` for a search/API failure; returns `{ ok: true, patch: { 'data.sources.aiSearch': value|null }, gaps? }` where failure adds a gap sentence. Only a timeout returns `ok: false` (so the step retries).

- [ ] **Step 1: Build the fixture** `webSearch.js` exporting `okResponse` (2 `server_tool_use` + 2 `web_search_tool_result` with result lists + text), `errorResultResponse` (one result is `{ type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }`), `pauseThenOk` (first `stop_reason: 'pause_turn'`, then `end_turn`), all shaped per the Claude API docs.
- [ ] **Step 2: Write failing tests**: `buildSearchQueries drops brand queries, adds city, caps at 8`; `falls back to services when all queries are brand`; `maps results to queries and computes you_appear`; `records a per-query search error`; `resumes pause_turn at most twice`; `sends web_search with max_uses and user_location`; `runSearch turns an API error into a gap, not a failed step`.
- [ ] **Step 3: Run** → fail.
- [ ] **Step 4: Implement** (mock `@anthropic-ai/sdk` the way `llm.test.js` does).
- [ ] **Step 5: Run** `src/__tests__/lib/seoAuditV2` → pass.
- [ ] **Step 6: Commit** `feat(seo-v2): capped web search check for the business and its competitors`

### Task 7: Reputation pass

**Files:**
- Modify: `src/lib/seoAuditV2/passes.js` (`PASSES`, input, prompt, schema, `ID_PREFIX`, `SYNTH_SYSTEM`: "five focused analysis passes (…, reputation)", and the GEO score line may cite the web search findings, described as a web search run during the audit)
- Modify: `src/lib/seoAuditV2/tasks.js` (category enum adds `'reputation'`)
- Modify: `src/lib/seoAuditV2/runStep.js` (`PASS_AREA.reputation`, load cached texts before building the reputation input)
- Modify: `src/lib/seoAuditV2/overview.js` (`AREA_LABELS.reputation = 'Reputation'`)
- Test: `passes.test.js`, `runStep.test.js`

**Interfaces:**
- Consumes: Task 4 `data.reviews`, Task 2 `getReviewTexts(job.id)`, Task 6 `data.aiSearch`.
- Produces: `buildPassInput('reputation', { crawl, data })` → `null` when both `data.reviews` and `data.aiSearch` are absent; else `{ brand, domain, locations: [{ name, city, source, coverage, stats, reviews }], search: { queries, notes } | null }` where `reviews` come from `data.reviewTexts[id]` (each text trimmed to 600 chars) and may be missing. `runPass` sets `data.reviewTexts = await getReviewTexts(job.id)` (null on any error) before calling `buildPassInput` for `reputation` only. `passSchema('reputation')` = findings + tasks + `themes: [{ kind: 'praise'|'complaint', theme, count, location, quotes: string[] }]` + `search_summary: { summary, competitors: string[], cited_sites: string[] }`. Task ids `REP-n`.
- Prompt rules (`PASS_SYSTEM.reputation`): counts and ratings only as given; theme `count` = number of input reviews mentioning it; quotes ≤ 1 sentence copied exactly; `coverage: 'sample'` → confidence at most medium and say "from 5 sample reviews"; describe the search as "a web search run during the audit", never as Google rankings or positions; competitors / cited sites only from the input results; never name an AI model or vendor.

- [ ] **Step 1: Write failing tests**: `reputation input is null without reviews or search`; `reputation input without cached review text` (stats only, no `reviews` key, not null); `reputation schema has themes and search_summary`; `normalizeTaskIds uses REP prefix`; runStep — `reputation pass reads cached review text by job id` (mock `reputationStore.getReviewTexts`).
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `src/__tests__/lib/seoAuditV2` → pass.
- [ ] **Step 5: Commit** `feat(seo-v2): reputation pass — review themes, search findings, tasks`

### Task 8: Result, data sources and cache cleanup

**Files:**
- Modify: `src/lib/seoAuditV2/runStep.js` (`runSynthesize`, `dataSources`)
- Modify: `src/lib/seoAuditV2/advance.js` (`finishFollowUps` drops the cache on `done`)
- Modify: `src/lib/seoAuditV2/gather.js` (`describeGaps` wording for `reviews` / `ai_search`)
- Test: `runStep.test.js`, `gather.test.js`, an `advance` test if one exists (else add `advance.test.js` with mocked store)

**Interfaces:**
- Produces `result.reputation` (absent when there are no reviews and no search):
  ```
  { locations: [{ name, city, source, coverage, stats }],
    themes: [...] | [],               // from passes.reputation, [] on quick
    search: { appear_count, total, summary, queries: [{ query, you_appear, others: string[] }] } | null,
    attribution: 'Source: Google reviews' | null }   // set when any location is source 'places'
  ```
  `others` = up to 3 result hosts that aren't the domain. `data_sources.reviews` / `data_sources.ai_search` statuses. Gap wording: reviews `not_connected` → "Google reviews: not connected (no Places API key)."; `no_data` → "Google reviews: no Google listing found that links to this website."; ai_search error → "Web search check didn't complete."
  `finishFollowUps`: when `status === 'done'`, `dropReviewTexts(job.id)` (errors logged, retried on next advance like history save).

- [ ] **Step 1: Write failing tests**: `result.reputation built from stats, themes and search`; `quick result has reputation stats and no themes`; `attribution set only for public data`; `no reputation key when neither source exists`; `describeGaps words reviews and search gaps`; `done job drops cached review text`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `src/__tests__/lib/seoAuditV2` → pass.
- [ ] **Step 5: Commit** `feat(seo-v2): reputation in the audit result; drop cached reviews when done`

### Task 9: Results view — Reputation tab and location picker

**Files:**
- Create: `src/app/dashboard/seo-audit/v2/Reputation.jsx`
- Modify: `V2Results.jsx` (tab `{ key: 'reputation', label: 'Reputation' }` shown only when `result.reputation`), `ActionPlan.jsx` (category style `reputation: { label: 'Reputation', … }` in the existing palette), `AdvancedOptions.jsx` (location picker), `ProgressSteps.jsx` (full-audit time text "usually 6–10 minutes")
- Test: `src/__tests__/dashboard/SeoAuditV2.test.jsx`

**Interfaces:**
- Consumes: Task 8 `result.reputation`; Task 5 routes; Task 2 `options.locations`.
- Produces: `Reputation({ reputation })` renders per location: name, city, rating ★, count, then for `coverage 'full'` "≈N/month · replies N% · newest N days ago", for `'sample'` "(5 sample reviews)" and a "Public data" badge, "Managed" otherwise; themes split praise / complaints with counts and one quote each; the search block titled "What a web search finds" with the note "A web search run during this audit, not Google rankings.", "You appear in X of Y searches", one row per query with ✓/✗ and `others`; `attribution` line at the bottom. AdvancedOptions: "Google Business Profiles" block per spec section 2 sketch — loads `GET /api/seo-audit/v2/locations?domain=` when the panel opens, checkboxes (prefilled from `saved`, else all `found` ticked), "Add a location" input + button calling `resolve`, candidate pick list when several; writes `adv.locations`; `toOptions`/`fromAuditOptions` carry `locations`.

- [ ] **Step 1: Write failing tests**: `Reputation tab appears only with reputation data`; `search block never shows a position and shows the not-Google-rankings note`; `public locations show the sample label and Google attribution`; `location picker prefills saved picks and sends locations in options`.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/dashboard/SeoAuditV2.test.jsx` → fail.
- [ ] **Step 3: Implement**, matching `audit.module.css` patterns (Geist, zinc, purple accent).
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Check visually** on the running dev server (port 3000; reuse it, don't start a second) by rendering a saved result fixture — no new audit run. If no existing page can show a fixture, skip and note it.
- [ ] **Step 6: Commit** `feat(seo-v2): Reputation tab and Google Business Profile location picker`

### Task 10: Downloaded / emailed report

**Files:**
- Modify: `src/lib/seoAuditReportHtml.js`
- Test: `src/__tests__/lib/seoAuditReportHtml.test.js`

**Interfaces:**
- Consumes: Task 8 `result.reputation`.
- Produces: a "Reputation" section after the plan breakdown with the same content as Task 9 (locations, themes, "What a web search finds" block with its note, attribution); omitted when `result.reputation` is absent; all text escaped with `esc`.

- [ ] **Step 1: Write failing tests**: `report includes reputation section with attribution`; `report omits reputation when absent`; `search rows show appear/not appear and no position`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the report test and the full suite `npx vitest run` → only the 2 known `googleAdsAudit` failures.
- [ ] **Step 5: Commit** `feat(seo-v2): reputation section in the downloaded and emailed report`

---

Phase 2 (Business Profile API: OAuth connect, managed locations, full reviews with replies) gets its own plan once Google approves access.
