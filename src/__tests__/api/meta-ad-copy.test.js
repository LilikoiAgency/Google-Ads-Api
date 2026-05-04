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
vi.mock('@/lib/mongoose', () => ({
  default: vi.fn().mockResolvedValue({
    db: () => ({ collection: () => ({ findOne: vi.fn().mockResolvedValue(null), updateOne: vi.fn() }) }),
  }),
}));
vi.mock('@/lib/usageLogger', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
  estimateClaudeCost: vi.fn().mockReturnValue(0.01),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));
vi.mock('@/lib/admins', () => ({ isAdmin: vi.fn().mockReturnValue(true) }));

import { POST } from '@/app/api/claude/meta-ad-copy/route.js';

function makeRequest(body) {
  return { json: async () => body };
}

const validCampaign = {
  campaignName: 'Spring Promo',
  objective: 'CONVERSIONS',
  spend: 500,
  ctr: 0.015,
  cpa: 0,
  roas: 0,
  conversions: 0,
  currentTitle: 'Get 20% Off',
  currentBody: 'Limited time offer.',
  callToActionType: 'SHOP_NOW',
  flags: ['Zero conversions with spend'],
};

const validContext = {
  business: 'Acme HVAC',
  audience: 'Homeowners in Phoenix',
  usps: 'Same-day service, 10-year warranty',
  tone: 'Professional',
};

describe('POST /api/claude/meta-ad-copy', () => {
  it('returns 400 when required context fields are missing', async () => {
    const res = await POST(makeRequest({ context: { tone: 'Pro' }, campaign: validCampaign }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/business|audience|usps/i);
  });

  it('returns 400 when campaign.campaignName is missing', async () => {
    const res = await POST(makeRequest({ context: validContext, campaign: { spend: 100 } }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/campaignName/i);
  });

  it('returns 401 when session email is not from allowed domain', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce({ user: { email: 'user@other.com' } });
    const res = await POST(makeRequest({ context: validContext, campaign: validCampaign }));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.error).toMatch(/unauthorized/i);
  });

  it('returns 429 with NO_CREDITS when budget cap is reached', async () => {
    const { getMonthlyClaudeCost } = await import('@/lib/usageLogger');
    getMonthlyClaudeCost.mockResolvedValueOnce(100);
    const res = await POST(makeRequest({ context: validContext, campaign: validCampaign }));
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.code).toBe('NO_CREDITS');
    expect(data.limitReached).toBe(true);
  });

  it('returns 429 with limitReached when daily limit is hit', async () => {
    const { isAdmin } = await import('@/lib/admins');
    isAdmin.mockReturnValueOnce(false);
    const mongoose = await import('@/lib/mongoose');
    mongoose.default.mockResolvedValueOnce({
      db: () => ({ collection: () => ({ findOne: vi.fn().mockResolvedValue({ metaAdCopyCount: 10 }), updateOne: vi.fn() }) }),
    });
    const res = await POST(makeRequest({ context: validContext, campaign: validCampaign }));
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.limitReached).toBe(true);
  });
});
