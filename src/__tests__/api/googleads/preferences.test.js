import { describe, it, expect, vi } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: { json: vi.fn((body, init) => ({ body, init })) },
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));
vi.mock('@/lib/mongoose', () => ({ default: vi.fn() }));
vi.mock('@/lib/admins', () => ({
  isAdmin: vi.fn((email) => email === 'frank@lilikoiagency.com'),
}));

const { preferencesPostSchema } = await import('@/app/api/googleads/preferences/route.js');

describe('preferencesPostSchema', () => {
  it('accepts a valid accountId string', () => {
    expect(preferencesPostSchema.safeParse({ accountId: '1234567890' }).success).toBe(true);
  });

  it('rejects an empty string accountId', () => {
    expect(preferencesPostSchema.safeParse({ accountId: '' }).success).toBe(false);
  });

  it('rejects a missing accountId', () => {
    // z.coerce.string() turns undefined into "undefined" which passes min(1),
    // but the field is required so an absent key still fails.
    const result = preferencesPostSchema.safeParse({});
    // accountId is required — must be present even with coerce
    expect(result.success).toBe(false);
  });

  it('accepts a numeric accountId (coerced to string)', () => {
    // Google Ads API returns numeric IDs; coerce handles the conversion.
    expect(preferencesPostSchema.safeParse({ accountId: 12345 }).success).toBe(true);
    expect(preferencesPostSchema.safeParse({ accountId: 12345 }).data?.accountId).toBe('12345');
  });
});
