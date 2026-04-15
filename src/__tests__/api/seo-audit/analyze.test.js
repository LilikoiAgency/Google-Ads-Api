import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkRateLimit, resetRateLimitMap } from '@/lib/seoRateLimit.js';

describe('checkRateLimit', () => {
  beforeEach(() => resetRateLimitMap());

  it('allows the first request from a user', () => {
    const result = checkRateLimit('user@test.com');
    expect(result.limited).toBe(false);
  });

  it('blocks a second request within 30 seconds', () => {
    checkRateLimit('user@test.com');
    const result = checkRateLimit('user@test.com');
    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('allows a second request after 30 seconds have passed', () => {
    const map = new Map();
    map.set('user@test.com', Date.now() - 31_000); // 31s ago
    const result = checkRateLimit('user@test.com', map);
    expect(result.limited).toBe(false);
  });

  it('tracks users independently', () => {
    checkRateLimit('alice@test.com');
    const result = checkRateLimit('bob@test.com');
    expect(result.limited).toBe(false);
  });
});
