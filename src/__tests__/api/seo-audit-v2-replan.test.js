import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/mongoose', () => ({ default: vi.fn() }));
vi.mock('@/lib/usageLogger', () => ({ getMonthlyClaudeCost: vi.fn(), getClaudeBudgetCap: vi.fn() }));
vi.mock('@/lib/seoAuditV2/replan', () => ({ replanAudit: vi.fn() }));

const { getServerSession } = await import('next-auth');
const usage = await import('@/lib/usageLogger');
const { replanAudit } = await import('@/lib/seoAuditV2/replan');
const route = await import('@/app/api/seo-audit/v2/audits/[id]/replan/route.js');

const params = { id: 'aud1' };

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { email: 'a@lilikoiagency.com' } });
  usage.getMonthlyClaudeCost.mockResolvedValue(10);
  usage.getClaudeBudgetCap.mockResolvedValue(100);
});

describe('POST /api/seo-audit/v2/audits/:id/replan', () => {
  it('allows the full 300s', () => {
    expect(route.maxDuration).toBe(300);
  });

  it('401 for a non-agency email', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'x@gmail.com' } });
    expect((await route.POST({}, { params })).init.status).toBe(401);
    expect(replanAudit).not.toHaveBeenCalled();
  });

  it('429 when the monthly budget cap is reached', async () => {
    usage.getMonthlyClaudeCost.mockResolvedValue(100);
    const res = await route.POST({}, { params });
    expect(res.init.status).toBe(429);
    expect(res.body.error).toBe('Monthly AI budget cap of $100 reached. Contact an admin.');
    expect(replanAudit).not.toHaveBeenCalled();
  });

  it('returns the new result', async () => {
    replanAudit.mockResolvedValue({ ok: true, result: { a: 1 } });
    const res = await route.POST({}, { params });
    expect(res.body).toEqual({ result: { a: 1 } });
    expect(replanAudit).toHaveBeenCalledWith({ auditId: 'aud1', now: expect.any(Date) });
  });

  it('passes the error status through', async () => {
    replanAudit.mockResolvedValue({ ok: false, status: 409, error: 'The plan is already being updated.' });
    const res = await route.POST({}, { params });
    expect(res.init.status).toBe(409);
    expect(res.body).toEqual({ error: 'The plan is already being updated.' });
  });

  it('500 when something throws', async () => {
    replanAudit.mockRejectedValue(new Error('boom'));
    expect((await route.POST({}, { params })).init.status).toBe(500);
  });
});
