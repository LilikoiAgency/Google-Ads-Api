import { describe, it, expect } from 'vitest';
import { shouldSkipCronRun } from '@/lib/cronGuard.js';

describe('shouldSkipCronRun', () => {
  it('returns true when lastRun was less than 8 minutes ago', () => {
    const lastRun = new Date(Date.now() - 4 * 60 * 1000); // 4 min ago
    expect(shouldSkipCronRun(lastRun)).toBe(true);
  });

  it('returns false when lastRun was more than 8 minutes ago', () => {
    const lastRun = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    expect(shouldSkipCronRun(lastRun)).toBe(false);
  });

  it('returns false when lastRun is null', () => {
    expect(shouldSkipCronRun(null)).toBe(false);
  });
});
