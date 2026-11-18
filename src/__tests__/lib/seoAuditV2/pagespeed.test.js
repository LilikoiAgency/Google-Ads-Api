import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapPageSpeed, fetchPageSpeed } from '@/lib/seoAuditV2/pagespeed';

const lab = {
  lighthouseResult: {
    categories: { performance: { score: 0.47 } },
    audits: {
      'largest-contentful-paint': { numericValue: 5234.6 },
      'cumulative-layout-shift': { numericValue: 0.08123 },
    },
  },
};

const withField = {
  ...lab,
  loadingExperience: {
    id: 'https://x.com/a/',
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100, category: 'AVERAGE' },
      INTERACTION_TO_NEXT_PAINT: { percentile: 210, category: 'AVERAGE' },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12, category: 'AVERAGE' },
    },
    overall_category: 'AVERAGE',
  },
};

describe('mapPageSpeed', () => {
  it('maps lab data without field data', () => {
    expect(mapPageSpeed(lab)).toEqual({ score: 47, lcp_ms: 5235, inp_ms: null, cls: 0.081, field: null });
  });

  it('maps real-user field data (CLS percentile is x100)', () => {
    expect(mapPageSpeed(withField).field).toEqual({ lcp_ms: 3100, inp_ms: 210, cls: 0.12, origin_fallback: false });
  });

  it('marks origin-level field data', () => {
    const origin = { ...withField, loadingExperience: { ...withField.loadingExperience, origin_fallback: true } };
    expect(mapPageSpeed(origin).field.origin_fallback).toBe(true);
  });

  it('uses a lab INP audit when present (either name)', () => {
    const a = { lighthouseResult: { ...lab.lighthouseResult, audits: { ...lab.lighthouseResult.audits, 'interaction-to-next-paint': { numericValue: 180.4 } } } };
    expect(mapPageSpeed(a).inp_ms).toBe(180);
    const b = { lighthouseResult: { ...lab.lighthouseResult, audits: { 'experimental-interaction-to-next-paint': { numericValue: 99 } } } };
    expect(mapPageSpeed(b).inp_ms).toBe(99);
  });

  it('handles an empty response', () => {
    expect(mapPageSpeed({})).toEqual({ score: null, lcp_ms: null, inp_ms: null, cls: null, field: null });
  });
});

describe('fetchPageSpeed', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('calls the mobile performance endpoint and maps the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => withField });
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchPageSpeed('https://x.com/a/?q=1', { apiKey: 'k' });
    const called = new URL(fetchMock.mock.calls[0][0]);
    expect(called.origin + called.pathname).toBe('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    expect(called.searchParams.get('url')).toBe('https://x.com/a/?q=1');
    expect(called.searchParams.get('strategy')).toBe('mobile');
    expect(called.searchParams.get('category')).toBe('performance');
    expect(called.searchParams.get('key')).toBe('k');
    expect(out).toMatchObject({ status: 'ok', url: 'https://x.com/a/?q=1', score: 47, lcp_ms: 5235 });
    expect(out.field.lcp_ms).toBe(3100);
  });

  it('runs keyless when no key is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => lab });
    vi.stubGlobal('fetch', fetchMock);
    const prev = process.env.PAGESPEED_API_KEY;
    delete process.env.PAGESPEED_API_KEY;
    await fetchPageSpeed('https://x.com/');
    if (prev !== undefined) process.env.PAGESPEED_API_KEY = prev;
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('key')).toBe(false);
  });

  it('returns timeout when the request is aborted', async () => {
    vi.stubGlobal('fetch', vi.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const out = await fetchPageSpeed('https://x.com/', { timeoutMs: 20 });
    expect(out).toMatchObject({ status: 'timeout', url: 'https://x.com/', score: null, field: null });
  });

  it('returns error on a bad HTTP status or network failure, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded' } }) }));
    const out = await fetchPageSpeed('https://x.com/');
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/429/);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net down')));
    expect(await fetchPageSpeed('https://x.com/')).toMatchObject({ status: 'error', error: 'net down' });
  });
});
