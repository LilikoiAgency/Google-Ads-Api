# SEO Audit v2 — Analyst Pipeline — Design

Date: 2026-11-18
Status: Approved by Frank, 2026-11-18

## Intent and why

Frank ran the current SEO Audit on Big Bully Turf and called it weak: "actionable items are laughable." Evidence from that audit:

- Its #1 "critical" finding was false. It said "sitemap reports only 3 URLs". The crawler only reads the **first** child of a sitemap index (a 3-post sitemap), and the model built a critical recommendation on that bad number.
- The other items were generic ("rewrite titles", "add FAQ schema"). The audit is one request asking for 12 sections at once, capped at 5 items and 1–2 sentences per field to fit the 5-minute function limit.
- A Quick Audit sees 5 pages. Page records carry only the first 2,000 characters of content, but every image in full, so the input is large and still thin where it matters.
- It has no index status, page speed, or page-level join of Search Console queries to pages, which is what an SEO specialist actually works from.

Goal: an audit good enough that **Frank's team (or a developer) can execute it as a task list**, with a short, credible **client-facing summary** on top. Who it serves was assumed, not confirmed by Frank; he can correct this.

## Goals

1. **Correct inputs.** No finding may rest on a known-bad number. Fix the sitemap reading and make every data gap explicit.
2. **Depth.** Separate focused analysis passes, each with room to reason and write, instead of one capped mega-request.
3. **Actionable output.** A single prioritized **Action Plan**. Every task names the exact page, the evidence (real numbers), the exact change (proposed title text, missing section, schema to add), and impact and effort, so it can be handed to a developer or writer as-is.
4. **Client summary.** 3–5 sentences plus the top 3 moves, in plain language, safe to show a client.
5. **No 5-minute wall.** The audit runs as a sequence of steps, each its own request well under the function limit, with a visible progress bar.
6. **Keep what works.** Search Console and GA4 auto-matching by domain (shipped in PR #6), audit history, and the daily limit.

## Non-goals (v2)

- Competitor / SERP data (who outranks you and why). This needs a paid SERP API; it's a follow-up once v2 proves out.
- Backlink data (Ahrefs/SEMrush). There's no integration today.
- Google Business Profile API. Local signals are judged from on-site evidence only.
- Scheduling or emailing audits.
- Changing Google Ads data in the audit. It stays as today (not auto-attached).

## Anti-goals (would make this a failure even if it works)

- A recommendation built on a wrong or missing data point presented as fact. Each task must carry its evidence, and the model must say "can't verify" instead of guessing.
- Generic advice that could apply to any website ("improve content quality").
- An audit that silently drops sections or shows a half-finished result as complete.
- Losing or breaking old audits in history.
- Any mention of the AI vendor or "AI-generated" in client-facing output.

## Approaches considered

- **A. Analyst pipeline** *(chosen by Frank)*: better data, then focused passes, then one synthesis into a prioritized plan, run as resumable steps.
- **B. Same single request, stronger:** the 5-minute wall forces the same trimming, so it stays shallow.
- **C. Page-by-page only:** very actionable but weak on site-wide issues. Its per-page fix lists are folded into A's content pass.

## Design

### 1. Data layer fixes and additions (no AI)

**Crawler (`src/lib/seoCrawler.js`)**
- **Sitemaps:** read **every** child sitemap of an index (cap 50 child sitemaps and 5,000 URLs), and handle `sitemap_index.xml`, `robots.txt` `Sitemap:` lines, and plain `sitemap.xml`. Report `sitemap_url_count` (total), `sitemaps` (each child URL with its count) and the source used.
- **Page records:**
  - Keep the full text up to **8,000 characters** (up from 2,000) for content analysis.
  - Replace the full `images` list with a summary: `{ count, missing_alt, examples_missing_alt: [up to 5 src] }`.
  - Add `status_code`, `final_url` (redirects), and `response_ms` if available.
- **Page choice:** for a Full audit, the pages crawled are the union of the top Search Console pages by clicks and impressions (up to 25) plus the nav and sitemap pages, capped at 50 total. Quick stays at 5 but uses the top 5 Search Console pages when available.

**Search Console (`src/lib/seoAuditData.js`)**
- Keep the current summaries, and add a **page × query join**: for each of the top 25 pages, its top 10 queries (clicks, impressions, CTR, position).
- **URL Inspection** (`searchconsole.urlInspection.index.inspect`) for the top 20 pages: index status (`coverageState`, `verdict`), Google-chosen canonical vs declared canonical, last crawl time, mobile usability verdict. Quota: 2,000/day per property, run 5 at a time. Requires Owner or Full permission on the property; if it isn't available, record it as a data gap.
- **Sitemaps as Google sees them** (`searchconsole.sitemaps.list`): submitted sitemaps, URL counts, last read, errors and warnings. This cross-checks our own sitemap read.

**GA4:** keep the current summary, and add a per-landing-page join (organic sessions, engagement rate, key events) for the same top pages.

**Page speed (new, `src/lib/pageSpeed.js`):** Google PageSpeed Insights API v5, mobile strategy, for the top 5 pages: performance score, LCP, INP, CLS, plus real-user (CrUX) field data when present. Uses the `PAGESPEED_API_KEY` env var if set, otherwise runs keyless with a low quota. Up to 60 s per URL, run in parallel, never fatal.

**Data gaps:** every fetcher returns `{status, data}`, using the existing status vocabulary. The pipeline assembles a `data_gaps` list (for example "URL Inspection unavailable: permission", "PageSpeed timed out for /pricing"), which goes to the model and to the UI.

### 2. Analysis passes (AI)

Four focused passes run **in parallel**. Each gets only the data it needs, plus a shared context block (domain, business type inferred from the homepage, the data-gaps list):

| Pass | Input slice | Output |
|---|---|---|
| **Technical & indexing** | sitemap facts (ours + Google's), URL Inspection results, status codes and redirects, canonicals, robots, PageSpeed | findings + tasks |
| **Content & keywords** | top pages with full text, titles, metas, headings, and each page's top queries; striking-distance and low-CTR lists | **per-page fix list** (exact new title and meta text, the missing sections to add, the queries each fix targets) + tasks |
| **Local, AEO & AI search** | schema per page, NAP signals, FAQ/question headings, location pages, review markup | findings + tasks |
| **Conversion (GA4)** | per-page organic sessions, engagement, key events; channel mix and trend | findings + tasks (or one "set up lead tracking" task if key events aren't configured) |

**Task shape** (shared by all passes; validated with a schema):
```
{ id, title, category: technical|content|local|aeo|conversion,
  page: "/path" | "site-wide",
  evidence: ["43,425 impressions, 0.00% CTR, position 1.1 (Search Console, last 90 days)", ...],
  change: "Exact change. e.g. New title: 'Solar Panel Repair in San Diego | Same-Week Service | Semper Solaris'",
  why: "One sentence linking evidence to expected outcome",
  impact: 1-5, effort: 1-5, confidence: high|medium|low }
```

Rules for every pass:
- **Every task must quote at least one evidence item taken from the input.**
- If the data needed to judge something is in `data_gaps`, the pass says so and doesn't produce a task about it.
- Generic tasks are forbidden ("improve content", "build backlinks").

**Model:** the most capable current model, with adaptive thinking at `high` effort, streaming. Passes use **structured outputs** (a JSON schema per pass), so the reply is always valid JSON and the brace-repair hack isn't needed for v2. The model ID lives in one constant.

**Prompt caching:** the shared context block goes first and is cached across the four parallel passes and the synthesis.

### 3. Synthesis pass (AI)

Input: all pass outputs (findings and tasks), the data-gaps list, and the headline numbers.

Output (structured):
- `client_summary`: 3–5 plain sentences, no jargon, safe to share.
- `top_moves`: the 3 highest-value tasks, rephrased for a client.
- `scores`: SEO / GEO / AEO (0–10) with one-line reasons, kept for continuity with v1 history.
- `action_plan`: all tasks deduplicated and merged across passes, ordered by `priority = impact × confidence weight ÷ effort`. Each keeps its evidence and exact change.
- `data_gaps`: carried through, phrased for humans.

### 4. Orchestration — resumable steps (no single request over ~4 minutes)

New collection `SeoAuditJobs`:
```
{ _id, email, domain, auditType, status: queued|running|done|failed,
  steps: [{ key, status: pending|running|done|failed, startedAt, finishedAt, error }],
  data: {...}, passes: {...}, result: {...}, createdAt, updatedAt, version: 2 }
```
Steps: `crawl` → `gather` (GSC, URL Inspection, sitemaps, GA4, PageSpeed in parallel) → `pass:technical`, `pass:content`, `pass:local`, `pass:conversion` (parallel) → `synthesize`.

API:
- `POST /api/seo-audit/v2/jobs` `{ domain, auditType, forceRerun }` creates the job. It applies the daily limit and budget checks exactly as today (one audit = one use), then returns `{ jobId }`.
- `POST /api/seo-audit/v2/jobs/:id/advance` runs the **next runnable step(s)**, with the four passes in parallel in one call. It persists the results and returns the job's progress. It's idempotent: a step already running and under 6 minutes old isn't started twice.
- `GET /api/seo-audit/v2/jobs/:id` returns progress and, when done, the result.
- Every route sets `maxDuration = 300`, and each step is designed to finish in under ~4 minutes. The passes stream; the content pass splits the top pages into two halves run as separate calls if needed to stay within time.

The page drives it: it calls `advance` until `done`, showing per-step progress ("Reading sitemaps… Checking 20 pages in Google's index… Analyzing content…"). If the tab is closed, the job stays where it stopped; reopening it from history continues it.

**Finished jobs** are also written to `SeoAudits` with `version: 2` and the v2 result, so history works in one list.

**Failures:**
- Every step retries itself automatically up to 2 times, covering overload and timeouts.
- If an **analysis pass** still fails, the job can still finish. That area is listed prominently in `data_gaps` ("Technical analysis didn't complete — rerun to include it"), and the UI shows it as a gap, never as a clean result.
- If `crawl`, `gather` or `synthesize` still fails, the job is `failed`. The UI offers **Retry**, which resumes from the failed step and doesn't count as a new use.
- A job that ends `failed` with no result **refunds its daily use**.

**Reuse and reruns:**
- `POST /jobs` returns an existing job instead of starting a new one when there is either an in-progress job for the same domain and audit type, or a v2 audit finished today. This applies team-wide, the same as v1's same-day reuse. Duplicate runs cost $2–5.
- `forceRerun` always starts a new job and **never overwrites** the earlier audit. Both stay in history. This intentionally differs from v1's replace.

**History and access:** in-progress and failed jobs appear in the same history list with a status badge (Running / Failed / Done). Anyone signed in with @lilikoiagency.com can view or resume any job; this is an internal tool, the same as today.

**Quick vs Full:**

| | Quick | Full |
|---|---|---|
| Pages crawled | 5 (top Search Console pages when available) | up to 50 |
| URL Inspection | those 5 | top 20 |
| PageSpeed | top 2 | top 5 |
| Passes | all 4 + synthesis, effort `medium` | all 4 + synthesis, effort `high` |
| Target time / cost | ~3–5 min / ~$1–1.50 | ~5–9 min / ~$2–5 |

### 5. UI (`/dashboard/seo-audit`)

The results view for v2 audits, from top to bottom:
1. **Client summary** card, plus the 3 top moves and the scores row (as today).
2. **Action Plan** table: priority, task, page, category, impact/effort chips. Each row expands to show the evidence and the exact change. Filters by category and page. **Copy as checklist** and **Download CSV** buttons.
3. **Pages** tab: one card per important page with its fix list (from the content pass), its top queries, index status and speed.
4. **Technical**, **Local & AI search**, and **Conversion** tabs with each pass's findings.
5. **Data sources & gaps** line: what was used and what was missing, and why.

v1 audits in history keep rendering with the existing v1 view (picked by `version`).

### 6. Costs and limits (estimates, to confirm in testing)

- About 5–9 minutes per full audit end to end.
- Model cost about $2–5 per full audit (shared context cached; each pass gets only its slice), and about $1 for Quick.
- Usage is still logged per call through `logApiUsage`, and the monthly budget cap still applies.

## Testing

- **Unit:** sitemap index parsing (nested, robots.txt, missing); image summary; page × query join; URL Inspection result mapping; PageSpeed mapping; data-gaps assembly; task priority ordering and dedupe; job step state machine (runnable-step selection, idempotency, failure handling).
- **Route tests** with mocked fetchers and model: limit and budget enforcement, advance order, resume.
- **Live acceptance**, before calling it done:
  - **Big Bully Turf (full):** no sitemap false positive. Every Action Plan task has page-specific evidence and an exact change. At least 10 tasks; no generic tasks.
  - **Semper Solaris (full)** with GA4: at least one conversion task tied to real per-page key events.
  - Frank reviews both and judges whether they're actually useful. That's the bar.

## Decided by Frank

- Approach A: analyst pipeline.

## Calls made during design (open to correction)

- The audience is assumed to be the team as executors, with a client summary on top (not confirmed).
- Competitors, SERP, backlinks and the Google Business Profile API are out of v2.
- The most capable current model with high effort, accepting about $2–5 per full audit.
- PageSpeed runs keyless unless `PAGESPEED_API_KEY` is set.
- v1 stays in place for viewing old audits; new audits use v2 only.
- Steps retry automatically twice. A failed analysis pass becomes a labeled gap; a failed job refunds the day's use.
- Same-day reuse is team-wide; Rerun keeps the old audit instead of replacing it.
- Unfinished jobs show in history with a status badge, and anyone on the team can resume them.
- A Quick audit runs every pass at lower effort for about $1–1.50.

## Left to the builder

File and component breakdown, exact prompt wording per pass (within the rules above), how the content pass splits pages, UI styling within the existing page's look, and CSV column order.
