import { describe, it, expect, vi } from 'vitest';

vi.mock('next/server', () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/dbFunctions', () => ({ getCredentials: vi.fn() }));
vi.mock('google-ads-api', () => ({ GoogleAdsApi: vi.fn() }));

const { googleAdsAdsQuerySchema } = await import('@/app/api/googleads/ads/route.js');

describe('googleAdsAdsQuerySchema', () => {
  it('accepts numeric customer and campaign ids', () => {
    const result = googleAdsAdsQuerySchema.safeParse({
      customerId: '1234567890',
      campaignId: '987654321',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric ids', () => {
    expect(googleAdsAdsQuerySchema.safeParse({
      customerId: 'abc',
      campaignId: '987654321',
    }).success).toBe(false);
    expect(googleAdsAdsQuerySchema.safeParse({
      customerId: '1234567890',
      campaignId: 'bad',
    }).success).toBe(false);
  });
});
