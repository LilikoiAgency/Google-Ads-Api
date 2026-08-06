import { describe, it, expect } from 'vitest';
import { extractPlatformLines } from '../../lib/pacingSheets';

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
