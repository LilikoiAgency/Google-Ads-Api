import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ searchPlaces: vi.fn(), getPlace: vi.fn() }));

vi.mock('@/lib/seoAuditV2/places', async (orig) => ({
  ...(await orig()),
  searchPlaces: m.searchPlaces,
  getPlace: m.getPlace,
}));

import { brandName, reviewStats, fetchReviews } from '@/lib/seoAuditV2/reviews';
import { PlacesError } from '@/lib/seoAuditV2/places';

const home = (extra) => ({ pages_crawled: [{ page_type: 'homepage', title_tag: '', ...extra }] });
const NOW = new Date('2026-11-19T12:00:00Z');

beforeEach(() => vi.clearAllMocks());

describe('brandName', () => {
  it('prefers schema name', () => {
    const crawl = home({
      title_tag: 'Home | Title Name',
      open_graph: { og_site_name: 'OG Name' },
      schema_markup: [{ raw_json: { '@graph': [{ '@type': 'WebSite', name: 'Site' }, { '@type': ['Plumber', 'LocalBusiness'], name: 'Schema Name' }] } }],
    });
    expect(brandName(crawl, 'acme.com')).toBe('Schema Name');
  });

  it('falls back to og:site_name, then the title before a separator, then the domain label', () => {
    expect(brandName(home({ open_graph: { og_site_name: 'OG Name' }, title_tag: 'x | y' }), 'acme.com')).toBe('OG Name');
    expect(brandName(home({ title_tag: 'Ranger Electric - Tampa Electricians' }), 'acme.com')).toBe('Ranger Electric');
    expect(brandName(home({ title_tag: 'Ranger Electric — Tampa' }), 'acme.com')).toBe('Ranger Electric');
    expect(brandName(home({ title_tag: '' }), 'www.acme-plumbing.com')).toBe('acme-plumbing');
    expect(brandName(null, 'acme.com')).toBe('acme');
  });
});

describe('reviewStats', () => {
  it('sample coverage leaves per_month null', () => {
    const s = reviewStats([{ stars: 5, date: '2026-11-01', text: 'a' }], { rating: 4.6, count: 120, coverage: 'sample' }, NOW);
    expect(s).toEqual({
      rating: 4.6, count: 120, coverage: 'sample', per_month: null, star_split: null, days_since_newest: 18, reply_rate: null,
    });
  });

  it('full coverage computes reply_rate and per_month over 12 months', () => {
    const reviews = [
      { stars: 5, date: '2026-11-10', replied: true },
      { stars: 5, date: '2026-06-01', replied: false },
      { stars: 1, date: '2026-01-15', replied: true },
      { stars: 4, date: '2024-01-01', replied: true },
    ];
    const s = reviewStats(reviews, { rating: 4.2, count: 4, coverage: 'full' }, NOW);
    expect(s.per_month).toBe(0.3); // 3 reviews in the last 12 months / 12, rounded to 0.1
    expect(s.reply_rate).toBe(0.75);
    expect(s.star_split).toEqual({ 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 });
    expect(s.days_since_newest).toBe(9);
  });

  it('handles no reviews', () => {
    expect(reviewStats([], { rating: null, count: null, coverage: 'sample' }, NOW).days_since_newest).toBeNull();
  });
});

describe('fetchReviews', () => {
  const place = (i, website) => ({ id: `p${i}`, name: `Shop ${i}`, website });
  const detail = (id) => ({ id, name: `N ${id}`, rating: 4.5, count: 10, city: 'Tampa', region: 'FL', reviews: [{ stars: 5, date: '2026-11-01', text: 'Nice' }] });

  it('auto-matches places by website and caps at 10', async () => {
    m.searchPlaces.mockResolvedValue([
      ...Array.from({ length: 12 }, (_, i) => place(i, 'https://www.acme.com/loc')),
      place(99, 'https://other.com'),
    ]);
    m.getPlace.mockImplementation(async (id) => detail(id));
    const out = await fetchReviews({ domain: 'acme.com', crawl: home({ title_tag: 'Acme | Home' }), locations: null });
    expect(m.searchPlaces).toHaveBeenCalledWith('Acme');
    expect(out.status).toBe('ok');
    expect(out.locations).toHaveLength(10);
    expect(out.locations[0]).toMatchObject({ source: 'places', id: 'p0', city: 'Tampa', region: 'FL', coverage: 'sample' });
    expect(out.locations[0]).not.toHaveProperty('reviews');
    expect(out.texts.p0).toEqual([{ stars: 5, date: '2026-11-01', text: 'Nice' }]);
  });

  it('no matching place gives no_data', async () => {
    m.searchPlaces.mockResolvedValue([place(1, 'https://other.com')]);
    expect((await fetchReviews({ domain: 'acme.com', crawl: null, locations: null })).status).toBe('no_data');
  });

  it('uses given locations, skips gbp, and skips a failing one', async () => {
    m.getPlace.mockImplementation(async (id) => { if (id === 'bad') throw new Error('x'); return detail(id); });
    const out = await fetchReviews({
      domain: 'acme.com', crawl: null,
      locations: [{ source: 'places', id: 'a', name: 'A' }, { source: 'places', id: 'bad', name: 'B' }, { source: 'gbp', id: 'g', name: 'G' }],
    });
    expect(m.searchPlaces).not.toHaveBeenCalled();
    expect(out.locations.map((l) => l.id)).toEqual(['a']);
  });

  it('every location failing is an error with the first message; not_connected and permission pass through', async () => {
    m.getPlace.mockRejectedValue(new Error('boom'));
    const locs = [{ source: 'places', id: 'a', name: 'A' }];
    expect(await fetchReviews({ domain: 'a.com', crawl: null, locations: locs })).toMatchObject({ status: 'error', error: 'boom' });
    m.getPlace.mockRejectedValue(new PlacesError('not_connected', 'no key'));
    expect((await fetchReviews({ domain: 'a.com', crawl: null, locations: locs })).status).toBe('not_connected');
    m.searchPlaces.mockRejectedValue(new PlacesError('permission', 'denied'));
    expect((await fetchReviews({ domain: 'a.com', crawl: null, locations: null })).status).toBe('permission');
  });
});
