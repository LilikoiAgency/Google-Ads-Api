# Add Payless For Solar (PLS) to the Daily Pacing Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Payless For Solar as a fourth client on the daily Budget Pacing Report, sourced from its own Google Sheet, rendered identically to BBT / SMP / MSP.

**Architecture:** No new report section and no new builder code. The pacing pipeline already fetches one Google Sheet per client and renders one `renderClientSection` block per client, so PLS is a config entry plus one parser fix. The only code change is teaching the platform matcher that `X` is a platform, because the PLS sheet has an `X` row that the current matcher silently drops. Registration happens against the live `PacingConfig` Mongo singleton, since editing `DEFAULT_CLIENTS` alone has no effect on an existing install.

**Tech Stack:** Next.js App Router, Vitest, Google Sheets API v4 (service account), MongoDB, Resend.

## Global Constraints

- Client key: `PLS`. Display name: `Payless For Solar`.
- Sheet ID: `1FKPACgebq2_YAAsgswGeBROzJm5JH45c2s2G2k-siyo`
- The PLS sheet has **two tabs only** (PACING + Spends). No `Validation` tab, no `Google Budget` / `Meta Budget` / `Bing Budget` tabs. This is expected: those paths already degrade gracefully — validation box is omitted and Campaign Budget renders `—`.
- Treat PLS exactly like the existing clients. Do not add report sections, columns, tabs, admin UI, or geo handling for it.
- The geo bar reading the first platform row instead of client totals is **pre-existing behavior affecting all clients**. Explicitly out of scope.
- Existing platform matching behavior must not change: `GOOGLE LSA` must still resolve to base platform `GOOGLE` with `displayPlatform` `GOOGLE LSA`.
- Parser changes go in `src/lib/pacingSheets.js` only. Nothing in `pacingReportBuilder.js` changes.

---

### Task 1: Recognize `X` as a platform

The PLS PACING tab has a row with Platform cell `X` (Lead Name `PAID X ADS PAYLESSFORSOLAR ALL`, $4,200 budget, $0 spend). `extractPlatformLines` skips any row whose platform cell matches no entry in `KNOWN_PLATFORMS`, so today that row is dropped silently — it is missing from the table, from the client TOTAL, and from the 0%-spend recommended action.

A naive `upper.includes('X')` would false-match cells like `PMAX`, so single-letter platform names must match on a word boundary.

`extractPlatformLines` is currently module-private. Export it so the parser can be tested without network access.

**Files:**
- Modify: `src/lib/pacingSheets.js:7` (KNOWN_PLATFORMS + new `matchPlatform` helper)
- Modify: `src/lib/pacingSheets.js:128` (export `extractPlatformLines`)
- Modify: `src/lib/pacingSheets.js:148` (use `matchPlatform`)
- Modify: `src/lib/pacingSheets.js:266`, `src/lib/pacingSheets.js:296` (use `matchPlatform` in `fetchValidationTab`)
- Test: `src/__tests__/lib/pacingSheets.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function extractPlatformLines(rows)` — takes `Array<Array<any>>` raw sheet rows, returns `Array<{platform: string, isLsa: boolean, displayPlatform: string, vertical: string, rawLabel: string, budget: number|null, spendMtd: number|null, eomPacing: number|null}>`. Task 3 relies on this returning an `X` line for the PLS sheet.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/pacingSheets.test.js`. The rows mirror the real PLS PACING tab layout: a totals row above the header, then the header row, then platform rows.

```javascript
import { describe, it, expect } from 'vitest';
import { extractPlatformLines } from '../../lib/pacingSheets';

const PLS_ROWS = [
  ['', '', '', '', '', 35700, 5211.49, 31847.62, 0, 31847.62],
  ['REMAINING DAYS', 'Client', 'Platform', 'Campaign Type', 'Lead Name',
   'Current Budget', 'Current Spend', 'Total Budget Pacing', 'ALL', 'CA'],
  [26, 'PLS', 'GOOGLE', 'SOLAR', 'PPC PAYLESSFORSOLAR ALL', 6500, 1257.62, 6847.62, 0, 6847.62],
  ['', 'PLS', 'FACEBOOK', 'SOLAR', 'PAID FB ADS PAYLESSFORSOLAR ALL', 25000, 3953.87, 25000, 0, 25000],
  ['', 'PLS', 'X', 'SOLAR', 'PAID X ADS PAYLESSFORSOLAR ALL', 4200, 0, 0, 0, 0],
];

describe('extractPlatformLines', () => {
  it('includes the X platform row', () => {
    const lines = extractPlatformLines(PLS_ROWS);
    const x = lines.find((l) => l.platform === 'X');
    expect(x).toBeDefined();
    expect(x.displayPlatform).toBe('X');
    expect(x.vertical).toBe('SOLAR');
    expect(x.budget).toBe(4200);
    expect(x.spendMtd).toBe(0);
    expect(x.eomPacing).toBe(0);
  });

  it('parses all three PLS platform rows', () => {
    const lines = extractPlatformLines(PLS_ROWS);
    expect(lines.map((l) => l.platform)).toEqual(['GOOGLE', 'FACEBOOK', 'X']);
  });

  it('does not match X inside other words like PMAX', () => {
    const rows = [
      ['Platform', 'Campaign Type', 'Current Budget', 'Current Spend', 'Total Budget Pacing'],
      ['PMAX', 'SOLAR', 1000, 500, 1000],
    ];
    expect(extractPlatformLines(rows)).toEqual([]);
  });

  it('still resolves GOOGLE LSA to base platform GOOGLE', () => {
    const rows = [
      ['Platform', 'Campaign Type', 'Current Budget', 'Current Spend', 'Total Budget Pacing'],
      ['GOOGLE LSA', 'SOLAR', 2000, 900, 1800],
    ];
    const [line] = extractPlatformLines(rows);
    expect(line.platform).toBe('GOOGLE');
    expect(line.displayPlatform).toBe('GOOGLE LSA');
    expect(line.isLsa).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/__tests__/lib/pacingSheets.test.js`

Expected: FAIL. The import fails because `extractPlatformLines` is not exported (`SyntaxError` / "does not provide an export named 'extractPlatformLines'").

- [ ] **Step 3: Add `X` to the platform list and a boundary-aware matcher**

In `src/lib/pacingSheets.js`, replace line 7:

```javascript
const KNOWN_PLATFORMS = ['GOOGLE', 'YOUTUBE', 'BING', 'FACEBOOK', 'X'];

// Match a platform cell to a known platform. Multi-letter names match as a
// substring so qualifiers survive ("GOOGLE LSA" → GOOGLE). Single-letter names
// like "X" must match as a whole word, or they'd be picked up inside PMAX, MAX, etc.
function matchPlatform(upper) {
  return KNOWN_PLATFORMS.find((p) => (
    p.length > 1 ? upper.includes(p) : new RegExp(`\\b${p}\\b`).test(upper)
  ));
}
```

- [ ] **Step 4: Export `extractPlatformLines` and route all three call sites through `matchPlatform`**

In `src/lib/pacingSheets.js`, change the declaration at line 128:

```javascript
export function extractPlatformLines(rows) {
```

Replace line 148 (inside `extractPlatformLines`):

```javascript
    const platform = matchPlatform(upper);
```

Replace line 266 (inside `fetchValidationTab`, left summary parse):

```javascript
    const platform = matchPlatform(cell);
```

Replace line 296 (inside `fetchValidationTab`, names table parse):

```javascript
      const platform = matchPlatform(cell);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/__tests__/lib/pacingSheets.test.js`

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the full suite to confirm nothing regressed**

Run: `npm test`

Expected: no new failures versus the pre-change baseline. If the baseline already had failures, note which and confirm they are unrelated to `pacingSheets`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pacingSheets.js src/__tests__/lib/pacingSheets.test.js
git commit -m "feat: recognize X as a pacing report platform"
```

---

### Task 2: Grant the service account access and verify the PLS sheet parses

Before touching config, confirm the service account can actually read the sheet and that the parser produces the expected three lines. This is the step most likely to fail at runtime rather than at build time.

**Files:**
- Create: `scripts/verify-pls-sheet.mjs`

**Interfaces:**
- Consumes: `extractPlatformLines` from Task 1.
- Produces: confirmation that `fetchClientSheet('1FKPACgebq2_YAAsgswGeBROzJm5JH45c2s2G2k-siyo', 'PLS')` resolves with 3 lines. Task 3 assumes this passes.

- [ ] **Step 1: Print the service account email**

```bash
node -e "require('dotenv').config({path:'.env'});console.log(JSON.parse(process.env.GOOGLE_SHEETS_SA_KEY).client_email)"
```

Expected: a `...iam.gserviceaccount.com` address.

- [ ] **Step 2: Share the sheet with that address**

Manual step for the user: open https://docs.google.com/spreadsheets/d/1FKPACgebq2_YAAsgswGeBROzJm5JH45c2s2G2k-siyo/edit and share it with the email from Step 1 as **Viewer**. The pipeline requests the `spreadsheets.readonly` scope, so Viewer is sufficient.

- [ ] **Step 3: Write the verification script**

Create `scripts/verify-pls-sheet.mjs`:

```javascript
// One-off: confirm the PLS sheet is readable and parses into the expected lines.
// Run: node scripts/verify-pls-sheet.mjs
import 'dotenv/config';
import { fetchClientSheet } from '../src/lib/pacingSheets.js';

const SHEET_ID = '1FKPACgebq2_YAAsgswGeBROzJm5JH45c2s2G2k-siyo';

const { pacing, validation } = await fetchClientSheet(SHEET_ID, 'PLS');

if (pacing.error) {
  console.error('PACING fetch failed:', pacing.error);
  process.exit(1);
}

console.log(`lines: ${pacing.lines.length}`);
for (const l of pacing.lines) {
  console.log(`  ${l.displayPlatform} / ${l.vertical}: budget=${l.budget} spend=${l.spendMtd} eom=${l.eomPacing} campaignBudget=${l.campaignBudget}`);
}
console.log('remainingDays:', pacing.header.remainingDays);
console.log('validation platforms:', validation.platforms.length, validation.error ? `(${validation.error})` : '');
```

- [ ] **Step 4: Run it**

Run: `node scripts/verify-pls-sheet.mjs`

Expected output — three lines, X present, and validation empty because the tab does not exist:

```
lines: 3
  GOOGLE / SOLAR: budget=6500 spend=1257.62 eom=6847.62 campaignBudget=null
  FACEBOOK / SOLAR: budget=25000 spend=3953.87 eom=25000 campaignBudget=null
  X / SOLAR: budget=4200 spend=0 eom=0 campaignBudget=null
```

`campaignBudget=null` on every line is correct here — the sheet has no budget tabs, so the Campaign Budget column will render `—`.

If it fails with a 403 / "The caller does not have permission", Step 2 was not completed or was applied to the wrong address.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-pls-sheet.mjs
git commit -m "chore: add PLS pacing sheet verification script"
```

---

### Task 3: Register PLS in the pacing config

Two places need the entry, for two different reasons. `DEFAULT_CLIENTS` in `src/lib/pacingPipeline.js:14` only seeds the config document on first run (`loadPacingConfig` inserts it when absent, `:41-52`), so editing it keeps fresh installs correct but does **not** affect this deployment. The live cron reads the `PacingConfig` singleton in Mongo, so that document must be updated directly.

There is deliberately no admin-UI change: `/dashboard/pacing` edits existing clients (`page.js:256`) but has no add control, and adding one is out of scope.

**Files:**
- Modify: `src/lib/pacingPipeline.js:14-18` (DEFAULT_CLIENTS)
- Create: `scripts/add-pls-client.mjs`

**Interfaces:**
- Consumes: verified sheet access from Task 2.
- Produces: a `PacingConfig.clients` array containing `{ key: 'PLS', name: 'Payless For Solar', sheetId: '1FKPACgebq2_YAAsgswGeBROzJm5JH45c2s2G2k-siyo', enabled: true }`.

- [ ] **Step 1: Add PLS to `DEFAULT_CLIENTS`**

In `src/lib/pacingPipeline.js`, append to the array at line 14:

```javascript
const DEFAULT_CLIENTS = [
  { key: 'BBT', name: 'Big Bully Turf',  sheetId: '1MSsCNhqCA53ToFAeAxIC45nxwETMWhg6Ip7eT9RBRgc', enabled: true },
  { key: 'SMP', name: 'Semper Solaris',  sheetId: '1xvWA1WWDHBrABYoWjMJJaaCCV3aQgofSV0m4GT4Eahw', enabled: true },
  { key: 'MSP', name: 'More Space Place', sheetId: '1qzAYyXUbtZ1FwXRkznvlna5g2OMAmby6GcF1sNBqlXE', enabled: true },
  { key: 'PLS', name: 'Payless For Solar', sheetId: '1FKPACgebq2_YAAsgswGeBROzJm5JH45c2s2G2k-siyo', enabled: true },
];
```

- [ ] **Step 2: Write the config update script**

Create `scripts/add-pls-client.mjs`. It is idempotent: re-running updates the existing PLS entry rather than duplicating it.

Note: this script talks to MongoDB directly instead of importing `loadPacingConfig` / `savePacingConfig`. `src/lib/pacingPipeline.js:5` uses an extensionless import (`from './mongoose'`) which Next's bundler resolves but plain Node ESM rejects with `ERR_MODULE_NOT_FOUND`. The DB name, collection, and `_id` below are copied from `pacingPipeline.js:9-12`.

```javascript
// One-off: add PLS to the live PacingConfig singleton in Mongo.
// Run: node scripts/add-pls-client.mjs
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const DB = 'tokensApi';
const CONFIG_COLL = 'PacingConfig';
const CONFIG_ID = 'singleton';

const PLS = {
  key: 'PLS',
  name: 'Payless For Solar',
  sheetId: '1FKPACgebq2_YAAsgswGeBROzJm5JH45c2s2G2k-siyo',
  enabled: true,
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const coll = client.db(DB).collection(CONFIG_COLL);

const cfg = await coll.findOne({ _id: CONFIG_ID });
if (!cfg) {
  console.error('No PacingConfig singleton found. Load /dashboard/pacing once to seed it, then re-run.');
  await client.close();
  process.exit(1);
}

console.log('before:', cfg.clients.map((c) => c.key).join(', '));

const clients = [...cfg.clients];
const idx = clients.findIndex((c) => c.key === 'PLS');
if (idx >= 0) clients[idx] = { ...clients[idx], ...PLS };
else clients.push(PLS);

await coll.updateOne(
  { _id: CONFIG_ID },
  { $set: { clients, updatedAt: new Date() } },
);

const after = await coll.findOne({ _id: CONFIG_ID });
console.log('after:', after.clients.map((c) => `${c.key}${c.enabled ? '' : ' (disabled)'}`).join(', '));

await client.close();
```

- [ ] **Step 3: Run it**

Run: `node scripts/add-pls-client.mjs`

Expected:

```
before: BBT, SMP, MSP
after: BBT, SMP, MSP, PLS
```

If `before` already lists other keys or shows a disabled client, do not overwrite them — the script preserves the existing array, but confirm the `after` line still contains every key from `before`.

- [ ] **Step 4: Confirm the config reads back correctly**

The `after:` line from Step 3 is the read-back — it re-queries the document after the write. Confirm it lists four keys including `PLS`, and that no key from the `before:` line disappeared.

If you want the full document, re-run the script: it is idempotent and prints both lines again without duplicating the entry.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pacingPipeline.js scripts/add-pls-client.mjs
git commit -m "feat: add Payless For Solar to pacing report clients"
```

---

### Task 4: Verify the rendered report end to end

Confirm PLS appears as its own client block with the X row present, and that no existing client's output changed.

**Files:**
- No source changes. Verification only.

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: a confirmed dry-run report. Nothing depends on this task.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Generate a dry-run report**

Sign in at http://localhost:3000 with a `@lilikoiagency.com` account (the pacing routes require it — see `assertAllowed` in `src/app/api/pacing/config/route.js`), then open:

http://localhost:3000/api/pacing/preview

`runPacingReport({ dryRun: true })` builds the HTML and skips both the Resend send and the Mongo insert (`pacingPipeline.js:126`, `:155`), so this is safe to run repeatedly.

- [ ] **Step 3: Check the four assertions**

In the returned HTML / summary, confirm:
1. A `Payless For Solar` client section exists, with its own banner and table.
2. Its table contains three platform rows — `GOOGLE`, `FACEBOOK`, and `X` — plus a TOTAL row.
3. The `X` row shows Budget `$4,200`, Spend MTD `$0.00`, Campaign Budget `—`, and Status `Under`. Because it is a budgeted line at zero spend, PLS should also appear in Recommended Actions under the "lines at 0% spend" item (`pacingReportBuilder.js:358`).
4. The BBT / SMP / MSP sections are unchanged, and `summary.clients` has 4 entries.

- [ ] **Step 4: Check the email rendering**

Send a real test to yourself only: temporarily set `recipients` to just your address via `/dashboard/pacing`, trigger `/api/pacing/send-now`, confirm the PLS block renders correctly in Gmail, then **restore the full recipient list**.

Gmail is the constraint that matters — it strips `<style>` blocks, which is why the builder is inline-only. No new markup was introduced, so this is a sanity check rather than a likely failure point.

- [ ] **Step 5: Commit any fixes**

If Steps 3-4 surfaced problems, fix and commit them. If everything passed, there is nothing to commit — the verification is the deliverable.

---

## Rollback

Set `enabled: false` on the PLS entry via `/dashboard/pacing` and save. The pipeline filters on `enabled` before fetching (`pacingPipeline.js:72`), so PLS drops out of the next run with no code change or redeploy.

Reverting Task 1 is independent: `git revert` the platform commit restores the previous four-platform list without touching client config.
