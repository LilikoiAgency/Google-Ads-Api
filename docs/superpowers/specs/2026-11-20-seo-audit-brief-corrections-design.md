# SEO Audit: company brief and corrections

## Why

The audit learns what a business does only from its homepage (title, meta description, H1, ~1,500 characters of text, built in `buildSharedContext`, `src/lib/seoAuditV2/passes.js`). It guesses wrong. On a Semper audit it recommended roof repairs, a service the company doesn't offer and doesn't want to rank for. The agency needs to:

1. tell the audit what the company does before it runs, and
2. correct an audit after it runs, so a wrong recommendation goes away now and never comes back.

It must work the same for clients and for prospects (sites with no client record).

## Goals

- A **company brief** saved per website (bare domain), loaded and editable on the audit form, used by every analysis step as fact ahead of the homepage.
- On a finished audit, a **"We don't offer this"** action on any task: the task (and matching ones) disappears at once, and the service is added to the brief so later audits don't suggest it.
- An optional **"Update the plan"** that re-runs only the final step with the corrections, so the summary, scores, top moves and 30/60/90 plan are rewritten without the hidden work.

## Non-goals

- No brief on the Clients admin record (prospects aren't there; one place only).
- No rewriting of the earlier analysis steps on "Update the plan" (that would be a full re-audit).
- No v1 audits.
- No editing of task text by hand.

## Anti-goals

- A correction must never silently hide unrelated work: hidden tasks stay visible behind a "Show hidden" toggle, and every correction can be undone.
- Client-facing text must never mention the correction mechanics or name an AI vendor.

## Approaches considered

- **A. Brief saved per website, edited on the audit form and from task corrections (chosen).** Keyed by domain like the saved review locations (`SeoAuditLocations`), so prospects work. Every later audit loads it.
- **B. Brief on the Clients admin record.** One place per client, but prospects aren't clients, which fails the prospect requirement, and editing means leaving the audit.
- **C. Corrections on the audit only.** Simplest, but the next audit repeats the mistake.

Frank chose A, with both instant hiding and an optional re-run of the plan.

## The brief

New Mongo collection `SeoAuditBriefs` (db `tokensApi`), one document per bare domain (lowercase, no `www.`):

| Field | Type | Meaning |
|---|---|---|
| `domain` | string | key |
| `services` | string | what they do, free text (≤ 1,000 chars) |
| `exclude` | string[] | services or topics not to recommend (each ≤ 80 chars, ≤ 30 items) |
| `areas` | string | service areas, free text (≤ 300 chars) |
| `notes` | string | anything else (priorities, constraints), free text (≤ 1,000 chars) |
| `updatedAt`, `updatedBy` | date, email | |

API: `GET /api/seo-audit/v2/brief?domain=` and `PUT /api/seo-audit/v2/brief` (agency emails only, like the other v2 routes). Exclusions are de-duplicated case-insensitively.

**On the audit form:** a "Company brief" section in Advanced, loaded for the typed domain (same lazy load as the location picker), with the four fields and the exclusion list as removable chips plus an add box. Edits save when the audit starts. The job stores a snapshot (`job.brief`) so a later brief edit never changes what an old audit was told.

**In the analysis:** `buildSharedContext` gets a "Company brief (from the agency: treat as fact; it overrides what the homepage suggests)" block listing services, areas, notes and "Do not recommend: …". The shared rules add: never write a task, keyword pick or move that promotes an excluded service; if the site has pages for an excluded service, at most suggest de-emphasising them when the brief's notes ask for it. The target keywords pass must not pick excluded keywords. An empty brief adds nothing.

**Safety net in code:** after each pass, tasks matching an exclusion are removed (`matchesExclusion(task, exclude)`, see below), as are target keyword picks that contain an excluded phrase. A data gap line is not added for these.

## Matching an exclusion

`matchesExclusion(task, phrases)`: true when any phrase appears in the task's title, or in the first line of its change, as whole words, case-insensitive, with a simple singular/plural tolerance ("roof repair" matches "roof repairs" and "Roof Repair"). Phrases shorter than 4 characters are ignored. Group tasks match when the group title matches; otherwise only the matching items are hidden. One function, used by the new-audit safety net, the instant hide, and the report.

## Corrections on a finished audit

Stored on the saved audit (`SeoAudits` document), beside `auditResult`, never inside it:

```
corrections: [{ id, kind: 'not_offered' | 'not_relevant', service?: string, task_ids: [..], by, at }]
```

- On each task row (and group item), a "Not for this business" menu with:
  - **We don't offer this:** a small form prefilled with a service name guessed from the task title (editable), and a checkbox "Don't recommend it in future audits" (on by default). Saving hides the task plus every task matching the service phrase, and when the box is ticked adds the phrase to the brief's `exclude`.
  - **Not relevant here:** hides only this task on this audit; nothing goes to the brief.
- The hidden set = the corrections' `task_ids` plus tasks matching any `not_offered` service. It is computed in one pure function `applyCorrections(result, corrections)` that returns the plan without hidden tasks (group items removed, an emptied group removed) and `hidden` (task ids with the correction that hid each).
- Everything that shows the plan uses the corrected plan: Action Plan (both views), the 30/60/90 plan, the top-moves card (a hidden top move drops out), the plan breakdown, page cards' task links, the Target keywords tab's task links, the CSV, and both report downloads.
- The Action Plan shows "N hidden · Show hidden"; shown hidden tasks are greyed with the reason and an "Undo" that removes the correction (undo does not remove the phrase from the brief; the brief is edited on the form).
- API: `POST /api/seo-audit/v2/audits/[id]/corrections` (add) and `DELETE …/corrections/[correctionId]` (undo); both return the updated corrections; the brief update happens in the add call.

## Update the plan

- A button "Update the plan" appears once an audit has corrections added after its last plan build. It explains: "Rewrites the summary, scores and plan without the hidden work. About a minute."
- `POST /api/seo-audit/v2/audits/[id]/replan`: loads the audit's job (`jobId` on the saved audit; finished jobs keep `passes.*`, `data.sources` and `data.sharedContext`), rebuilds the shared context with the current brief, removes hidden tasks from the pass outputs, runs the existing synthesize step logic once (`runSynthesize` with the same schema and effort), and replaces `auditResult` with the new result. The previous result is kept as `previousResults[]` (last 3) so it can be compared or restored by hand. `corrections` stay; a correction whose tasks are gone from the new plan is harmless.
- It runs inside one request (synthesize already fits the 300s route limit). One run at a time per audit (a `replanning` flag with a 6-minute stale timeout, like job steps). It does not count as a new audit against the daily limit, but its model cost is logged like other steps (`label: 'replan'`).
- If the job is missing (deleted) the button is not shown.

## Decisions made after the builder check (Claude's calls)

- **Corrections are keyed by pass task ids, not plan ids.** Plan ids (`T7`, `T3.1`) are positional and change on a replan. Every plan task already carries `source_ids` (the pass-level ids such as `CONT-2-3`, which never change because replan reuses the pass outputs). A correction stores `source_ids`; `applyCorrections` hides a task (or group item) whose `source_ids` intersect. `task_ids` in the correction schema above means these source ids. Replan removes hidden pass tasks by the same ids before synthesizing, so no mapping is needed.
- **Replan context:** the brief block is the last section of the shared context. Replan takes the job's stored `data.sharedContext`, cuts any old brief block and appends one built from the current brief, so the crawl isn't needed. (Jobs have no expiry today; checked.)
- **Can it replan?** The single-audit load (`GET /api/seo-audit/history?id=`) adds `canReplan` (its job exists and has `passes`), one indexed lookup.
- **Storage:** `corrections`, `replanning` and `previousResults` are top-level fields on the `SeoAudits` document; the history list excludes `previousResults` and returns only a `correctionsCount`.
- **Reused jobs:** a running or recent job is reused only when its `brief` snapshot equals the current brief; otherwise a new job starts.
- **Summary prose:** excluded services are kept out of summary, scores and move headlines by the prompt only; hidden tasks drop out of top moves in code; "Update the plan" rewrites the prose after a correction.
- **Short phrases:** the brief form and the correction form reject exclusions under 4 characters with a message, so nothing is saved that can't match.

## Constraints

- Agency-only routes (`@lilikoiagency.com`), same session check as existing v2 routes.
- Brief text is agency-written, but it is still put in the prompt as data under a clear heading.
- Client report: no mention of corrections, hidden tasks or the brief. Full report: a line "N tasks hidden by the agency" under data gaps.
- All new client-facing text in plain language; never names an AI vendor.

## Left to the builder

- Exact UI placement and styling, following the existing v2 components (modern SaaS style: white, grey lines, purple accent in the app; the audit form is the dark form).
- How the service name is guessed from a task title (a short heuristic is enough; the user edits it).
- Index on `SeoAuditBriefs.domain` (unique).
