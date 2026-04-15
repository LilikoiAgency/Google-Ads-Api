import { describe, it, expect } from 'vitest';
import { prioritizePages } from '@/lib/seoCrawler.js';

describe('prioritizePages', () => {
  it('caps output at maxPages', () => {
    const urls = Array.from({ length: 100 }, (_, i) => `https://example.com/page-${i}`);
    const result = prioritizePages(urls, 'example.com', 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('returns all URLs when count is under the cap', () => {
    const urls = ['https://example.com/', 'https://example.com/about'];
    const result = prioritizePages(urls, 'example.com', 50);
    expect(result.length).toBe(2);
  });
});
