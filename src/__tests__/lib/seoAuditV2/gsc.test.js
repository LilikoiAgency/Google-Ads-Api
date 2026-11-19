import { describe, it, expect, vi, beforeEach } from 'vitest';

const { inspect, sitemapsList } = vi.hoisted(() => ({ inspect: vi.fn(), sitemapsList: vi.fn() }));
vi.mock('googleapis', () => ({
  google: {
    searchconsole: () => ({ urlInspection: { index: { inspect } }, sitemaps: { list: sitemapsList } }),
  },
}));

import { joinPagesToQueries, mapInspection, inspectUrls, listGoogleSitemaps, ga4PerPage } from '@/lib/seoAuditV2/gsc';

const row = (page, query, clicks, impressions, position) => ({
  keys: [page, query], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position,
});

describe('joinPagesToQueries', () => {
  const rows = [
    row('https://x.com/a/', 'turf a', 10, 100, 2),
    row('https://x.com/a/', 'turf b', 5, 300, 6),
    row('https://x.com/b/', 'b one', 20, 50, 1),
    row('https://x.com/c/', 'c one', 0, 900, 30),
    row('https://x.com/d/', 'd one', 15, 10, 1),
    row('https://x.com/d/', 'd two', 0, 400, 12),
  ];

  it('ranks pages by total clicks, then impressions', () => {
    const out = joinPagesToQueries(rows);
    expect(out.map((p) => p.page)).toEqual(['https://x.com/b/', 'https://x.com/d/', 'https://x.com/a/', 'https://x.com/c/']);
    // a and d both have 15 clicks; d has more impressions (410 vs 400), c has 0 clicks
    const tie = joinPagesToQueries([row('/a', 'q', 15, 400, 1), row('/d', 'q', 15, 410, 1)]);
    expect(tie.map((p) => p.page)).toEqual(['/d', '/a']);
  });

  it('totals a page from its query rows with impression-weighted position', () => {
    const a = joinPagesToQueries(rows).find((p) => p.page === 'https://x.com/a/');
    expect(a.clicks).toBe(15);
    expect(a.impressions).toBe(400);
    expect(a.ctr).toBeCloseTo(0.0375, 3);
    expect(a.position).toBe(5); // (2*100 + 6*300) / 400
  });

  it('keeps the top queries per page by clicks then impressions', () => {
    const d = joinPagesToQueries(rows, { perPage: 1 }).find((p) => p.page === 'https://x.com/d/');
    expect(d.queries).toEqual([{ query: 'd one', clicks: 15, impressions: 10, ctr: 1.5, position: 1 }]);
    const a = joinPagesToQueries(rows).find((p) => p.page === 'https://x.com/a/');
    expect(a.queries.map((q) => q.query)).toEqual(['turf a', 'turf b']);
  });

  it('strips query strings and fragments and merges the same page and query', () => {
    const out = joinPagesToQueries([
      row('https://x.com/a/?utm_source=gmb', 'turf', 4, 100, 2),
      row('https://x.com/a/', 'turf', 6, 300, 6),
      row('https://x.com/a/#reviews', 'other', 1, 100, 10),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ page: 'https://x.com/a/', clicks: 11, impressions: 500, ctr: 0.022, position: 6 });
    expect(out[0].queries).toEqual([
      { query: 'turf', clicks: 10, impressions: 400, ctr: 0.025, position: 5 }, // (2*100 + 6*300) / 400
      { query: 'other', clicks: 1, impressions: 100, ctr: 0.01, position: 10 },
    ]);
  });

  it('caps the number of pages', () => {
    expect(joinPagesToQueries(rows, { topPages: 2 })).toHaveLength(2);
    expect(joinPagesToQueries([])).toEqual([]);
    expect(joinPagesToQueries(undefined)).toEqual([]);
  });
});

describe('mapInspection', () => {
  const api = {
    inspectionResult: {
      inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=x',
      indexStatusResult: {
        verdict: 'PASS',
        coverageState: 'Submitted and indexed',
        googleCanonical: 'https://x.com/a/',
        userCanonical: 'https://x.com/a-old/',
        lastCrawlTime: '2026-11-10T08:00:00Z',
        robotsTxtState: 'ALLOWED',
      },
      mobileUsabilityResult: { verdict: 'VERDICT_UNSPECIFIED' },
    },
  };

  it('maps the index status and flags a canonical mismatch', () => {
    expect(mapInspection(api, 'https://x.com/a/')).toEqual({
      url: 'https://x.com/a/',
      verdict: 'PASS',
      coverage_state: 'Submitted and indexed',
      google_canonical: 'https://x.com/a/',
      user_canonical: 'https://x.com/a-old/',
      canonical_mismatch: true,
      last_crawl: '2026-11-10T08:00:00Z',
    });
  });

  it('does not flag matching canonicals (trailing slash and host case ignored) or a missing one', () => {
    const same = { inspectionResult: { indexStatusResult: { googleCanonical: 'https://X.com/a', userCanonical: 'https://x.com/a/' } } };
    expect(mapInspection(same).canonical_mismatch).toBe(false);
    const missing = { inspectionResult: { indexStatusResult: { googleCanonical: 'https://x.com/a/' } } };
    expect(mapInspection(missing).canonical_mismatch).toBe(false);
  });

  it('handles an empty result', () => {
    expect(mapInspection({}, 'https://x.com/z')).toEqual({
      url: 'https://x.com/z', verdict: null, coverage_state: null, google_canonical: null, user_canonical: null,
      canonical_mismatch: false, last_crawl: null,
    });
  });
});

describe('inspectUrls', () => {
  beforeEach(() => { inspect.mockReset(); });

  it('inspects every URL and keeps input order', async () => {
    inspect.mockImplementation(async ({ requestBody }) => ({
      data: { inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: `ok ${requestBody.inspectionUrl}` } } },
    }));
    const urls = ['https://x.com/1', 'https://x.com/2', 'https://x.com/3'];
    const out = await inspectUrls({}, 'sc-domain:x.com', urls, { concurrency: 2 });
    expect(out.status).toBe('ok');
    expect(out.results.map((r) => r.url)).toEqual(urls);
    expect(inspect).toHaveBeenCalledWith({ requestBody: { inspectionUrl: 'https://x.com/1', siteUrl: 'sc-domain:x.com' } });
  });

  it('reports permission on a 403', async () => {
    inspect.mockRejectedValue(Object.assign(new Error('User does not have sufficient permission'), { code: 403 }));
    const out = await inspectUrls({}, 'sc-domain:x.com', ['https://x.com/1', 'https://x.com/2']);
    expect(out.status).toBe('permission');
    expect(out.results).toEqual([]);
    expect(out.error).toMatch(/permission/);
  });

  it('keeps partial results when some URLs fail, errors when all fail', async () => {
    inspect.mockImplementation(async ({ requestBody }) => {
      if (requestBody.inspectionUrl.endsWith('2')) throw new Error('boom');
      return { data: { inspectionResult: { indexStatusResult: { verdict: 'PASS' } } } };
    });
    const partial = await inspectUrls({}, 's', ['https://x.com/1', 'https://x.com/2']);
    expect(partial.status).toBe('ok');
    expect(partial.results).toHaveLength(2);
    expect(partial.results[1]).toEqual({ url: 'https://x.com/2', error: 'boom' });

    inspect.mockRejectedValue(new Error('down'));
    const none = await inspectUrls({}, 's', ['https://x.com/1']);
    expect(none.status).toBe('error');
    expect(none.error).toBe('down');
  });

  it('returns no_data for no URLs', async () => {
    expect(await inspectUrls({}, 's', [])).toEqual({ status: 'no_data', results: [] });
  });
});

describe('listGoogleSitemaps', () => {
  beforeEach(() => { sitemapsList.mockReset(); });

  it('maps submitted sitemaps and their URL counts', async () => {
    sitemapsList.mockResolvedValue({
      data: {
        sitemap: [{
          path: 'https://x.com/sitemap_index.xml', lastSubmitted: '2026-01-01T00:00:00Z', lastDownloaded: '2026-11-15T00:00:00Z',
          isSitemapsIndex: true, errors: '0', warnings: '2',
          contents: [{ type: 'web', submitted: '120', indexed: '0' }, { type: 'image', submitted: '30' }],
        }],
      },
    });
    const out = await listGoogleSitemaps({}, 'sc-domain:x.com');
    expect(sitemapsList).toHaveBeenCalledWith({ siteUrl: 'sc-domain:x.com' });
    expect(out).toEqual({
      status: 'ok',
      sitemaps: [{
        path: 'https://x.com/sitemap_index.xml', submitted: 150,
        lastDownloaded: '2026-11-15T00:00:00Z', errors: 0, warnings: 2,
      }],
    });
    expect(out.sitemaps[0]).not.toHaveProperty('indexed');
  });

  it('keeps an indexed count only when Google reports a non-zero one (the field is deprecated and returns "0")', async () => {
    sitemapsList.mockResolvedValue({
      data: { sitemap: [{ path: 'https://x.com/s.xml', contents: [{ type: 'web', submitted: '50', indexed: '40' }] }] },
    });
    const out = await listGoogleSitemaps({}, 's');
    expect(out.sitemaps[0]).toEqual({ path: 'https://x.com/s.xml', submitted: 50, indexed: 40, lastDownloaded: null, errors: 0, warnings: 0 });
  });

  it('returns no_data when nothing is submitted, permission on 403, error otherwise', async () => {
    sitemapsList.mockResolvedValue({ data: {} });
    expect(await listGoogleSitemaps({}, 's')).toEqual({ status: 'no_data', sitemaps: [] });
    sitemapsList.mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 403 } }));
    expect(await listGoogleSitemaps({}, 's')).toMatchObject({ status: 'permission', sitemaps: [] });
    sitemapsList.mockRejectedValue(new Error('down'));
    expect(await listGoogleSitemaps({}, 's')).toEqual({ status: 'error', sitemaps: [], error: 'down' });
  });
});

describe('ga4PerPage', () => {
  const report = {
    landingPages: [
      { page: '/a/', channel: 'Organic Search', sessions: 40, users: 30, keyEvents: 3 },
      { page: '/a/?utm_source=x', channel: 'Organic Search', sessions: 10, users: 9, keyEvents: 1 },
      { page: '/a/', channel: 'Direct', sessions: 500, users: 400, keyEvents: 50 },
      { page: '/b', channel: 'Organic Search', sessions: 8, users: 8, keyEvents: 0, engagedSessions: 6 },
    ],
  };

  it('joins a full URL to its GA4 path using organic rows only', () => {
    const [a] = ga4PerPage(report, ['https://x.com/a/']);
    expect(a).toEqual({ page: 'https://x.com/a/', organic_sessions: 50, engagement_rate: null, key_events: 4 });
  });

  it('matches with or without a trailing slash and computes engagement when available', () => {
    const [b] = ga4PerPage(report, ['https://x.com/b/']);
    expect(b).toEqual({ page: 'https://x.com/b/', organic_sessions: 8, engagement_rate: 0.75, key_events: 0 });
  });

  it('returns zeros for a page with no organic sessions, and handles a missing report', () => {
    expect(ga4PerPage(report, ['/missing'])).toEqual([{ page: '/missing', organic_sessions: 0, engagement_rate: null, key_events: 0 }]);
    expect(ga4PerPage(null, ['/a'])).toEqual([{ page: '/a', organic_sessions: 0, engagement_rate: null, key_events: 0 }]);
  });
});
