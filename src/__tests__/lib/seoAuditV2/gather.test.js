import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  findGscSite: vi.fn(), findGa4Property: vi.fn(), summarizeGsc: vi.fn(), summarizeGa4: vi.fn(),
  fetchTrafficReport: vi.fn(), joinPagesToQueries: vi.fn(), inspectUrls: vi.fn(), listGoogleSitemaps: vi.fn(),
  ga4PerPage: vi.fn(), fetchPageSpeed: vi.fn(), query: vi.fn(),
}));

vi.mock('googleapis', () => ({ google: { webmasters: () => ({ searchanalytics: { query: m.query } }) } }));
vi.mock('@/lib/seoAuditData', () => ({
  findGscSite: m.findGscSite, findGa4Property: m.findGa4Property, summarizeGsc: m.summarizeGsc,
  summarizeGa4: m.summarizeGa4,
  auditRanges: () => ({ current: { startDate: 'a', endDate: 'b' }, previous: { startDate: 'c', endDate: 'd' } }),
}));
vi.mock('@/lib/ga4Client', () => ({ fetchTrafficReport: m.fetchTrafficReport }));
vi.mock('@/lib/seoAuditV2/gsc', () => ({
  joinPagesToQueries: m.joinPagesToQueries, inspectUrls: m.inspectUrls,
  listGoogleSitemaps: m.listGoogleSitemaps, ga4PerPage: m.ga4PerPage,
}));
vi.mock('@/lib/seoAuditV2/pagespeed', () => ({ fetchPageSpeed: m.fetchPageSpeed }));

import { AUDIT_PROFILES, gatherAll, describeGaps, seedPages } from '@/lib/seoAuditV2/gather';

const crawl = { pages_crawled: [{ url: 'https://x.com/', final_url: 'https://x.com/home' }, { url: 'https://x.com/b' }, { url: 'https://x.com/c' }] };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GA4_SA_KEY;
});

describe('AUDIT_PROFILES', () => {
  it('matches the spec table', () => {
    expect(AUDIT_PROFILES.quick).toEqual({ pages: 5, inspect: 5, pagespeed: 2, effort: 'medium' });
    expect(AUDIT_PROFILES.full).toEqual({ pages: 50, inspect: 20, pagespeed: 5, effort: 'high' });
  });
});

describe('gather with all sources missing', () => {
  it('turns every status into a gap, falls back to crawled pages, never throws', async () => {
    m.findGscSite.mockResolvedValue({ status: 'not_connected', site: null, auth: null });
    m.fetchPageSpeed.mockImplementation(async (url) => ({ status: 'error', url, error: 'PageSpeed HTTP 500' }));
    const { data, gaps } = await gatherAll({ domain: 'x.com', crawl, profile: 'quick' });
    expect(Object.values(data).every((v) => v === null)).toBe(true);
    expect(gaps.map((g) => g.source).sort()).toEqual(['ga4', 'pagespeed', 'pagespeed', 'search_console', 'sitemaps', 'url_inspection']);
    expect(gaps.find((g) => g.source === 'search_console').status).toBe('not_connected');
    expect(gaps.find((g) => g.source === 'ga4').status).toBe('not_connected');
    expect(m.fetchPageSpeed.mock.calls.map((c) => c[0])).toEqual(['https://x.com/home', 'https://x.com/b']);
  });

  it('a findGscSite throw becomes an error gap', async () => {
    m.findGscSite.mockRejectedValue(new Error('sites.list boom'));
    const { gaps } = await gatherAll({ domain: 'x.com', crawl: null, profile: 'quick' });
    expect(gaps.find((g) => g.source === 'search_console')).toMatchObject({ status: 'error', detail: 'sites.list boom' });
  });
});

describe('gather partial', () => {
  it('Search Console ok, GA4 no_property, one PageSpeed timeout', async () => {
    process.env.GA4_SA_KEY = 'k';
    m.findGscSite.mockResolvedValue({ status: 'ok', site: 'sc-domain:x.com', auth: {} });
    m.query.mockResolvedValue({ data: { rows: [{ impressions: 5 }] } });
    m.summarizeGsc.mockReturnValue({ summary: true });
    m.joinPagesToQueries.mockReturnValue([{ page: 'https://x.com/a' }, { page: 'https://x.com/b' }, { page: 'https://x.com/c' }]);
    m.inspectUrls.mockResolvedValue({ status: 'ok', results: [{ url: 'https://x.com/a' }] });
    m.listGoogleSitemaps.mockResolvedValue({ status: 'ok', sitemaps: [{ path: 's.xml' }] });
    m.findGa4Property.mockResolvedValue(null);
    m.fetchPageSpeed.mockImplementation(async (url) => (url.endsWith('/a')
      ? { status: 'ok', url, score: 90 } : { status: 'timeout', url }));
    const { data, gaps } = await gatherAll({ domain: 'x.com', crawl, profile: 'quick' });
    expect(data.gsc).toEqual({ summary: true });
    expect(data.gscPages).toHaveLength(3);
    expect(data.inspection).toEqual([{ url: 'https://x.com/a' }]);
    expect(data.googleSitemaps).toEqual([{ path: 's.xml' }]);
    expect(data.ga4).toBeNull();
    expect(data.pagespeed).toEqual([{ status: 'ok', url: 'https://x.com/a', score: 90 }]);
    expect(m.inspectUrls.mock.calls[0][2]).toHaveLength(3);
    expect(gaps).toEqual([
      { source: 'ga4', status: 'no_property', detail: '' },
      { source: 'pagespeed', status: 'timeout', detail: 'https://x.com/b' },
    ]);
    const joinCall = m.query.mock.calls.find((c) => c[0].requestBody.dimensions.length === 2);
    expect(joinCall[0].requestBody.rowLimit).toBe(5000);
  });

  it('a PageSpeed 429 becomes one quota gap', async () => {
    m.findGscSite.mockResolvedValue({ status: 'not_connected' });
    m.fetchPageSpeed.mockImplementation(async (url) => ({ status: 'error', url, error: 'PageSpeed HTTP 429: Quota exceeded' }));
    const { gaps } = await gatherAll({ domain: 'x.com', crawl, profile: 'quick' });
    expect(gaps.filter((g) => g.source === 'pagespeed')).toHaveLength(1);
    const text = describeGaps(gaps).find((s) => /Page speed/.test(s));
    expect(text).toMatch(/free .*quota ran out/);
    expect(text).toMatch(/PAGESPEED_API_KEY/);
  });
});

describe('gather fix round 1', () => {
  const gscOk = () => {
    m.findGscSite.mockResolvedValue({ status: 'ok', site: 'sc-domain:x.com', auth: {} });
    m.query.mockResolvedValue({ data: { rows: [{ impressions: 5 }] } });
    m.summarizeGsc.mockReturnValue({ summary: true });
    m.joinPagesToQueries.mockReturnValue([{ page: 'https://x.com/a' }]);
    m.inspectUrls.mockResolvedValue({ status: 'ok', results: [] });
    m.listGoogleSitemaps.mockResolvedValue({ status: 'ok', sitemaps: [] });
    m.fetchPageSpeed.mockImplementation(async (url) => ({ status: 'ok', url }));
  };
  const ga4Ok = () => {
    process.env.GA4_SA_KEY = 'k';
    m.findGa4Property.mockResolvedValue({ propertyId: '1', propertyName: 'p', account: 'a' });
    m.fetchTrafficReport.mockResolvedValue({ totalsByView: { all: { sessions: 10 } } });
    m.summarizeGa4.mockReturnValue({ ga4: true });
  };

  it('uses a chosen Search Console property and GA4 property instead of matching by domain', async () => {
    gscOk(); ga4Ok();
    await gatherAll({ domain: 'x.com', crawl, profile: 'quick', gscSite: 'https://www.x.com/', ga4Property: { id: 'properties/77', name: 'Picked', account: 'Acct' } });
    expect(m.findGscSite).toHaveBeenCalledWith('x.com', { site: 'https://www.x.com/' });
    expect(m.findGa4Property).not.toHaveBeenCalled();
    expect(m.fetchTrafficReport.mock.calls[0][0].property).toEqual({ id: 'properties/77', name: 'Picked', account: 'Acct' });
  });

  it('records which GA4 property the numbers came from', async () => {
    gscOk(); ga4Ok();
    const { data } = await gatherAll({ domain: 'x.com', crawl, profile: 'quick' });
    expect(data.ga4Property).toBe('p');
  });

  it('GA4 ok path populates ga4 and ga4Pages', async () => {
    gscOk(); ga4Ok();
    m.ga4PerPage.mockReturnValue([{ page: '/a', sessions: 3 }]);
    const { data, gaps } = await gatherAll({ domain: 'x.com', crawl, profile: 'quick' });
    expect(data.ga4).toEqual({ ga4: true });
    expect(data.ga4Pages).toEqual([{ page: '/a', sessions: 3 }]);
    expect(gaps.find((g) => g.source === 'ga4')).toBeUndefined();
  });

  it('a ga4PerPage throw keeps other data and adds a ga4 error gap', async () => {
    gscOk(); ga4Ok();
    m.ga4PerPage.mockImplementation(() => { throw new Error('per page boom'); });
    const { data, gaps } = await gatherAll({ domain: 'x.com', crawl, profile: 'quick' });
    expect(data.gsc).toEqual({ summary: true });
    expect(data.ga4Pages).toBeNull();
    expect(gaps.find((g) => g.source === 'ga4')).toMatchObject({ status: 'error', detail: 'per page boom' });
    expect(gaps.find((g) => g.source === 'gather')).toBeUndefined();
  });

  it('caps inspected and measured URLs to the profile limits', async () => {
    gscOk();
    const many = Array.from({ length: 60 }, (_, i) => ({ page: `https://x.com/p${i}` }));
    m.joinPagesToQueries.mockReturnValue(many);
    await gatherAll({ domain: 'x.com', crawl, profile: 'quick' });
    expect(m.inspectUrls.mock.calls[0][2]).toHaveLength(AUDIT_PROFILES.quick.inspect);
    expect(m.fetchPageSpeed).toHaveBeenCalledTimes(AUDIT_PROFILES.quick.pagespeed);
  });

  it('listed pages are inspected and speed-tested first; skipped Search Console pages are left out', async () => {
    gscOk();
    m.joinPagesToQueries.mockReturnValue([{ page: 'https://x.com/blog/a' }, { page: 'https://x.com/p1' }]);
    await gatherAll({ domain: 'x.com', crawl, profile: 'quick', priorityUrls: ['https://x.com/money'], skip: ['/blog/*'] });
    expect(m.inspectUrls.mock.calls[0][2]).toEqual(['https://x.com/money', 'https://x.com/p1']);
    expect(m.fetchPageSpeed.mock.calls.map((c) => c[0])).toEqual(['https://x.com/money', 'https://x.com/p1']);
  });

  it('checks each page once: a listed or crawled variant of a Search Console page uses the Search Console address', async () => {
    gscOk();
    m.joinPagesToQueries.mockReturnValue([{ page: 'https://www.x.com/' }, { page: 'https://www.x.com/p1' }]);
    await gatherAll({ domain: 'x.com', crawl, profile: 'quick', priorityUrls: ['https://x.com/', 'https://x.com/money'] });
    expect(m.inspectUrls.mock.calls[0][2]).toEqual(['https://www.x.com/', 'https://x.com/money', 'https://www.x.com/p1']);
    expect(m.fetchPageSpeed.mock.calls.map((c) => c[0])).toEqual(['https://www.x.com/', 'https://x.com/money']);
  });

  it('only listed pages: targets are just the crawled pages', async () => {
    gscOk();
    m.joinPagesToQueries.mockReturnValue([{ page: 'https://x.com/p1' }]);
    await gatherAll({ domain: 'x.com', crawl, profile: 'full', priorityUrls: ['https://x.com/b'], onlyListed: true });
    expect(m.inspectUrls.mock.calls[0][2]).toEqual(['https://x.com/b', 'https://x.com/home', 'https://x.com/c']);
  });

  it('a URL containing 429 in a non-quota detail is not worded as quota', () => {
    const [text] = describeGaps([{ source: 'pagespeed', status: 'error', detail: 'https://x.com/p429: boom' }]);
    expect(text).not.toMatch(/quota/);
  });
});

describe('describeGaps', () => {
  it('words each status', () => {
    const out = describeGaps([
      { source: 'url_inspection', status: 'permission', detail: '' },
      { source: 'ga4', status: 'no_property', detail: '' },
      { source: 'ga4', status: 'not_connected', detail: '' },
      { source: 'search_console', status: 'no_site', detail: '' },
      { source: 'search_console', status: 'no_data', detail: '' },
      { source: 'search_console', status: 'timeout', detail: '' },
      { source: 'sitemaps', status: 'error', detail: 'boom' },
      { source: 'pagespeed', status: 'timeout', detail: 'https://x.com/b' },
    ]);
    expect(out[0]).toBe("Google's index status for each page unavailable: our Search Console access doesn't cover this website.");
    expect(out[1]).toBe('No Google Analytics property was found for this website.');
    expect(out[1]).not.toMatch(/not connected/);
    expect(out[2]).toMatch(/not connected/);
    expect(out[3]).toMatch(/not in a Search Console account we can access/);
    expect(out[4]).toMatch(/no data/);
    expect(out[5]).toMatch(/took too long/);
    expect(out[6]).toBe("Google's sitemap report unavailable: it could not be loaded.");
    expect(out[7]).toBe('Page speed timed out for https://x.com/b.');
  });
});

describe('seedPages', () => {
  it('returns top page URLs, or [] when unavailable', async () => {
    m.findGscSite.mockResolvedValue({ status: 'ok', site: 's', auth: {} });
    m.query.mockResolvedValue({ data: { rows: [] } });
    m.joinPagesToQueries.mockReturnValue([{ page: 'https://x.com/a' }]);
    expect(await seedPages('x.com', 'quick')).toEqual(['https://x.com/a']);
    expect(m.joinPagesToQueries.mock.calls[0][1].topPages).toBe(5);
    m.findGscSite.mockRejectedValue(new Error('x'));
    expect(await seedPages('x.com', 'full')).toEqual([]);
  });
});

describe('seedPages time budget', () => {
  it('gives up after SEED_TIMEOUT_MS and returns []', async () => {
    vi.useFakeTimers();
    try {
      m.findGscSite.mockReturnValue(new Promise(() => {}));
      const p = seedPages('x.com', 'full');
      await vi.advanceTimersByTimeAsync(30000);
      expect(await p).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
