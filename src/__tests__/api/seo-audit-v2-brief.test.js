import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/mongoose', () => ({ default: vi.fn() }));
vi.mock('@/lib/seoAuditV2/briefStore', () => ({ getBrief: vi.fn(), saveBrief: vi.fn() }));

const { getServerSession } = await import('next-auth');
const store = await import('@/lib/seoAuditV2/briefStore');
const route = await import('@/app/api/seo-audit/v2/brief/route.js');

const USER = 'a@lilikoiagency.com';
const get = (domain) => ({ url: `http://localhost/api/seo-audit/v2/brief?domain=${encodeURIComponent(domain)}` });
const put = (body) => ({ json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { email: USER } });
});

describe('/api/seo-audit/v2/brief', () => {
  it('401 for a non-agency email', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'x@gmail.com' } });
    expect((await route.GET(get('acme.com'))).init.status).toBe(401);
    expect((await route.PUT(put({ domain: 'acme.com', brief: {} }))).init.status).toBe(401);
    expect(store.getBrief).not.toHaveBeenCalled();
    expect(store.saveBrief).not.toHaveBeenCalled();
  });

  it('GET returns the saved brief for the normalized domain', async () => {
    const brief = { services: 's', exclude: [], areas: '', notes: '' };
    store.getBrief.mockResolvedValue(brief);
    const res = await route.GET(get('https://www.Acme.com/about'));
    expect(res.body).toEqual({ brief });
    expect(store.getBrief).toHaveBeenCalledWith('acme.com');
  });

  it('GET 400 on an invalid domain', async () => {
    expect((await route.GET(get('nope'))).init.status).toBe(400);
  });

  it('PUT saves the parsed brief and returns it', async () => {
    store.saveBrief.mockResolvedValue();
    const res = await route.PUT(put({ domain: 'acme.com', brief: { services: ' Roofing ', exclude: ['solar panels', 'SOLAR PANELS'] } }));
    const expected = { services: 'Roofing', exclude: ['solar panels'], areas: '', notes: '' };
    expect(res.body).toEqual({ brief: expected });
    expect(store.saveBrief).toHaveBeenCalledWith('acme.com', expected, USER);
  });

  it('PUT with an empty brief deletes it', async () => {
    store.saveBrief.mockResolvedValue();
    const res = await route.PUT(put({ domain: 'acme.com', brief: { services: '' } }));
    expect(res.body).toEqual({ brief: null });
    expect(store.saveBrief).toHaveBeenCalledWith('acme.com', null, USER);
  });

  it('PUT 400 on a 3-character exclusion', async () => {
    const res = await route.PUT(put({ domain: 'acme.com', brief: { exclude: ['abc'] } }));
    expect(res.init.status).toBe(400);
    expect(res.body.error).toBe('Use at least 4 characters for each service not to recommend.');
    expect(store.saveBrief).not.toHaveBeenCalled();
  });
});
