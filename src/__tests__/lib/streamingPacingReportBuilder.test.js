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

  it('has an empty tabErrors summary and no banner when there are no tab read errors', () => {
    expect(html).not.toContain('Sheet read failed');
    expect(summary.tabErrors).toEqual([]);
  });
});

describe('buildStreamingPacingReport — tab read errors', () => {
  it('surfaces a Budget tab read error as a banner, an action, and a summary entry', () => {
    const { html, summary } = buildStreamingPacingReport({
      reportDate: '2026-09-11', info: INFO, budgets: { error: 'The caller does not have permission' }, clients: [SMP],
    });
    expect(html).toContain('Sheet read failed: Budget');
    expect(html).toContain('The caller does not have permission');
    expect(html).toContain('Budget and pacing figures below may be wrong until this is fixed.');
    expect(summary.tabErrors).toEqual(['Budget']);
  });
});
