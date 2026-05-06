// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { email: 'test@lilikoiagency.com' } }),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/dbFunctions', () => ({
  getCredentials: vi.fn().mockResolvedValue({ anthropic_api_key: 'test-key' }),
}));
vi.mock('@/lib/mongoose', () => ({
  default: vi.fn().mockResolvedValue({
    db: () => ({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn(),
      }),
    }),
  }),
}));
vi.mock('@/lib/usageLogger', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
  estimateClaudeCost: vi.fn().mockReturnValue(0.01),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));
vi.mock('@/lib/admins', () => ({ isAdmin: vi.fn().mockReturnValue(true) }));
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ text: '{"primaryTexts":[{"text":"Fix your home today","rationale":"direct"}],"headlines":[{"text":"Expert Plumbers","rationale":"trust"}],"descriptions":[{"text":"Call now","rationale":"cta"}],"ctaRecommendation":{"cta":"Get Quote","rationale":"lead gen"}}' }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  class MockAnthropic {
    constructor() {
      this.messages = { create: mockCreate };
    }
  }
  return { default: MockAnthropic };
});

const { POST } = await import('@/app/api/claude/meta-ad-copy-new/route.js');

function makeRequest(body) {
  return new Request('http://localhost/api/claude/meta-ad-copy-new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/claude/meta-ad-copy-new', () => {
  it('returns 401 when unauthenticated', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ product: 'p', audience: 'a', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when product is missing', async () => {
    const res = await POST(makeRequest({ audience: 'a', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/product/i);
  });

  it('returns 400 when audience is missing', async () => {
    const res = await POST(makeRequest({ product: 'p', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/audience/i);
  });

  it('returns 400 when usps is missing', async () => {
    const res = await POST(makeRequest({ product: 'p', audience: 'a', cta: 'c' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/usps/i);
  });

  it('returns 400 when cta is missing', async () => {
    const res = await POST(makeRequest({ product: 'p', audience: 'a', usps: 'u' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cta/i);
  });

  it('returns 429 when monthly budget cap is reached', async () => {
    const { getMonthlyClaudeCost, getClaudeBudgetCap } = await import('@/lib/usageLogger');
    getMonthlyClaudeCost.mockResolvedValueOnce(200);
    getClaudeBudgetCap.mockResolvedValueOnce(100);
    const res = await POST(makeRequest({ product: 'p', audience: 'a', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/monthly/i);
  });

  it('returns 429 when daily limit is reached', async () => {
    const { isAdmin } = await import('@/lib/admins');
    isAdmin.mockReturnValueOnce(false);
    const mongooseConnect = (await import('@/lib/mongoose')).default;
    mongooseConnect.mockResolvedValueOnce({
      db: () => ({
        collection: () => ({
          findOne: vi.fn().mockResolvedValue({ metaAdCopyNewCount: 10 }),
          updateOne: vi.fn(),
        }),
      }),
    });
    const res = await POST(makeRequest({ product: 'p', audience: 'a', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/daily/i);
  });

  it('returns 200 with primaryTexts on happy path', async () => {
    const res = await POST(makeRequest({ product: 'Plumbing Services', audience: 'homeowners 30-55', usps: 'Same-day service', cta: 'Get Quote' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveProperty('primaryTexts');
  });
});
