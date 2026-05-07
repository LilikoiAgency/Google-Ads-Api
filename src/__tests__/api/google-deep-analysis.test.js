// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

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

import { POST } from '@/app/api/claude/google-deep-analysis/route.js';

function makeRequest(body) {
  return { json: async () => body };
}

describe('POST /api/claude/google-deep-analysis', () => {
  it('returns 400 when customerId is missing', async () => {
    const res = await POST(makeRequest({ campaigns: [{ campaignId: '1' }], auditData: {} }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/customerId/);
  });

  it('returns 400 when campaigns array is empty', async () => {
    const res = await POST(makeRequest({ customerId: '123', campaigns: [], auditData: {} }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/campaigns/i);
  });

  it('returns 401 when session email is not from allowed domain', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce({ user: { email: 'hacker@evil.com' } });
    const res = await POST(makeRequest({ customerId: '123', campaigns: [{ campaignId: '1' }], auditData: {} }));
    expect(res.status).toBe(401);
  });
});
