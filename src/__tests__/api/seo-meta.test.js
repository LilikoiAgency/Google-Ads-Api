// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { email: 'test@lilikoiagency.com' },
  }),
}));
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));
vi.mock('@/lib/dbFunctions', () => ({
  getCredentials: vi.fn().mockResolvedValue({ anthropic_api_key: 'test-key' }),
}));
vi.mock('@/lib/usageLogger', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
  estimateClaudeCost: vi.fn().mockReturnValue(0.001),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));

import { POST } from '@/app/api/claude/seo-meta/route.js';

function makeRequest(body) {
  return { json: async () => body };
}

describe('POST /api/claude/seo-meta', () => {
  it('returns 400 when pageTitle is missing', async () => {
    const res = await POST(makeRequest({}));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/pageTitle/);
  });

  it('returns 400 when pageTitle is empty string', async () => {
    const res = await POST(makeRequest({ pageTitle: '   ' }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/pageTitle/);
  });

  it('returns 401 when session email is not from allowed domain', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce({ user: { email: 'user@other.com' } });
    const res = await POST(makeRequest({ pageTitle: 'My Page' }));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.error).toMatch(/unauthorized/i);
  });

  it('returns 429 when budget cap is reached', async () => {
    const { getMonthlyClaudeCost } = await import('@/lib/usageLogger');
    getMonthlyClaudeCost.mockResolvedValueOnce(100);
    const res = await POST(makeRequest({ pageTitle: 'My Page' }));
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.code).toBe('NO_CREDITS');
    expect(data.limitReached).toBe(true);
  });
});
