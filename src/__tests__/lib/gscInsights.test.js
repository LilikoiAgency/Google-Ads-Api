import { describe, it, expect } from 'vitest';
import {
  expectedCtrModel, strikingDistance, lowCtr, cannibalization, pageGroups, groupOf, aggregate,
  rollupTrend, isBranded, guessBrandTerm, pagesForQuery, queriesForPage, change,
} from '@/lib/gscInsights';
import { siteHost, matchProperty, normalizePath, ga4ByPath, joinPages } from '@/lib/gscGa4Join';

const q = (query, clicks, impressions, position) => ({ query, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

describe('expected CTR model', () => {
  it('uses the default curve without data and never rises with position', () => {
    const ctrAt = expectedCtrModel([]);
    expect(ctrAt(1)).toBeCloseTo(0.28);
    expect(ctrAt(3)).toBeCloseTo(0.11);
    for (let p = 2; p <= 25; p++) expect(ctrAt(p)).toBeLessThanOrEqual(ctrAt(p - 1));
  });

  it("leans on the site's own click-weighted CTR, within 0.5x-1.5x of the default", () => {
    const at3 = (ctr) => Array.from({ length: 5 }, (_, i) => q(`q${i}`, ctr * 100, 100, 3));
    expect(expectedCtrModel(at3(0.13))(3)).toBeCloseTo(0.13);
    expect(expectedCtrModel(at3(0.002))(3)).toBeCloseTo(0.055); // zero-click site: floor
    // Capped at 1.5x (0.165), then held at position 2's 0.16 so it never beats a higher spot.
    expect(expectedCtrModel(at3(0.9))(3)).toBeCloseTo(0.16);
    expect(expectedCtrModel(at3(0.9).slice(0, 4))(3)).toBeCloseTo(0.11); // too few samples
  });
});

describe('opportunities', () => {
  const ctrAt = expectedCtrModel([]);
  it('ranks striking-distance queries by extra clicks at position 3', () => {
    const out = strikingDistance([q('a', 5, 1000, 6), q('b', 1, 100, 9), q('top', 50, 1000, 2), q('deep', 0, 1000, 30), q('tiny', 0, 10, 6)], ctrAt);
    expect(out.map((r) => r.query)).toEqual(['a', 'b']);
    expect(out[0].potential).toBe(Math.round(1000 * 0.11 - 5));
  });

  it('flags top-10 rows with under half the expected CTR', () => {
    const out = lowCtr([q('weak', 2, 1000, 2), q('fine', 150, 1000, 2), q('deep', 0, 1000, 15)], ctrAt);
    expect(out.map((r) => r.query)).toEqual(['weak']);
    expect(out[0].lostClicks).toBe(158);
  });

  it('finds queries split across pages', () => {
    const rows = [
      { query: 'solar', page: '/a', clicks: 5, impressions: 60, position: 8 },
      { query: 'solar', page: '/b', clicks: 2, impressions: 40, position: 12 },
      { query: 'solar', page: '/c', clicks: 0, impressions: 5, position: 40 },
      { query: 'roof', page: '/a', clicks: 9, impressions: 100, position: 3 },
    ];
    const out = cannibalization(rows);
    expect(out).toHaveLength(1);
    expect(out[0].pages.map((p) => p.page)).toEqual(['/a', '/b']);
    // Branded queries are skipped; UTM variants of one URL are one page.
    expect(cannibalization(rows, { brandTerms: ['solar'] })).toEqual([]);
    const utm = cannibalization([
      { query: 'x', page: 'https://a.com/p?utm_source=gbp', clicks: 1, impressions: 50, position: 3 },
      { query: 'x', page: 'https://a.com/p', clicks: 1, impressions: 50, position: 5 },
    ]);
    expect(utm).toEqual([]);
    expect(pagesForQuery(rows, 'solar')[0].page).toBe('/a');
    expect(queriesForPage(rows, '/a').map((r) => r.query)).toEqual(['roof', 'solar']);
  });
});

describe('aggregation', () => {
  it('weights position by impressions', () => {
    expect(aggregate([{ clicks: 1, impressions: 100, position: 2 }, { clicks: 1, impressions: 300, position: 10 }]))
      .toEqual({ clicks: 2, impressions: 400, ctr: 0.005, position: 8 });
  });

  it('groups pages by first folder', () => {
    expect(groupOf('https://x.com/services/solar/')).toBe('/services');
    expect(groupOf('https://x.com/about')).toBe('/');
    expect(groupOf('https://x.com/')).toBe('/');
    const g = pageGroups([
      { page: 'https://x.com/blog/a', clicks: 3, impressions: 30, position: 5, prev: { clicks: 1, impressions: 10, position: 6 } },
      { page: 'https://x.com/blog/b', clicks: 1, impressions: 10, position: 9, prev: null },
      { page: 'https://x.com/', clicks: 10, impressions: 50, position: 2, prev: null },
    ]);
    expect(g.map((x) => [x.group, x.pages, x.clicks])).toEqual([['/', 1, 10], ['/blog', 2, 4]]);
    expect(g[1].prev.clicks).toBe(1);
  });

  it('rolls the daily trend up to ISO weeks and months', () => {
    const t = [
      { date: '2026-11-01', clicks: 1, impressions: 10, position: 4 }, // Sunday
      { date: '2026-11-02', clicks: 2, impressions: 30, position: 8 }, // Monday
    ];
    expect(rollupTrend(t, 'week').map((x) => [x.date, x.clicks])).toEqual([['2026-10-26', 1], ['2026-11-02', 2]]);
    expect(rollupTrend(t, 'month')).toEqual([{ date: '2026-11-01', clicks: 3, impressions: 40, ctr: 0.075, position: 7 }]);
    expect(rollupTrend(t, 'day')).toBe(t);
  });

  it('matches brand terms and suggests one from the site', () => {
    expect(isBranded('Semper Solaris reviews', ['semper'])).toBe(true);
    expect(isBranded('solar panels', ['semper'])).toBe(false);
    expect(guessBrandTerm('sc-domain:rangerelectricco.com')).toBe('rangerelectricco');
    expect(guessBrandTerm('https://www.bigbullyturf.com/')).toBe('bigbullyturf');
    expect(change(12, 10)).toBeCloseTo(0.2);
    expect(change(5, 0)).toBeNull();
  });
});

describe('GA4 join', () => {
  const streams = [
    { propertyId: 'p/help', propertyName: 'Help', uri: 'https://help.acme.com' },
    { propertyId: 'p/main', propertyName: 'Main', uri: 'https://www.acme.com' },
  ];
  it('matches the main domain exactly, never a subdomain stream', () => {
    expect(siteHost('sc-domain:acme.com')).toBe('acme.com');
    expect(siteHost('https://www.acme.com/')).toBe('acme.com');
    expect(matchProperty('sc-domain:acme.com', streams).id).toBe('p/main');
    expect(matchProperty('sc-domain:acme.com', [streams[0]])).toBeNull();
    expect(matchProperty('https://shop.acme.com/', [streams[1]]).id).toBe('p/main');
  });

  it('joins on normalized paths', () => {
    expect(normalizePath('https://acme.com/Services/?utm=x#a')).toBe('/services');
    expect(normalizePath('/services/')).toBe('/services');
    expect(normalizePath('https://acme.com')).toBe('/');
    const map = ga4ByPath([{ path: '/services/', sessions: 5, engagedSessions: 3, keyEvents: 1 }, { path: '/services?x=1', sessions: 2, engagedSessions: 1, keyEvents: 0 }]);
    const out = joinPages([{ page: 'https://www.acme.com/services' }, { page: 'https://acme.com/none' }], map);
    expect(out[0].ga).toEqual({ sessions: 7, engagedSessions: 4, keyEvents: 1 });
    expect(out[1].ga).toBeNull();
  });
});
