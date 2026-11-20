import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ getCredentials: vi.fn() }));
vi.mock('@/lib/dbFunctions', () => ({ getCredentials: m.getCredentials }));
vi.mock('google-ads-api', () => ({ GoogleAdsApi: vi.fn(), enums: { KeywordPlanNetwork: { GOOGLE_SEARCH: 2 } } }));

import { fetchKeywordData, indexGscRows, MAX_IDEAS } from '@/lib/seoAuditV2/keywords';

const cred = { client_id: 'c', client_secret: 's', developer_token: 'd', refresh_token: 'r', customer_id: '123-456-7890' };

function fakeClient({ hist = [], ideas = [], geo = [] } = {}) {
  const calls = { hist: [], ideas: [], geo: [], customer: null };
  const customer = {
    keywordPlanIdeas: {
      generateKeywordHistoricalMetrics: vi.fn(async (req) => { calls.hist.push(req); return { results: hist }; }),
      generateKeywordIdeas: vi.fn(async (req) => { calls.ideas.push(req); return ideas; }),
    },
    geoTargetConstants: {
      suggestGeoTargetConstants: vi.fn(async (req) => { calls.geo.push(req); return { geo_target_constant_suggestions: geo }; }),
    },
  };
  return { client: { Customer: (o) => { calls.customer = o; return customer; } }, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getCredentials.mockResolvedValue(cred);
});

describe('indexGscRows', () => {
  it('merges page variants by path and weights position by impressions', () => {
    const g = indexGscRows([
      { keys: ['https://x.com/a/', 'Panel Upgrade'], clicks: 1, impressions: 10, position: 4 },
      { keys: ['https://www.x.com/a', 'Panel Upgrade'], clicks: 1, impressions: 30, position: 8 },
      { keys: ['https://x.com/b', 'panel upgrade'], clicks: 5, impressions: 5, position: 2 },
    ]);
    expect(g.pageQueries('/a')).toEqual([{ query: 'Panel Upgrade', clicks: 2, impressions: 40, position: 7 }]);
    expect(g.keywordPages('PANEL  upgrade')).toEqual([
      { page: '/b', clicks: 5, impressions: 5, position: 2 },
      { page: '/a', clicks: 2, impressions: 40, position: 7 },
    ]);
    expect(g.pageQueries('/none')).toEqual([]);
  });
});

describe('fetchKeywordData', () => {
  it('returns no_data without targets and not_connected without Google Ads credentials', async () => {
    expect(await fetchKeywordData({ targets: [] })).toEqual({ status: 'no_data' });
    m.getCredentials.mockResolvedValue({});
    expect(await fetchKeywordData({ targets: [{ url: 'https://x.com/a', keywords: [] }] })).toEqual({ status: 'not_connected' });
  });

  it('uses the manager account, the business city and the given keywords as seeds', async () => {
    const { client, calls } = fakeClient({
      geo: [{ geo_target_constant: { resource_name: 'geoTargetConstants/1', canonical_name: 'Tampa,Florida,United States', target_type: 'City' } }],
      hist: [{ text: 'panel upgrade tampa', keyword_metrics: { avg_monthly_searches: '210', competition: 'LOW' }, close_variants: ['panel upgrades tampa'] }],
      ideas: [
        { text: 'Electrical Panel Upgrade', keyword_idea_metrics: { avg_monthly_searches: '590', competition: 'MEDIUM' } },
        { text: 'panel upgrade tampa', keyword_idea_metrics: { avg_monthly_searches: '210' } },
        { text: 'zero volume', keyword_idea_metrics: { avg_monthly_searches: '0' } },
        { text: 'no metrics' },
      ],
    });
    const gscRows = [{ keys: ['https://x.com/services', 'panel upgrade tampa'], clicks: 2, impressions: 80, position: 12.5 }];
    const out = await fetchKeywordData({
      targets: [{ url: 'https://x.com/panel', keywords: ['panel upgrade tampa', 'panel upgrades tampa', 'unknown kw'] }],
      gscRows, city: { city: 'Tampa', region: 'FL' }, client,
    });
    expect(calls.customer).toEqual({ customer_id: '1234567890', refresh_token: 'r', login_customer_id: '1234567890' });
    expect(calls.geo[0].location_names.names).toEqual(['Tampa, FL']);
    expect(calls.hist[0].geo_target_constants).toEqual(['geoTargetConstants/1']);
    expect(calls.ideas[0].keyword_and_url_seed).toEqual({ url: 'https://x.com/panel', keywords: ['panel upgrade tampa', 'panel upgrades tampa', 'unknown kw'] });
    expect(out.status).toBe('ok');
    expect(out.keywords.geo).toBe('Tampa, Florida');
    const t = out.keywords.targets[0];
    expect(t).toMatchObject({ page: '/panel', mode: 'given', page_queries: [] });
    expect(t.given).toEqual([
      { keyword: 'panel upgrade tampa', volume: 210, competition: 'low', search_console: [{ page: '/services', clicks: 2, impressions: 80, position: 12.5 }] },
      { keyword: 'panel upgrades tampa', volume: 210, competition: 'low', search_console: [] },
      { keyword: 'unknown kw', volume: null, competition: null, search_console: [] },
    ]);
    expect(t.ideas).toEqual([{ keyword: 'electrical panel upgrade', volume: 590, competition: 'medium', search_console: [] }]);
  });

  it('falls back to the US, seeds from the page queries, then from the URL alone, and caps ideas', async () => {
    const ideas = Array.from({ length: 40 }, (_, i) => ({ text: `kw ${i}`, keyword_idea_metrics: { avg_monthly_searches: String(i + 1) } }));
    const { client, calls } = fakeClient({ ideas });
    const gscRows = [{ keys: ['https://x.com/a', 'own query'], clicks: 1, impressions: 2, position: 3 }];
    const out = await fetchKeywordData({
      targets: [{ url: 'https://x.com/a', keywords: [] }, { url: 'https://x.com/b', keywords: [] }], gscRows, client,
    });
    expect(calls.geo).toHaveLength(0);
    expect(calls.hist).toHaveLength(0);
    expect(calls.ideas[0].geo_target_constants).toEqual(['geoTargetConstants/2840']);
    expect(calls.ideas[0].keyword_and_url_seed.keywords).toEqual(['own query']);
    expect(calls.ideas[1].url_seed).toEqual({ url: 'https://x.com/b' });
    expect(out.keywords.geo).toBe('United States');
    expect(out.keywords.targets[0].mode).toBe('recommend');
    expect(out.keywords.targets[0].ideas).toHaveLength(MAX_IDEAS);
    expect(out.keywords.targets[0].ideas[0].volume).toBe(40);
  });

  it('a failed geo lookup falls back to the US', async () => {
    const { client, calls } = fakeClient();
    client.Customer({}).geoTargetConstants.suggestGeoTargetConstants.mockRejectedValue(new Error('boom'));
    const out = await fetchKeywordData({ targets: [{ url: 'https://x.com/a', keywords: [] }], city: { city: 'Tampa' }, client });
    expect(calls.geo).toHaveLength(0);
    expect(out.keywords.geo).toBe('United States');
  });
});

describe('gscOnlyKeywordData', () => {
  it('builds the keyword shape from Search Console rows, with no volumes', async () => {
    const { gscOnlyKeywordData } = await import('@/lib/seoAuditV2/keywords');
    const rows = [{ keys: ['https://x.com/panel', 'panel upgrade tampa'], clicks: 2, impressions: 60, position: 8 }];
    const out = gscOnlyKeywordData([{ url: 'https://x.com/panel', keywords: ['Panel Upgrade Tampa'] }], rows);
    expect(out).toMatchObject({ geo: null, volumes: false });
    expect(out.targets[0]).toMatchObject({ page: '/panel', mode: 'given', ideas: [] });
    expect(out.targets[0].given[0]).toEqual({ keyword: 'panel upgrade tampa', volume: null, competition: null, search_console: [{ page: '/panel', clicks: 2, impressions: 60, position: 8 }] });
    expect(out.targets[0].page_queries[0].query).toBe('panel upgrade tampa');
    expect(gscOnlyKeywordData([{ url: 'https://x.com/a', keywords: [] }], null)).toBeNull();
  });
});
