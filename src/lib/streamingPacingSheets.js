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
