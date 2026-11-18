import { describe, it, expect } from 'vitest';
import { PRESETS, presetRange, compareRange, autoGranularity, isValidRange, rangeLabel } from '@/lib/ga4Dates';

describe('ga4Dates', () => {
  it('exposes presets', () => {
    expect(PRESETS.map((p) => p.key)).toEqual(['this_month', 'last_month', 'last_7', 'last_28', 'last_90', 'ytd', 'custom']);
  });
  it('last_month in January', () => {
    expect(presetRange('last_month', '2026-01-15')).toEqual({ startDate: '2025-12-01', endDate: '2025-12-31' });
  });
  it('last_28 ends yesterday', () => {
    expect(presetRange('last_28', '2026-11-18')).toEqual({ startDate: '2026-10-21', endDate: '2026-11-17' });
  });
  it('this_month, ytd, last_7, custom', () => {
    expect(presetRange('this_month', '2026-11-18')).toEqual({ startDate: '2026-11-01', endDate: '2026-11-18' });
    expect(presetRange('ytd', '2026-11-18')).toEqual({ startDate: '2026-01-01', endDate: '2026-11-18' });
    expect(presetRange('last_7', '2026-11-18')).toEqual({ startDate: '2026-11-11', endDate: '2026-11-17' });
    expect(presetRange('custom', '2026-11-18')).toBeNull();
  });
  it('prev of a full month is the previous full month', () => {
    expect(compareRange({ startDate: '2026-03-01', endDate: '2026-03-31' }, 'prev')).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' });
    expect(compareRange({ startDate: '2026-01-01', endDate: '2026-01-31' }, 'prev')).toEqual({ startDate: '2025-12-01', endDate: '2025-12-31' });
  });
  it('prev of an arbitrary range is the same length ending the day before', () => {
    expect(compareRange({ startDate: '2026-01-01', endDate: '2026-01-10' }, 'prev')).toEqual({ startDate: '2025-12-22', endDate: '2025-12-31' });
  });
  it('yoy maps Feb 29 to Feb 28', () => {
    expect(compareRange({ startDate: '2028-02-01', endDate: '2028-02-29' }, 'yoy')).toEqual({ startDate: '2027-02-01', endDate: '2027-02-28' });
    expect(compareRange({ startDate: '2026-10-03', endDate: '2026-11-02' }, 'yoy')).toEqual({ startDate: '2025-10-03', endDate: '2025-11-02' });
  });
  it('none', () => { expect(compareRange({ startDate: '2026-10-01', endDate: '2026-10-31' }, 'none')).toBeNull(); });
  it('granularity', () => {
    expect(autoGranularity({ startDate: '2026-08-01', endDate: '2026-10-31' })).toBe('day');
    expect(autoGranularity({ startDate: '2026-01-01', endDate: '2026-10-31' })).toBe('week');
    expect(autoGranularity({ startDate: '2024-01-01', endDate: '2026-10-31' })).toBe('month');
  });
  it('validates ranges', () => {
    expect(isValidRange({ startDate: '2026-10-31', endDate: '2026-10-01' })).toBe(false);
    expect(isValidRange({ startDate: '2026-02-30', endDate: '2026-03-01' })).toBe(false);
    expect(isValidRange({ startDate: '2020-01-01', endDate: '2026-01-01' })).toBe(false);
    expect(isValidRange({ startDate: '2026-10-01', endDate: '2026-10-31' })).toBe(true);
    expect(isValidRange({ startDate: 'nope', endDate: '2026-10-31' })).toBe(false);
  });
  it('labels', () => {
    expect(rangeLabel({ startDate: '2026-10-01', endDate: '2026-10-31' })).toBe('Oct 2026');
    expect(rangeLabel({ startDate: '2025-12-20', endDate: '2026-01-05' })).toBe('Dec 20, 2025 – Jan 5, 2026');
    expect(rangeLabel({ startDate: '2026-10-03', endDate: '2026-11-02' })).toBe('Oct 3 – Nov 2, 2026');
  });
});
