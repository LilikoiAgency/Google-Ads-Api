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
