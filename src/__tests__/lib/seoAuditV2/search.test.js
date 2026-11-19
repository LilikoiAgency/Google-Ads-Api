import { describe, it, expect, vi, beforeEach } from 'vitest';
import { okResponse, errorResultResponse, pauseResponse, pauseThenOk } from './fixtures/webSearch';

const m = vi.hoisted(() => ({
  betaStream: vi.fn(), finalMessage: vi.fn(), getCredentials: vi.fn(), logApiUsage: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class APIUserAbortError extends Error {}
  class FakeClient {
    constructor() {
      this.beta = { messages: { stream: (...a) => { m.betaStream(...a); return { finalMessage: m.finalMessage }; } } };
    }
  }
  FakeClient.APIUserAbortError = APIUserAbortError;
  return { default: FakeClient, APIUserAbortError };
});
vi.mock('@/lib/dbFunctions', () => ({ getCredentials: m.getCredentials }));
vi.mock('@/lib/usageLogger', () => ({ logApiUsage: m.logApiUsage }));

import { buildSearchQueries, runWebSearch } from '@/lib/seoAuditV2/search';
import { PassError } from '@/lib/seoAuditV2/llm';

const q = (query, impressions) => ({ query, impressions, clicks: 1, position: 3 });
const base = { queries: ['turf installation austin', 'artificial grass cost austin'], brand: 'Acme Turf', domain: 'acme.com', city: 'Austin', region: 'TX', email: 'a@b.com' };

beforeEach(() => {
  vi.clearAllMocks();
  m.getCredentials.mockResolvedValue({ anthropic_api_key: 'k' });
  m.logApiUsage.mockResolvedValue();
});

describe('buildSearchQueries', () => {
  it('drops brand queries, adds city, caps at 8', () => {
    const gscPages = [{ page: 'https://acme.com/', queries: [
      q('acme turf reviews', 900),
      ...Array.from({ length: 9 }, (_, i) => q(`buy grass ${i}`, 100 - i)),
      q('turf in austin tx', 50),
    ] }];
    const out = buildSearchQueries({ gscPages, crawl: {}, brand: 'Acme Turf Co', city: 'Austin' });
    expect(out).toHaveLength(8);
    expect(out.slice(0, 6)).toEqual(['buy grass 0 Austin', 'buy grass 1 Austin', 'buy grass 2 Austin', 'buy grass 3 Austin', 'buy grass 4 Austin', 'buy grass 5 Austin']);
    expect(out.slice(6)).toEqual(['Acme Turf Co reviews', 'Acme Turf Co']);
  });

  it('does not append the city when the query already has it', () => {
    const out = buildSearchQueries({ gscPages: [{ queries: [q('grass Austin', 10)] }], crawl: {}, brand: 'Zed', city: 'Austin' });
    expect(out[0]).toBe('grass austin');
  });

  it('falls back to services when all queries are brand', () => {
    const gscPages = [{ queries: [q('acme', 100), q('acme turf phone', 50)] }];
    const crawl = { pages_crawled: [
      { url: 'https://acme.com/', page_type: 'homepage', h1_tags: ['Austin lawn experts'] },
      { url: 'https://acme.com/services/turf', h1_tags: ['Synthetic turf installation'] },
      { url: 'https://acme.com/about', h1_tags: ['About us'] },
    ] };
    const out = buildSearchQueries({ gscPages, crawl, brand: 'Acme Co', city: 'Austin' });
    expect(out).toEqual(['Austin lawn experts', 'Synthetic turf installation Austin', 'Acme Co reviews', 'Acme Co']);
  });

  it('only treats the URL path as a service page, not the domain', () => {
    const crawl = { pages_crawled: [
      { url: 'https://bestservicepros.com/about', h1_tags: ['About us'] },
      { url: 'not a url', h1_tags: ['Broken'] },
    ] };
    expect(buildSearchQueries({ gscPages: [], crawl, brand: 'Zed', city: null })).toEqual(['Zed reviews', 'Zed']);
  });

  it('works with no city and no data', () => {
    expect(buildSearchQueries({ gscPages: null, crawl: null, brand: 'Zed', city: null })).toEqual(['Zed reviews', 'Zed']);
  });
});

describe('runWebSearch', () => {
  it('sends web_search with max_uses and user_location', async () => {
    m.finalMessage.mockResolvedValue(okResponse);
    await runWebSearch(base);
    const [body, opts] = m.betaStream.mock.calls[0];
    expect(body.tools).toEqual([{
      type: 'web_search_20260209', name: 'web_search', max_uses: 4,
      user_location: { type: 'approximate', city: 'Austin', region: 'TX', country: 'US' },
    }]);
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body.max_tokens).toBe(16000);
    expect(body).not.toHaveProperty('thinking');
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(body.messages[0].content).toContain('1. turf installation austin');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('omits user_location without a city', async () => {
    m.finalMessage.mockResolvedValue(okResponse);
    await runWebSearch({ ...base, city: null, region: null });
    expect(m.betaStream.mock.calls[0][0].tools[0]).not.toHaveProperty('user_location');
  });

  it('maps results to queries and computes you_appear', async () => {
    m.finalMessage.mockResolvedValue(okResponse);
    const out = await runWebSearch(base);
    expect(out.status).toBe('ok');
    expect(out.queries[0]).toEqual({
      query: 'turf installation austin',
      you_appear: true,
      results: [
        { title: 'Turf installation | Acme', url: 'https://www.acme.com/turf', host: 'acme.com' },
        { title: 'Rival Turf', url: 'https://rival.com/', host: 'rival.com' },
        { title: 'Best turf in Austin - Yelp', url: 'https://www.yelp.com/search?q=turf', host: 'yelp.com' },
      ],
    });
    expect(out.queries[1].you_appear).toBe(false);
    expect(out.notes).toBe('Query 1: Acme appears. Query 2: Acme does not appear.');
    expect(m.logApiUsage.mock.calls[0][0]).toMatchObject({ feature: 'seo_audit_v2', label: 'search', model: 'claude-opus-5-5' });
  });

  it('records a per-query search error', async () => {
    m.finalMessage.mockResolvedValue(errorResultResponse);
    const out = await runWebSearch(base);
    expect(out.status).toBe('ok');
    expect(out.queries[1]).toMatchObject({ query: 'artificial grass cost austin', you_appear: false, results: [], error: 'max_uses_exceeded' });
    expect(out.queries[0].error).toBeUndefined();
  });

  it('marks queries with no tool call as not searched, and all-errored as status error', async () => {
    m.finalMessage.mockResolvedValue({ ...okResponse, content: [{ type: 'text', text: 'nothing' }] });
    const out = await runWebSearch(base);
    expect(out.status).toBe('error');
    expect(out.queries.map((x) => x.error)).toEqual(['not searched', 'not searched']);
  });

  it('resumes pause_turn at most twice', async () => {
    m.finalMessage.mockResolvedValueOnce(pauseThenOk[0]).mockResolvedValueOnce(pauseThenOk[1]);
    const out = await runWebSearch(base);
    expect(m.betaStream).toHaveBeenCalledTimes(2);
    const second = m.betaStream.mock.calls[1][0].messages;
    expect(second).toHaveLength(2);
    expect(second[1]).toEqual({ role: 'assistant', content: pauseThenOk[0].content });
    expect(out.queries.every((x) => x.results.length === 1)).toBe(true);

    m.betaStream.mockClear();
    m.finalMessage.mockReset().mockResolvedValue(pauseResponse);
    await runWebSearch(base);
    expect(m.betaStream).toHaveBeenCalledTimes(3);
  });

  it('keeps every paused segment in the assistant content on later resumes', async () => {
    const seg2 = { ...pauseResponse, content: [
      { type: 'server_tool_use', id: 'srvtoolu_2', name: 'web_search', input: { query: 'artificial grass cost austin' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_2', content: [] },
    ] };
    m.finalMessage.mockResolvedValueOnce(pauseResponse).mockResolvedValueOnce(seg2).mockResolvedValueOnce(pauseThenOk[1]);
    await runWebSearch(base);
    expect(m.betaStream).toHaveBeenCalledTimes(3);
    const third = m.betaStream.mock.calls[2][0].messages;
    expect(third).toHaveLength(2);
    expect(third[1]).toEqual({ role: 'assistant', content: [...pauseResponse.content, ...seg2.content] });
  });

  it('assigns a rewritten search to the still-unmatched query', async () => {
    const rewritten = { ...okResponse, content: okResponse.content.map((b) => (b.id === 'srvtoolu_2'
      ? { ...b, input: { query: 'artificial turf price in austin' } } : b)) };
    m.finalMessage.mockResolvedValue(rewritten);
    const out = await runWebSearch(base);
    expect(out.queries[1].error).toBeUndefined();
    expect(out.queries[1].results).toHaveLength(2);
  });

  it('turns a refusal into an error result', async () => {
    m.finalMessage.mockResolvedValue({ ...okResponse, stop_reason: 'refusal', content: [] });
    const out = await runWebSearch(base);
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/declined/i);
  });

  it('keeps parsed results on max_tokens', async () => {
    m.finalMessage.mockResolvedValue({ ...okResponse, stop_reason: 'max_tokens' });
    const out = await runWebSearch(base);
    expect(out.status).toBe('ok');
    expect(out.queries[0].you_appear).toBe(true);
  });

  it('turns API failures into an error result and timeouts into a PassError', async () => {
    m.finalMessage.mockRejectedValueOnce(new Error('boom'));
    expect(await runWebSearch(base)).toMatchObject({ status: 'error', error: 'boom', queries: [] });
    m.finalMessage.mockRejectedValueOnce(Object.assign(new Error('Request timed out'), { name: 'AbortError' }));
    await expect(runWebSearch(base)).rejects.toBeInstanceOf(PassError);
  });
});
