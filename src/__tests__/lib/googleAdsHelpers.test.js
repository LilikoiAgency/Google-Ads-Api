import { describe, it, expect } from 'vitest';
import {
  isValidDateLiteral,
  buildDateFilter,
  getCampaignStatusCondition,
  normalizeLandingPageUrl,
  sortPerformanceRows,
} from '@/lib/googleAdsHelpers.js';

describe('isValidDateLiteral', () => {
  it('accepts YYYY-MM-DD', () => expect(isValidDateLiteral('2026-01-15')).toBe(true));
  it('rejects non-date strings', () => expect(isValidDateLiteral('yesterday')).toBe(false));
  it('rejects empty string', () => expect(isValidDateLiteral('')).toBe(false));
});

describe('buildDateFilter', () => {
  it('throws on CUSTOM with invalid dates', () => {
    expect(() => buildDateFilter('CUSTOM', 'bad', 'bad')).toThrow('Invalid custom date range');
  });

  it('throws on CUSTOM when start > end', () => {
    expect(() => buildDateFilter('CUSTOM', '2026-02-01', '2026-01-01')).toThrow();
  });

  it('returns a dateFilter SQL fragment and dateWindow for LAST_7_DAYS', () => {
    const { dateFilter, dateWindow } = buildDateFilter('LAST_7_DAYS');
    expect(dateFilter).toContain('segments.date BETWEEN');
    expect(dateWindow).toHaveProperty('startDate');
    expect(dateWindow).toHaveProperty('endDate');
  });
});

describe('getCampaignStatusCondition', () => {
  it('returns ENABLED + SERVING for ACTIVE', () => {
    expect(getCampaignStatusCondition('ACTIVE')).toContain("campaign.status = 'ENABLED'");
  });

  it('returns PAUSED/REMOVED for INACTIVE', () => {
    expect(getCampaignStatusCondition('INACTIVE')).toContain('PAUSED');
  });
});

describe('normalizeLandingPageUrl', () => {
  it('strips query string and hash', () => {
    expect(normalizeLandingPageUrl('https://ex.com/page?foo=1#bar')).toBe('https://ex.com/page');
  });

  it('returns null for falsy input', () => {
    expect(normalizeLandingPageUrl(null)).toBeNull();
  });
});

describe('sortPerformanceRows', () => {
  it('sorts by conversions descending', () => {
    const rows = [{ conversions: 2 }, { conversions: 5 }, { conversions: 1 }];
    const sorted = [...rows].sort(sortPerformanceRows);
    expect(sorted[0].conversions).toBe(5);
  });
});
