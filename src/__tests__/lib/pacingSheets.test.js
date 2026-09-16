import { describe, it, expect } from 'vitest';
import { extractPlatformLines, budgetTabCandidates, parseMetaLocationTab, extractGeoPacing } from '../../lib/pacingSheets';

// Mirrors the real PLS PACING tab: a totals row above the header, then the
// header row, then one row per platform.
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

describe('budgetTabCandidates', () => {
  it('tries the client-prefixed tab name before the shared one', () => {
    expect(budgetTabCandidates('Google Budget', 'PLS'))
      .toEqual(['PLS Google Budget', 'Google Budget']);
  });

  it('falls back to the bare tab name when no client key is given', () => {
    expect(budgetTabCandidates('Meta Budget', '')).toEqual(['Meta Budget']);
    expect(budgetTabCandidates('Meta Budget', undefined)).toEqual(['Meta Budget']);
  });
});

describe('extractGeoPacing', () => {
  it('reads the client-wide totals row above the header, not the first platform line', () => {
    expect(extractGeoPacing(PLS_ROWS)).toEqual([{ name: 'CA', pacing: 31847.62 }]);
  });

  it('includes LA / SAC / FNO / BFD codes', () => {
    const rows = [
      ['', '', 100, 200, 300, 400, 500],
      ['Client', 'Platform', 'CA', 'LA', 'SAC', 'FNO', 'BFD'],
      ['SMP', 'GOOGLE', 1, 2, 3, 4, 5],
    ];
    expect(extractGeoPacing(rows).map((g) => g.name)).toEqual(['CA', 'LA', 'SAC', 'FNO', 'BFD']);
    expect(extractGeoPacing(rows)[1].pacing).toBe(200);
  });

  it('falls back to the row below when nothing numeric sits above the header', () => {
    const rows = [
      ['Client', 'Platform', 'CA', 'SD'],
      ['SMP', 'GOOGLE', 10, 20],
    ];
    expect(extractGeoPacing(rows)).toEqual([{ name: 'CA', pacing: 10 }, { name: 'SD', pacing: 20 }]);
  });
});

// Mirrors the real SMP "META Spends by Location" tab as of 2026-09-16.
const META_LOC_ROWS = [
  ['Location', 'Lead Count', 'Spend %', 'Spend'],
  ['Fresno', 6, 7.23, 804.1],
  ['Inland Empire', 16, 19.28, 2144.27],
  ['Los Angeles', 24, 28.92, 3216.4],
  ['Orange County', 8, 9.64, 1072.13],
  ['Sacramento', 6, 7.23, 804.1],
  ['San Diego', 19, 22.89, 2546.32],
  ['San Franscisco', 4, 4.82, 536.07],
];

describe('parseMetaLocationTab', () => {
  it('parses every location row and totals leads and spend', () => {
    const out = parseMetaLocationTab(META_LOC_ROWS);
    expect(out.locations).toHaveLength(7);
    expect(out.totalLeads).toBe(83);
    expect(out.totalSpend).toBeCloseTo(11123.39, 2);
  });

  it('sorts by spend descending and keeps the sheet share', () => {
    const out = parseMetaLocationTab(META_LOC_ROWS);
    expect(out.locations[0]).toEqual({ name: 'Los Angeles', leads: 24, sharePct: 28.92, spend: 3216.4 });
    expect(out.locations[out.locations.length - 1].name).toBe('San Franscisco');
  });

  it('derives share from leads when the sheet has no percent column', () => {
    const out = parseMetaLocationTab([
      ['Location', 'Lead Count', 'Spend'],
      ['A', 3, 300],
      ['B', 1, 100],
    ]);
    expect(out.locations.map((l) => l.sharePct)).toEqual([75, 25]);
  });

  it('stops at a total row and skips blank / zero rows', () => {
    const out = parseMetaLocationTab([
      ['Location', 'Lead Count', 'Spend %', 'Spend'],
      ['A', 3, 75, 300],
      ['', '', '', ''],
      ['Empty', 0, 0, 0],
      ['Grand Count', 3, 100, 300],
      ['Z', 9, 9, 900],
    ]);
    expect(out.locations.map((l) => l.name)).toEqual(['A']);
  });

  it('returns an empty result for a missing or headerless tab', () => {
    expect(parseMetaLocationTab([])).toEqual({ locations: [], totalLeads: 0, totalSpend: 0 });
    expect(parseMetaLocationTab([['foo', 'bar']]).locations).toEqual([]);
  });
});
