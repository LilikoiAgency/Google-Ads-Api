import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/serverCache', () => ({ getCached: vi.fn(), setCached: vi.fn() }));
vi.mock('@/lib/gscClient', () => ({ createAuthedGscClient: vi.fn() }));
vi.mock('@/lib/ga4Client', () => ({ listProperties: vi.fn(), listWebStreams: vi.fn(), fetchTrafficReport: vi.fn() }));

import {
  normalizeDomain, pickGscSite, streamMatchesDomain, isBrandedQuery,
  auditRanges, summarizeGsc, summarizeGa4,
} from '@/lib/seoAuditData';

describe('normalizeDomain', () => {
  it('strips protocol, www, path and port', () => {
    expect(normalizeDomain('https://www.BigBullyTurf.com:443/foo?x=1')).toBe('bigbullyturf.com');
    expect(normalizeDomain('sc-domain:sempersolaris.com')).toBe('sempersolaris.com');
    expect(normalizeDomain('')).toBe('');
  });
});

describe('pickGscSite', () => {
  const sites = ['https://bigbullyturf.com/', 'sc-domain:bigbullyturf.com', 'sc-domain:help.sempersolaris.com'];
  it('prefers the domain property', () => {
    expect(pickGscSite('www.bigbullyturf.com', sites)).toBe('sc-domain:bigbullyturf.com');
  });
  it('falls back to a URL-prefix property', () => {
    expect(pickGscSite('bigbullyturf.com', ['https://www.bigbullyturf.com/'])).toBe('https://www.bigbullyturf.com/');
  });
  it('does not match a subdomain of the audited domain or vice versa', () => {
    expect(pickGscSite('sempersolaris.com', sites)).toBeNull();
  });
});

describe('streamMatchesDomain', () => {
  it('matches exact host ignoring www and protocol', () => {
    expect(streamMatchesDomain('https://www.rangerelectric.com/', 'rangerelectric.com')).toBe(true);
    expect(streamMatchesDomain('https://help.sempersolaris.com', 'sempersolaris.com')).toBe(false);
    expect(streamMatchesDomain(undefined, 'x.com')).toBe(false);
  });
});

describe('isBrandedQuery', () => {
  it('detects brand name with or without spaces', () => {
    expect(isBrandedQuery('big bully turf reviews', 'bigbullyturf.com')).toBe(true);
    expect(isBrandedQuery('bigbullyturf', 'bigbullyturf.com')).toBe(true);
    expect(isBrandedQuery('big bully', 'bigbullyturf.com')).toBe(true);
  });
  it('does not flag generic queries', () => {
    expect(isBrandedQuery('artificial turf installation', 'bigbullyturf.com')).toBe(false);
    expect(isBrandedQuery('turf', 'bigbullyturf.com')).toBe(false);
  });
});

describe('auditRanges', () => {
  it('uses 90 days ending 4 days ago (GSC lag) and the 90 days before', () => {
    expect(auditRanges('2026-11-18')).toEqual({
      current: { startDate: '2026-08-17', endDate: '2026-11-14' },
      previous: { startDate: '2026-05-19', endDate: '2026-08-16' },
    });
  });
});

const q = (query, clicks, impressions, position) => ({ keys: [query], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

describe('summarizeGsc', () => {
  const queryRows = [
    q('big bully turf', 300, 1000, 1.2),
    q('artificial turf san diego', 40, 4000, 7.8),
    q('turf installation cost', 5, 2500, 12.4),
    q('pet turf', 20, 300, 3.1),
    q('synthetic grass near me', 1, 900, 25),
  ];
  const pageRows = [{ keys: ['https://bigbullyturf.com/'], clicks: 320, impressions: 5000, ctr: 0.064, position: 4 }];
  const s = summarizeGsc({
    site: 'sc-domain:bigbullyturf.com', domain: 'bigbullyturf.com',
    ranges: auditRanges('2026-11-18'),
    queryRows, pageRows,
    totals: { clicks: 366, impressions: 8700, ctr: 0.042, position: 9.1 },
    prevTotals: { clicks: 300, impressions: 8000, ctr: 0.0375, position: 10 },
  });

  it('carries totals with change vs previous period', () => {
    expect(s.totals.clicks).toBe(366);
    expect(s.totals.clicks_change_pct).toBe(22);
  });
  it('computes branded split from query rows', () => {
    expect(s.branded_split.branded_clicks).toBe(300);
    expect(s.branded_split.nonbranded_clicks).toBe(66);
    expect(s.branded_split.branded_click_share).toBeCloseTo(300 / 366, 3);
  });
  it('lists striking-distance queries (positions 4-20) by impressions', () => {
    expect(s.striking_distance.map((r) => r.query)).toEqual(['artificial turf san diego', 'turf installation cost']);
  });
  it('lists low-CTR page-one queries', () => {
    expect(s.low_ctr_page_one.map((r) => r.query)).toEqual(['artificial turf san diego']);
  });
  it('rounds metrics for compactness', () => {
    expect(s.top_queries[0]).toEqual({ query: 'big bully turf', clicks: 300, impressions: 1000, ctr: 0.3, position: 1.2 });
    expect(s.top_pages[0].page).toBe('https://bigbullyturf.com/');
  });
});

describe('summarizeGa4', () => {
  const M = (o) => ({ users: 0, newUsers: 0, sessions: 0, engagedSessions: 0, engagementRate: 0, keyEvents: 0, ...o });
  const report = {
    property: { id: 'properties/1', name: 'BBT', account: 'BBT' },
    range: { startDate: '2026-08-17', endDate: '2026-11-14' },
    compareRange: { startDate: '2026-05-19', endDate: '2026-08-16' },
    totalsByView: { all: M({ users: 1000, sessions: 1500, keyEvents: 30, engagementRate: 0.55 }), organic: M({ users: 400, sessions: 600, keyEvents: 12, engagementRate: 0.6 }), nonPaid: M({}), paid: M({}) },
    totalsByViewCompare: { all: M({ users: 800, sessions: 1200, keyEvents: 20 }), organic: M({ users: 500, sessions: 750, keyEvents: 15 }), nonPaid: M({}), paid: M({}) },
    channels: [
      { channel: 'Organic Search', bucket: 'organic', current: M({ sessions: 600, users: 400, keyEvents: 12, engagementRate: 0.6 }), compare: M({ sessions: 750 }) },
      { channel: 'Paid Search', bucket: 'paid', current: M({ sessions: 500, users: 350, keyEvents: 15, engagementRate: 0.5 }), compare: M({ sessions: 300 }) },
    ],
    landingPages: [
      { page: '/', channel: 'Organic Search', bucket: 'organic', sessions: 300, users: 250, keyEvents: 6 },
      { page: '/pricing', channel: 'Paid Search', bucket: 'paid', sessions: 200, users: 150, keyEvents: 9 },
      { page: '/pet-turf', channel: 'Organic Search', bucket: 'organic', sessions: 120, users: 100, keyEvents: 0 },
    ],
    dataQuality: { sampled: false, otherRow: false, thresholded: false },
  };
  const s = summarizeGa4(report);

  it('reports organic search totals with change and share of sessions', () => {
    expect(s.organic_search.sessions).toBe(600);
    expect(s.organic_search.sessions_change_pct).toBe(-20);
    expect(s.organic_share_of_sessions).toBe(0.4);
  });
  it('lists only organic-search landing pages', () => {
    expect(s.organic_landing_pages.map((p) => p.page)).toEqual(['/', '/pet-turf']);
  });
  it('lists channels with session change', () => {
    expect(s.channels[1]).toMatchObject({ channel: 'Paid Search', sessions: 500, sessions_change_pct: 67 });
  });
  it('flags whether key events are set up', () => {
    expect(s.key_events_configured).toBe(true);
  });
});
