import { describe, it, expect } from 'vitest';
import { buildReportRequests, normalizeTrafficReport } from '@/lib/ga4Report';
import semper from '../fixtures/ga4/semper-oct-2026.json';
import empty from '../fixtures/ga4/empty.json';

const ctx = {
  property: { id: 'properties/349447933', name: 'Semper Solaris - GA4', account: 'Semper Solaris' },
  range: { startDate: '2026-10-01', endDate: '2026-10-31' },
  compareRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
  granularity: 'day',
};

const ZERO = { users: 0, newUsers: 0, sessions: 0, engagedSessions: 0, engagementRate: 0, keyEvents: 0 };

function emptyReports() {
  return JSON.parse(JSON.stringify(empty.reports));
}

describe('ga4Report', () => {
  it('builds 13 requests with view filters', () => {
    const r = buildReportRequests({ ...ctx.range, compareRange: ctx.compareRange, granularity: 'week' });
    expect(r).toHaveLength(13);
    expect(r[1].dimensionFilter.filter.inListFilter.values).toEqual(['Organic Search']);
    expect(r[4].dimensionFilter).toBeUndefined();
    expect(r[5].dimensions[0].name).toBe('isoYearIsoWeek');
    expect(r[5].dateRanges).toHaveLength(1);
  });

  it('uses two named date ranges only for channels and totals', () => {
    const r = buildReportRequests({ ...ctx.range, compareRange: ctx.compareRange, granularity: 'day' });
    for (const i of [0, 1, 2, 3, 4]) {
      expect(r[i].dateRanges).toEqual([
        { ...ctx.range, name: 'current' },
        { ...ctx.compareRange, name: 'compare' },
      ]);
    }
    for (const i of [5, 6, 7, 8, 9, 10, 11, 12]) expect(r[i].dateRanges).toEqual([{ ...ctx.range, name: 'current' }]);
    expect(r[5].dimensions[0].name).toBe('date');
    expect(r[6].limit).toBe(1000);
    expect(r[7].limit).toBe(500);
    expect(r[6].orderBys).toEqual([{ metric: { metricName: 'sessions' }, desc: true }]);
    const noCompare = buildReportRequests({ ...ctx.range, compareRange: null, granularity: 'month' });
    expect(noCompare[0].dateRanges).toHaveLength(1);
    expect(noCompare[5].dimensions[0].name).toBe('yearMonth');
  });

  it('normalizes real responses', () => {
    const out = normalizeTrafficReport(semper.reports, ctx);
    expect(out.totalsByView.all.users).toBeGreaterThan(out.totalsByView.nonPaid.users);
    expect(typeof out.channels[0].current.sessions).toBe('number');
    expect(out.channels[0].current.sessions).toBeGreaterThanOrEqual(out.channels[1].current.sessions);
    expect(out.series.labels).toHaveLength(31);
    expect(out.series.labels[0]).toBe('Oct 1');
    expect(out.totalsByViewCompare).not.toBeNull();
    expect(out.totalsByViewCompare.all.sessions).toBeGreaterThan(0);
    expect(out.channels.every((c) => c.compare !== null)).toBe(true);
    const anyChannel = Object.values(out.series.byChannel)[0];
    expect(anyChannel).toHaveLength(31);
    expect(anyChannel.slice(5).every((v) => v === 0)).toBe(true); // fixture keeps 5 days
    expect(out.sources).toHaveLength(20);
    expect(out.landingPages).toHaveLength(20);
    const rate = out.totalsByView.all.engagementRate;
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(1);
  });

  it('normalizes empty responses', () => {
    const out = normalizeTrafficReport(empty.reports, ctx);
    expect(out.totalsByView.organic).toEqual(ZERO);
    expect(out.totalsByViewCompare.all).toEqual(ZERO);
    expect(out.channels).toEqual([]);
    expect(out.series.labels).toHaveLength(31);
    expect(out.series.byChannel).toEqual({});
    expect(out.sources).toEqual([]);
    expect(out.landingPages).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(out.dataQuality).toEqual({ sampled: false, otherRow: false, thresholded: false });
    expect(out.property).toEqual(ctx.property);
  });

  it('detects thresholding', () => {
    const reports = JSON.parse(JSON.stringify(empty.reports));
    reports[2] = { ...(reports[2] || {}), metadata: { subjectToThresholding: true } };
    const out = normalizeTrafficReport(reports, ctx);
    expect(out.dataQuality.thresholded).toBe(true);
    expect(out.warnings).toEqual(['GA hid some low numbers to protect user privacy (thresholding)']);
  });

  it('totalsByViewCompare is null without a comparison', () => {
    const out = normalizeTrafficReport(empty.reports, { ...ctx, compareRange: null });
    expect(out.totalsByViewCompare).toBeNull();
    expect(out.compareRange).toBeNull();
  });

  it('labels ISO weeks by Monday', () => {
    const reports = emptyReports();
    reports[5] = {
      rows: [{ dimensionValues: [{ value: '202641' }, { value: 'Direct' }], metricValues: [{ value: '10' }] }],
      rowCount: 1,
    };
    const out = normalizeTrafficReport(reports, {
      ...ctx, range: { startDate: '2026-10-05', endDate: '2026-10-11' }, compareRange: null, granularity: 'week',
    });
    expect(out.series.labels).toEqual(['Wk of Oct 5']);
    expect(out.series.byChannel).toEqual({ Direct: [10] });
  });

  it('fills month labels across a year boundary', () => {
    const out = normalizeTrafficReport(empty.reports, {
      ...ctx, range: { startDate: '2025-11-15', endDate: '2026-02-03' }, compareRange: null, granularity: 'month',
    });
    expect(out.series.labels).toEqual(['Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026']);
  });

  it('splits current/compare rows, sorts channels, flags suspected paid and warns', () => {
    const reports = emptyReports();
    const m = (...v) => v.map((value) => ({ value: String(value) }));
    reports[0] = {
      rows: [
        { dimensionValues: m('Direct', 'current'), metricValues: m(5, 4, 6, 3, '0.5', 1) },
        { dimensionValues: m('Organic Search', 'current'), metricValues: m(10, 8, 12, 9, '0.75', 2) },
        { dimensionValues: m('Organic Search', 'compare'), metricValues: m(7, 6, 8, 4, '0.5', 0) },
        { dimensionValues: m('Organic Video Plus', 'compare'), metricValues: m(1, 1, 1, 0, '0', 0) },
      ],
    };
    reports[4] = {
      rows: [
        { dimensionValues: m('current'), metricValues: m(14, 12, 18, 12, '0.6666', 3) },
        { dimensionValues: m('compare'), metricValues: m(8, 7, 9, 4, '0.44', 0) },
      ],
      metadata: { dataLossFromOtherRow: true },
    };
    reports[6] = {
      rows: [
        { dimensionValues: m('facebook / paid', 'Organic Social'), metricValues: m(40, 30) },
        { dimensionValues: m('google / organic', 'Organic Search'), metricValues: m(20, 15) },
        { dimensionValues: m('google / cpc', 'Paid Search'), metricValues: m(10, 9) },
      ],
      metadata: { samplingMetadatas: [{ samplesReadCount: '1', samplingSpaceSize: '2' }] },
    };
    reports[7] = {
      rows: [{ dimensionValues: m('/a?b=<c>', 'Direct'), metricValues: m(3, 2, 1) }],
    };
    const out = normalizeTrafficReport(reports, ctx);
    expect(out.totalsByView.all).toEqual({ users: 14, newUsers: 12, sessions: 18, engagedSessions: 12, engagementRate: 0.6666, keyEvents: 3 });
    expect(out.totalsByViewCompare.all.sessions).toBe(9);
    expect(out.totalsByViewCompare.paid).toEqual(ZERO);
    expect(out.channels.map((c) => c.channel)).toEqual(['Organic Search', 'Direct', 'Organic Video Plus']);
    expect(out.channels[0]).toEqual({
      channel: 'Organic Search', bucket: 'organic',
      current: { users: 10, newUsers: 8, sessions: 12, engagedSessions: 9, engagementRate: 0.75, keyEvents: 2 },
      compare: { users: 7, newUsers: 6, sessions: 8, engagedSessions: 4, engagementRate: 0.5, keyEvents: 0 },
    });
    expect(out.channels[1].compare).toEqual(ZERO);
    expect(out.channels[2]).toMatchObject({ bucket: 'unassigned', current: ZERO });
    expect(out.sources[0]).toEqual({ sourceMedium: 'facebook / paid', channel: 'Organic Social', bucket: 'otherNonPaid', sessions: 40, users: 30, suspectedPaid: true });
    expect(out.sources[2].suspectedPaid).toBe(false);
    expect(out.landingPages).toEqual([{ page: '/a?b=<c>', channel: 'Direct', bucket: 'otherNonPaid', sessions: 3, users: 2, keyEvents: 1 }]);
    expect(out.warnings).toHaveLength(3);
    expect(out.warnings[0]).toMatch(/~40 sessions/);
    expect(out.warnings[0]).toMatch(/Organic Social/);
    expect(out.warnings).toContain('GA grouped some rows into (other)');
    expect(out.warnings).toContain('GA sampled this data');
    expect(out.dataQuality).toEqual({ sampled: true, otherRow: true, thresholded: false });
    expect(typeof out.fetchedAt).toBe('string');
  });

  it('landing pages carry engagedSessions when the report returns it', () => {
    expect(buildReportRequests({ ...ctx.range, compareRange: ctx.compareRange, granularity: 'day' })[7].metrics.map((m) => m.name))
      .toEqual(['sessions', 'activeUsers', 'keyEvents', 'engagedSessions']);
    const reports = emptyReports();
    reports[7] = { rows: [{ dimensionValues: [{ value: '/a' }, { value: 'Organic Search' }], metricValues: ['10', '8', '2', '6'].map((value) => ({ value })) }] };
    expect(normalizeTrafficReport(reports, ctx).landingPages[0]).toEqual({
      page: '/a', channel: 'Organic Search', bucket: 'organic', sessions: 10, users: 8, keyEvents: 2, engagedSessions: 6,
    });
  });

  it('without a comparison, channel compare is null', () => {
    const reports = emptyReports();
    reports[0] = { rows: [{ dimensionValues: [{ value: 'Direct' }], metricValues: ['1', '1', '1', '1', '1', '0'].map((value) => ({ value })) }] };
    const out = normalizeTrafficReport(reports, { ...ctx, compareRange: null });
    expect(out.channels).toEqual([{ channel: 'Direct', bucket: 'otherNonPaid', current: { users: 1, newUsers: 1, sessions: 1, engagedSessions: 1, engagementRate: 1, keyEvents: 0 }, compare: null }]);
  });
});
