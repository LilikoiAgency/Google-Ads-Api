// src/lib/pacingSheets.js
// Service-account-backed fetchers for each client's PACING + Validation tabs.
// Keep parsing defensive: locate columns by header keyword rather than fixed index.

import { google } from 'googleapis';

const KNOWN_PLATFORMS = ['GOOGLE', 'YOUTUBE', 'BING', 'FACEBOOK'];
const KNOWN_GEOS = [
  'SD', 'LV', 'SLC', 'PHX', 'DAL', 'TUS', 'ALL', 'IE',
  'CA', 'SF', 'OC', 'TMP', 'NY', 'TX', 'FL', 'AZ', 'CO', 'WA',
];

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

async function readTab(sheetId, tabName) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: tabName,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return res.data.values || [];
}

function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,\s]/g, '').replace(/%$/, '');
  if (s === '' || s === '—' || s === '-' || s.toLowerCase() === 'n/a') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Find (rowIdx, colIdx) of the first cell whose normalized text matches any of keys.
function findLabel(rows, keys) {
  const wanted = keys.map(normKey);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const k = normKey(row[c]);
      if (wanted.includes(k)) return { r, c };
    }
  }
  return null;
}

// Header meta is a scattered key/value block at the top of PACING.
// We find each label by keyword and read the cell immediately to its right.
function extractHeaderMeta(rows) {
  const meta = { remainingDays: null, totalBudget: null, totalSpend: null, totalPacing: null };

  const map = {
    remainingDays: ['remainingdays', 'daysremaining'],
    totalBudget: ['currentbudget', 'totalbudget', 'budget'],
    totalSpend: ['currentspend', 'totalspend', 'spend', 'spendmtd'],
    totalPacing: ['totalbudgetpacing', 'eompacing', 'pacing'],
  };

  for (const [field, keys] of Object.entries(map)) {
    const hit = findLabel(rows, keys);
    if (hit) {
      const right = (rows[hit.r] || [])[hit.c + 1];
      const below = (rows[hit.r + 1] || [])[hit.c];
      meta[field] = toNum(right) ?? toNum(below);
    }
  }
  return meta;
}

// Find the geo-pacing row: top area of sheet will list geo codes with their EOM pacing values.
// Strategy: find a row that contains ≥2 known geo codes, read the row immediately below for values.
function extractGeoPacing(rows) {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] || [];
    const matches = [];
    row.forEach((cell, c) => {
      const up = String(cell || '').trim().toUpperCase();
      if (KNOWN_GEOS.includes(up)) matches.push({ name: up, col: c });
    });
    if (matches.length >= 2) {
      const valueRow = rows[r + 1] || [];
      return matches
        .map(({ name, col }) => ({ name, pacing: toNum(valueRow[col]) }))
        .filter((g) => g.pacing != null && g.pacing > 0);
    }
  }
  return [];
}

// Locate the platform data table: header row contains "Platform" and "Spend" (or similar).
// Return { headerRow, headers, dataRows }.
function findPlatformTable(rows) {
  for (let r = 0; r < rows.length; r++) {
    const row = (rows[r] || []).map((c) => normKey(c));
    const hasPlatform = row.some((c) => c === 'platform' || c === 'platformvertical');
    const hasSpend = row.some((c) => c.includes('spend'));
    if (hasPlatform && hasSpend) {
      return { headerRow: r, headers: rows[r], dataRows: rows.slice(r + 1) };
    }
  }
  return null;
}

function colIndex(headers, keys) {
  const wanted = keys.map(normKey);
  for (let i = 0; i < headers.length; i++) {
    if (wanted.includes(normKey(headers[i]))) return i;
  }
  return -1;
}

function extractPlatformLines(rows) {
  const table = findPlatformTable(rows);
  if (!table) return [];
  const { headers, dataRows } = table;

  const cPlatform = colIndex(headers, ['platform', 'platformvertical']);
  const cVertical = colIndex(headers, ['vertical']);
  const cBudget   = colIndex(headers, ['budget', 'currentbudget', 'monthlybudget']);
  const cSpend    = colIndex(headers, ['spend', 'spendmtd', 'currentspend', 'mtdspend']);
  const cPacing   = colIndex(headers, ['totalbudgetpacing', 'eompacing', 'pacing', 'pacingeom', 'projected']);

  const lines = [];
  for (const raw of dataRows) {
    const row = raw || [];
    const platformCell = String(row[cPlatform] || '').trim();
    if (!platformCell) continue;
    const upper = platformCell.toUpperCase();
    // Stop at "TOTAL" / blank separator rows
    if (upper === 'TOTAL' || upper === 'TOTALS' || upper.startsWith('GRAND')) break;
    // Must begin with a known platform name
    const platform = KNOWN_PLATFORMS.find((p) => upper.includes(p));
    if (!platform) continue;

    const vertical = cVertical >= 0 ? String(row[cVertical] || '').trim() : '';
    lines.push({
      platform,
      vertical,
      rawLabel: vertical ? `${platform} / ${vertical}` : platformCell,
      budget:   cBudget >= 0 ? toNum(row[cBudget])   : null,
      spendMtd: cSpend  >= 0 ? toNum(row[cSpend])    : null,
      eomPacing: cPacing >= 0 ? toNum(row[cPacing])  : null,
    });
  }
  return lines;
}

export async function fetchPacingTab(sheetId, label = '') {
  const tag = `[pacing:${label || sheetId.slice(0, 6)}:PACING]`;
  const rows = await readTab(sheetId, 'PACING');
  console.log(`${tag} rows=${rows.length}`);

  const header = extractHeaderMeta(rows);
  console.log(`${tag} header`, JSON.stringify(header));

  const geos = extractGeoPacing(rows);
  console.log(`${tag} geos=${geos.length}`, geos.map((g) => `${g.name}:${g.pacing}`).join(', '));

  const tableInfo = findPlatformTable(rows);
  if (tableInfo) {
    console.log(`${tag} platform table header @ row ${tableInfo.headerRow}:`, tableInfo.headers);
  } else {
    console.warn(`${tag} NO platform table header found`);
  }

  const lines = extractPlatformLines(rows);
  console.log(`${tag} lines=${lines.length}`);
  for (const l of lines) {
    console.log(`${tag}   ${l.rawLabel}: budget=${l.budget} spend=${l.spendMtd} eom=${l.eomPacing}`);
  }

  return { header, geos, lines };
}

// Find ALL column indices in a header row that match any of the given keys.
function allColIndices(headers, keys) {
  const wanted = keys.map(normKey);
  const hits = [];
  for (let i = 0; i < headers.length; i++) {
    if (wanted.includes(normKey(headers[i]))) hits.push(i);
  }
  return hits;
}

// Validation tab layout (observed):
//   Left summary table:  Platform | Differences $ | # incorrect Campaign names
//   Right names table:   Platform | Campaign Name (one row per bad name)
// Both share the same header row but sit in different columns, sometimes with blank columns between.
export async function fetchValidationTab(sheetId, label = '') {
  const tag = `[pacing:${label || sheetId.slice(0, 6)}:Validation]`;
  let rows;
  try { rows = await readTab(sheetId, 'Validation'); }
  catch (err) {
    console.warn(`${tag} read failed: ${err?.message}`);
    return { platforms: [], error: err?.message || 'Validation tab unavailable' };
  }
  console.log(`${tag} rows=${rows.length}`);

  // Locate the header row: has at least one "Platform" column AND a "Differences" column.
  let headerIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const row = (rows[r] || []).map(normKey);
    if (row.some((c) => c === 'platform') && row.some((c) => c.includes('difference'))) {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx < 0) {
    console.warn(`${tag} header row not found`);
    return { platforms: [] };
  }

  const headers = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1);

  const platformCols = allColIndices(headers, ['platform']);
  const cDiff        = colIndex(headers, ['differences', 'differences$', 'differenceusd', 'diff']);
  const cIncCount    = colIndex(headers, ['incorrectcampaignnames', 'incorrectnames', 'incorrectcount', '#incorrectcampaignnames']);

  // Left summary uses first Platform; names table uses any additional Platform column (last if present).
  const cSummaryPlatform = platformCols[0] ?? -1;
  const cNamesPlatform = platformCols.length > 1 ? platformCols[platformCols.length - 1] : -1;

  // Campaign Name column must sit to the RIGHT of the right-table Platform column.
  let cCampaignName = -1;
  if (cNamesPlatform >= 0) {
    for (let i = cNamesPlatform + 1; i < headers.length; i++) {
      const h = normKey(headers[i]);
      if (h.includes('name') || h.includes('campaign')) { cCampaignName = i; break; }
    }
  }

  console.log(`${tag} header @ row ${headerIdx}:`, headers);
  console.log(`${tag} cols: summaryPlatform=${cSummaryPlatform} diff=${cDiff} incCount=${cIncCount} namesPlatform=${cNamesPlatform} campaignName=${cCampaignName}`);

  // Parse left summary: one entry per base platform.
  const summary = new Map();
  for (const raw of dataRows) {
    const row = raw || [];
    const cell = String(row[cSummaryPlatform] || '').trim().toUpperCase();
    if (!cell) continue;
    if (cell === 'TOTAL') break;
    const platform = KNOWN_PLATFORMS.find((p) => cell.includes(p));
    if (!platform) continue;

    const diffRaw = cDiff >= 0 ? toNum(row[cDiff]) : null;
    const diff = Math.abs(diffRaw || 0) < 0.01 ? 0 : Math.abs(diffRaw || 0);
    const inc  = cIncCount >= 0 ? toNum(row[cIncCount]) : null;

    // If we've already seen this platform, keep the higher count / larger diff
    // (covers cases like GOOGLE + GOOGLE LSA mapping to the same base platform).
    const prev = summary.get(platform);
    if (prev) {
      prev.differencesUsd = Math.max(prev.differencesUsd, diff);
      prev.incorrectCount = Math.max(prev.incorrectCount, inc || 0);
    } else {
      summary.set(platform, {
        platform,
        differencesUsd: diff,
        incorrectCount: inc || 0,
        incorrectNames: [],
      });
    }
  }

  // Parse right names table — every non-empty row becomes one (platform, name) pair.
  if (cNamesPlatform >= 0 && cCampaignName >= 0) {
    for (const raw of dataRows) {
      const row = raw || [];
      const cell = String(row[cNamesPlatform] || '').trim().toUpperCase();
      const name = String(row[cCampaignName] || '').trim();
      if (!cell || !name) continue;
      const platform = KNOWN_PLATFORMS.find((p) => cell.includes(p));
      if (!platform) continue;
      if (!summary.has(platform)) {
        summary.set(platform, { platform, differencesUsd: 0, incorrectCount: 0, incorrectNames: [] });
      }
      summary.get(platform).incorrectNames.push(name);
    }
    // If the names list exceeds the declared count, trust the list.
    for (const entry of summary.values()) {
      if (entry.incorrectNames.length > entry.incorrectCount) {
        entry.incorrectCount = entry.incorrectNames.length;
      }
    }
  }

  const out = Array.from(summary.values());
  for (const p of out) {
    console.log(`${tag}   ${p.platform}: diff=${p.differencesUsd} count=${p.incorrectCount} names=${JSON.stringify(p.incorrectNames)}`);
  }
  return { platforms: out };
}

// Sum a single column from a hidden API tab. Returns null if the tab is missing or has no data.
async function sumApiTabColumn(sheetId, tabName, colIdx, label) {
  try {
    const rows = await readTab(sheetId, tabName);
    let total = 0;
    let found = false;
    // Row 0 is the header; start at 1
    for (let r = 1; r < rows.length; r++) {
      const val = toNum((rows[r] || [])[colIdx]);
      if (val != null && val > 0) { total += val; found = true; }
    }
    console.log(`[pacing:${label}] ${tabName} col=${colIdx} sum=${found ? total : 'none'}`);
    return found ? total : null;
  } catch (err) {
    console.warn(`[pacing:${label}] ${tabName} budget fetch skipped: ${err?.message}`);
    return null;
  }
}

export async function fetchClientSheet(sheetId, label = '') {
  console.log(`[pacing:${label || sheetId.slice(0, 6)}] fetch start sheetId=${sheetId.slice(0, 10)}…`);
  const [pacing, validation, googleBudget, metaBudget, bingBudget] = await Promise.all([
    fetchPacingTab(sheetId, label).catch((err) => {
      console.error(`[pacing:${label}] PACING fetch failed: ${err?.message}`);
      return { error: err?.message || 'PACING fetch failed' };
    }),
    fetchValidationTab(sheetId, label).catch((err) => {
      console.error(`[pacing:${label}] Validation fetch failed: ${err?.message}`);
      return { platforms: [], error: err?.message };
    }),
    sumApiTabColumn(sheetId, 'Google API', 8, label),
    sumApiTabColumn(sheetId, 'Meta API',   8, label),
    sumApiTabColumn(sheetId, 'Bing Budget', 3, label),
  ]);

  // Attach campaign budget to each platform line based on platform.
  // LSA and YOUTUBE rows are excluded (non-standard budget types).
  if (Array.isArray(pacing.lines)) {
    for (const line of pacing.lines) {
      const isLsa = line.vertical && line.vertical.toUpperCase().includes('LSA');
      if (isLsa || line.platform === 'YOUTUBE') {
        line.campaignBudget = null;
      } else if (line.platform === 'GOOGLE') {
        line.campaignBudget = googleBudget;
      } else if (line.platform === 'FACEBOOK') {
        line.campaignBudget = metaBudget;
      } else if (line.platform === 'BING') {
        line.campaignBudget = bingBudget;
      } else {
        line.campaignBudget = null;
      }
    }
  }

  console.log(`[pacing:${label || sheetId.slice(0, 6)}] fetch done`);
  return { pacing, validation };
}
