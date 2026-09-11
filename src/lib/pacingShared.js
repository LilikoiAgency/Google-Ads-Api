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
