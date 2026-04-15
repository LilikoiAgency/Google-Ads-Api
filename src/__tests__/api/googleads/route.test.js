import { describe, it, expect, vi } from 'vitest';

vi.mock('next/server', () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/dbFunctions', () => ({ getCredentials: vi.fn() }));
vi.mock('google-ads-api', () => ({ GoogleAdsApi: vi.fn() }));
vi.mock('@/lib/googleAdsCustomer', () => ({ fetchCustomerData: vi.fn() }));
vi.mock('node:util', () => ({ default: { inspect: vi.fn((e) => String(e)) } }));

const { googleAdsQuerySchema } = await import('@/app/api/googleads/route.js');

describe('googleAdsQuerySchema', () => {
  it('accepts valid params', () => {
    const result = googleAdsQuerySchema.safeParse({
      dateRange: 'LAST_7_DAYS',
      statusFilter: 'ACTIVE',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown dateRange', () => {
    const result = googleAdsQuerySchema.safeParse({ dateRange: 'LAST_999_DAYS' });
    expect(result.success).toBe(false);
  });

  it('defaults statusFilter to ACTIVE when omitted', () => {
    const result = googleAdsQuerySchema.safeParse({ dateRange: 'LAST_30_DAYS' });
    expect(result.success).toBe(true);
    expect(result.data.statusFilter).toBe('ACTIVE');
  });

  it('requires both startDate and endDate for CUSTOM range', () => {
    const result = googleAdsQuerySchema.safeParse({
      dateRange: 'CUSTOM',
      startDate: '2026-01-01',
    });
    expect(result.success).toBe(false);
  });
});
