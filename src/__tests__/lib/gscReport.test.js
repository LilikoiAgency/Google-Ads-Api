import { describe, it, expect } from 'vitest';
import { buildSearchRequests, normalizeSearchReport, brandRegex, cleanBrandTerms, hasQueries } from '@/lib/gscReport';

const range = { startDate: '2026-10-01', endDate: '2026-10-31' };
const cmp = { startDate: '2026-09-01', endDate: '2026-09-30' };
const row = (keys, clicks, impressions, position = 5) => ({ keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

describe('buildSearchRequests', () => {
  it('asks for totals with no dimensions (not summed query rows) and fresh data', () => {
    const r = buildSearchRequests({ ...range, compareRange: null, type: 'web' });
    const totals = r.find((x) => x.key === 'totals');
    expect(totals.body.dimensions).toBeUndefined();
    expect(r.every((x) => x.body.dataState === 'all' && x.body.type === 'web')).toBe(true);
    expect(r.map((x) => x.key)).toEqual(['totals', 'trend', 'pages', 'countries', 'devices', 'queries', 'queryPages', 'appearance']);
    expect(r.find((x) => x.key === 'queryPages').body.rowLimit).toBe(25000);
  });

  it('adds compare-period requests', () => {
    const keys = buildSearchRequests({ ...range, compareRange: cmp, type: 'web' }).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['totals:compare', 'trend:compare', 'pages:compare', 'queries:compare', 'devices:compare', 'countries:compare']));
    const t = buildSearchRequests({ ...range, compareRange: cmp }).find((x) => x.key === 'totals:compare');
    expect(t.body.startDate).toBe('2026-09-01');
  });

  it('adds branded / non-branded regex requests when terms are set', () => {
    const r = buildSearchRequests({ ...range, compareRange: cmp, brandTerms: ['Semper', 'semper solaris'] });
    const b = r.find((x) => x.key === 'brand:totals');
    expect(b.body.dimensionFilterGroups[0].filters[0]).toEqual({ dimension: 'query', operator: 'includingRegex', expression: '(?i)(semper|semper solaris)' });
    expect(r.find((x) => x.key === 'nonBrand:trend').body.dimensionFilterGroups[0].filters[0].operator).toBe('excludingRegex');
    expect(r.some((x) => x.key === 'nonBrand:totals:compare')).toBe(true);
  });

  it('skips query, device and appearance requests for Discover', () => {
    const keys = buildSearchRequests({ ...range, compareRange: cmp, type: 'discover', brandTerms: ['x'] }).map((x) => x.key);
    expect(keys.some((k) => /quer|device|appearance|brand/i.test(k))).toBe(false);
    expect(hasQueries('discover')).toBe(false);
    expect(hasQueries('image')).toBe(true);
  });
});

describe('brand terms', () => {
  it('cleans, dedupes and escapes', () => {
    expect(cleanBrandTerms([' Acme  Co ', 'acme co', '', 'a.b'])).toEqual(['acme co', 'a.b']);
    expect(brandRegex(['a.b', 'c+d'])).toBe('(?i)(a\\.b|c\\+d)');
    expect(brandRegex([])).toBeNull();
  });
});

describe('normalizeSearchReport', () => {
  const results = {
    totals: { rows: [{ clicks: 100, impressions: 5000, ctr: 0.02, position: 12.5 }] },
    'totals:compare': { rows: [{ clicks: 80, impressions: 4000, ctr: 0.02, position: 14 }] },
    trend: { rows: [row(['2026-10-02'], 6, 200), row(['2026-10-01'], 4, 100)], metadata: { firstIncompleteDate: '2026-10-30' } },
    'trend:compare': { rows: [row(['2026-09-01'], 3, 90)] },
    queries: { rows: [row(['acme roofing'], 30, 300, 1.2), row(['roof repair'], 10, 900, 8)] },
    'queries:compare': { rows: [row(['acme roofing'], 20, 250, 1.4)] },
    pages: { rows: [row(['https://acme.com/'], 40, 1000)] },
    'pages:compare': { rows: [] },
    queryPages: { rows: [row(['roof repair', 'https://acme.com/'], 10, 900)] },
    devices: { rows: [row(['MOBILE'], 60, 3000), row(['DESKTOP'], 40, 2000)] },
    'devices:compare': { rows: [row(['MOBILE'], 50, 2500)] },
    countries: { rows: [row(['usa'], 90, 4000)] },
    appearance: { rows: [row(['VIDEO'], 2, 50)] },
    'brand:totals': { rows: [{ clicks: 30, impressions: 300, ctr: 0.1, position: 1.2 }] },
    'nonBrand:totals': { rows: [{ clicks: 50, impressions: 4000, ctr: 0.0125, position: 13 }] },
    'brand:totals:compare': { rows: [{ clicks: 20, impressions: 250, ctr: 0.08, position: 1.4 }] },
    'nonBrand:totals:compare': { rows: [{ clicks: 40, impressions: 3000, ctr: 0.013, position: 15 }] },
    'brand:trend': { rows: [row(['2026-10-01'], 2, 20)] },
    'nonBrand:trend': { rows: [row(['2026-10-01'], 1, 50), row(['2026-10-02'], 3, 60)] },
  };
  const out = normalizeSearchReport(results, { site: 'sc-domain:acme.com', range, compareRange: cmp, type: 'web', brandTerms: ['acme'] });

  it('takes totals from the unfiltered totals request', () => {
    expect(out.totals).toEqual({ clicks: 100, impressions: 5000, ctr: 0.02, position: 12.5 });
    expect(out.totalsCompare.clicks).toBe(80);
  });

  it('sorts the trend and keeps the preliminary marker', () => {
    expect(out.trend.map((t) => t.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(out.firstIncompleteDate).toBe('2026-10-30');
  });

  it('attaches compare rows as prev', () => {
    expect(out.queries[0].prev.clicks).toBe(20);
    expect(out.queries[1].prev).toBeNull();
    expect(out.devices[0]).toMatchObject({ device: 'Mobile', clicks: 60, prev: { clicks: 50 } });
    expect(out.devices[1].prev).toBeNull();
  });

  it('splits branded / non-branded / anonymized clicks', () => {
    expect(out.brand.current.anonymized).toEqual({ clicks: 20, impressions: 700 });
    expect(out.brand.compare.anonymized).toEqual({ clicks: 20, impressions: 750 });
    expect(out.brand.trend).toEqual([
      { date: '2026-10-01', branded: 2, nonBranded: 1 },
      { date: '2026-10-02', branded: 0, nonBranded: 3 },
    ]);
  });

  it('handles empty responses and no compare', () => {
    const e = normalizeSearchReport({}, { site: 's', range, compareRange: null, type: 'web', brandTerms: [] });
    expect(e.totals).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
    expect(e.totalsCompare).toBeNull();
    expect(e.brand).toBeNull();
    expect(e.queries).toEqual([]);
  });
});
