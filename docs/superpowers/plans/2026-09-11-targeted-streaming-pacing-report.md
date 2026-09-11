# Targeted Streaming Pacing Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second daily pacing email, for Targeted Streaming, fed by the shared "Targeted Streaming Spends" Google Sheet, with its own cron, config, history, trends and dashboard page.

**Architecture:** A parallel subsystem mirroring the Paid Search trio (sheet fetcher → pure HTML builder → pipeline) with the generic helpers factored into two small shared modules first. The dashboard page and trend chart are parameterized so both reports render through one component. The live Paid Search report's behaviour does not change.

**Tech Stack:** Next.js 14 App Router, Vitest, Google Sheets API v4 via `googleapis` (service account), MongoDB (native driver via `src/lib/mongoose.js`), Resend, Recharts.

**Spec:** `docs/superpowers/specs/2026-09-11-targeted-streaming-pacing-report-design.md`

## Global Constraints

- Sheet ID: `1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU` (already shared with `pacing-report-reader@lilikoi-ads-analytics.iam.gserviceaccount.com` as Viewer).
- Clients in scope: `SMP` (Semper Solaris), `BBT` (Big Bully Turf). Pacing tab name is `${key} Pacing`.
- Known platforms: `TRADE DESK`, `PARAMOUNT`, `SPOTIFY`, `DISNEY`, `ADLIB`, `PUBMATIC`. Unknown platform names are **kept** and logged, never dropped.
- Pacing % = EOM pacing ÷ full Final Budget. No agency-fee factor.
- Status thresholds identical to Paid Search: `≤85` UNDER, `≤115` ON_TRACK, else OVER; `>200` critical.
- Mongo db `tokensApi`; collections `StreamingPacingConfig` (`_id: 'singleton'`) and `StreamingPacingReports`.
- Email HTML uses inline styles only (Gmail strips `<style>`).
- Cron: `/api/cron/streaming-pacing-report`, schedule `5 12 * * 1-5` UTC, Bearer `CRON_SECRET`.
- Relative imports **between the sheet/builder modules** (`pacingShared`, `sheetsClient`, `pacingSheets`, `streamingPacingSheets`, `pacingReportBuilder`, `streamingPacingReportBuilder`) use explicit `.js` extensions (e.g. `from './pacingShared.js'`). Next and Vitest resolve both forms, but the `scripts/verify-*-sheet.mjs` one-offs import these files under plain Node ESM, which rejects extensionless paths. Pipelines and routes keep the repo's extensionless style because no script imports them.
- Existing `src/__tests__/lib/pacingSheets.test.js` must pass unchanged after every task.
- Run tests with `npm test -- <path>`; run everything with `npm test`.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Extract shared sheet-parsing and formatting helpers

The Paid Search fetcher and builder each hold small generic helpers. Move them to shared modules so the streaming report reuses them instead of copying.

**Files:**
- Create: `src/lib/sheetsClient.js`
- Create: `src/lib/pacingShared.js`
- Modify: `src/lib/pacingSheets.js` (remove `getAuth`, `readTab`, `toNum`, `normKey`, `colIndex`; import them)
- Modify: `src/lib/pacingReportBuilder.js` (remove `PALETTE`, `fmtCurrency`, `fmtCurrencyNoDec`, `fmtPct`, `fmtDateLong`, `daysInMonth`, `dayOfMonth`, `escapeHtml`; import them)
- Test: `src/__tests__/lib/pacingShared.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sheetsClient.js`: `export async function readTab(sheetId, tabName) → Promise<Array<Array<any>>>` (UNFORMATTED_VALUE, `[]` when empty).
  - `pacingShared.js`: `toNum(v) → number|null`, `normKey(s) → string`, `colIndex(headers, keys) → number` (−1 if none), `findHeaderRow(rows, requiredKeys) → number` (−1 if none; a row matches when, for every entry in `requiredKeys`, some cell's `normKey` equals one of that entry's alternatives), `serialToISO(n) → 'YYYY-MM-DD'`, `statusFromPct(pct) → 'UNDER'|'ON_TRACK'|'OVER'`, `fmtCurrency(n, decimals=2)`, `fmtCurrencyNoDec(n)`, `fmtPct(n)`, `fmtDateLong('YYYY-MM-DD')`, `daysInMonth('YYYY-MM-DD')`, `dayOfMonth('YYYY-MM-DD')`, `escapeHtml(s)`, `PALETTE`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/pacingShared.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  toNum, normKey, colIndex, findHeaderRow, serialToISO, statusFromPct,
  fmtCurrency, fmtCurrencyNoDec, fmtPct, escapeHtml, PALETTE,
} from '../../lib/pacingShared';

describe('pacingShared', () => {
  it('toNum handles numbers, currency strings, blanks and sheet error strings', () => {
    expect(toNum(12.5)).toBe(12.5);
    expect(toNum('$1,234.50')).toBe(1234.5);
    expect(toNum('')).toBeNull();
    expect(toNum(null)).toBeNull();
    expect(toNum('—')).toBeNull();
    expect(toNum('#REF! (Unresolved sheet name)')).toBeNull();
    expect(toNum('#N/A (Argument must be a range.)')).toBeNull();
  });

  it('normKey lowercases and strips non-alphanumerics', () => {
    expect(normKey(' Final Budget ')).toBe('finalbudget');
    expect(normKey('# incorrect Campaign names')).toBe('incorrectcampaignnames');
  });

  it('colIndex finds the first header matching any key', () => {
    expect(colIndex(['Client', 'Platform', 'Current Spend'], ['spend', 'currentspend'])).toBe(2);
    expect(colIndex(['Client'], ['spend'])).toBe(-1);
  });

  it('findHeaderRow locates the row containing every required key', () => {
    const rows = [
      ['', '', 100],
      ['REPORT UPDATED', 'Client', 'Platform', 'Total Pacing'],
      [1, 'SMP', 'PARAMOUNT', 5],
    ];
    expect(findHeaderRow(rows, [['platform'], ['totalpacing', 'pacing']])).toBe(1);
    expect(findHeaderRow(rows, [['platform'], ['budget']])).toBe(-1);
  });

  it('serialToISO converts Google Sheets serial dates', () => {
    expect(serialToISO(46267)).toBe('2026-09-02');
    expect(serialToISO(46235)).toBe('2026-08-01');
  });

  it('statusFromPct applies the shared thresholds', () => {
    expect(statusFromPct(85)).toBe('UNDER');
    expect(statusFromPct(85.1)).toBe('ON_TRACK');
    expect(statusFromPct(115)).toBe('ON_TRACK');
    expect(statusFromPct(115.1)).toBe('OVER');
  });

  it('formats currency and percent with dashes for missing values', () => {
    expect(fmtCurrency(1234.5)).toBe('$1,234.50');
    expect(fmtCurrencyNoDec(1234.5)).toBe('$1,235');
    expect(fmtCurrency(null)).toBe('—');
    expect(fmtPct(101.234)).toBe('101.2%');
    expect(fmtPct(null)).toBe('—');
  });

  it('escapeHtml escapes the five special characters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });

  it('exposes the shared palette', () => {
    expect(PALETTE.headerBg).toBe('#1a1a2e');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/__tests__/lib/pacingShared.test.js`
Expected: FAIL — cannot resolve `../../lib/pacingShared`.

- [ ] **Step 3: Create `src/lib/sheetsClient.js`**

```javascript
// src/lib/sheetsClient.js
// Service-account Google Sheets reader shared by every sheet-backed report.

import { google } from 'googleapis';

function getAuth() {
  const raw = process.env.GOOGLE_SHEETS_SA_KEY;
  if (!raw) throw new Error('GOOGLE_SHEETS_SA_KEY env var not set');
  let creds;
  try { creds = JSON.parse(raw); }
  catch { throw new Error('GOOGLE_SHEETS_SA_KEY is not valid JSON'); }
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

export async function readTab(sheetId, tabName) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: tabName,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return res.data.values || [];
}
```

- [ ] **Step 4: Create `src/lib/pacingShared.js`**

```javascript
// src/lib/pacingShared.js
// Helpers shared by the Paid Search and Targeted Streaming pacing reports:
// sheet cell parsing, header lookup, status thresholds, and inline-email formatting.

// ── Cell parsing ──────────────────────────────────────────────────────────────

export function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s.startsWith('#')) return null; // #REF!, #N/A, #DIV/0! etc. from broken formulas
  const cleaned = s.replace(/[$,\s]/g, '').replace(/%$/, '');
  if (cleaned === '' || cleaned === '—' || cleaned === '-' || cleaned.toLowerCase() === 'n/a') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// First header index whose normalized text matches any of keys; -1 if none.
export function colIndex(headers, keys) {
  const wanted = keys.map(normKey);
  for (let i = 0; i < headers.length; i++) {
    if (wanted.includes(normKey(headers[i]))) return i;
  }
  return -1;
}

// Index of the first row that has, for every group in requiredKeys, at least one
// cell whose normalized text equals one of that group's alternatives; -1 if none.
export function findHeaderRow(rows, requiredKeys) {
  for (let r = 0; r < rows.length; r++) {
    const row = (rows[r] || []).map(normKey);
    const ok = requiredKeys.every((alts) => alts.map(normKey).some((k) => row.includes(k)));
    if (ok) return r;
  }
  return -1;
}

// Google Sheets serial date (days since 1899-12-30) → 'YYYY-MM-DD'.
export function serialToISO(n) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

// ── Status thresholds ─────────────────────────────────────────────────────────

export function statusFromPct(pct) {
  if (pct <= 85) return 'UNDER';
  if (pct <= 115) return 'ON_TRACK';
  return 'OVER';
}

// ── Email formatting ──────────────────────────────────────────────────────────

export const PALETTE = {
  headerBg: '#1a1a2e',
  onTrackBg: '#38a169',
  underBg: '#3182ce',
  overBg: '#dd6b20',
  criticalBg: '#e53e3e',
  noBudgetBg: '#fff3cd',
  noBudgetText: '#856404',
  inactiveBg: '#edf2f7',
  inactiveText: '#4a5568',
  rowNormal: '#ffffff',
  rowWarn: '#fffff0',
  rowCritical: '#fff5f5',
  rowInactive: '#f9fafb',
  rowTotal: '#f7fafc',
  textPrimary: '#2d3748',
  textSecondary: '#4a5568',
  textMuted: '#a0aec0',
  onTrackText: '#276749',
  overText: '#c05621',
  underText: '#2b6cb0',
  criticalText: '#e53e3e',
  borderLight: '#edf2f7',
  borderMed: '#e2e8f0',
};

export function fmtCurrency(n, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
export function fmtCurrencyNoDec(n) { return fmtCurrency(n, 0); }

export function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(1) + '%';
}

export function fmtDateLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function daysInMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function dayOfMonth(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDate();
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 5: Point `pacingSheets.js` at the shared modules**

In `src/lib/pacingSheets.js`:

1. Replace the single import line `import { google } from 'googleapis';` with:

```javascript
import { readTab } from './sheetsClient.js';
import { toNum, normKey, colIndex } from './pacingShared.js';
```

2. Delete the local `getAuth` function, the local `readTab` function, the local `toNum` function, the local `normKey` function, and the local `colIndex` function (the one that returns the first match — keep `allColIndices`, `findLabel`, and everything else).

Everything else in the file stays. `matchPlatform`, `KNOWN_PLATFORMS`, `KNOWN_GEOS`, `extractPlatformLines`, `fetchValidationTab`, `budgetTabCandidates`, `fetchClientSheet` are untouched.

- [ ] **Step 6: Point `pacingReportBuilder.js` at the shared module**

In `src/lib/pacingReportBuilder.js`:

1. Add at the top, under the file comment:

```javascript
import {
  PALETTE, fmtCurrency, fmtCurrencyNoDec, fmtPct, fmtDateLong,
  daysInMonth, dayOfMonth, escapeHtml,
} from './pacingShared.js';
```

2. Delete the local `const PALETTE = { ... };` block and the local `fmtCurrency`, `fmtCurrencyNoDec`, `fmtPct`, `fmtDateLong`, `daysInMonth`, `dayOfMonth`, `escapeHtml` function definitions (the whole "Utilities" section). Keep `classifyLine`, `isEmptyLine`, `classifyClientTotal` and everything below unchanged.

- [ ] **Step 7: Run the tests**

Run: `npm test -- src/__tests__/lib/pacingShared.test.js src/__tests__/lib/pacingSheets.test.js`
Expected: PASS — 9 new tests plus the existing 6.

- [ ] **Step 8: Run the full suite and a build check**

Run: `npm test` then `npx next build 2>&1 | tail -20`
Expected: no new test failures versus the baseline; build succeeds (this proves the builder's remaining code has no dangling references to the removed helpers).

Then confirm the existing one-off scripts still resolve under plain Node:

Run: `node scripts/verify-rec-sheet.mjs`
Expected: prints `lines: N` and per-platform rows for Ranger Electric, no `ERR_MODULE_NOT_FOUND`. If it fails to resolve `./sheetsClient` or `./pacingShared`, an import in `pacingSheets.js` is missing its `.js` extension.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sheetsClient.js src/lib/pacingShared.js src/lib/pacingSheets.js src/lib/pacingReportBuilder.js src/__tests__/lib/pacingShared.test.js
git commit -m "refactor: extract shared sheet and formatting helpers from pacing report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Streaming sheet parsers (pure functions)

Three exported parsers, one per tab, tested against fixtures copied from the real sheet on 2026-09-11.

**Files:**
- Create: `src/lib/streamingPacingSheets.js` (parsers only in this task; the network fetcher is Task 3)
- Test: `src/__tests__/lib/streamingPacingSheets.test.js`

**Interfaces:**
- Consumes: `toNum`, `normKey`, `colIndex`, `findHeaderRow`, `serialToISO` from `src/lib/pacingShared.js`.
- Produces:
  - `export const KNOWN_STREAMING_PLATFORMS = ['TRADE DESK','PARAMOUNT','SPOTIFY','DISNEY','ADLIB','PUBMATIC']`
  - `export function parseClientInfo(rows) → { currentMonth: string|null, currentYear: number|null, lastUpdated: string|null, lastUpdatedDay: number|null, daysInMonth: number|null }`
  - `export function parseBudgetTab(rows) → { byClient: Record<string, number>, byClientVertical: Record<string, Record<string, number>> }`
  - `export function extractStreamingLines(rows) → Array<{ platform: string, vertical: string, spendMtd: number|null, eomPacing: number|null, geos: Array<{ name: string, pacing: number }> }>`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/lib/streamingPacingSheets.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  parseClientInfo, parseBudgetTab, extractStreamingLines, KNOWN_STREAMING_PLATFORMS,
} from '../../lib/streamingPacingSheets';

// Copied from the live "Targeted Streaming Spends" sheet on 2026-09-11.
const CLIENT_INFO_ROWS = [
  ['As of 46267', 'Client Abbreviation', 'Current Month', 'Current Year', 'Last Updated',
   'Beginning of Month', 'End of Month', "Today's Date", 'Last Updated Day', 'Yesterday Day', 'Days in Month'],
  ['Multiple', 'Multiple', 'August', 2026, 46267, 46235, 46265, 46276, 31, 30, 31],
];

const BUDGET_ROWS = [
  ['Client Abbreviation', 'Lead Name', 'Budget Category', 'Final Budget', 'Solar Budget', 'Roofing Budget', 'HVAC Budget', 'Windows Budget', 'Turf Budget'],
  ['SMP', 'TARGETED STREAMING ALL', 'Targeted Streaming', 101939.86, 101939.86],
  ['SMP', 'TARGETED STREAMING ROOF ALL', 'Targeted Streaming', 3574.3, '', 3574.3],
  ['SMP', 'TARGETED STREAMING HVAC ALL', 'Targeted Streaming', 3548.91, '', '', 3548.91],
  ['SMP', 'TARGETED STREAMING WINDOWS ALL', 'Targeted Streaming', 3573.87, '', '', '', 3573.87],
  ['BBT', 'TARGETED STREAMING CA', 'Targeted Streaming', 14536.34, '', '', '', '', 14536.34],
  ['BBT', 'TARGETED STREAMING NV', 'Targeted Streaming', 11939.96, '', '', '', '', 11939.96],
];

const BBT_PACING_ROWS = [
  ['', '', '', '', '', 0, 31773.45, 31773.45, 5107.34, 6592.31, 1108.39, 0, 4715.96, 5059.81, 4428.70, 1414.08, 0, 1681.00, 1539.63, 91.55, 34.68],
  ['REPORT UPDATED', 'Client', 'Platform', 'Vertical', 'Lead Name', 'Current Budget', 'Current Spend', 'Total Pacing',
   'ALL', 'SD', 'IE', 'OC', 'LV', 'DAL', 'PHX', 'TUS', 'NAZ', 'SLC', 'STG', 'AUS', 'SAT'],
  [46267, 'BBT', 'Trade Desk', 'TURF', '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ['', 'BBT', 'PARAMOUNT', 'TURF', '', '', 19599.87, 19599.87, 522.91, 5443.45, 550.69, 0, 3500.89, 3687.17, 2936.83, 1083.40, 0, 1287.39, 460.91, 91.55, 34.68],
  ['', 'BBT', 'SPOTIFY', 'TURF', '', '', 3600.14, 3600.14, 0, 514.26, 536.13, 0, 518.4, 533.72, 521.33, 0, 0, 0, 976.3, 0, 0],
  ['', 'BBT', 'DISNEY', 'TURF', '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ['', 'BBT', 'Netflix Direct', 'TURF', '', '', 100, 110, 110, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

describe('parseClientInfo', () => {
  it('reads the control cells and converts serial dates', () => {
    expect(parseClientInfo(CLIENT_INFO_ROWS)).toEqual({
      currentMonth: 'August',
      currentYear: 2026,
      lastUpdated: '2026-09-02',
      lastUpdatedDay: 31,
      daysInMonth: 31,
    });
  });

  it('returns nulls when the header row is missing', () => {
    expect(parseClientInfo([['nothing', 'here']])).toEqual({
      currentMonth: null, currentYear: null, lastUpdated: null, lastUpdatedDay: null, daysInMonth: null,
    });
  });
});

describe('parseBudgetTab', () => {
  it('sums Final Budget per client', () => {
    const { byClient } = parseBudgetTab(BUDGET_ROWS);
    expect(byClient.SMP).toBeCloseTo(112636.94, 2);
    expect(byClient.BBT).toBeCloseTo(26476.30, 2);
  });

  it('assigns each row to the vertical whose budget column is populated', () => {
    const { byClientVertical } = parseBudgetTab(BUDGET_ROWS);
    expect(byClientVertical.SMP).toEqual({
      SOLAR: 101939.86, ROOF: 3574.3, HVAC: 3548.91, WINDOWS: 3573.87,
    });
    expect(byClientVertical.BBT.TURF).toBeCloseTo(26476.30, 2);
  });

  it('skips rows whose Final Budget is a sheet error string', () => {
    const rows = [
      BUDGET_ROWS[0],
      ['SMP', 'TARGETED STREAMING ALL', 'Targeted Streaming', '#REF! (Unresolved sheet name)', '#REF!'],
    ];
    expect(parseBudgetTab(rows)).toEqual({ byClient: {}, byClientVertical: {} });
  });

  it('counts a row with no vertical column toward the client total only', () => {
    const rows = [
      BUDGET_ROWS[0],
      ['CMK', 'TARGETED STREAMING TMP', 'Targeted Streaming', 500],
    ];
    const out = parseBudgetTab(rows);
    expect(out.byClient.CMK).toBe(500);
    expect(out.byClientVertical.CMK).toEqual({});
  });
});

describe('extractStreamingLines', () => {
  it('drops all-zero platform rows and keeps the rest', () => {
    const lines = extractStreamingLines(BBT_PACING_ROWS);
    expect(lines.map((l) => l.platform)).toEqual(['PARAMOUNT', 'SPOTIFY', 'NETFLIX DIRECT']);
  });

  it('normalizes known platform names and keeps unknown ones upper-cased', () => {
    const rows = [
      BBT_PACING_ROWS[1],
      ['', 'BBT', 'Trade Desk', 'TURF', '', '', 10, 12, 12],
      ['', 'BBT', 'Netflix Direct', 'TURF', '', '', 10, 12, 12],
    ];
    const lines = extractStreamingLines(rows);
    expect(lines[0].platform).toBe('TRADE DESK');
    expect(KNOWN_STREAMING_PLATFORMS).toContain(lines[0].platform);
    expect(lines[1].platform).toBe('NETFLIX DIRECT');
  });

  it('reads spend, EOM pacing and the non-zero geo breakdown', () => {
    const [paramount] = extractStreamingLines(BBT_PACING_ROWS);
    expect(paramount.vertical).toBe('TURF');
    expect(paramount.spendMtd).toBe(19599.87);
    expect(paramount.eomPacing).toBe(19599.87);
    expect(paramount.geos).toEqual([
      { name: 'ALL', pacing: 522.91 },
      { name: 'SD', pacing: 5443.45 },
      { name: 'IE', pacing: 550.69 },
      { name: 'LV', pacing: 3500.89 },
      { name: 'DAL', pacing: 3687.17 },
      { name: 'PHX', pacing: 2936.83 },
      { name: 'TUS', pacing: 1083.40 },
      { name: 'SLC', pacing: 1287.39 },
      { name: 'STG', pacing: 460.91 },
      { name: 'AUS', pacing: 91.55 },
      { name: 'SAT', pacing: 34.68 },
    ]);
  });

  it('stops at a TOTAL row and returns [] without a header', () => {
    const rows = [
      BBT_PACING_ROWS[1],
      ['', 'BBT', 'SPOTIFY', 'TURF', '', '', 10, 12, 12],
      ['', '', 'TOTAL', '', '', '', 10, 12, 12],
      ['', 'BBT', 'DISNEY', 'TURF', '', '', 10, 12, 12],
    ];
    expect(extractStreamingLines(rows)).toHaveLength(1);
    expect(extractStreamingLines([['no', 'header']])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/__tests__/lib/streamingPacingSheets.test.js`
Expected: FAIL — cannot resolve `../../lib/streamingPacingSheets`.

- [ ] **Step 3: Write the parsers**

Create `src/lib/streamingPacingSheets.js`:

```javascript
// src/lib/streamingPacingSheets.js
// Parsers + fetcher for the shared "Targeted Streaming Spends" Google Sheet.
// Tabs read: "Client Information", "Budget", and one "<KEY> Pacing" tab per client.
// Parsing is header-keyword based so column order can move without breaking us.

import { toNum, normKey, colIndex, findHeaderRow, serialToISO } from './pacingShared.js';

export const KNOWN_STREAMING_PLATFORMS = ['TRADE DESK', 'PARAMOUNT', 'SPOTIFY', 'DISNEY', 'ADLIB', 'PUBMATIC'];

// "Solar Budget" column populated → this row's budget belongs to the SOLAR vertical, etc.
const VERTICAL_COLUMNS = {
  solarbudget: 'SOLAR',
  roofingbudget: 'ROOF',
  hvacbudget: 'HVAC',
  windowsbudget: 'WINDOWS',
  turfbudget: 'TURF',
};

// ── Client Information ────────────────────────────────────────────────────────

const EMPTY_INFO = { currentMonth: null, currentYear: null, lastUpdated: null, lastUpdatedDay: null, daysInMonth: null };

export function parseClientInfo(rows) {
  const h = findHeaderRow(rows, [['currentmonth'], ['lastupdated']]);
  if (h < 0) return { ...EMPTY_INFO };
  const headers = rows[h];
  const values = rows[h + 1] || [];
  const pick = (keys) => { const i = colIndex(headers, keys); return i >= 0 ? values[i] : undefined; };

  const monthRaw = pick(['currentmonth']);
  const serial = toNum(pick(['lastupdated']));
  return {
    currentMonth: monthRaw ? String(monthRaw).trim() : null,
    currentYear: toNum(pick(['currentyear'])),
    lastUpdated: serial != null ? serialToISO(serial) : null,
    lastUpdatedDay: toNum(pick(['lastupdatedday'])),
    daysInMonth: toNum(pick(['daysinmonth'])),
  };
}

// ── Budget ────────────────────────────────────────────────────────────────────

export function parseBudgetTab(rows) {
  const out = { byClient: {}, byClientVertical: {} };
  const h = findHeaderRow(rows, [['clientabbreviation', 'client'], ['finalbudget']]);
  if (h < 0) return out;
  const headers = rows[h];
  const cClient = colIndex(headers, ['clientabbreviation', 'client']);
  const cFinal = colIndex(headers, ['finalbudget']);
  const verticalCols = headers
    .map((name, i) => ({ vertical: VERTICAL_COLUMNS[normKey(name)], i }))
    .filter((v) => v.vertical);

  for (const raw of rows.slice(h + 1)) {
    const row = raw || [];
    const client = String(row[cClient] || '').trim().toUpperCase();
    const final = toNum(row[cFinal]);
    if (!client || final == null) continue;

    out.byClient[client] = (out.byClient[client] || 0) + final;
    out.byClientVertical[client] = out.byClientVertical[client] || {};

    const hit = verticalCols.find((v) => (toNum(row[v.i]) || 0) > 0);
    if (hit) {
      const bucket = out.byClientVertical[client];
      bucket[hit.vertical] = (bucket[hit.vertical] || 0) + final;
    }
  }
  return out;
}

// ── <KEY> Pacing ──────────────────────────────────────────────────────────────

function normalizePlatform(cell) {
  const upper = String(cell || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return KNOWN_STREAMING_PLATFORMS.find((p) => upper.includes(p)) || upper;
}

export function extractStreamingLines(rows) {
  const h = findHeaderRow(rows, [['platform'], ['totalpacing', 'eompacing', 'pacing']]);
  if (h < 0) return [];
  const headers = rows[h];
  const cPlatform = colIndex(headers, ['platform']);
  const cVertical = colIndex(headers, ['vertical', 'campaigntype']);
  const cSpend = colIndex(headers, ['currentspend', 'totalcurrentspend', 'spend']);
  const cPacing = colIndex(headers, ['totalpacing', 'eompacing', 'pacing']);
  const geoCols = headers
    .map((name, i) => ({ name: String(name || '').trim().toUpperCase(), i }))
    .filter((g) => g.i > cPacing && g.name);

  const lines = [];
  for (const raw of rows.slice(h + 1)) {
    const row = raw || [];
    const platformCell = String(row[cPlatform] || '').trim();
    if (!platformCell) continue;
    const upper = platformCell.toUpperCase();
    if (upper === 'TOTAL' || upper === 'TOTALS' || upper.startsWith('GRAND')) break;

    const platform = normalizePlatform(platformCell);
    if (!KNOWN_STREAMING_PLATFORMS.includes(platform)) {
      console.warn(`[streaming-pacing] unknown platform "${platformCell}" kept as "${platform}"`);
    }

    const spendMtd = cSpend >= 0 ? toNum(row[cSpend]) : null;
    const eomPacing = cPacing >= 0 ? toNum(row[cPacing]) : null;
    const geos = geoCols
      .map((g) => ({ name: g.name, pacing: toNum(row[g.i]) }))
      .filter((g) => g.pacing != null && g.pacing > 0);

    if (!(spendMtd > 0) && !(eomPacing > 0) && geos.length === 0) continue;

    lines.push({
      platform,
      vertical: cVertical >= 0 ? String(row[cVertical] || '').trim().toUpperCase() : '',
      spendMtd,
      eomPacing,
      geos,
    });
  }
  return lines;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/__tests__/lib/streamingPacingSheets.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/streamingPacingSheets.js src/__tests__/lib/streamingPacingSheets.test.js
git commit -m "feat: parsers for the Targeted Streaming pacing sheet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Streaming sheet fetcher and live verification script

Wire the parsers to the Sheets API, and prove the real sheet parses before writing the builder.

**Files:**
- Modify: `src/lib/streamingPacingSheets.js` (append `fetchStreamingSheet`)
- Create: `scripts/verify-streaming-sheet.mjs`

**Interfaces:**
- Consumes: `readTab` from `src/lib/sheetsClient.js`; parsers from Task 2.
- Produces: `export async function fetchStreamingSheet(sheetId, clients) → Promise<{ info, budgets, clients: Array<{ key, name, lines, budget: number|null, verticalBudgets: Record<string, number>, error: string|null }> }>` where `clients` input is `Array<{ key: string, name: string }>` (already filtered to enabled), `info` is the `parseClientInfo` shape, and `budgets` is the `parseBudgetTab` shape.

- [ ] **Step 1: Append the fetcher**

Add to the top of `src/lib/streamingPacingSheets.js`, under the existing import:

```javascript
import { readTab } from './sheetsClient.js';
```

Append at the end of the file:

```javascript
// ── Fetcher ───────────────────────────────────────────────────────────────────

async function safeReadTab(sheetId, tabName, tag) {
  try {
    const rows = await readTab(sheetId, tabName);
    console.log(`${tag} "${tabName}" rows=${rows.length}`);
    return { rows, error: null };
  } catch (err) {
    console.warn(`${tag} "${tabName}" read failed: ${err?.message}`);
    return { rows: [], error: err?.message || `failed to read ${tabName}` };
  }
}

/**
 * Read Client Information, Budget, and every client's "<KEY> Pacing" tab in parallel.
 * A missing/unreadable Pacing tab is a per-client error; Client Information and Budget
 * errors are surfaced on `info.error` / `budgets.error` and the run continues.
 */
export async function fetchStreamingSheet(sheetId, clients) {
  const tag = '[streaming-pacing]';
  const [infoRes, budgetRes, ...pacingRes] = await Promise.all([
    safeReadTab(sheetId, 'Client Information', tag),
    safeReadTab(sheetId, 'Budget', tag),
    ...clients.map((c) => safeReadTab(sheetId, `${c.key} Pacing`, `${tag}:${c.key}`)),
  ]);

  const info = { ...parseClientInfo(infoRes.rows), error: infoRes.error };
  const budgets = { ...parseBudgetTab(budgetRes.rows), error: budgetRes.error };
  console.log(`${tag} info`, JSON.stringify(info));
  console.log(`${tag} budgets`, JSON.stringify(budgets.byClient));

  const out = clients.map((c, i) => {
    const res = pacingRes[i];
    const lines = res.error ? [] : extractStreamingLines(res.rows);
    const key = c.key.toUpperCase();
    for (const l of lines) {
      console.log(`${tag}:${key}   ${l.platform} / ${l.vertical}: spend=${l.spendMtd} eom=${l.eomPacing} geos=${l.geos.length}`);
    }
    return {
      key,
      name: c.name,
      lines,
      budget: budgets.byClient[key] ?? null,
      verticalBudgets: budgets.byClientVertical[key] || {},
      error: res.error,
    };
  });

  return { info, budgets, clients: out };
}
```

- [ ] **Step 2: Write the verification script**

Create `scripts/verify-streaming-sheet.mjs`:

```javascript
// One-off: confirm the Targeted Streaming sheet is readable and parses as expected.
// Run: node scripts/verify-streaming-sheet.mjs
//
// Imports the .js modules directly with explicit extensions because plain Node ESM
// does not resolve the extensionless imports Next uses inside src/lib.
import 'dotenv/config';
import { fetchStreamingSheet } from '../src/lib/streamingPacingSheets.js';

const SHEET_ID = '1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU';
const CLIENTS = [
  { key: 'SMP', name: 'Semper Solaris' },
  { key: 'BBT', name: 'Big Bully Turf' },
];

const { info, budgets, clients } = await fetchStreamingSheet(SHEET_ID, CLIENTS);

console.log('\ninfo:', info);
console.log('budgets byClient:', budgets.byClient);
console.log('budgets byClientVertical:', JSON.stringify(budgets.byClientVertical, null, 2));
for (const c of clients) {
  console.log(`\n${c.key} (${c.name}) budget=${c.budget} lines=${c.lines.length} error=${c.error}`);
  for (const l of c.lines) {
    const geo = l.geos.map((g) => `${g.name}:${g.pacing.toFixed(0)}`).join(' ');
    console.log(`  ${l.platform.padEnd(12)} ${l.vertical.padEnd(8)} spend=${l.spendMtd?.toFixed(2)} eom=${l.eomPacing?.toFixed(2)}  ${geo}`);
  }
}
```

- [ ] **Step 3: Run the script against the live sheet**

Run: `node scripts/verify-streaming-sheet.mjs`

Expected (values will drift as the sheet updates; shape is what matters):
- `info.currentMonth` is a month name, `info.lastUpdated` is an ISO date, `daysInMonth` is 28–31.
- `budgets.byClient` has `SMP` and `BBT`; `byClientVertical.SMP` has `SOLAR`, `ROOF`, `HVAC`, `WINDOWS`; `byClientVertical.BBT` has `TURF`.
- SMP lists 10–16 lines across four verticals; BBT lists 4 lines (PARAMOUNT, SPOTIFY, ADLIB, PUBMATIC) all `TURF`. Trade Desk and Disney rows with zero everywhere are absent.
- No `error` on any client.

If Node reports `ERR_MODULE_NOT_FOUND` for `./pacingShared` or `./sheetsClient`, an import is missing its `.js` extension (see Global Constraints). Fix the import, do not change the script.

- [ ] **Step 4: Commit**

```bash
git add src/lib/streamingPacingSheets.js scripts/verify-streaming-sheet.mjs
git commit -m "feat: fetch and verify the Targeted Streaming pacing sheet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Streaming report builder (pure HTML + summary)

**Files:**
- Create: `src/lib/streamingPacingReportBuilder.js`
- Test: `src/__tests__/lib/streamingPacingReportBuilder.test.js`

**Interfaces:**
- Consumes: `PALETTE`, `fmtCurrency`, `fmtCurrencyNoDec`, `fmtPct`, `fmtDateLong`, `escapeHtml`, `statusFromPct` from `src/lib/pacingShared.js`; the `fetchStreamingSheet` result shape from Task 3.
- Produces: `export function buildStreamingPacingReport({ reportDate, info, clients }) → { html: string, summary }` with
  `summary = { reportDate, dataAsOf, sheetMonth, stale, clients: Array<{ key, name, status, pacingPct, totalBudget, totalSpend, totalEomPacing, verticalCount, lineCount }>, actionCount }`.
  Also exported for tests: `classifyTotals({ budget, eomPacing }) → { status, pacingPct }`, `groupByVertical(lines) → Array<{ vertical, lines, spendMtd, eomPacing }>`, `isSheetStale(info, reportDate) → boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/lib/streamingPacingReportBuilder.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  buildStreamingPacingReport, classifyTotals, groupByVertical, isSheetStale,
} from '../../lib/streamingPacingReportBuilder';

const INFO = { currentMonth: 'August', currentYear: 2026, lastUpdated: '2026-09-02', lastUpdatedDay: 31, daysInMonth: 31, error: null };

const SMP = {
  key: 'SMP', name: 'Semper Solaris', error: null,
  budget: 112636.94,
  verticalBudgets: { SOLAR: 101939.86, ROOF: 3574.3, HVAC: 3548.91, WINDOWS: 3573.87 },
  lines: [
    { platform: 'PARAMOUNT', vertical: 'SOLAR', spendMtd: 37225.48, eomPacing: 37225.48, geos: [{ name: 'SD', pacing: 11601.81 }, { name: 'SF', pacing: 10389.30 }, { name: 'ALL', pacing: 5330.05 }] },
    { platform: 'SPOTIFY',   vertical: 'SOLAR', spendMtd: 6997.59,  eomPacing: 6997.59,  geos: [{ name: 'SD', pacing: 999.57 }] },
    { platform: 'DISNEY',    vertical: 'ROOF',  spendMtd: 499.98,   eomPacing: 499.98,   geos: [{ name: 'ALL', pacing: 499.98 }] },
    { platform: 'ADLIB',     vertical: 'ROOF',  spendMtd: 1001.96,  eomPacing: 1001.96,  geos: [{ name: 'SF', pacing: 1001.96 }] },
    { platform: 'PUBMATIC',  vertical: 'ROOF',  spendMtd: 1000.07,  eomPacing: 9000,     geos: [{ name: 'SD', pacing: 9000 }] },
  ],
};

const BBT_NO_DATA = { key: 'BBT', name: 'Big Bully Turf', error: null, budget: 63989.86, verticalBudgets: { TURF: 63989.86 }, lines: [] };
const CMK_ERR = { key: 'CMK', name: 'CMK Construction', error: 'Unable to parse range: CMK Pacing', budget: null, verticalBudgets: {}, lines: [] };

describe('classifyTotals', () => {
  it('returns NO_BUDGET when there is no budget', () => {
    expect(classifyTotals({ budget: 0, eomPacing: 100 })).toEqual({ status: 'NO_BUDGET', pacingPct: null });
    expect(classifyTotals({ budget: null, eomPacing: 100 })).toEqual({ status: 'NO_BUDGET', pacingPct: null });
  });
  it('computes pacing % against budget and applies thresholds', () => {
    expect(classifyTotals({ budget: 1000, eomPacing: 500 })).toEqual({ status: 'UNDER', pacingPct: 50 });
    expect(classifyTotals({ budget: 1000, eomPacing: 1000 })).toEqual({ status: 'ON_TRACK', pacingPct: 100 });
    expect(classifyTotals({ budget: 1000, eomPacing: 1500 })).toEqual({ status: 'OVER', pacingPct: 150 });
  });
});

describe('groupByVertical', () => {
  it('groups lines in first-seen vertical order with subtotals', () => {
    const groups = groupByVertical(SMP.lines);
    expect(groups.map((g) => g.vertical)).toEqual(['SOLAR', 'ROOF']);
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[0].spendMtd).toBeCloseTo(44223.07, 2);
    expect(groups[1].eomPacing).toBeCloseTo(10501.94, 2);
  });
});

describe('isSheetStale', () => {
  it('is stale when the sheet month differs from the report month', () => {
    expect(isSheetStale(INFO, '2026-09-11')).toBe(true);
    expect(isSheetStale({ ...INFO, currentMonth: 'September' }, '2026-09-11')).toBe(false);
  });
  it('is not stale when the month is unknown', () => {
    expect(isSheetStale({ ...INFO, currentMonth: null }, '2026-09-11')).toBe(false);
  });
});

describe('buildStreamingPacingReport', () => {
  const { html, summary } = buildStreamingPacingReport({ reportDate: '2026-09-11', info: INFO, clients: [SMP, BBT_NO_DATA, CMK_ERR] });

  it('renders the header with data-as-of and a stale warning', () => {
    expect(html).toContain('Targeted Streaming Pacing Report');
    expect(html).toContain('September 11, 2026');
    expect(html).toContain('Data as of September 2, 2026');
    expect(html).toContain('August 2026');
    expect(html).toContain('Sheet is still on August');
  });

  it('omits the stale warning when the sheet is current', () => {
    const cur = buildStreamingPacingReport({ reportDate: '2026-09-11', info: { ...INFO, currentMonth: 'September' }, clients: [SMP] });
    expect(cur.html).not.toContain('Sheet is still on');
    expect(cur.summary.stale).toBe(false);
  });

  it('renders vertical subtotal rows and platform rows with geo breakdowns', () => {
    expect(html).toContain('SOLAR');
    expect(html).toContain('$101,940');           // SOLAR vertical budget
    expect(html).toContain('SD $11,601.81');       // geo breakdown, largest first
    expect(html.indexOf('SD $11,601.81')).toBeLessThan(html.indexOf('SF $10,389.30'));
    expect(html).toContain('$44,223.07');          // SOLAR spend subtotal
  });

  it('renders a data-unavailable section for a client fetch error', () => {
    expect(html).toContain('CMK Construction');
    expect(html).toContain('Data unavailable');
    expect(html).toContain('Unable to parse range: CMK Pacing');
  });

  it('builds recommended actions at the vertical level', () => {
    expect(html).toContain('Recommended Actions');
    expect(html).toContain('ROOF CRITICALLY OVER PACING');       // 10501.94 / 3574.3 = 293%
    expect(html).toContain('Big Bully Turf — No spend data');    // budgeted client with zero lines
    expect(html).toContain('HVAC, WINDOWS');                     // budgeted verticals with no spend
    expect(html).toContain('roll');                              // stale-sheet action
  });

  it('produces the summary shape used by latest/trends', () => {
    expect(summary.reportDate).toBe('2026-09-11');
    expect(summary.dataAsOf).toBe('2026-09-02');
    expect(summary.sheetMonth).toBe('August 2026');
    expect(summary.stale).toBe(true);
    expect(summary.clients).toHaveLength(3);
    const smp = summary.clients.find((c) => c.key === 'SMP');
    expect(smp.totalBudget).toBeCloseTo(112636.94, 2);
    expect(smp.totalSpend).toBeCloseTo(46725.08, 2);
    expect(smp.status).toBe('UNDER');
    expect(smp.verticalCount).toBe(2);
    expect(smp.lineCount).toBe(5);
    expect(summary.actionCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/__tests__/lib/streamingPacingReportBuilder.test.js`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the builder**

Create `src/lib/streamingPacingReportBuilder.js`:

```javascript
// src/lib/streamingPacingReportBuilder.js
// Pure functions: parsed Targeted Streaming sheet data → email HTML + structured summary.
// Styling is 100% inline per Gmail constraints.

import {
  PALETTE, fmtCurrency, fmtCurrencyNoDec, fmtPct, fmtDateLong, escapeHtml, statusFromPct,
} from './pacingShared.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_GEOS = 6;

// ── Classification ────────────────────────────────────────────────────────────

export function classifyTotals({ budget, eomPacing }) {
  if (!budget || budget <= 0) return { status: 'NO_BUDGET', pacingPct: null };
  const pct = ((eomPacing || 0) / budget) * 100;
  return { status: statusFromPct(pct), pacingPct: pct };
}

export function groupByVertical(lines) {
  const order = [];
  const map = new Map();
  for (const l of lines) {
    const v = l.vertical || 'GENERAL';
    if (!map.has(v)) { map.set(v, { vertical: v, lines: [], spendMtd: 0, eomPacing: 0 }); order.push(v); }
    const g = map.get(v);
    g.lines.push(l);
    g.spendMtd += l.spendMtd || 0;
    g.eomPacing += l.eomPacing || 0;
  }
  return order.map((v) => map.get(v));
}

export function isSheetStale(info, reportDate) {
  if (!info?.currentMonth) return false;
  const reportMonth = MONTHS[new Date(reportDate + 'T00:00:00').getMonth()];
  return info.currentMonth.trim().toLowerCase() !== reportMonth.toLowerCase();
}

function computeClientTotals(client) {
  const spendMtd = client.lines.reduce((s, l) => s + (l.spendMtd || 0), 0);
  const eomPacing = client.lines.reduce((s, l) => s + (l.eomPacing || 0), 0);
  return { budget: client.budget, spendMtd, eomPacing };
}

// ── Cell / row helpers ────────────────────────────────────────────────────────

const td = (extra = '') => `padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};${extra}`;
const th = (align) => `text-align:${align};padding:8px 10px;background:${PALETTE.rowTotal};border-bottom:2px solid ${PALETTE.borderMed};color:${PALETTE.textSecondary};font-weight:bold;`;

function statusColor(status) {
  return status === 'OVER' ? PALETTE.overText
    : status === 'UNDER' ? PALETTE.underText
    : status === 'NO_BUDGET' ? PALETTE.criticalText
    : PALETTE.onTrackText;
}

function statusLabel(status, pct) {
  if (status === 'OVER') return pct > 200 ? '🚨 Over' : 'Over';
  if (status === 'UNDER') return 'Under';
  if (status === 'NO_BUDGET') return 'No Budget';
  return 'On Track';
}

function geoBreakdown(geos) {
  if (!geos?.length) return '—';
  const sorted = [...geos].sort((a, b) => b.pacing - a.pacing);
  const shown = sorted.slice(0, MAX_GEOS).map((g) => `${escapeHtml(g.name)} ${fmtCurrency(g.pacing)}`);
  const extra = sorted.length - shown.length;
  return shown.join(' &nbsp;·&nbsp; ') + (extra > 0 ? ` &nbsp;·&nbsp; +${extra} more` : '');
}

function renderVerticalRow(group, budget) {
  const cls = classifyTotals({ budget, eomPacing: group.eomPacing });
  const color = statusColor(cls.status);
  const bg = cls.status === 'OVER' ? PALETTE.rowWarn : cls.status === 'NO_BUDGET' ? PALETTE.rowCritical : PALETTE.rowTotal;
  return `
    <tr>
      <td colspan="2" style="${td(`background:${bg};color:${PALETTE.textPrimary};font-weight:bold;border-top:2px solid ${PALETTE.borderMed};`)}">${escapeHtml(group.vertical)}</td>
      <td style="${td(`background:${bg};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};`)}">${budget ? fmtCurrencyNoDec(budget) : '—'}</td>
      <td style="${td(`background:${bg};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};`)}">${fmtCurrency(group.spendMtd)}</td>
      <td style="${td(`background:${bg};color:${color};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};`)}">${fmtCurrency(group.eomPacing)}</td>
      <td style="${td(`background:${bg};color:${color};font-weight:bold;text-align:center;border-top:2px solid ${PALETTE.borderMed};`)}">${fmtPct(cls.pacingPct)}</td>
      <td style="${td(`background:${bg};text-align:center;border-top:2px solid ${PALETTE.borderMed};`)}"><span style="color:${color};font-weight:bold;">${statusLabel(cls.status, cls.pacingPct)}</span></td>
    </tr>`;
}

function renderPlatformRow(line) {
  return `
    <tr>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textPrimary};padding-left:22px;`)}">${escapeHtml(line.platform)}</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textSecondary};font-size:11px;`)}">${geoBreakdown(line.geos)}</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textMuted};text-align:right;`)}">—</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textPrimary};text-align:right;`)}">${fmtCurrency(line.spendMtd)}</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textPrimary};text-align:right;`)}">${fmtCurrency(line.eomPacing)}</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textMuted};text-align:center;`)}">—</td>
      <td style="${td(`background:${PALETTE.rowNormal};text-align:center;`)}"></td>
    </tr>`;
}

function renderTotalRow(totals, cls) {
  const color = statusColor(cls.status);
  return `
    <tr>
      <td colspan="2" style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;border-top:2px solid ${PALETTE.borderMed};">TOTAL</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${totals.budget ? fmtCurrencyNoDec(totals.budget) : '—'}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${fmtCurrency(totals.spendMtd)}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${fmtCurrency(totals.eomPacing)}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};font-weight:bold;text-align:center;border-top:2px solid ${PALETTE.borderMed};color:${color};">${fmtPct(cls.pacingPct)}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};text-align:center;border-top:2px solid ${PALETTE.borderMed};"><span style="color:${color};font-weight:bold;">${statusLabel(cls.status, cls.pacingPct)}</span></td>
    </tr>`;
}

function renderClientBanner(totals, cls) {
  if (cls.status === 'NO_BUDGET') {
    return `
      <div style="background:${PALETTE.noBudgetBg};color:${PALETTE.noBudgetText};padding:10px 32px;font-size:13px;font-weight:bold;">
        ⚠️ NO BUDGET LOADED &nbsp;|&nbsp; Spend: ${fmtCurrency(totals.spendMtd)} &nbsp;|&nbsp; EOM Pacing: ${fmtCurrency(totals.eomPacing)}
      </div>`;
  }
  const bg = cls.status === 'OVER' ? PALETTE.overBg : cls.status === 'UNDER' ? PALETTE.underBg : PALETTE.onTrackBg;
  const label = cls.status === 'OVER' ? 'OVER PACING' : cls.status === 'UNDER' ? 'UNDER PACING' : 'ON TRACK';
  return `
    <div style="background:${bg};color:#ffffff;padding:10px 32px;font-size:13px;font-weight:bold;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ffffff;margin-right:8px;vertical-align:middle;"></span>
      ${label} &nbsp;|&nbsp; Spend: ${fmtCurrency(totals.spendMtd)} &nbsp;|&nbsp; EOM Pacing: ${fmtCurrency(totals.eomPacing)} &nbsp;|&nbsp; Budget: ${fmtCurrency(totals.budget)} &nbsp;|&nbsp; Pacing: ${fmtPct(cls.pacingPct)}
    </div>`;
}

function renderClientSection(client) {
  const title = `
  <div style="padding:24px 32px 8px 32px;">
    <h2 style="margin:0 0 4px 0;font-size:16px;font-weight:bold;color:${PALETTE.headerBg};border-bottom:2px solid ${PALETTE.headerBg};padding-bottom:6px;">${escapeHtml(client.name)}</h2>
  </div>`;

  if (client.error) {
    return `${title}
  <div style="margin:12px 32px 16px;background:${PALETTE.rowCritical};border:1px solid #feb2b2;border-radius:5px;padding:12px 16px;font-size:12px;color:${PALETTE.textPrimary};">
    <strong style="color:${PALETTE.criticalText};">Data unavailable:</strong> ${escapeHtml(client.error)}
  </div>
  <hr style="border:none;border-top:2px solid ${PALETTE.borderMed};margin:0 32px;">`;
  }

  const totals = computeClientTotals(client);
  const cls = classifyTotals(totals);
  const groups = groupByVertical(client.lines);

  const body = groups.length
    ? groups.map((g) => renderVerticalRow(g, client.verticalBudgets[g.vertical] ?? null) + g.lines.map(renderPlatformRow).join('')).join('') + renderTotalRow(totals, cls)
    : `<tr><td colspan="7" style="padding:14px;text-align:center;color:${PALETTE.textMuted};font-size:12px;">No spend data</td></tr>`;

  return `${title}
  ${renderClientBanner(totals, cls)}
  <div style="padding:0 32px 16px 32px;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr>
          <th style="${th('left')}">Vertical / Platform</th>
          <th style="${th('left')}">Geo Pacing EOM</th>
          <th style="${th('right')}">Budget</th>
          <th style="${th('right')}">Spend MTD</th>
          <th style="${th('right')}">EOM Pacing</th>
          <th style="${th('center')}">Pacing %</th>
          <th style="${th('center')}">Status</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  <hr style="border:none;border-top:2px solid ${PALETTE.borderMed};margin:0 32px;">`;
}

// ── Recommended actions ───────────────────────────────────────────────────────

function buildRecommendedActions(clients, info, stale) {
  const actions = [];

  if (stale) {
    actions.push({
      icon: '📅', priority: 0,
      text: `<strong style="color:${PALETTE.overText};">Sheet not rolled forward:</strong> "Client Information" still says ${escapeHtml(info.currentMonth)}. Update Current Month and Last Updated in the Targeted Streaming Spends sheet so budgets and pacing reflect the current month.`,
    });
  }

  for (const client of clients) {
    const name = escapeHtml(client.name);
    if (client.error) {
      actions.push({ icon: '🔴', priority: 1, text: `<strong>${name} — Pacing tab unreadable:</strong> ${escapeHtml(client.error)}. Confirm the "${escapeHtml(client.key)} Pacing" tab exists and the service account has Viewer access.` });
      continue;
    }

    const groups = groupByVertical(client.lines);
    const byVertical = groups.map((g) => ({ g, budget: client.verticalBudgets[g.vertical] ?? null, cls: classifyTotals({ budget: client.verticalBudgets[g.vertical] ?? null, eomPacing: g.eomPacing }) }));

    for (const { g, budget, cls } of byVertical.filter((x) => x.cls.status === 'OVER' && x.cls.pacingPct > 200)) {
      actions.push({ icon: '🚨', priority: 0, text: `<strong style="color:${PALETTE.overText};">${name} — ${escapeHtml(g.vertical)} CRITICALLY OVER PACING (${fmtPct(cls.pacingPct)}):</strong> Spent ${fmtCurrency(g.spendMtd)} against ${fmtCurrency(budget)} budget, pacing to ${fmtCurrency(g.eomPacing)} EOM. Reduce vendor caps or pause to stop further overspend.` });
    }

    for (const { g } of byVertical.filter((x) => x.cls.status === 'NO_BUDGET' && x.g.spendMtd > 0)) {
      actions.push({ icon: '🔴', priority: 1, text: `<strong>${name} — ${escapeHtml(g.vertical)} spending with no budget loaded:</strong> ${fmtCurrency(g.spendMtd)} MTD (pacing ${fmtCurrency(g.eomPacing)} EOM) with no Targeted Streaming budget in the Budget tab. Load a budget or pause.` });
    }

    const moderate = byVertical.filter((x) => x.cls.status === 'OVER' && x.cls.pacingPct <= 200);
    if (moderate.length) {
      actions.push({ icon: '⚠️', priority: 2, text: `<strong>${name} — Over pacing:</strong> ${moderate.map((x) => `${escapeHtml(x.g.vertical)} (${fmtPct(x.cls.pacingPct)})`).join(', ')}. Consider reducing vendor caps if overspend is unintended.` });
    }

    const spentVerticals = new Set(groups.map((g) => g.vertical));
    const zero = Object.entries(client.verticalBudgets).filter(([v, b]) => b > 0 && !spentVerticals.has(v));
    if (zero.length && client.lines.length) {
      const total = zero.reduce((s, [, b]) => s + b, 0);
      actions.push({ icon: '⚠️', priority: 3, text: `<strong>${name} — ${zero.length} vertical${zero.length > 1 ? 's' : ''} at 0% spend:</strong> ${zero.map(([v]) => escapeHtml(v)).join(', ')} (combined ${fmtCurrencyNoDec(total)} budget). Confirm campaigns are live and vendor spend files have been loaded.` });
    }

    const under = byVertical.filter((x) => x.cls.status === 'UNDER' && x.cls.pacingPct < 60 && x.g.spendMtd > 0);
    if (under.length) {
      actions.push({ icon: '⚠️', priority: 4, text: `<strong>${name} — Significantly under pacing:</strong> ${under.map((x) => `${escapeHtml(x.g.vertical)} (${fmtPct(x.cls.pacingPct)})`).join(', ')}. Increase vendor budgets to recover spend before month end.` });
    }

    if (!client.lines.length) {
      actions.push({ icon: '⚠️', priority: 6, text: `<strong>${name} — No spend data:</strong> ${client.budget ? `${fmtCurrencyNoDec(client.budget)} budgeted but ` : ''}no platform spend found in the "${escapeHtml(client.key)} Pacing" tab. Confirm vendor spend files were loaded for this client.` });
    }
  }

  actions.sort((a, b) => a.priority - b.priority);
  return actions;
}

function renderRecommendedActions(actions) {
  const rows = actions.length
    ? actions.map((a) => `
    <table style="width:100%;border-collapse:collapse;margin-bottom:2px;">
      <tbody><tr>
        <td style="width:30px;font-size:16px;vertical-align:top;padding:10px 10px 10px 0;">${a.icon}</td>
        <td style="font-size:12px;color:${PALETTE.textPrimary};line-height:1.7;padding:10px 0;border-bottom:1px solid ${PALETTE.borderLight};">${a.text}</td>
      </tr></tbody>
    </table>`).join('')
    : `<div style="font-size:12px;color:${PALETTE.textSecondary};">No urgent actions — all accounts within normal pacing ranges.</div>`;

  return `
    <div style="background:${PALETTE.rowTotal};border-top:2px solid ${PALETTE.borderMed};padding:20px 32px;">
      <h3 style="margin:0 0 14px 0;font-size:14px;font-weight:bold;color:${PALETTE.headerBg};">Recommended Actions</h3>
      ${rows}
    </div>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * @param {{ reportDate: string, info: object, clients: Array<object> }} params
 *   reportDate — YYYY-MM-DD (ET). info — parseClientInfo shape. clients — fetchStreamingSheet().clients.
 */
export function buildStreamingPacingReport({ reportDate, info, clients }) {
  const stale = isSheetStale(info, reportDate);
  const sheetMonth = info?.currentMonth ? `${info.currentMonth}${info.currentYear ? ' ' + info.currentYear : ''}` : null;
  const dayLine = info?.lastUpdatedDay != null && info?.daysInMonth != null ? ` &nbsp;·&nbsp; Day ${info.lastUpdatedDay} of ${info.daysInMonth}` : '';

  const header = `
  <div style="background:${PALETTE.headerBg};color:#ffffff;padding:24px 32px;">
    <h1 style="margin:0 0 4px 0;font-size:20px;font-weight:bold;color:#ffffff;">📺 Targeted Streaming Pacing Report</h1>
    <div style="color:#a0aec0;font-size:13px;">${fmtDateLong(reportDate)}${info?.lastUpdated ? ` &nbsp;·&nbsp; Data as of ${fmtDateLong(info.lastUpdated)}` : ''}${sheetMonth ? ` &nbsp;·&nbsp; ${escapeHtml(sheetMonth)}` : ''}${dayLine}</div>
  </div>`;

  const staleBanner = stale ? `
  <div style="background:${PALETTE.noBudgetBg};color:${PALETTE.noBudgetText};padding:10px 32px;font-size:13px;font-weight:bold;">
    ⚠️ Sheet is still on ${escapeHtml(info.currentMonth)} — roll "Client Information" forward before trusting these numbers.
  </div>` : '';

  const sections = clients.map(renderClientSection).join('');
  const actions = buildRecommendedActions(clients, info, stale);

  const footer = `
  <div style="background:${PALETTE.headerBg};color:#718096;padding:14px 32px;font-size:11px;text-align:center;">
    Lilikoi Agency — Automated Targeted Streaming Pacing Report &nbsp;·&nbsp; ${fmtDateLong(reportDate)}
  </div>`;

  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#222222;background-color:#f0f2f5;margin:0;padding:20px 0;">
<div style="max-width:860px;margin:0 auto;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${header}${staleBanner}${sections}${renderRecommendedActions(actions)}${footer}
</div>
</body></html>`;

  const summary = {
    reportDate,
    dataAsOf: info?.lastUpdated || null,
    sheetMonth,
    stale,
    clients: clients.map((c) => {
      const totals = computeClientTotals(c);
      const cls = classifyTotals(totals);
      return {
        key: c.key,
        name: c.name,
        status: c.error ? 'ERROR' : cls.status,
        pacingPct: cls.pacingPct,
        totalBudget: c.budget,
        totalSpend: totals.spendMtd,
        totalEomPacing: totals.eomPacing,
        verticalCount: groupByVertical(c.lines).length,
        lineCount: c.lines.length,
      };
    }),
    actionCount: actions.length,
  };

  return { html, summary };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/__tests__/lib/streamingPacingReportBuilder.test.js`
Expected: PASS — 12 tests. If the `'HVAC, WINDOWS'` assertion fails on ordering, the zero-spend list follows `Object.entries(verticalBudgets)` insertion order, which the fixture sets as SOLAR, ROOF, HVAC, WINDOWS — check the fixture, not the builder.

- [ ] **Step 5: Commit**

```bash
git add src/lib/streamingPacingReportBuilder.js src/__tests__/lib/streamingPacingReportBuilder.test.js
git commit -m "feat: Targeted Streaming pacing report HTML builder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Streaming pipeline (config, run, send, persist)

**Files:**
- Create: `src/lib/streamingPacingPipeline.js`

**Interfaces:**
- Consumes: `fetchStreamingSheet` (Task 3), `buildStreamingPacingReport` (Task 4), `dbConnect` from `src/lib/mongoose.js`, `Resend`.
- Produces:
  - `export async function loadStreamingPacingConfig() → config doc` (seeds defaults on first call)
  - `export async function saveStreamingPacingConfig(update) → config doc`
  - `export async function runStreamingPacingReport({ manual?, dryRun?, triggeredBy? }) → report doc` with fields `reportDate, subject, recipients, fromAddress, status ('sent'|'failed'|'skipped'), sendError, resendId, html, summary, parsedData, manual, dryRun, triggeredBy, createdAt, _id (null on dryRun)`.

- [ ] **Step 1: Write the pipeline**

Create `src/lib/streamingPacingPipeline.js`:

```javascript
// src/lib/streamingPacingPipeline.js
// Orchestrates the Targeted Streaming pacing report:
// load config → fetch shared sheet → build HTML → send email → persist.

import { Resend } from 'resend';
import dbConnect from './mongoose';
import { fetchStreamingSheet } from './streamingPacingSheets';
import { buildStreamingPacingReport } from './streamingPacingReportBuilder';

const DB = 'tokensApi';
const REPORTS_COLL = 'StreamingPacingReports';
const CONFIG_COLL = 'StreamingPacingConfig';
const CONFIG_ID = 'singleton';

export const DEFAULT_STREAMING_SHEET_ID = '1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU';

const DEFAULT_CLIENTS = [
  { key: 'SMP', name: 'Semper Solaris', enabled: true },
  { key: 'BBT', name: 'Big Bully Turf',  enabled: true },
];

const DEFAULT_RECIPIENTS = [
  'kevinw@lilikoiagency.com',
  'lance@lilikoiagency.com',
  'pierre@lilikoiagency.com',
  'danielle@lilikoiagency.com',
  'sophia@lilikoiagency.com',
  'nicole@lilikoiagency.com',
];

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export async function loadStreamingPacingConfig() {
  const client = await dbConnect();
  const coll = client.db(DB).collection(CONFIG_COLL);
  let doc = await coll.findOne({ _id: CONFIG_ID });
  if (!doc) {
    doc = {
      _id: CONFIG_ID,
      sheetId: DEFAULT_STREAMING_SHEET_ID,
      clients: DEFAULT_CLIENTS,
      recipients: DEFAULT_RECIPIENTS,
      subjectPrefix: 'Targeted Streaming Pacing Report',
      fromAddress: process.env.PACING_REPORT_FROM || 'reports@updates.lilikoiagency.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await coll.insertOne(doc);
  }
  return doc;
}

export async function saveStreamingPacingConfig(update) {
  const client = await dbConnect();
  const coll = client.db(DB).collection(CONFIG_COLL);
  const { _id, createdAt, ...rest } = update || {};
  await coll.updateOne(
    { _id: CONFIG_ID },
    { $set: { ...rest, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  return loadStreamingPacingConfig();
}

async function sendEmail({ html, subject, recipients, fromAddress }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({ from: fromAddress, to: recipients, subject, html });
  if (result?.error) throw new Error(result.error.message || 'Resend send failed');
  return result?.data?.id || null;
}

/**
 * @param {{ manual?: boolean, dryRun?: boolean, triggeredBy?: string }} opts
 */
export async function runStreamingPacingReport(opts = {}) {
  const { manual = false, dryRun = false, triggeredBy = 'cron' } = opts;
  const reportDate = todayET();
  const config = await loadStreamingPacingConfig();
  const sheetId = config.sheetId || DEFAULT_STREAMING_SHEET_ID;
  const active = (config.clients || []).filter((c) => c.enabled && c.key);

  console.log(`[streaming-pacing] run date=${reportDate} manual=${manual} dryRun=${dryRun} by=${triggeredBy} clients=${active.map((c) => c.key).join(',')}`);
  const { info, clients } = await fetchStreamingSheet(sheetId, active);
  const { html, summary } = buildStreamingPacingReport({ reportDate, info, clients });
  console.log('[streaming-pacing] summary:', JSON.stringify(summary));

  const subject = `${config.subjectPrefix || 'Targeted Streaming Pacing Report'} — ${reportDate}`;
  const recipients = config.recipients || [];
  const fromAddress = config.fromAddress || process.env.PACING_REPORT_FROM || 'reports@updates.lilikoiagency.com';

  let sendStatus = 'skipped';
  let sendError = null;
  let resendId = null;
  if (!dryRun && recipients.length) {
    try {
      resendId = await sendEmail({ html, subject, recipients, fromAddress });
      sendStatus = 'sent';
    } catch (err) {
      sendError = err?.message || 'send failed';
      sendStatus = 'failed';
    }
  }

  const doc = {
    reportDate, subject, recipients, fromAddress,
    status: sendStatus, sendError, resendId,
    html, summary,
    parsedData: { info, clients },
    manual, dryRun, triggeredBy,
    createdAt: new Date(),
  };

  if (dryRun) return { ...doc, _id: null };

  const dbClient = await dbConnect();
  const inserted = await dbClient.db(DB).collection(REPORTS_COLL).insertOne(doc);
  return { ...doc, _id: inserted.insertedId };
}
```

- [ ] **Step 2: Type-check by building**

Run: `npx next build 2>&1 | tail -15`
Expected: build succeeds (the module is not yet imported anywhere, so this only proves it compiles; Task 6 exercises it).

- [ ] **Step 3: Commit**

```bash
git add src/lib/streamingPacingPipeline.js
git commit -m "feat: Targeted Streaming pacing pipeline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: API routes and cron

Eight routes, one-to-one with the Paid Search set, using the shared auth helpers in `src/lib/routeAuth.js`.

**Files:**
- Create: `src/app/api/cron/streaming-pacing-report/route.js`
- Create: `src/app/api/streaming-pacing/config/route.js`
- Create: `src/app/api/streaming-pacing/preview/route.js`
- Create: `src/app/api/streaming-pacing/send-now/route.js`
- Create: `src/app/api/streaming-pacing/reports/route.js`
- Create: `src/app/api/streaming-pacing/reports/[id]/route.js`
- Create: `src/app/api/streaming-pacing/latest/route.js`
- Create: `src/app/api/streaming-pacing/trends/route.js`
- Modify: `vercel.json` (add cron entry)

**Interfaces:**
- Consumes: Task 5 exports; `getAllowedSession`, `getAdminSession` from `src/lib/routeAuth.js`; `dbConnect`.
- Produces: JSON endpoints with the same shapes as `/api/pacing/*`: `GET config → { data }`, `PUT config → { data }`, `POST preview → { ok, html, summary, reportDate }`, `POST send-now → { ok, id, status, sendError, summary }`, `GET reports?limit → { data: [...] }` (no html/parsedData), `GET reports/[id] → { data }`, `DELETE reports/[id] → { ok }` (admin), `GET latest → { data }`, `GET trends?days → { data: { series, clients, days } }`.

- [ ] **Step 1: Cron route**

Create `src/app/api/cron/streaming-pacing-report/route.js`:

```javascript
// src/app/api/cron/streaming-pacing-report/route.js
// Invoked by Vercel Cron at 5 12 * * 1-5 UTC (five minutes after the Paid Search report).

import { NextResponse } from 'next/server';
import { runStreamingPacingReport } from '../../../../lib/streamingPacingPipeline';

export const maxDuration = 300;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (request.headers.get('authorization') || '') === `Bearer ${secret}`;
}

export async function GET(request) {
  const requestId = crypto.randomUUID();
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }
  try {
    const result = await runStreamingPacingReport({ manual: false, triggeredBy: 'cron' });
    return NextResponse.json({ ok: true, id: String(result._id), reportDate: result.reportDate, status: result.status, summary: result.summary, requestId });
  } catch (err) {
    console.error('[cron/streaming-pacing-report]', err);
    return NextResponse.json({ error: err?.message || 'pipeline failed', requestId }, { status: 500 });
  }
}
```

- [ ] **Step 2: Config route**

Create `src/app/api/streaming-pacing/config/route.js`:

```javascript
// src/app/api/streaming-pacing/config/route.js
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import { loadStreamingPacingConfig, saveStreamingPacingConfig } from '../../../../lib/streamingPacingPipeline';

export async function GET() {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ data: await loadStreamingPacingConfig() });
}

export async function PUT(request) {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const update = {};
  if (Array.isArray(body.recipients)) {
    update.recipients = body.recipients
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  }
  if (Array.isArray(body.clients)) {
    update.clients = body.clients.map((c) => ({
      key: String(c.key || '').toUpperCase().slice(0, 8),
      name: String(c.name || '').slice(0, 120),
      enabled: !!c.enabled,
    })).filter((c) => c.key && c.name);
  }
  if (typeof body.sheetId === 'string') update.sheetId = body.sheetId.trim();
  if (typeof body.subjectPrefix === 'string') update.subjectPrefix = body.subjectPrefix.slice(0, 120);
  if (typeof body.fromAddress === 'string') update.fromAddress = body.fromAddress.trim();

  return NextResponse.json({ data: await saveStreamingPacingConfig(update) });
}
```

- [ ] **Step 3: Preview and send-now routes**

Create `src/app/api/streaming-pacing/preview/route.js`:

```javascript
// src/app/api/streaming-pacing/preview/route.js
// Dry-run: fetches the sheet + builds HTML, returns it without sending or persisting.
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import { runStreamingPacingReport } from '../../../../lib/streamingPacingPipeline';

export const maxDuration = 300;

export async function POST() {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await runStreamingPacingReport({ manual: true, dryRun: true, triggeredBy: auth.email });
    return NextResponse.json({ ok: true, html: result.html, summary: result.summary, reportDate: result.reportDate });
  } catch (err) {
    console.error('[streaming-pacing/preview]', err);
    return NextResponse.json({ error: err?.message || 'preview failed' }, { status: 500 });
  }
}
```

Create `src/app/api/streaming-pacing/send-now/route.js`:

```javascript
// src/app/api/streaming-pacing/send-now/route.js
// Admin-only manual trigger.
import { NextResponse } from 'next/server';
import { getAdminSession } from '../../../../lib/routeAuth';
import { runStreamingPacingReport } from '../../../../lib/streamingPacingPipeline';

export const maxDuration = 300;

export async function POST() {
  const auth = await getAdminSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await runStreamingPacingReport({ manual: true, triggeredBy: auth.email });
    return NextResponse.json({ ok: true, id: String(result._id), status: result.status, sendError: result.sendError, summary: result.summary });
  } catch (err) {
    console.error('[streaming-pacing/send-now]', err);
    return NextResponse.json({ error: err?.message || 'pipeline failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Reports list, detail/delete, latest, trends**

Create `src/app/api/streaming-pacing/reports/route.js`:

```javascript
// src/app/api/streaming-pacing/reports/route.js
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'StreamingPacingReports';

export async function GET(request) {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100);

  const client = await dbConnect();
  const docs = await client.db(DB).collection(COLL)
    .find({}).sort({ createdAt: -1 }).limit(limit)
    .project({ html: 0, parsedData: 0 }).toArray();
  return NextResponse.json({ data: docs });
}
```

Create `src/app/api/streaming-pacing/reports/[id]/route.js`:

```javascript
// src/app/api/streaming-pacing/reports/[id]/route.js
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getAllowedSession, getAdminSession } from '../../../../../lib/routeAuth';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'StreamingPacingReports';

function parseId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

export async function GET(_request, { params }) {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const oid = parseId(id);
  if (!oid) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const client = await dbConnect();
  const doc = await client.db(DB).collection(COLL).findOne({ _id: oid });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: doc });
}

export async function DELETE(_request, { params }) {
  const auth = await getAdminSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const oid = parseId(id);
  if (!oid) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const client = await dbConnect();
  const result = await client.db(DB).collection(COLL).deleteOne({ _id: oid });
  if (result.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

Create `src/app/api/streaming-pacing/latest/route.js`:

```javascript
// src/app/api/streaming-pacing/latest/route.js
// Most recent non-dry-run report: id + date + summary only.
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'StreamingPacingReports';

export async function GET() {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const client = await dbConnect();
  const doc = await client.db(DB).collection(COLL)
    .find({ dryRun: { $ne: true } }).sort({ createdAt: -1 }).limit(1)
    .project({ html: 0, parsedData: 0 }).next();
  if (!doc) return NextResponse.json({ data: null });
  return NextResponse.json({ data: { _id: doc._id, reportDate: doc.reportDate, createdAt: doc.createdAt, summary: doc.summary, status: doc.status } });
}
```

Create `src/app/api/streaming-pacing/trends/route.js`:

```javascript
// src/app/api/streaming-pacing/trends/route.js
// Per-day per-client pacing % over the last N days for the trend chart.
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'StreamingPacingReports';

export async function GET(request) {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const days = Math.min(parseInt(searchParams.get('days') || '30', 10), 90);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const client = await dbConnect();
  const docs = await client.db(DB).collection(COLL)
    .find({ createdAt: { $gte: since }, dryRun: { $ne: true } })
    .sort({ reportDate: 1, createdAt: 1 })
    .project({ reportDate: 1, summary: 1 }).toArray();

  const byDate = new Map();
  for (const d of docs) byDate.set(d.reportDate, d);

  const series = Array.from(byDate.values()).map((d) => {
    const row = { date: d.reportDate };
    for (const c of d.summary?.clients || []) {
      row[c.key + '_pct'] = c.pacingPct;
      row[c.key + '_spend'] = c.totalSpend;
      row[c.key + '_budget'] = c.totalBudget;
      row[c.key + '_eom'] = c.totalEomPacing;
      row[c.key + '_status'] = c.status;
    }
    return row;
  });

  const latest = docs[docs.length - 1];
  const clients = (latest?.summary?.clients || []).map((c) => ({ key: c.key, name: c.name }));
  return NextResponse.json({ data: { series, clients, days } });
}
```

- [ ] **Step 5: Add the cron to `vercel.json`**

In `vercel.json`, change the last entry of the `crons` array from

```json
    { "path": "/api/cron/pacing-report", "schedule": "0 12 * * 1-5" }
```

to

```json
    { "path": "/api/cron/pacing-report", "schedule": "0 12 * * 1-5" },
    { "path": "/api/cron/streaming-pacing-report", "schedule": "5 12 * * 1-5" }
```

- [ ] **Step 6: Smoke-test the preview route locally**

Run: `npm run dev` in one terminal. In a browser, sign in at http://localhost:3000 with a `@lilikoiagency.com` account, then open the browser devtools console on any dashboard page and run:

```javascript
fetch('/api/streaming-pacing/preview', { method: 'POST' }).then(r => r.json()).then(j => { console.log(j.summary); document.open(); document.write(j.html); document.close(); });
```

Expected: the page is replaced by the rendered report. Check: header shows "Data as of …", the stale banner appears if the sheet month ≠ today's month, SMP shows four vertical groups with platform rows underneath, BBT shows a TURF group, and Recommended Actions is populated. The dev terminal shows `[streaming-pacing]` log lines and no stack traces.

Also confirm `GET /api/streaming-pacing/config` returns the seeded document with `sheetId`, two clients and six recipients.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cron/streaming-pacing-report src/app/api/streaming-pacing vercel.json
git commit -m "feat: Targeted Streaming pacing API routes and cron

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Parameterize the pacing dashboard view and trend chart

Turn the Paid Search page body into a reusable component so both reports share one UI. The Paid Search page must look and behave exactly as before.

**Files:**
- Create: `src/app/dashboard/components/PacingReportsView.jsx` (moved from `src/app/dashboard/pacing/page.js`)
- Move: `src/app/dashboard/pacing/PacingTrendChart.jsx` → `src/app/dashboard/components/PacingTrendChart.jsx`
- Modify: `src/app/dashboard/pacing/page.js` (becomes a thin wrapper)
- Test: `src/__tests__/dashboard/PacingReportsView.test.jsx`

**Interfaces:**
- Produces:
  - `export default function PacingReportsView({ apiBase, title, subtitle, sheetMode })` — `apiBase` like `'/api/pacing'`; `sheetMode` is `'perClient'` (each client row has a Sheet ID input, Paid Search) or `'shared'` (one Sheet ID input above the client list, streaming).
  - `export default function PacingTrendChart({ endpoint, colors })` — `endpoint` like `'/api/pacing/trends'`; `colors` maps client key → hex.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/dashboard/PacingReportsView.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PacingReportsView from '../../app/dashboard/components/PacingReportsView';

vi.mock('../../app/dashboard/components/PacingTrendChart', () => ({ default: () => <div>chart</div> }));

const CONFIG = {
  sheetId: 'SHARED123',
  recipients: ['a@lilikoiagency.com'],
  clients: [{ key: 'SMP', name: 'Semper Solaris', sheetId: 'PER1', enabled: true }],
  subjectPrefix: 'X', fromAddress: 'r@x.com',
};

function mockFetch() {
  global.fetch = vi.fn((url) => {
    const body = String(url).endsWith('/config') ? { data: CONFIG } : { data: [] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
}

describe('PacingReportsView', () => {
  beforeEach(mockFetch);

  it('renders the given title and fetches from apiBase', async () => {
    render(<PacingReportsView apiBase="/api/streaming-pacing" title="Streaming Pacing" subtitle="sub" sheetMode="shared" />);
    expect(screen.getByText('Streaming Pacing')).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/streaming-pacing/config'));
    expect(global.fetch).toHaveBeenCalledWith('/api/streaming-pacing/reports');
  });

  it('shows one shared Sheet ID input in shared mode', async () => {
    render(<PacingReportsView apiBase="/api/streaming-pacing" title="T" subtitle="s" sheetMode="shared" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    screen.getByText('Config').click();
    await waitFor(() => expect(screen.getByDisplayValue('SHARED123')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('PER1')).toBeNull();
  });

  it('shows per-client Sheet ID inputs in perClient mode', async () => {
    render(<PacingReportsView apiBase="/api/pacing" title="T" subtitle="s" sheetMode="perClient" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    screen.getByText('Config').click();
    await waitFor(() => expect(screen.getByDisplayValue('PER1')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('SHARED123')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/__tests__/dashboard/PacingReportsView.test.jsx`
Expected: FAIL — cannot resolve `PacingReportsView`.

- [ ] **Step 3: Move the trend chart and add props**

```bash
git mv src/app/dashboard/pacing/PacingTrendChart.jsx src/app/dashboard/components/PacingTrendChart.jsx
```

In `src/app/dashboard/components/PacingTrendChart.jsx`:

1. Change the first comment line to `// src/app/dashboard/components/PacingTrendChart.jsx`.
2. Change the component signature and the fetch URL:

```javascript
export default function PacingTrendChart({ endpoint = "/api/pacing/trends", colors = CLIENT_COLORS }) {
```

and inside the `useEffect`, replace `` fetch(`/api/pacing/trends?days=${days}`) `` with `` fetch(`${endpoint}?days=${days}`) `` and add `endpoint` to the effect's dependency array: `}, [days, endpoint]);`.

3. In the `<Line ... stroke={CLIENT_COLORS[c.key] || FALLBACK}` line, change `CLIENT_COLORS[c.key]` to `colors[c.key]`.

- [ ] **Step 4: Move the page body into `PacingReportsView.jsx`**

```bash
git mv src/app/dashboard/pacing/page.js src/app/dashboard/components/PacingReportsView.jsx
```

Then edit `src/app/dashboard/components/PacingReportsView.jsx`:

1. Delete the line `export const dynamic = 'force-dynamic';` (that belongs on the page, not a component).
2. Change `import PacingTrendChart from "./PacingTrendChart";` — the path is still correct because both files now live in `components/`, so leave it.
3. Change the component signature from `export default function PacingDashboardPage() {` to:

```javascript
export default function PacingReportsView({
  apiBase = "/api/pacing",
  title = "Daily Pacing Reports",
  subtitle = "Automated Mon–Fri at 9 AM ET. Edit recipients and sheet IDs here.",
  sheetMode = "perClient",
}) {
```

4. Replace every hard-coded API string with the template form. There are six:
   - `fetch("/api/pacing/config")` → `` fetch(`${apiBase}/config`) `` (two occurrences: initial load, and the PUT in `handleSaveConfig`)
   - `fetch("/api/pacing/reports")` → `` fetch(`${apiBase}/reports`) `` (two occurrences: initial load, and refresh after send)
   - `` fetch(`/api/pacing/reports/${activeId}`) `` → `` fetch(`${apiBase}/reports/${activeId}`) ``
   - `fetch("/api/pacing/preview", ...)` → `` fetch(`${apiBase}/preview`, ...) ``
   - `fetch("/api/pacing/send-now", ...)` → `` fetch(`${apiBase}/send-now`, ...) ``

5. In `handleSaveConfig`, the PUT body currently sends `recipients, clients, subjectPrefix, fromAddress`. Add `sheetId: configDraft.sheetId,` so shared mode persists it.

6. Replace the header block's two hard-coded strings:
   - `<h1 ...>Daily Pacing Reports</h1>` → `<h1 ...>{title}</h1>`
   - `<p ...>Automated Mon–Fri at 9 AM ET. Edit recipients and sheet IDs here.</p>` → `<p ...>{subtitle}</p>`

7. In the Clients config block, wrap the per-client Sheet ID `<input ... placeholder="Sheet ID" .../>` in a condition so it only renders in perClient mode:

```jsx
                      {sheetMode === "perClient" && (
                        <input
                          value={c.sheetId || ''}
                          onChange={(e) => updateClient(i, { sheetId: e.target.value })}
                          placeholder="Sheet ID"
                          style={{ ...inputSm, fontFamily: "monospace", fontSize: 11 }}
                        />
                      )}
```

   and directly above the `<label style={lbl}>Clients & sheet IDs</label>` line insert a shared Sheet ID field:

```jsx
              {sheetMode === "shared" && (
                <div style={{ marginBottom: 20 }}>
                  <label style={lbl}>Shared sheet ID</label>
                  <input
                    value={configDraft.sheetId || ''}
                    onChange={(e) => updateDraft({ sheetId: e.target.value })}
                    placeholder="Google Sheet ID"
                    style={{ ...input, fontFamily: "monospace", fontSize: 12 }}
                  />
                </div>
              )}
```

   Change that label text to `{sheetMode === "perClient" ? "Clients & sheet IDs" : "Clients"}`.

8. Replace `<PacingTrendChart />` with `<PacingTrendChart endpoint={`${apiBase}/trends`} />`.

- [ ] **Step 5: Recreate the Paid Search page as a wrapper**

Create `src/app/dashboard/pacing/page.js`:

```javascript
"use client";
export const dynamic = 'force-dynamic';
import PacingReportsView from "../components/PacingReportsView";

export default function PacingDashboardPage() {
  return (
    <PacingReportsView
      apiBase="/api/pacing"
      title="Daily Pacing Reports"
      subtitle="Paid Search & Social. Automated Mon–Fri at 9 AM ET. Edit recipients and sheet IDs here."
      sheetMode="perClient"
    />
  );
}
```

- [ ] **Step 6: Run the tests and the existing dashboard tests**

Run: `npm test -- src/__tests__/dashboard`
Expected: the three new tests PASS and every existing dashboard test still passes.

- [ ] **Step 7: Visually verify the Paid Search page is unchanged**

Run `npm run dev`, open http://localhost:3000/dashboard/pacing. Check: header, Config panel with per-client Sheet ID inputs, Past Reports list, Report/Trends tabs, Preview button all work as before.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/components/PacingReportsView.jsx src/app/dashboard/components/PacingTrendChart.jsx src/app/dashboard/pacing/page.js src/__tests__/dashboard/PacingReportsView.test.jsx
git commit -m "refactor: reusable PacingReportsView and parameterized trend chart

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Streaming dashboard page and sidebar entry

**Files:**
- Create: `src/app/dashboard/streaming-pacing/page.js`
- Modify: `src/app/dashboard/components/DashboardSidebar.jsx:28` (add nav item)

**Interfaces:**
- Consumes: `PacingReportsView` from Task 7; routes from Task 6.

- [ ] **Step 1: Create the page**

Create `src/app/dashboard/streaming-pacing/page.js`:

```javascript
"use client";
export const dynamic = 'force-dynamic';
import PacingReportsView from "../components/PacingReportsView";

export default function StreamingPacingDashboardPage() {
  return (
    <PacingReportsView
      apiBase="/api/streaming-pacing"
      title="Targeted Streaming Pacing"
      subtitle="CTV, audio and DOOH vendors from the shared Targeted Streaming Spends sheet. Automated Mon–Fri at 9:05 AM ET."
      sheetMode="shared"
    />
  );
}
```

- [ ] **Step 2: Add the sidebar entry**

In `src/app/dashboard/components/DashboardSidebar.jsx`, in the `"Organic & Reports"` section directly after the line

```javascript
    { href: "/dashboard/pacing",         label: "Pacing Reports",  icon: <ReportIcon />         },
```

insert

```javascript
    { href: "/dashboard/streaming-pacing", label: "Streaming Pacing", icon: <StreamingIcon />  },
```

`StreamingIcon` is already imported at the top of the file.

- [ ] **Step 3: Run the sidebar and nav tests**

Run: `npm test -- src/__tests__/dashboard/DashboardSidebar.test.jsx src/__tests__/dashboard/MobileNavSheet.test.jsx`
Expected: PASS. If a test asserts an exact count of nav items, update the expected count by one and note it in the commit message.

- [ ] **Step 4: Verify in the browser**

With `npm run dev` running, open http://localhost:3000/dashboard/streaming-pacing. Check: "Streaming Pacing" is highlighted in the sidebar; Config shows one shared Sheet ID input, two clients (SMP, BBT) without per-client sheet fields, and the recipient chips; Preview renders the streaming report in the iframe; the Trends tab shows the empty-state message (no sends yet).

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/streaming-pacing/page.js src/app/dashboard/components/DashboardSidebar.jsx
git commit -m "feat: Targeted Streaming pacing dashboard page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Documentation and first-send checklist

**Files:**
- Modify: `docs/pacing-report-setup.md` (append a section)

- [ ] **Step 1: Document the streaming report**

Append to `docs/pacing-report-setup.md`:

```markdown

---

## Targeted Streaming Pacing Report

A second daily email fed by the shared **Targeted Streaming Spends** sheet
(`1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU`). Same service account, same Resend sender, same `CRON_SECRET`.

- Cron: `/api/cron/streaming-pacing-report` at `5 12 * * 1-5` UTC (five minutes after Paid Search).
- Config: Mongo `tokensApi.StreamingPacingConfig` (`_id: 'singleton'`), seeded on first load of **/dashboard/streaming-pacing**. Holds one shared `sheetId`, the client list (`SMP`, `BBT`), recipients, subject prefix, from address.
- History: `tokensApi.StreamingPacingReports`.
- Tabs read: `Client Information`, `Budget`, and `<KEY> Pacing` for each enabled client. Nothing else.

### Adding a client

1. Make sure the sheet has a `<KEY> Pacing` tab for the client and its rows appear in the `Budget` tab.
2. In **/dashboard/streaming-pacing → Config**, there is no add-client control yet. Use a one-off script modelled on `scripts/add-rec-client.mjs` but against collection `StreamingPacingConfig`, with entries of the form `{ key, name, enabled }` (no `sheetId` per client).
3. Run `node scripts/verify-streaming-sheet.mjs` after adding the key to its `CLIENTS` array to confirm the tab parses.

### Month rollover

The sheet's `Client Information!C2` (Current Month) and `E2` (Last Updated) are typed by hand. When they lag the calendar, the report shows a yellow "Sheet is still on <month>" banner and a Recommended Action. That is expected; fix it in the sheet, not the code.

### First run checklist

1. `node scripts/verify-streaming-sheet.mjs` prints SMP and BBT lines with no errors.
2. Open **/dashboard/streaming-pacing** once to seed the config; confirm recipients.
3. Click **Preview** — the report renders with a "Data as of" line.
4. Temporarily set recipients to yourself, **Send now**, check Gmail rendering (inline styles only), restore recipients.
5. Deploy; the cron takes over the next weekday.
```

- [ ] **Step 2: Commit**

```bash
git add docs/pacing-report-setup.md
git commit -m "docs: Targeted Streaming pacing report setup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end verification

No source changes unless something surfaces. Verification is the deliverable.

- [ ] **Step 1: Full test suite and build**

Run: `npm test` then `npx next build 2>&1 | tail -20`
Expected: all tests pass; build succeeds with both `/dashboard/pacing` and `/dashboard/streaming-pacing` in the route list and all eight `/api/streaming-pacing*` routes present.

- [ ] **Step 2: Live sheet parse**

Run: `node scripts/verify-streaming-sheet.mjs`
Expected: SMP and BBT both return lines, no `error`.

- [ ] **Step 3: Preview both reports**

With `npm run dev`, open `/dashboard/pacing` and click Preview, then `/dashboard/streaming-pacing` and click Preview. Both render. The Paid Search report is byte-for-byte the same layout as before the refactor (compare against the most recent stored report in its Past Reports list).

- [ ] **Step 4: Real send to yourself**

On `/dashboard/streaming-pacing → Config`, set recipients to just your address, Save, then **Send now**. Confirm the email arrives, the vertical rows and geo breakdown render in Gmail, and the report appears in Past Reports with status Sent. **Restore the full recipient list and Save.**

- [ ] **Step 5: Confirm the Paid Search cron is untouched**

`git diff main -- src/app/api/cron/pacing-report src/lib/pacingPipeline.js` shows no changes. `vercel.json` shows exactly one added cron line.

- [ ] **Step 6: Commit any fixes**

If steps 1–5 surfaced problems, fix and commit them with a `fix:` prefix. Otherwise there is nothing to commit.

---

## Rollback

Set both clients `enabled: false` on `/dashboard/streaming-pacing → Config` and Save: the pipeline still runs on cron but renders an empty report and sends it. To stop sends entirely, remove the `streaming-pacing-report` line from `vercel.json` and redeploy. The Paid Search report is unaffected either way because it shares only the helper modules from Task 1, which are behaviour-preserving.
