import { describe, it, expect } from 'vitest';
import { buildReportRequests, normalizeTrafficReport } from '@/lib/ga4Report';
import { selectAudience, selectView } from '@/lib/ga4View';
import semper from '../fixtures/ga4/semper-oct-2026.json';

const ctx = {
  property: { id: 'properties/1', name: 'Test', account: 'Test' },
  range: { startDate: '2026-10-01', endDate: '2026-10-07' },
  compareRange: null,
  granularity: 'day',
};

const row = (dims, mets) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: mets.map((v) => ({ value: String(v) })),
});

function reportsWithAudience() {
  const base = Array.from({ length: 8 }, () => ({ rows: [] }));
  return [
    ...base,
    { rows: [
      row(['United States', 'California', 'San Diego', 'Organic Search'], [100, 80, 60, 5]),
      row(['United States', 'California', 'San Diego', 'Paid Search'], [50, 40, 20, 4]),
      row(['United States', 'California', 'Los Angeles', 'Organic Search'], [30, 25, 10, 0]),
      row(['United States', 'Texas', 'Austin', 'Direct'], [20, 18, 5, 1]),
    ] },
    { rows: [
      row(['mobile', 'Organic Search'], [120, 100, 60, 4]),
      row(['desktop', 'Organic Search'], [10, 9, 10, 1]),
      row(['desktop', 'Paid Search'], [50, 40, 20, 4]),
    ] },
    { rows: [
      row(['new', 'Organic Search'], [90, 90, 40, 2]),
      row(['returning', 'Organic Search'], [40, 20, 30, 3]),
      row(['(not set)', 'Organic Search'], [0, 0, 0, 0]),
    ] },
    { rows: [
      row(['generate_lead', 'Organic Search'], [4]),
      row(['click_to_call', 'Organic Search'], [1]),
      row(['generate_lead', 'Paid Search'], [4]),
      row(['page_view', 'Organic Search'], [0]),
    ] },
    { rows: [
      row(['1', '09', 'Organic Search'], [12, 1]), // Monday 9am
      row(['0', '23', 'Organic Search'], [3, 0]), // Sunday 11pm
      row(['1', '09', 'Paid Search'], [7, 2]),
    ] },
  ];
}

describe('GA4 audience breakdowns', () => {
  it('requests geo, device, new vs returning, key events by name and day x hour', () => {
    const r = buildReportRequests({ ...ctx.range, compareRange: null, granularity: 'day' });
    expect(r.slice(8).map((q) => q.dimensions.map((d) => d.name))).toEqual([
      ['country', 'region', 'city', 'sessionPrimaryChannelGroup'],
      ['deviceCategory', 'sessionPrimaryChannelGroup'],
      ['newVsReturning', 'sessionPrimaryChannelGroup'],
      ['eventName', 'sessionPrimaryChannelGroup'],
      ['dayOfWeek', 'hour', 'sessionPrimaryChannelGroup'],
    ]);
    expect(r[11].metricFilter.filter.fieldName).toBe('keyEvents');
  });

  it('normalizes the breakdown rows', () => {
    const out = normalizeTrafficReport(reportsWithAudience(), ctx);
    expect(out.geo[0]).toEqual({ country: 'United States', region: 'California', city: 'San Diego', channel: 'Organic Search', sessions: 100, users: 80, engagedSessions: 60, keyEvents: 5 });
    expect(out.devices).toHaveLength(3);
    expect(out.keyEventNames.map((e) => e.event)).toEqual(['generate_lead', 'click_to_call', 'generate_lead']);
    expect(out.timeGrid[0]).toEqual({ day: 1, hour: 9, channel: 'Organic Search', sessions: 12, keyEvents: 1 });
  });

  it('rolls breakdowns up per view', () => {
    const report = normalizeTrafficReport(reportsWithAudience(), ctx);
    const organic = selectAudience(report, 'organic');
    expect(organic.cities.map((c) => c.city)).toEqual(['San Diego', 'Los Angeles']);
    expect(organic.cities[0].sessions).toBe(100);
    expect(organic.regions).toHaveLength(1);
    expect(organic.devices.map((d) => d.device)).toEqual(['Mobile', 'Desktop']);
    expect(organic.devices[0].engagementRate).toBe(0.5);
    expect(organic.visitorTypes[0]).toMatchObject({ type: 'New visitors', sessions: 90 });
    expect(organic.keyEvents).toEqual([
      { event: 'generate_lead', count: 4, share: 0.8 },
      { event: 'click_to_call', count: 1, share: 0.2 },
    ]);
    expect(organic.heatmap.sessions[0][9]).toBe(12); // Monday row
    expect(organic.heatmap.sessions[6][23]).toBe(3); // Sunday row
    expect(organic.heatmap.max).toBe(12);

    const all = selectAudience(report, 'all');
    expect(all.cities[0]).toMatchObject({ city: 'San Diego', sessions: 150, keyEvents: 9 });
    expect(all.regions.map((r) => r.region)).toEqual(['California', 'Texas']);
    expect(all.regions[0].share).toBeCloseTo(180 / 200);
    expect(all.keyEvents[0]).toMatchObject({ event: 'generate_lead', count: 8 });
    expect(all.heatmap.sessions[0][9]).toBe(19);
  });

  it('returns null audience for reports cached before the breakdowns existed', () => {
    const old = normalizeTrafficReport(semper.reports, { ...ctx, compareRange: { startDate: '2026-09-01', endDate: '2026-09-30' } });
    delete old.geo;
    expect(selectView(old, 'all').audience).toBeNull();
  });
});
