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
