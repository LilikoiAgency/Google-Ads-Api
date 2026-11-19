# SEO Audit v2: Reputation and AI search check

Date: 2026-11-19
Status: for approval

## Why

The SEO audit (v2) only looks at the client's own website and their own Google data: crawl, Search Console, URL Inspection, GA4 and PageSpeed. It sees nothing off the site. For the local service businesses we mostly audit (Ranger Electric, roofing, solar, turf), that leaves out two things that matter a lot:

- **Google reviews.** Rating, review count, how recent the reviews are, whether the owner replies, and what customers keep saying. These drive the map pack and whether a searcher calls.
- **What a search actually shows about the brand.** Today the GEO score ("ready for AI search") is judged from on-site signals only. Nothing checks whether a real search for "electrician Tampa Bay" or "Ranger Electric reviews" turns up the business, its competitors, or third-party lists it is missing from.

Audits are mostly run for existing clients, whose Google Business Profiles we usually manage, but they are also run for prospects where we have no access. A business can have several locations, so several profiles.

## Goals

1. Pull Google reviews for every location of the audited business.
   - Managed profiles: full review history with dates and owner replies (Business Profile API).
   - Anything else: public rating, count and up to 5 sample reviews (Places API).
2. Find locations automatically where possible; let the user confirm, remove or add locations by hand; remember the picks per domain.
3. Run a small, capped web-search check with Claude only: does the business show up for real buyer searches, who shows up instead, which sites get cited, and what is said about the brand.
4. Turn both into evidence-backed tasks and a reputation section in the results view and the emailed/downloaded report, in the same style as the rest of the audit.

## Non-goals

- Other AI engines (ChatGPT, Perplexity, Gemini, Google AI Overviews). Claude only, by decision.
- Directory citation audits (Yelp/BBB/Angi NAP consistency across the web), backlinks, competitor review comparison. Possible later with a paid data source.
- Replying to reviews or writing to Business Profiles. Read only.
- A 30/60/90-day plan. Discussed; separate piece of work.
- A new score. SEO / GEO / AEO stay; the GEO reason may now cite search evidence.

## Anti-goals (would make this a failure even if it works)

- Made-up or estimated numbers. Ratings, counts, reply rates and "you appear in X of Y searches" must come from data, computed in code, never written by the model from memory. Same evidence rule as the existing passes.
- Runaway cost. The search check is hard-capped per audit.
- A prospect audit that silently looks like a client audit. The report must say which locations used public data (5 sample reviews) versus full managed data.
- Blocking the audit. Missing keys, no locations, or failed calls become data gaps; the rest of the audit runs as today.

## Constraints

- Fits the existing job pipeline (`src/lib/seoAuditV2`): resumable steps, each with retries, statuses `ok | no_data | permission | error | not_connected`, and gaps shown to the user.
- Model: `AUDIT_MODEL` (`claude-opus-5-5`) through the existing Anthropic key and `llm.js` conventions (streaming, fallback beta, usage logging).
- **Claude web search cannot be combined with structured JSON output in one request** (citations are incompatible with `output_config.format`). So the search runs as its own call without a schema, and a separate structured pass analyses what it found.
- Web search tool: `web_search_20260209`, with `max_uses` set; handle `pause_turn` (resume a bounded number of times) and search errors that come back as an error object inside `web_search_tool_result` instead of a thrown error.
- Business Profile API is free but needs a one-time access approval from Google for the Cloud project (review takes up to about 14 days). The design must work without it.
- Places API is paid per request with a monthly free allowance; requests that include reviews are likely in Google's top price tier (smallest free allowance). Ask only for the fields needed and set a budget cap in Google Cloud.
- No live Claude calls during development (the API account is being topped up). Everything is built and tested with mocks and recorded response fixtures. The first live run is done by Frank after deploy.

## Approaches considered

**A. Two tiers chosen automatically (picked).** Business Profile API for managed locations (all reviews, replies), Places API for everything else (rating, count, 5 reviews). Manual add by Google Maps link. Claude web search check on top. Most to build, and the Business Profile tier waits on Google's approval, so it is built in two phases: Places + manual + search first, Business Profile second.

**B. Places API only.** One key, same for clients and prospects. Rejected: 5 reviews per location is too thin for sentiment, no reply data, and it wastes the management access we have for clients.

**C. Claude web search only, no Google APIs.** No new keys. Rejected: ratings and counts read from search snippets can be stale or wrong and every location can't be found reliably, which breaks the audit's rule that every number comes from real data.

## Design

### 1. Steps

New job steps, keeping today's order otherwise:

```
crawl → gather → search → pass:technical | pass:content | pass:local | pass:conversion | pass:reputation → synthesize
```

- **gather** also fetches reviews (new source `reviews`), in parallel with the existing sources.
- **search** (new step, after gather because it uses Search Console queries and the crawl) runs the Claude web-search check (new source `ai_search`). Its failure is a gap, never a failed job: it ends `done` with a gap, like a source inside gather. It gets the normal step retries for timeouts.
- **pass:reputation** (new pass) is skipped (`{ skipped: true }`) when both `reviews` and `ai_search` are unavailable, the same way `pass:conversion` is skipped without GA4.
- Older jobs without the new steps must still load and render (no reputation section).

**Quick vs full audits (Frank's decision):**
- **Full audits** get everything: reviews, the search step and the reputation pass.
- **Quick audits** get **reviews only**: rating, count and the computed stats (reviews per month, reply rate, newest review), shown in the reputation section. No `search` step and no `pass:reputation`, so no extra Claude calls. On a quick job the two steps are created already `done` with a `skipped` marker (or left out of the job's step list). Builder's call which, as long as old jobs and both audit types render.
- Location picking works the same for both types.

### 2. Finding locations

Each location is `{ source: 'gbp' | 'places', id, name, address, mapsUrl }` where `id` is the Business Profile location name (`locations/…`) or the Places `place_id`.

**Automatic, in this order:**
1. *Managed (phase 2, when Business Profile is connected):* list all locations the agency account can see; keep those whose website host matches the audited domain (`www.` ignored, same bare-host rule as `options.js`).
2. *Public:* Places Text Search for the business name (see below), keep results whose `websiteUri` host matches the domain. This naturally finds multiple locations that link to the same site. Skip any place already matched as managed (same place id; Business Profile locations expose their place id in metadata).

Business name for the search: LocalBusiness/Organization schema `name` from the crawl, else `og:site_name`, else the home page title before its separator. Builder's call on exact extraction; it already has the crawled schema blocks.

**Manual (Advanced section of the audit form):**

```
Google Business Profiles
  Found 3 locations for rangerelectricco.com:
  [x] Ranger Electric – Tampa         4.9 ★ · 212 reviews   Managed
  [x] Ranger Electric – The Villages  4.8 ★ · 87 reviews    Managed
  [ ] Ranger Lighting – Sarasota      4.7 ★ · 40 reviews    Public

  + Add a location: [ paste a Google Maps link, or "name, city" ]  [Add]
```

- The list loads when the Advanced panel opens (same pattern as the Search Console / GA4 lists), via a new route that runs the automatic matching for the typed domain.
- **Add a location** accepts a Google Maps link (including `maps.app.goo.gl` short links, which are followed to the full URL) or plain "business name, city". Either is resolved to a place with Places Text Search; if several match, show them to pick from. Locations added this way use public data unless they also match a managed location.
- Cap: 10 locations per audit (my call; keeps Places cost and prompt size bounded).
- **Remembered per domain:** picks are saved in a new Mongo collection `SeoAuditLocations` (`{ domain, locations, updatedAt }`, db `tokensApi`) when an audit starts with locations chosen, and prefilled next time. The job's `options.locations` stores the snapshot used, so "Run again" repeats it like the other options. Saved picks and job options hold only `{ source, id, name }` per location. Address, rating and counts are fetched fresh each time.
- If the user never opens Advanced, the audit uses the saved picks for the domain if any, else the automatic match.

### 3. Review data per location

Fetched in gather. Numbers are computed in code; the model only reads them.

| Field | Managed (Business Profile) | Public (Places) |
|---|---|---|
| rating, review count | yes | yes |
| reviews | last 12 months, newest first, capped at 150 per location | up to 5, Google's "most relevant" |
| per review | stars, date, text, owner replied (y/n) | stars, date, text |
| computed | reviews per month (12 mo), star split, days since newest review, reply rate | days since newest of the 5 only |

Stored per location under `data.sources.reviews` with `source` and `coverage: 'full' | 'sample'`.

**Storing public (Places) data, Frank's decision: follow Google's Maps terms strictly.**
- Raw Places content (review text, rating, count, address) is used only while the job runs. When the job finishes (synthesize done, or the job fails for good), it is removed from the job document: `data.sources.reviews` keeps only `{ source, id, name, coverage }` for public locations.
- The saved result and the emailed/downloaded report keep only our own analysis: themes with counts and short quotes (one sentence at most), task evidence, and the computed stats as of the audit date. Wherever public data appears it is labelled "Source: Google reviews" (Google attribution).
- Business Profile (managed) data is the client's own and is stored as designed.
- Builder's call: whether the cleanup runs in the synthesize step, in the job store on finish, or both. It must also cover jobs that fail. Status per the shared vocabulary; no key → `not_connected`; no locations found → `no_data`; Places/Business Profile errors → `error` with detail.

Places requests use the New Places API with a field mask limited to what is listed above. Key in env `PLACES_API_KEY`.

### 4. The Claude search check (step `search`)

**Queries (built in code, deterministic):** up to 8 in total.
- Up to 6 buyer searches: the top non-brand Search Console queries by impressions that look like service searches (exclude queries containing the brand name), each made local with the main city if it has none. Without Search Console: service names from the crawl's navigation/service pages × main city.
- 2 brand searches: `"<brand> reviews"`, `"<brand>"`.
- Main city: from the first location's address, else the crawl's contact address. Also sent as the web search tool's `user_location`.

**Call:** one request on `AUDIT_MODEL` with the `web_search_20260209` tool, `max_uses` = number of queries + 2, effort `medium`, no structured output. The prompt lists the queries and asks Claude to search each once and write, per query, short notes: is the business in the results, which competitors appear, which third-party sites appear (lists, directories, review sites), and anything said about the brand. `pause_turn` is resumed at most twice. Usage logged with label `search`.

**Stored (`data.sources.ai_search`):**
- `queries`: per query, the results taken **from the `web_search_tool_result` blocks in code** (title, URL, host), plus `you_appear: true/false` computed in code (any result host matches the domain, or a location's Maps URL/place).
- `notes`: Claude's text.
- Per-query search errors recorded; all failed → status `error`.

Cost per audit: at most 10 web searches plus one Claude call, and the reputation pass below.

### 5. Reputation pass (`pass:reputation`)

Structured pass with the same rules as the other passes (evidence quoted from the input, no generic tasks, confidence lowered for sample data). Input: per-location computed stats and reviews, the search results and notes, the brand and domain.

It returns the standard `findings` and `tasks` (category `reputation`), plus:
- `themes`: praise and complaint themes, each with how many reviews mention it and 1–2 quotes, per location or overall.
- `search_summary`: one or two sentences, plus the list of competitors and third-party sites that came up (copied from the input).

Typical tasks: reply to unanswered reviews (with count), ask for reviews where the newest is months old, fix a complaint theme on the site or in operations wording, get listed on a third-party list that keeps appearing for buyer searches, add a missing location's profile link to the site.

Synthesis gets the reputation tasks like any other pass. Its GEO score reason may cite search evidence. Client text rules unchanged.

### 6. Results view and report

New "Reputation" section in the v2 results and the downloaded/emailed report, same Geist / zinc / purple style:

```
Reputation
  Ranger Electric – Tampa       4.9 ★  212 reviews  ~9/month  replies 64%  newest 3 days ago   Managed
  Ranger Electric – Villages    4.8 ★   87 reviews  (5 sample reviews)                         Public data

  What customers say     + On time, clean work (31)    − Scheduling delays (6)
  What a web search finds    You appear in 3 of 8 searches
    "electrician tampa"          ✗  Angi, Expertise.com, Smith Electric
    "panel upgrade tampa"        ✓
    ...
```

The search check uses Claude's web search, not Google, so it never shows a position or rank: only whether the business appears, plus who else does. The section is labelled "What a web search finds", with a one-line note that this is a web search run during the audit, not Google rankings. The reputation pass and the GEO score reason describe it the same way (my call).

Data gaps for `reviews` / `ai_search` appear in the existing gaps list with plain wording (for example "Google reviews: no Places API key", "Business Profile not connected, public data used").

### 7. Phases

**Phase 1:** Places API, automatic public matching, manual add, saved picks, search step, reputation pass, UI and report.

**Phase 2 (after Google approves Business Profile API access):** Business Profile connect (OAuth with scope `business.manage`, token stored like `GscTokens`, callback route like `/api/gsc-callback`, a connect button where Search Console is connected today), managed location listing and matching, full reviews with replies.

### 8. Setup Frank does outside the code

1. Enable Places API (New) in the existing Google Cloud project, create an API key restricted to it, add `PLACES_API_KEY` to `.env` and Vercel, and set a budget alert/cap.
2. Apply for Business Profile API access for the same project (phase 2 depends on it).

### 9. Testing

- Unit tests with mocked `fetch`, `googleapis` and Anthropic client, in the existing Vitest style under `src/__tests__/lib/seoAuditV2/`.
- The web search response is tested against a fixture built from the documented response shape (server tool use blocks, `web_search_tool_result` with a result list, an error-object result, a `pause_turn` response).
- No live Claude calls and no full audit runs during development. A live Places call is fine once the key exists, but not required.
- The first real end-to-end run is Frank's, after deploy.

## Left to the builder

- Exact Places field masks and SKUs; Maps link parsing details.
- Prompt wording for the search call and the reputation pass, within the rules above.
- How the new steps show in `ProgressSteps`.
- Component structure for the reputation section and report markup.
- Whether review text is trimmed per review to bound prompt size.
