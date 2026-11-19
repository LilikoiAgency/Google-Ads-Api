import { describe, it, expect } from 'vitest';
import { buildSearchSummary, planStats, kpiCards, isQuickWin, effortLabel, compact } from '@/lib/seoAuditV2/overview';

const GSC = {
  range: { startDate: '2026-08-17', endDate: '2026-11-14' },
  compare_range: { startDate: '2026-05-19', endDate: '2026-08-16' },
  totals: { clicks: 4661, impressions: 312344, ctr: 0.015, avg_position: 13.8, clicks_change_pct: -38, impressions_change_pct: -46, avg_position_prev: 12.8 },
  branded_split: { branded_clicks: 2668, nonbranded_clicks: 365, branded_click_share: 0.88 },
  striking_distance: Array.from({ length: 12 }, (_, i) => ({ query: `q${i}`, clicks: i, impressions: 1000 - i, ctr: 0.01, position: 9 })),
};
const INSPECTION = [{ verdict: 'PASS' }, { verdict: 'PASS' }, { verdict: 'NEUTRAL' }];
const task = (impact, effort, category = 'content') => ({ impact, effort, category });

describe('buildSearchSummary', () => {
  it('keeps totals, brand share, the top 8 almost-won searches and index counts', () => {
    const out = buildSearchSummary(GSC, INSPECTION);
    expect(out.search).toMatchObject({ clicks: 4661, impressions: 312344, avg_position: 13.8, avg_position_prev: 12.8, clicks_change_pct: -38, branded_click_share: 0.88, nonbranded_clicks: 365 });
    expect(out.search.opportunities).toHaveLength(8);
    expect(out.search.opportunities[0]).toEqual({ query: 'q0', clicks: 0, impressions: 1000, position: 9 });
    expect(out.index).toEqual({ checked: 3, indexed: 2 });
  });
  it('returns nothing for missing sources', () => {
    expect(buildSearchSummary(null, null)).toEqual({});
    expect(buildSearchSummary({}, [])).toEqual({});
  });
});

describe('planStats', () => {
  it('counts areas (largest first) and the impact/effort grid with one quick-win rule', () => {
    const plan = [task(5, 1), task(4, 2, 'local'), task(5, 3), task(2, 1), task(2, 2, 'local'), task(1, 4, 'technical')];
    const s = planStats(plan);
    expect(s.areas.map((a) => [a.label, a.count])).toEqual([['Content', 3], ['Local', 2], ['Technical', 1]]);
    expect(s.matrix).toEqual({ quick: 2, big: 1, fill: 2, later: 1 });
    expect(s.quickWins).toBe(plan.filter(isQuickWin).length);
  });
});

describe('kpiCards', () => {
  it('builds the six headline cards with direction and tone', () => {
    const cards = kpiCards({ ...buildSearchSummary(GSC, INSPECTION), action_plan: [task(5, 1), task(2, 3)] });
    expect(cards.map((c) => c.key)).toEqual(['clicks', 'impressions', 'position', 'brand', 'index', 'plan']);
    expect(cards[0]).toMatchObject({ value: '4,661', sub: '▼ 38% vs prior 90 days', tone: 'down' });
    expect(cards[1]).toMatchObject({ value: '312K', tone: 'down' });
    expect(cards[2]).toMatchObject({ value: '13.8', sub: '▼ Down from 12.8', tone: 'down' });
    expect(cards[3]).toMatchObject({ value: '88%', sub: '365 non-brand clicks' });
    expect(cards[4]).toMatchObject({ value: '2', unit: '/3', sub: '1 checked page not indexed', tone: 'down' });
    expect(cards[5]).toMatchObject({ value: '2', sub: '1 quick win', tone: 'up' });
  });
  it('an older result without search data shows only the plan card', () => {
    expect(kpiCards({ action_plan: [] }).map((c) => c.key)).toEqual(['plan']);
  });
  it('a better position reads as up', () => {
    const s = buildSearchSummary({ ...GSC, totals: { ...GSC.totals, avg_position: 9, avg_position_prev: 12 } });
    expect(kpiCards(s).find((c) => c.key === 'position')).toMatchObject({ sub: '▲ Up from 12', tone: 'up' });
  });
});

describe('formatting helpers', () => {
  it('effort words and compact numbers', () => {
    expect([1, 2, 3, 4, 5].map(effortLabel)).toEqual(['Quick', 'Quick', 'Moderate', 'Major', 'Major']);
    expect(compact(9999)).toBe('9,999');
    expect(compact(312344)).toBe('312K');
  });
});
