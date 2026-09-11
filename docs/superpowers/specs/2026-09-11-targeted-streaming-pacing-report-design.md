# Targeted Streaming Pacing Report — Design

**Date:** 2026-09-11
**Status:** Approved for planning

## Goal

Add a second daily pacing report, for Targeted Streaming (CTV / audio / DOOH vendors), alongside the existing Paid Search & Social pacing report. Same delivery model: emailed Mon–Fri at 9 AM ET via Resend, with preview, send-now, history, and trends in the dashboard.

## Source of truth

One shared Google Sheet, **Targeted Streaming Spends** (`1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU`), already shared with the `pacing-report-reader` service account. Three tabs are read:

| Tab | What we take | Notes |
|---|---|---|
| `Client Information` | Current Month (text, e.g. `August`), Current Year, Last Updated (serial date), Last Updated Day, Days in Month | Hand-maintained control cells. Everything else in the sheet derives from them. |
| `Budget` | Final Budget per row, grouped by Client Abbreviation and by vertical | Vertical is whichever of Solar/Roofing/HVAC/Windows/Turf Budget columns is populated. SMP's `TARGETED STREAMING ALL` row counts as **SOLAR**. Values may arrive as error strings (`#REF!`, `#N/A`) when the IMPORTRANGE breaks; treat as null. |
| `<KEY> Pacing` (one per client) | Platform, Vertical, Current Spend, Total Pacing, and one column per geo holding **EOM-projected** spend | Same shape as the Paid Search PACING tab: totals row, header row (`REPORT UPDATED, Client, Platform, Vertical, Lead Name, Current Budget, Current Spend, Total Pacing, <geo...>`), then data rows. Current Budget is always blank in this sheet. |

Tabs explicitly **not** read: `<KEY> Spends` (same data pre-projection), the `BBT`/`CMK`/`MSP` matrix tabs (their per-platform "approved" figures are spend ÷ 0.7, i.e. derived from spend, not real budgets), `SUM`, and all vendor `Spend *` tabs.

Pacing % is spend/EOM against the **full Final Budget**. No agency-fee factor.

### Known platforms

`TRADE DESK`, `PARAMOUNT`, `SPOTIFY`, `DISNEY`, `ADLIB`, `PUBMATIC`. Matching is case-insensitive substring on the upper-cased cell (`Trade Desk` → `TRADE DESK`). **Unknown platform names are kept, not dropped** — the sheet gains vendors over time — and logged with a warning so the list can be extended.

### Clients in scope

`SMP` (Semper Solaris) and `BBT` (Big Bully Turf). CMK and MSP have no Pacing tab and zero spend; they are not configured. Adding a client later is a config change (key + name + enabled) once its `<KEY> Pacing` tab exists.

## Architecture

Parallel subsystem mirroring the Paid Search trio, with shared helpers factored out. No changes to the behaviour of the existing pacing report.

```
src/lib/pacingShared.js                    NEW  toNum, normKey, colIndex, findPlatformTable-style header search,
                                                fmtCurrency/fmtPct/escapeHtml, PALETTE, classifyPct thresholds
src/lib/pacingSheets.js                    MOD  import shared helpers (behaviour unchanged)
src/lib/pacingReportBuilder.js             MOD  import shared helpers (behaviour unchanged)

src/lib/streamingPacingSheets.js           NEW  fetcher + pure parsers
src/lib/streamingPacingReportBuilder.js    NEW  pure HTML + summary builder
src/lib/streamingPacingPipeline.js         NEW  config load/save, run, send, persist

src/app/api/cron/streaming-pacing-report/route.js                NEW
src/app/api/streaming-pacing/{config,preview,send-now,reports,reports/[id],latest,trends}/route.js  NEW
src/app/dashboard/streaming-pacing/page.js + StreamingPacingTrendChart.jsx                          NEW
src/app/dashboard/components/DashboardSidebar.jsx                MOD  add nav entry
vercel.json                                                      MOD  add cron
scripts/verify-streaming-sheet.mjs                               NEW
```

Mongo (db `tokensApi`): `StreamingPacingConfig` singleton (`_id: 'singleton'`) and `StreamingPacingReports`.

### Config document

```js
{
  _id: 'singleton',
  sheetId: '1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU',
  clients: [
    { key: 'SMP', name: 'Semper Solaris', enabled: true },
    { key: 'BBT', name: 'Big Bully Turf',  enabled: true },
  ],
  recipients: [...same default list as Paid Search...],
  subjectPrefix: 'Targeted Streaming Pacing Report',
  fromAddress: process.env.PACING_REPORT_FROM || 'reports@updates.lilikoiagency.com',
}
```

Single `sheetId` at the top level (not per client) because the sheet is shared. Pacing tab name is derived: `${key} Pacing`.

## Fetcher (`streamingPacingSheets.js`)

Pure parsers, each exported and unit-tested against fixtures copied from the real sheet:

- `parseClientInfo(rows)` → `{ currentMonth, currentYear, lastUpdated (YYYY-MM-DD), lastUpdatedDay, daysInMonth }`. Serial dates converted with the 1899-12-30 epoch.
- `parseBudgetTab(rows)` → `{ byClient: { SMP: 112636.94, BBT: 63989.86 }, byClientVertical: { SMP: { SOLAR, ROOF, HVAC, WINDOWS }, BBT: { TURF } } }`. Vertical determined by populated vertical-budget column header (`Solar Budget` → `SOLAR`, `Roofing Budget` → `ROOF`, `HVAC Budget` → `HVAC`, `Windows Budget` → `WINDOWS`, `Turf Budget` → `TURF`). Rows with no populated vertical column contribute to the client total only.
- `extractStreamingLines(rows)` → `Array<{ platform, vertical, spendMtd, eomPacing, geos: Array<{ name, pacing }> }>`. Geo columns are every header after `Total Pacing`; geos with zero/null value are omitted. Lines with zero spend, zero EOM and no geos are dropped (the sheet pre-populates every platform × vertical combination).

`fetchStreamingSheet(sheetId, clients)` reads `Client Information`, `Budget`, and each enabled client's Pacing tab in parallel and returns `{ info, budgets, clients: [{ key, name, lines, budget, verticalBudgets, error? }] }`. A missing Pacing tab is a per-client error; the rest of the report still renders.

## Builder (`streamingPacingReportBuilder.js`)

`buildStreamingPacingReport({ reportDate, info, clients }) → { html, summary }`. Inline CSS only (Gmail). Same palette and status thresholds as Paid Search (≤85 Under, ≤115 On Track, else Over; >200 critical).

**Header:** "📺 Targeted Streaming Pacing Report", report date, then `Data as of <lastUpdated> · <Current Month> <Year> · Day <lastUpdatedDay> of <daysInMonth>`.

**Stale-sheet warning:** if `info.currentMonth` is not the report date's month (ET), a yellow banner directly under the header: "Sheet is still on August — roll `Client Information` forward before trusting these numbers." This is the case today.

**Per client section:**
- Banner: client status from client total budget vs client total EOM, plus Spend / EOM / Budget / Pacing %.
- Table grouped by vertical. Each vertical gets a subtotal row (Budget, Spend MTD, EOM Pacing, Pacing %, Status) followed by its platform rows (Platform, Spend MTD, EOM Pacing, Geo breakdown as `SD $5,443 · LV $3,501 · …`, top 6 by value). Platform rows have no budget or % — the sheet has none at that level.
- Client TOTAL row.

**Recommended actions**, evaluated at the vertical level per client, same priority ordering as Paid Search:
critical over (>200%), spending with no budget, moderate over, budgeted verticals at $0 spend, significantly under (<60% with spend), client has no data, plus one report-level "sheet not rolled to current month" action when stale.

**Summary** mirrors Paid Search so `latest`/`trends`/Command Center patterns work unchanged: `{ reportDate, dataAsOf, sheetMonth, stale, clients: [{ key, name, status, pacingPct, totalBudget, totalSpend, totalEomPacing, verticalCount, lineCount }], actionCount }`.

## Pipeline & routes

`streamingPacingPipeline.js` exposes `loadStreamingPacingConfig`, `saveStreamingPacingConfig`, `runStreamingPacingReport({ manual, dryRun, triggeredBy })` with identical semantics to the Paid Search pipeline (dry run skips send and insert; failed send still persists with `status: 'failed'`).

Routes are one-to-one copies of the Paid Search routes pointed at the new pipeline and collection, using `getAllowedSession` / `getAdminSession` from `src/lib/routeAuth.js`. Cron: `/api/cron/streaming-pacing-report`, Bearer `CRON_SECRET`, scheduled `5 12 * * 1-5` UTC (five minutes after the Paid Search cron so the two runs don't contend for the Sheets quota).

## Dashboard

`/dashboard/streaming-pacing` — copy of the Paid Search page against the new endpoints. Config panel edits recipients, the single sheet ID, client name/enabled, subject prefix, and from address. Sidebar entry "Streaming Pacing" under the existing "Pacing Reports". The home-page widget and Command Center are **out of scope** for v1.

## Error handling

- Sheets 403 / missing tab → per-tab warning logged, per-client `error` surfaced as a "Data unavailable" section, report still sends.
- Budget import errors (`#REF!`, `#N/A` strings) → null budget → NO_BUDGET status for that client/vertical, and a recommended action.
- `GOOGLE_SHEETS_SA_KEY` / `RESEND_API_KEY` missing → pipeline throws, cron route returns 500, nothing persisted.

## Testing

Vitest, fixtures copied verbatim from the real sheet on 2026-09-11:
- `parseClientInfo`, `parseBudgetTab`, `extractStreamingLines` — shapes, SOLAR mapping, error-string handling, zero-row dropping, unknown platform retention.
- Builder — vertical subtotals and status, stale banner on/off, geo breakdown ordering, actions list, summary shape.
- Shared helpers moved out of the Paid Search files — existing `pacingSheets.test.js` must still pass unchanged.
- `scripts/verify-streaming-sheet.mjs` for the live read (manual, not CI).

## Out of scope

Home widget / Command Center tile, portal exposure, per-platform budgets, agency-fee modelling, CMK/MSP, automatic month rollover of the sheet.
