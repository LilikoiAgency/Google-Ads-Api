# SEO Audit: Advanced options (short design)

## Why
The automatic page choice (Search Console top pages, then nav/sitemap patterns) often spends
slots on pages nobody cares about — worst on a Quick audit with only 5 pages. Users need to
steer which pages get audited.

## Goals / non-goals
- Goal: choose pages to audit first, optionally audit only those, skip path patterns, pick the page count.
- Goal: zero extra steps when Advanced is left closed — behaviour identical to today.
- Non-goal: a page picker that loads the site's page list (approach B; maybe later).
- Non-goal: keyword/area focus options.
- Anti-goal: a custom audit silently reusing an earlier same-day audit with different pages.

## Approaches
- **A. Advanced panel with typed rules (picked).** Fast, one click when unused, mostly crawler wiring.
- B. Page picker (load pages + GSC clicks, tick boxes). More visual, but an extra 10–30s step every time and ~2x the build.

## Design
**UI** (`dashboard/seo-audit/page.js`): a collapsed "Advanced" section under the Quick/Full choice.
- *Pages to audit first* — textarea, one per line; full URLs or paths (`/pet-turf`).
- *Only audit these pages* — checkbox (enabled when at least one page is listed).
- *Skip pages matching* — comma/line separated path patterns; `*` is a wildcard (`/blog/*`).
- *Number of pages* — select 5, 10, 15, 25, 50. Defaults: Quick 5, Full 50.
- When anything is set, the closed panel shows a one-line summary ("3 priority pages · skip /blog/* · 10 pages").

**API** (`POST /api/seo-audit/v2/jobs`): optional `options: { pages: string[], onlyListed: boolean, skip: string[], pageCount: number }`.
- Pages are normalised to URLs on the audited domain (www or not). Off-domain or unparseable lines → 400 listing them. Max 50 pages, 20 skip patterns.
- `pageCount` 1–50; `onlyListed` → page count is the number of listed pages.
- A job with any options set is never reused by the same-day reuse check, and reuse never returns a job that had options to a plain request.
- Options are stored on the job so steps, retries and history use them.

**Crawl order** (`runStep` crawl step → `crawlSite`):
1. Listed pages, in the order given (never filtered by skip patterns).
2. If not `onlyListed`: Search Console top pages, then nav/sitemap priority — both with skip patterns removed — up to `pageCount`.
- Quick vs Full still controls analysis depth/effort; URL Inspection and PageSpeed counts are capped at the page count. Listed pages get inspected/speed-tested first.

**Results/history**: the header line shows "Custom pages" (with the listed count) when options were used; history rows show the same.

## Left to the builder
Exact layout/styling of the panel (match the existing card styles); wildcard matching details beyond `*`.

## Rulings (mine, check these)
- Skip patterns never remove a page you explicitly listed.
- Quick with 50 pages is allowed (cheaper effort, broad coverage); cost scales with page count (~$0.10/page Full content analysis).
- Custom audits always run fresh (no same-day reuse) and count as one daily use.
