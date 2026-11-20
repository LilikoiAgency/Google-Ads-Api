# SEO Audit Company Brief and Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company brief saved per website that every audit step treats as fact, plus "Not for this business" corrections on finished audits (instant hide, optional brief update) and an "Update the plan" re-run of the final step.

**Architecture:** Pure helpers (`briefs.js`, `corrections.js`) shared by server and browser; Mongo stores (`briefStore.js`, `auditStore.js`); new agency-only routes under `/api/seo-audit/v2/`. Corrections live beside `auditResult` on the saved `SeoAudits` document and are applied at render time; replan reuses `runStep(job, 'synthesize')` on the stored job with hidden pass tasks removed.

**Tech Stack:** Next.js 14 App Router, MongoDB (db `tokensApi`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-20-seo-audit-brief-corrections-design.md`

## Global Constraints

- Branch `feat/seo-audit-brief`, stacked on `feat/seo-audit-roadmap-keywords` (PR #13). Never commit to main.
- No mention of Claude/AI/Anthropic in commits, code comments, UI text or reports; no Co-Authored-By trailer.
- Do not call the Claude API, Google APIs or MongoDB from tests or scripts; mock them.
- Routes: agency emails only (`session.user.email` ends with `@${allowedEmailDomain}`), 401 otherwise, same as `src/app/api/seo-audit/v2/jobs/route.js`.
- Brief domain key: lowercase, no scheme, no `www.`, no path (`bareHost` in `src/lib/seoAuditV2/options.js`).
- Brief limits: `services` ≤ 1,000 chars, `areas` ≤ 300, `notes` ≤ 1,000, `exclude` ≤ 30 items each 4–80 chars, de-duplicated case-insensitively.
- Corrections key on pass task ids (`source_ids` on plan tasks, e.g. `CONT-2-3`), never on plan ids (`T7`).
- Client report never mentions corrections, hidden tasks or the brief. Full report adds "N task(s) hidden by the agency" under data gaps.
- Brief heading in the prompt, exactly: `## Company brief (from the agency: treat as fact; it overrides what the homepage suggests)`; it is the last section of the shared context.
- Replan keeps at most 3 `previousResults`; one replan at a time per audit with a 6-minute stale timeout.

## Review Focus

1. A correction on a group item hides only that item; an emptied group disappears; a correction on a group parent hides the whole group.
2. An exclusion phrase must not hide unrelated tasks: "roof repair" must not match "roofing" or "proof"; plural tolerance only adds/removes a trailing "s"/"es".
3. Replan on an audit whose job is gone, or while another replan runs, returns a clear error and leaves the audit unchanged.
4. A brief edited after an audit ran does not change that audit's stored context until "Update the plan".
5. An empty brief adds nothing to the prompt and starts no different job than today (reuse still works).

---

### Task 1: Pure correction helpers

**Files:**
- Create: `src/lib/seoAuditV2/corrections.js`
- Test: `src/__tests__/lib/seoAuditV2/corrections.test.js`

**Interfaces:**
- Produces:
  - `MIN_PHRASE = 4`, `isUsablePhrase(s): boolean` (trimmed length 4–80)
  - `matchesExclusion(task, phrases: string[]): boolean`: whole-word, case-insensitive match of any usable phrase in `task.title` or the first non-empty line of `task.change`; a trailing `s`/`es` on the last word of the phrase or the text is ignored.
  - `guessService(title: string): string`: strips leading verbs ("Add", "Create", "Build", "Write", "Expand", "Improve", "Optimize", "Target", "Rank for", "Publish") and trailing "page/section/content/landing page", returns lowercase, ≤ 80 chars.
  - `applyCorrections(result, corrections) -> { result, hidden: [{ task, correction }] }`: returns a copy of `result` whose `action_plan`, `top_moves` and `targets.pages[].task_ids` exclude hidden tasks. A task is hidden when its `source_ids` intersect a correction's `source_ids`, or it matches any `not_offered` correction's `service`. Group items are filtered individually; a group left with < 1 item is removed; follow-ups of a hidden parent are hidden with it. `result` without corrections is returned unchanged (same object).

- [ ] **Step 1: Write failing tests** covering: matches "Add a roof repair page" for "roof repairs"; no match for "roofing services" or "waterproofing"; phrase "ac" ignored; `guessService('Add a roof repair landing page')` → `'roof repair'`; `applyCorrections` hides by source id, by service, single group item, whole group, follow-ups with parent; `top_moves` entry dropped when its task is hidden; `targets.pages[0].task_ids` loses hidden ids; returns the same object when `corrections` is empty or missing.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/lib/seoAuditV2/corrections.test.js`; expect FAIL (module missing).
- [ ] **Step 3:** Implement `corrections.js` (pure, no imports beyond `./tasks` if needed).
- [ ] **Step 4:** Run the test; expect PASS.
- [ ] **Step 5:** Commit `feat(seo-v2): helpers to match exclusions and apply corrections`.

### Task 2: Brief model, store and API

**Files:**
- Create: `src/lib/seoAuditV2/briefs.js`, `src/lib/seoAuditV2/briefStore.js`, `src/app/api/seo-audit/v2/brief/route.js`
- Test: `src/__tests__/lib/seoAuditV2/briefs.test.js`, `src/__tests__/api/seo-audit-v2-brief.test.js`

**Interfaces:**
- Produces (pure, `briefs.js`):
  - `BRIEF_HEADING` (exact text from Global Constraints)
  - `parseBrief(raw) -> { brief } | { error }`: trims fields, enforces limits, dedupes `exclude` case-insensitively, rejects an exclusion under 4 chars with `"Use at least 4 characters for each service not to recommend."`; returns `{ brief: null }` when every field is empty.
  - `briefBlock(brief) -> string`: `''` for null/empty; otherwise the heading then lines `Services: …`, `Service areas: …`, `Do not recommend: a; b`, `Notes: …` (only non-empty ones).
  - `withBrief(sharedContext, brief) -> string`: removes everything from `BRIEF_HEADING` to the end, then appends `\n\n` + `briefBlock(brief)` when non-empty.
  - `sameBrief(a, b): boolean` (null-safe deep compare of the four fields).
- Produces (`briefStore.js`, collection `SeoAuditBriefs`, unique index on `domain` created lazily like `reputationStore.js`):
  - `getBrief(domain) -> brief | null`, `saveBrief(domain, brief, email)` (upsert; null brief deletes), `addExclusion(domain, phrase, email)` (`$addToSet` after a case-insensitive check; respects the 30-item limit by ignoring extras).
- Route: `GET /api/seo-audit/v2/brief?domain=` → `{ brief }`; `PUT` body `{ domain, brief }` → `{ brief }` or 400 `{ error }`.

- [ ] **Step 1: Write failing tests:** `parseBrief` limits and dedupe; empty → null; `briefBlock` exact output for a full brief and `''` for null; `withBrief` replaces an old block and leaves a context without one intact plus the new block; route 401 for a non-agency email, GET/PUT round trip with `briefStore` mocked, PUT 400 on a 3-char exclusion.
- [ ] **Step 2:** Run both test files; expect FAIL.
- [ ] **Step 3:** Implement the three files.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(seo-v2): company brief saved per website`.

### Task 3: Brief in the audit pipeline

**Files:**
- Modify: `src/app/api/seo-audit/v2/jobs/route.js`, `src/lib/seoAuditV2/jobStore.js` (`findReusable`), `src/lib/seoAuditV2/passes.js` (`buildSharedContext`, `RULES`), `src/lib/seoAuditV2/runStep.js` (`runGather`, `runPass`), `src/lib/seoAuditV2/targets.js` (`guardTargets`)
- Test: existing `jobs`, `runStep`, `passes`, `targets`, `seo-audit-v2` API tests

**Interfaces:**
- Consumes: `getBrief`, `briefBlock`, `withBrief`, `matchesExclusion`, `isUsablePhrase`.
- Produces:
  - Jobs route loads `getBrief(domain)` and stores `job.brief` (null when none). `findReusable({ domain, auditType, todayStart, brief })` adds `brief: brief ?? null` to its query (Mongo exact match on the snapshot; an old job without the field matches `null`).
  - `buildSharedContext({ domain, profile, homepage, gaps, brief })` ends with `withBrief`-compatible block (append `briefBlock(brief)` last).
  - `RULES` gains one line: "When the audit context has a company brief, it is fact: never write a task, keyword pick, move or summary line that promotes a service under Do not recommend, and follow the brief's service areas over guesses from the site."
  - `runPass` drops tasks where `matchesExclusion(task, job.brief?.exclude)`; for `targets` it passes `job.brief?.exclude` to `guardTargets(out, input, { exclude })`, which skips any keyword containing an excluded phrase (same whole-word rule, via `matchesExclusion({ title: keyword }, exclude)`).

- [ ] **Step 1: Write failing tests:** route stores `job.brief` from a mocked `getBrief` and passes it to `findReusable`; shared context ends with the brief block when given and is unchanged when not; `runPass` removes a task titled "Add a roof repair page" when `job.brief.exclude = ['roof repairs']` and keeps others; `guardTargets` drops "roof repair tampa" with that exclusion.
- [ ] **Step 2:** Run the touched test files; expect the new tests to FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite (`npx vitest run`); only the 2 known `googleAdsAudit.test.js` failures remain.
- [ ] **Step 5:** Commit `feat(seo-v2): audits follow the company brief`.

### Task 4: Corrections on saved audits

**Files:**
- Create: `src/lib/seoAuditV2/auditStore.js`, `src/app/api/seo-audit/v2/audits/[id]/corrections/route.js`, `src/app/api/seo-audit/v2/audits/[id]/corrections/[correctionId]/route.js`
- Modify: `src/app/api/seo-audit/history/route.js`
- Test: `src/__tests__/api/seo-audit-v2-corrections.test.js`, existing history tests if any

**Interfaces:**
- Consumes: `isUsablePhrase`, `addExclusion`.
- Produces (`auditStore.js`, collection `SeoAudits`):
  - `getAudit(id)`, `addCorrection(id, correction)` (`$push`), `removeCorrection(id, correctionId)` (`$pull`), each returning the updated `corrections` array.
- `POST /api/seo-audit/v2/audits/[id]/corrections` body `{ kind: 'not_offered'|'not_relevant', service?, source_ids: string[], saveToBrief?: boolean }`:
  - 400 when `source_ids` is empty or `kind` unknown, or `not_offered` without a usable `service`.
  - Stores `{ id: randomUUID(), kind, service?, source_ids, by: email, at: ISO }`; when `kind === 'not_offered' && saveToBrief`, calls `addExclusion(audit.domain, service, email)`.
  - → `{ corrections }`.
- `DELETE …/corrections/[correctionId]` → `{ corrections }` (brief untouched).
- History: single `GET ?id=` adds `canReplan: boolean` (job `jobId` exists in `SeoAuditJobs` with a `passes` field, via one `findOne` with projection `{ _id: 1 }`); the list projection also excludes `previousResults`.

- [ ] **Step 1: Write failing tests** with `auditStore`/`briefStore`/session mocked: 401; 400 cases; POST stores and calls `addExclusion` only for `not_offered` + `saveToBrief`; DELETE returns the remaining list; history single GET includes `canReplan`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(seo-v2): save corrections on finished audits`.

### Task 5: Update the plan (replan)

**Files:**
- Create: `src/lib/seoAuditV2/replan.js`, `src/app/api/seo-audit/v2/audits/[id]/replan/route.js`
- Modify: `src/lib/seoAuditV2/auditStore.js` (claim/finish/release)
- Test: `src/__tests__/lib/seoAuditV2/replan.test.js`

**Interfaces:**
- Consumes: `getJob(jobId)` (full), `runStep(job, 'synthesize')`, `getBrief`, `withBrief`, `applyCorrections`/`matchesExclusion`.
- Produces:
  - `auditStore.claimReplan(id, now)`: sets `replanning: ISO` only when absent or older than 6 minutes; returns boolean. `finishReplan(id, result)`: `$set auditResult`, `$push previousResults { $each: [old], $slice: -3 }`, `$unset replanning`, updates `scores`. `releaseReplan(id)`.
  - `replanAudit({ auditId, now }) -> { ok: true, result } | { ok: false, status, error }`:
    - 404 audit missing; 409 `"This audit's analysis data is no longer available."` when job missing or without `passes`; 409 `"The plan is already being updated."` when the claim fails.
    - Hidden pass ids = corrections' `source_ids` ∪ ids of pass tasks matching any `not_offered` service or current brief exclusion.
    - Job copy: each `passes[k].tasks` filtered (content pass too), `data.sharedContext = withBrief(job.data.sharedContext, currentBrief)`, steps unchanged.
    - `runStep(copy, 'synthesize')`; on `ok` → `finishReplan`; result keeps `audit_date` of the original and adds `replanned_at`. On failure → `releaseReplan`, `{ ok: false, status: 502, error: 'Updating the plan failed. Try again.' }`.
  - Route `POST /api/seo-audit/v2/audits/[id]/replan` (`maxDuration = 300`) → `{ result }` or `{ error }` with the status above. Not counted against the daily audit limit; checks the monthly budget cap like the jobs route.

- [ ] **Step 1: Write failing tests** (mock `jobStore`, `auditStore`, `briefStore`, `runStep`): hidden ids removed from the job copy given to `runStep`; brief block swapped; 404/409 paths; failure releases the claim; success calls `finishReplan` with the new result carrying the original `audit_date`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(seo-v2): update the plan after corrections`.

### Task 6: Company brief on the audit form

**Files:**
- Modify: `src/app/dashboard/seo-audit/v2/AdvancedOptions.jsx`, `src/app/dashboard/seo-audit/page.js`
- Test: `src/__tests__/dashboard/SeoAuditV2.test.jsx`

**Interfaces:**
- Consumes: brief GET/PUT routes, `parseBrief`.
- Produces: a `BriefEditor` section in Advanced (dark form styles already in the file): Services (textarea), Service areas (input), Don't recommend (chips with ✕ plus an input and Add button, rejecting < 4 chars inline), Notes (textarea). It loads the brief for the typed domain when the panel opens (lazy, like `useLocations`). Form state `adv.brief` (null = untouched). `page.js` PUTs the brief before starting a job when `adv.brief` differs from what was loaded; a PUT failure shows the API error and does not start the job. The collapsed Advanced summary shows "company brief" when one is loaded or edited.

- [ ] **Step 1: Write failing tests** (fetch mocked): loads and shows a saved brief; adding/removing an exclusion updates `onChange`; a 3-char exclusion shows the message and isn't added.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(seo-v2): edit the company brief on the audit form`.

### Task 7: Corrections and Update the plan in the results

**Files:**
- Modify: `src/app/dashboard/seo-audit/page.js`, `src/app/dashboard/seo-audit/ResultsView.jsx`, `src/app/dashboard/seo-audit/v2/V2Results.jsx`, `src/app/dashboard/seo-audit/v2/ActionPlan.jsx`, `src/app/dashboard/seo-audit/v2/ReportDownload.jsx`, `src/lib/seoAuditReportHtml.js`, `src/app/dashboard/seo-audit/v2/plan.module.css`
- Test: `src/__tests__/dashboard/SeoAuditV2.test.jsx`, `src/__tests__/lib/seoAuditReportHtml.test.js`

**Interfaces:**
- Consumes: corrections/replan routes, `applyCorrections`, `guessService`.
- Produces:
  - `page.js` keeps `auditId`, `corrections`, `canReplan` from the history load (and `auditId` from a finished job's progress; `canReplan` true then) and passes `review={{ auditId, corrections, canReplan, onCorrect, onUndo, onReplan, replanning, replanError }}` through `ResultsView` to `V2Results`. Without `review` (e.g. tests, old callers) nothing changes.
  - `V2Results` renders everything from `applyCorrections(result, corrections).result`; passes `hidden` and handlers to `ActionPlan`. Shows an "Update the plan" bar when a correction's `at` is later than `result.replanned_at || result.audit_date` (and `canReplan`): text "Rewrites the summary, scores and plan without the hidden work. About a minute." with the button; while running, "Updating the plan…"; errors inline.
  - `ActionPlan`: each row's detail area gets a "Not for this business" button (top-level tasks and group items) opening an inline form: two radio choices ("We don't offer this" with an editable service prefilled from `guessService(task.title)` and the "Don't recommend it in future audits" checkbox, ticked; "Not relevant here"), Save/Cancel. Save calls `onCorrect({ kind, service, source_ids: task.source_ids, saveToBrief })`. A "N hidden · Show hidden" control lists hidden tasks greyed with the reason ("You don't offer roof repair" / "Marked not relevant") and an Undo calling `onUndo(correction.id)`. A task without `source_ids` gets no button (every v2 audit has them).
  - `ReportDownload`/`generateSeoReportHtml(result, { kind, hiddenCount })`: callers pass the corrected result; full report adds the hidden line under data gaps when `hiddenCount > 0`; client report unchanged.

- [ ] **Step 1: Write failing tests:** a correction hides the task from the plan, the 30/60/90 view and top moves; Show hidden + Undo calls `onUndo`; the form sends `source_ids` and the edited service; Update bar appears only after a newer correction and calls `onReplan`; report full version shows "1 task hidden by the agency", client doesn't.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite; only the 2 known failures remain. Run `npx eslint` on touched dashboard and lib files.
- [ ] **Step 5:** Commit `feat(seo-v2): correct an audit and update its plan from the results`.
