import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/mongoose', () => ({ default: vi.fn() }));
vi.mock('@/lib/usageLogger', () => ({ getMonthlyClaudeCost: vi.fn(), getClaudeBudgetCap: vi.fn(), logApiUsage: vi.fn() }));
vi.mock('@/lib/seoAuditV2/jobStore', () => ({
  createJob: vi.fn(),
  findReusable: vi.fn(),
  getDailyUsage: vi.fn(),
  incrementUsage: vi.fn(),
  refundUsage: vi.fn(),
}));
vi.mock('@/lib/seoAuditV2/reputationStore', () => ({ getSavedLocations: vi.fn(), saveLocations: vi.fn() }));
vi.mock('@/lib/seoAuditV2/places', async () => {
  const actual = await vi.importActual('@/lib/seoAuditV2/places');
  return { ...actual, searchPlaces: vi.fn(), resolveLocationInput: vi.fn() };
});

const { getServerSession } = await import('next-auth');
const { getMonthlyClaudeCost, getClaudeBudgetCap } = await import('@/lib/usageLogger');
const store = await import('@/lib/seoAuditV2/jobStore');
const rep = await import('@/lib/seoAuditV2/reputationStore');
const places = await import('@/lib/seoAuditV2/places');
const { resetRateLimitMap } = await import('@/lib/seoRateLimit');
const locRoute = await import('@/app/api/seo-audit/v2/locations/route.js');
const resolveRoute = await import('@/app/api/seo-audit/v2/locations/resolve/route.js');
const jobsRoute = await import('@/app/api/seo-audit/v2/jobs/route.js');

const USER = 'a@lilikoiagency.com';
const req = (domain) => ({
  url: `http://localhost/api/seo-audit/v2/locations${domain === undefined ? '' : `?domain=${encodeURIComponent(domain)}`}`,
});
const post = (body) => ({ json: async () => body });
const place = (id, website) => ({ id, name: id, address: 'x', website, rating: 4.5, count: 10, mapsUrl: 'u' });

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitMap();
  getServerSession.mockResolvedValue({ user: { email: USER } });
  getMonthlyClaudeCost.mockResolvedValue(10);
  getClaudeBudgetCap.mockResolvedValue(100);
  store.findReusable.mockResolvedValue(null);
  store.getDailyUsage.mockResolvedValue(0);
  store.createJob.mockResolvedValue('newjob');
  rep.getSavedLocations.mockResolvedValue([{ source: 'places', id: 'p1', name: 'One' }]);
  rep.saveLocations.mockResolvedValue();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => '<html><head><title>Acme Roofing | Home</title></head></html>',
  });
});

describe('GET locations', () => {
  it('rejects unauthenticated and bad domains', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await locRoute.GET(req('acme.com'))).init.status).toBe(401);
    getServerSession.mockResolvedValue({ user: { email: USER } });
    expect((await locRoute.GET(req())).init.status).toBe(400);
    expect((await locRoute.GET(req('not a host!'))).init.status).toBe(400);
  });

  it('returns saved and found, filtered by domain, deduped', async () => {
    places.searchPlaces.mockImplementation(async (q) => (q === 'Acme Roofing'
      ? [place('a', 'https://acme.com/'), place('b', 'https://other.com')]
      : [place('a', 'https://acme.com/'), place('c', 'https://www.acme.com')]));
    const res = await locRoute.GET(req('acme.com'));
    expect(res.body.status).toBe('ok');
    expect(res.body.saved).toEqual([{ source: 'places', id: 'p1', name: 'One' }]);
    expect(res.body.found.map((p) => p.id).sort()).toEqual(['a', 'c']);
    expect(places.searchPlaces).toHaveBeenCalledWith('acme');
    expect(places.searchPlaces).toHaveBeenCalledWith('Acme Roofing');
  });

  it('uses the same brand the audit would: skips a leading Home segment and decodes entities', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><head><title>Home | Smith &amp; Sons Electric</title></head></html>',
    });
    places.searchPlaces.mockResolvedValue([]);
    await locRoute.GET(req('acme.com'));
    expect(places.searchPlaces).toHaveBeenCalledWith('Smith & Sons Electric');
    expect(places.searchPlaces).not.toHaveBeenCalledWith('Home');
  });

  it('caps found at 10', async () => {
    places.searchPlaces.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => place(`p${i}`, 'https://acme.com')),
    );
    const res = await locRoute.GET(req('acme.com'));
    expect(res.body.found).toHaveLength(10);
  });

  it('splits hyphenated labels into words and skips brand search on homepage failure', async () => {
    globalThis.fetch.mockRejectedValue(new Error('down'));
    places.searchPlaces.mockResolvedValue([]);
    const res = await locRoute.GET(req('ranger-electric-co.com'));
    expect(res.body.status).toBe('ok');
    expect(places.searchPlaces).toHaveBeenCalledWith('ranger-electric-co');
    expect(places.searchPlaces).toHaveBeenCalledWith('ranger electric co');
    expect(places.searchPlaces).toHaveBeenCalledTimes(2);
  });

  it('reports not_connected without a key', async () => {
    places.searchPlaces.mockRejectedValue(new places.PlacesError('not_connected', 'no key'));
    const res = await locRoute.GET(req('acme.com'));
    expect(res.body).toEqual({ saved: [{ source: 'places', id: 'p1', name: 'One' }], found: [], status: 'not_connected' });
  });

  it('reports error for other Places failures and tolerates a saved-picks DB error', async () => {
    places.searchPlaces.mockRejectedValue(new places.PlacesError('error', 'boom'));
    rep.getSavedLocations.mockRejectedValue(new Error('db'));
    const res = await locRoute.GET(req('acme.com'));
    expect(res.body).toEqual({ saved: null, found: [], status: 'error' });
  });
});

describe('POST resolve', () => {
  it('returns candidates', async () => {
    places.resolveLocationInput.mockResolvedValue([place('a', 'https://acme.com')]);
    const res = await resolveRoute.POST(post({ input: 'Acme Roofing Boise' }));
    expect(res.body.candidates).toHaveLength(1);
    expect(places.resolveLocationInput).toHaveBeenCalledWith('Acme Roofing Boise');
  });

  it('validates input and auth', async () => {
    expect((await resolveRoute.POST(post({ input: '' }))).init.status).toBe(400);
    expect((await resolveRoute.POST(post({ input: 'x'.repeat(501) }))).init.status).toBe(400);
    expect((await resolveRoute.POST(post({}))).init.status).toBe(400);
    getServerSession.mockResolvedValue(null);
    expect((await resolveRoute.POST(post({ input: 'a' }))).init.status).toBe(401);
  });

  it('reports not_connected', async () => {
    places.resolveLocationInput.mockRejectedValue(new places.PlacesError('not_connected', 'no key'));
    const res = await resolveRoute.POST(post({ input: 'a' }));
    expect(res.body).toEqual({ candidates: [], status: 'not_connected' });
  });
});

describe('jobs POST location picks', () => {
  const locs = [{ source: 'places', id: 'ChIJabcdefghij', name: 'Acme Boise', extra: 'drop me' }];

  it('saves exactly source/id/name after createJob', async () => {
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'quick', options: { locations: locs } }));
    expect(res.body).toEqual({ jobId: 'newjob', reused: false });
    expect(rep.saveLocations).toHaveBeenCalledWith('acme.com', [{ source: 'places', id: 'ChIJabcdefghij', name: 'Acme Boise' }]);
  });

  it('never blocks the response when saving fails', async () => {
    rep.saveLocations.mockRejectedValue(new Error('db'));
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'quick', options: { locations: locs } }));
    expect(res.body).toEqual({ jobId: 'newjob', reused: false });
  });

  it('does not save when no locations are set', async () => {
    await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'quick' }));
    expect(rep.saveLocations).not.toHaveBeenCalled();
  });
});
