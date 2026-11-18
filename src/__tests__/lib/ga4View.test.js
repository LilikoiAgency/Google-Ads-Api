import { describe, it, expect } from 'vitest';
import { normalizeTrafficReport } from '@/lib/ga4Report';
import { inView } from '@/lib/ga4Channels';
import { selectView, delta } from '@/lib/ga4View';
import semper from '../fixtures/ga4/semper-oct-2026.json';

const ctx = {
  property: { id: 'properties/349447933', name: 'Semper Solaris - GA4', account: 'Semper Solaris' },
  range: { startDate: '2026-10-01', endDate: '2026-10-31' },
  compareRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
  granularity: 'day',
};
const report = normalizeTrafficReport(semper.reports, ctx);
const noCompare = normalizeTrafficReport(semper.reports, { ...ctx, compareRange: null });

describe('ga4View', () => {
  it('organic view only has Organic Search', () => {
    const v = selectView(report, 'organic');
    expect(v.view.key).toBe('organic');
    expect(v.channels.map((c) => c.channel)).toEqual(['Organic Search']);
    expect(v.totals).toEqual(report.totalsByView.organic);
    expect(v.totalsCompare).toEqual(report.totalsByViewCompare.organic);
    expect(v.series.datasets.map((d) => d.channel)).toEqual(['Organic Search']);
    expect(v.series.labels).toEqual(report.series.labels);
  });

  it('unknown channel only appears in all', () => {
    const r = JSON.parse(JSON.stringify(report));
    const m = { users: 1, newUsers: 1, sessions: 1, engagedSessions: 1, engagementRate: 1, keyEvents: 0 };
    r.channels.push({ channel: 'Brand New', bucket: 'unassigned', current: m, compare: m });
    r.series.byChannel['Brand New'] = r.series.labels.map(() => 1);
    for (const key of ['organic', 'nonPaid', 'paid']) {
      const v = selectView(r, key);
      expect(v.channels.map((c) => c.channel)).not.toContain('Brand New');
      expect(v.series.datasets.map((d) => d.channel)).not.toContain('Brand New');
    }
    const all = selectView(r, 'all');
    expect(all.channels.map((c) => c.channel)).toContain('Brand New');
    expect(all.series.datasets.map((d) => d.channel)).toContain('Brand New');
  });

  it('delta is null when compare value is 0', () => {
    expect(delta(5, 0)).toBeNull();
    expect(delta(5, null)).toBeNull();
    expect(delta(110, 100)).toBeCloseTo(0.1);
  });

  it('engagementRate delta is points', () => {
    const r = JSON.parse(JSON.stringify(report));
    r.totalsByView.all.engagementRate = 0.6;
    r.totalsByViewCompare.all.engagementRate = 0.5;
    r.totalsByView.all.sessions = 110;
    r.totalsByViewCompare.all.sessions = 100;
    const v = selectView(r, 'all');
    expect(v.deltas.engagementRate).toBeCloseTo(0.1);
    expect(v.deltas.sessions).toBeCloseTo(0.1);
    for (const c of v.channels) {
      expect(c.deltas.engagementRate).toBeCloseTo(c.current.engagementRate - c.compare.engagementRate);
    }
  });

  it('deltas are null without a comparison', () => {
    const v = selectView(noCompare, 'all');
    expect(v.totalsCompare).toBeNull();
    expect(Object.values(v.deltas).every((d) => d === null)).toBe(true);
    expect(v.channels.every((c) => Object.values(c.deltas).every((d) => d === null))).toBe(true);
  });

  it('sources and pages are filtered to the view and capped at 25', () => {
    const v = selectView(report, 'nonPaid');
    expect(v.sources.length).toBeLessThanOrEqual(25);
    expect(v.sources.length).toBeGreaterThan(0);
    expect(v.sources.every((s) => ['organic', 'otherNonPaid'].includes(s.bucket))).toBe(true);
    expect(v.pages.length).toBeLessThanOrEqual(25);
    expect(v.pages.length).toBeGreaterThan(0);
    const sessions = v.pages.map((p) => p.sessions);
    expect(sessions).toEqual([...sessions].sort((a, b) => b - a));
    expect(new Set(v.pages.map((p) => p.page)).size).toBe(v.pages.length);
  });

  it('pages sum across channels in the view', () => {
    const v = selectView(report, 'nonPaid');
    const top = v.pages[0];
    const expected = report.landingPages
      .filter((p) => p.page === top.page && inView(p.channel, 'nonPaid'))
      .reduce((s, p) => s + p.sessions, 0);
    expect(top.sessions).toBe(expected);
  });

  it('suspected counts all suspected sources in the view', () => {
    const v = selectView(report, 'nonPaid');
    const exp = report.sources.filter((s) => s.suspectedPaid && inView(s.channel, 'nonPaid'));
    expect(v.suspected.sessions).toBe(exp.reduce((s, x) => s + x.sessions, 0));
    expect(Object.values(v.suspected.byChannel).reduce((a, b) => a + b, 0)).toBe(v.suspected.sessions);
    expect(selectView(report, 'paid').suspected).toEqual({ sessions: 0, byChannel: {} });
  });

  it('throws on unknown view', () => {
    expect(() => selectView(report, 'nope')).toThrow(/unknown view/i);
  });
});
