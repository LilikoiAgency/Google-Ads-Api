import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  crawlSite: vi.fn(),
  seedPages: vi.fn(),
  gatherAll: vi.fn(),
  runStructured: vi.fn(),
  getSavedLocations: vi.fn(),
  saveReviewTexts: vi.fn(),
  getReviewTexts: vi.fn(),
  runWebSearch: vi.fn(),
  buildSearchQueries: vi.fn(),
}));

vi.mock('@/lib/seoCrawler', () => ({ crawlSite: m.crawlSite }));
vi.mock('@/lib/seoAuditV2/gather', () => ({
  seedPages: m.seedPages,
  gatherAll: m.gatherAll,
  describeGaps: (gaps) => (gaps || []).map((g) => `${g.source} unavailable`),
  AUDIT_PROFILES: { quick: { effort: 'medium' }, full: { effort: 'high' } },
}));
vi.mock('@/lib/seoAuditV2/llm', () => ({ runStructured: m.runStructured }));
vi.mock('@/lib/seoAuditV2/reputationStore', () => ({ getSavedLocations: m.getSavedLocations, saveReviewTexts: m.saveReviewTexts, getReviewTexts: m.getReviewTexts }));

vi.mock('@/lib/seoAuditV2/search', () => ({
  buildSearchQueries: m.buildSearchQueries,
  runWebSearch: m.runWebSearch,
}));

const { runStep } = await import('@/lib/seoAuditV2/runStep');
const { newJob } = await import('@/lib/seoAuditV2/jobs');

const page = (url, extra = {}) => ({ url, final_url: url, title_tag: 'T', content_text: 'text', ...extra });
const task = (title, page = 'https://acme.com/', change = 'Change "x" to "y"') => ({
  title, page, category: 'technical', impact: 4, effort: 2, confidence: 'high', evidence: ['e'], change, why: 'w',
});

function job(statuses = {}, extra = {}) {
  const j = newJob({ email: 'a@lilikoiagency.com', domain: 'acme.com', auditType: 'full', now: '2026-11-18T10:00:00Z' });
  j.steps = j.steps.map((s) => ({ ...s, ...(statuses[s.key] || {}) }));
  return { ...j, ...extra };
}

const crawl = {
  pages_crawled: [
    page('https://acme.com/', { page_type: 'homepage' }),
    ...Array.from({ length: 5 }, (_, i) => page(`https://acme.com/p${i}`)),
  ],
  site_wide: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getSavedLocations.mockResolvedValue(null);
  m.saveReviewTexts.mockResolvedValue(undefined);
  m.getReviewTexts.mockResolvedValue(null);
});

describe('runStep', () => {
  it('crawl seeds from Search Console pages then crawls', async () => {
    m.seedPages.mockResolvedValue(['https://acme.com/a']);
    m.crawlSite.mockResolvedValue(crawl);
    const res = await runStep(job(), 'crawl');
    expect(m.seedPages).toHaveBeenCalledWith('acme.com', 'full');
    expect(m.crawlSite).toHaveBeenCalledWith('acme.com', 'full', null, { seedUrls: ['https://acme.com/a'], deadlineMs: 200_000 });
    expect(res).toEqual({ ok: true, patch: { 'data.crawl': crawl } });
  });

  it('crawl with options: listed pages first, Search Console seeds minus skipped, page limit and skip passed on', async () => {
    m.seedPages.mockResolvedValue(['https://acme.com/blog/x', 'https://acme.com/a']);
    m.crawlSite.mockResolvedValue(crawl);
    const options = { pages: ['https://acme.com/money'], onlyListed: false, skip: ['/blog/*'], pageCount: 10 };
    await runStep(job({}, { options }), 'crawl');
    expect(m.seedPages).toHaveBeenCalledWith('acme.com', 'full', 5, { gscSite: undefined });
    expect(m.crawlSite).toHaveBeenCalledWith('acme.com', 'full', null, {
      seedUrls: ['https://acme.com/money', 'https://acme.com/a'], deadlineMs: 200_000, pageLimit: 10, skip: ['/blog/*'],
    });
  });

  it('crawl with only listed pages skips discovery and Search Console seeding', async () => {
    m.crawlSite.mockResolvedValue(crawl);
    const options = { pages: ['https://acme.com/a', 'https://acme.com/b'], onlyListed: true, skip: [], pageCount: null };
    await runStep(job({}, { options }), 'crawl');
    expect(m.seedPages).not.toHaveBeenCalled();
    expect(m.crawlSite).toHaveBeenCalledWith('acme.com', 'full', options.pages, {
      seedUrls: [], deadlineMs: 200_000, pageLimit: 2, skip: [],
    });
  });

  it('gather passes listed pages and skip patterns when the job has options', async () => {
    m.gatherAll.mockResolvedValue({ data: {}, gaps: [] });
    const options = { pages: ['https://acme.com/money'], onlyListed: false, skip: ['/blog/*'], pageCount: null };
    await runStep(job({}, { data: { crawl }, options }), 'gather');
    expect(m.gatherAll).toHaveBeenCalledWith({
      domain: 'acme.com', crawl, profile: 'full', priorityUrls: options.pages, onlyListed: false, skip: ['/blog/*'], locations: null,
    });
  });

  it('a crawl cut short by the deadline becomes a job gap', async () => {
    m.seedPages.mockResolvedValue([]);
    const truncated = { ...crawl, crawl_truncated: true };
    m.crawlSite.mockResolvedValue(truncated);
    const res = await runStep(job(), 'crawl');
    expect(res.ok).toBe(true);
    expect(res.patch['data.crawl'].crawl_truncated).toBe(true);
    expect(res.gaps).toEqual(['Crawl stopped early after 6 pages because the site responded slowly.']);
  });

  it('crawl with no pages fails so it can retry', async () => {
    m.seedPages.mockResolvedValue([]);
    m.crawlSite.mockResolvedValue({ pages_crawled: [] });
    const res = await runStep(job(), 'crawl');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No pages/);
  });

  it('gather stores sources, gaps and the shared context', async () => {
    m.gatherAll.mockResolvedValue({ data: { gsc: null }, gaps: [{ source: 'ga4', status: 'no_property' }] });
    const res = await runStep(job({}, { data: { crawl } }), 'gather');
    expect(m.gatherAll).toHaveBeenCalledWith({ domain: 'acme.com', crawl, profile: 'full', locations: null });
    expect(res.patch['data.sources']).toEqual({ gsc: null });
    expect(res.patch['data.gaps']).toEqual([{ source: 'ga4', status: 'no_property' }]);
    expect(res.patch['data.sharedContext']).toMatch(/Domain: acme\.com/);
    expect(res.patch['data.sharedContext']).toMatch(/ga4 unavailable/);
  });

  it('content chunks run in parallel, get unique ids and generic tasks are dropped', async () => {
    let inFlight = 0;
    let max = 0;
    m.runStructured.mockImplementation(async ({ input }) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return {
        output: {
          findings: [{ title: `f${input.chunk}`, detail: '', evidence: [] }],
          tasks: [task(`Rewrite title ${input.chunk}`), task('Improve content quality')],
          pages: input.pages.map((p) => ({ page: p.url, fixes: [] })),
        },
      };
    });
    const j = job({ 'pass:content': { status: 'running', attempts: 2 } }, { data: { crawl, sources: {}, sharedContext: 'ctx' } });
    const res = await runStep(j, 'pass:content');
    expect(max).toBe(2);
    expect(m.runStructured.mock.calls[0][0]).toMatchObject({ sharedContext: 'ctx', effort: 'medium', email: 'a@lilikoiagency.com' });
    const out = res.patch['passes.content'];
    expect(out.tasks.map((t) => t.id)).toEqual(['CONT-1-1', 'CONT-2-1']);
    expect(out.findings).toHaveLength(2);
    expect(out.pages.map((p) => p.page)).toEqual(['/', '/p0', '/p1', '/p2', '/p3', '/p4']);
    expect(out.tasks[0].page).toBe('/');
    expect(res.gaps).toBeUndefined();
  });

  it('a failed content chunk fails the pass for this attempt', async () => {
    m.runStructured
      .mockResolvedValueOnce({ output: { findings: [], tasks: [], pages: [] } })
      .mockRejectedValueOnce(Object.assign(new Error('The request timed out'), { code: 'timeout' }));
    const res = await runStep(job({}, { data: { crawl, sources: {}, sharedContext: 'ctx' } }), 'pass:content');
    expect(res).toEqual({ ok: false, error: 'timeout: The request timed out' });
  });

  it('conversion is skipped without GA4', async () => {
    const res = await runStep(job({}, { data: { crawl, sources: { ga4: null }, sharedContext: 'ctx' } }), 'pass:conversion');
    expect(m.runStructured).not.toHaveBeenCalled();
    expect(res.patch['passes.conversion']).toMatchObject({ skipped: true, tasks: [] });
  });

  it('reputation pass reads cached review text by job id', async () => {
    const loc = { source: 'places', id: 'p1', name: 'Acme', city: 'Tampa', region: 'FL', coverage: 'full', stats: { rating: 4.5, count: 80 } };
    m.getReviewTexts.mockResolvedValue({ p1: [{ stars: 1, date: '2026-01-01', text: 'Late again' }] });
    m.runStructured.mockResolvedValue({ output: { findings: [], tasks: [{ ...task('Reply to reviews', 'https://acme.com/'), category: 'reputation' }], themes: [], search_summary: { summary: '', competitors: [], cited_sites: [] } } });
    const j = job({}, { data: { crawl, sources: { reviews: [loc] }, sharedContext: 'ctx' } });
    const res = await runStep(j, 'pass:reputation');
    expect(m.getReviewTexts).toHaveBeenCalledWith(j.id);
    const input = m.runStructured.mock.calls[0][0].input;
    expect(input.locations[0].reviews[0].text).toBe('Late again');
    expect(input.domain).toBe('acme.com');
    expect(res.patch['passes.reputation'].tasks[0].id).toBe('REP-1');
    expect(res.patch['passes.reputation']).toHaveProperty('themes');
  });

  it('reputation pass keeps only real, short quotes, clamps counts, and stores no other review text', async () => {
    const loc = { source: 'places', id: 'p1', name: 'Acme', stats: {} };
    const long = 'Great crew but they were late. ' + 'filler text '.repeat(40);
    m.getReviewTexts.mockResolvedValue({ p1: [{ stars: 4, text: long }, { stars: 1, text: 'Late again' }] });
    m.runStructured.mockResolvedValue({ output: { findings: [], tasks: [], themes: [
      { kind: 'complaint', theme: 't', count: 9, location: 'Acme', quotes: ['late AGAIN', 'made up quote', 'Great crew but they were late. ' + 'filler text '.repeat(20)] },
    ], search_summary: { summary: '', competitors: [], cited_sites: [] } } });
    const res = await runStep(job({}, { data: { crawl, sources: { reviews: [loc] }, sharedContext: 'ctx' } }), 'pass:reputation');
    const themes = res.patch['passes.reputation'].themes;
    expect(themes[0].quotes).toEqual(['late AGAIN']);
    expect(themes[0].count).toBe(2);
    expect(JSON.stringify(res.patch)).not.toContain(long);
  });

  it('reputation pass drops all quotes when no review text was loaded', async () => {
    m.getReviewTexts.mockResolvedValue(null);
    const loc = { source: 'places', id: 'p1', name: 'Acme', stats: {} };
    m.runStructured.mockResolvedValue({ output: { findings: [], tasks: [], themes: [{ kind: 'praise', theme: 't', count: 3, location: 'Acme', quotes: ['Great'] }] } });
    const res = await runStep(job({}, { data: { crawl, sources: { reviews: [loc] }, sharedContext: 'ctx' } }), 'pass:reputation');
    expect(res.patch['passes.reputation'].themes[0]).toMatchObject({ quotes: [], count: 3 });
  });

  it('reputation pass tolerates a failed text lookup and skips without sources', async () => {
    m.getReviewTexts.mockRejectedValue(new Error('db down'));
    m.runStructured.mockResolvedValue({ output: { findings: [], tasks: [] } });
    const loc = { source: 'places', id: 'p1', name: 'Acme', stats: {} };
    const ok = await runStep(job({}, { data: { crawl, sources: { reviews: [loc] }, sharedContext: 'ctx' } }), 'pass:reputation');
    expect(ok.ok).toBe(true);
    expect(m.runStructured.mock.calls[0][0].input.locations[0]).not.toHaveProperty('reviews');
    m.runStructured.mockClear();
    const skipped = await runStep(job({}, { data: { crawl, sources: {}, sharedContext: 'ctx' } }), 'pass:reputation');
    expect(m.runStructured).not.toHaveBeenCalled();
    expect(skipped.patch['passes.reputation']).toMatchObject({ skipped: true });
  });

  it('synthesize builds the result from completed passes', async () => {
    const passes = {
      technical: { findings: [{ title: 'tf' }], tasks: [{ ...task('Fix canonical'), id: 'TECH-1' }] },
      content: { findings: [], tasks: [{ ...task('Rewrite title', 'https://acme.com/p1'), id: 'CONT-1-1' }], pages: [{ page: 'p1', fixes: [] }] },
      local: { findings: [], tasks: [] },
    };
    m.runStructured.mockResolvedValue({
      output: {
        client_summary: 'Summary',
        top_moves: [{ task_id: 'CONT-1-1', headline: 'Get found' }],
        scores: { seo: { score: 6, reason: 'r' }, geo: { score: 4, reason: 'r' }, aeo: { score: 5, reason: 'r' } },
        data_gaps: ['GA4 is missing.'],
        drop_task_ids: [],
      },
    });
    const j = job({
      'pass:technical': { status: 'done' },
      'pass:content': { status: 'done' },
      'pass:local': { status: 'done' },
      'pass:conversion': { status: 'failed_final' },
      'pass:reputation': { status: 'done', skipped: true },
      synthesize: { status: 'running', attempts: 1 },
    }, {
      data: { crawl, sources: { gsc: { a: 1 } }, gaps: [{ source: 'ga4', status: 'no_property' }], sharedContext: 'ctx' },
      passes,
      gaps: ["Conversion analysis didn't complete — rerun to include it"],
    });
    const res = await runStep(j, 'synthesize');
    const synthInput = m.runStructured.mock.calls[0][0].input;
    expect(synthInput.passes_not_completed).toEqual(['Conversion']);
    expect(synthInput.tasks.map((t) => t.id).sort()).toEqual(['CONT-1-1', 'TECH-1']);
    const r = res.patch.result;
    expect(r).toMatchObject({ version: 2, domain: 'acme.com', audit_type: 'full', client_summary: 'Summary' });
    expect(r.action_plan).toHaveLength(2);
    expect(r.top_moves[0].headline).toBe('Get found');
    expect(r.pages).toEqual([{ page: '/p1', fixes: [], index: null, speed: null, top_queries: [] }]);
    expect(r.passes_completed).toEqual({ technical: true, content: true, local: true, conversion: false });
    expect(r.findings.technical).toEqual([{ title: 'tf' }]);
    expect(r.findings.conversion).toEqual([]);
    expect(r.data_gaps).toEqual(['ga4 unavailable', "Conversion analysis didn't complete — rerun to include it"]);
    expect(r.data_sources.search_console.status).toBe('ok');
    expect(r.data_sources.ga4.status).toBe('no_property');
  });

  it('synthesize joins index status, speed and top queries onto pages by path', async () => {
    m.runStructured.mockResolvedValue({
      output: { client_summary: 'S', top_moves: [], scores: {}, data_gaps: [], drop_task_ids: [] },
    });
    const inspection = [
      {
        url: 'https://acme.com/services/turf/', verdict: 'PASS', coverage_state: 'Submitted and indexed',
        google_canonical: 'https://acme.com/services/turf', user_canonical: 'https://acme.com/services/turf',
        canonical_mismatch: false, last_crawl: '2026-11-01T00:00:00Z',
      },
      {
        url: 'https://acme.com/about', verdict: 'NEUTRAL', coverage_state: 'Crawled - currently not indexed',
        google_canonical: null, user_canonical: null, canonical_mismatch: false, last_crawl: null,
      },
      { url: 'https://acme.com/broken', error: 'quota' },
    ];
    const pagespeed = [
      { status: 'ok', url: 'https://acme.com/services/turf?utm=x', score: 62, lcp_ms: 3100, inp_ms: 180, cls: 0.05, field: { lcp_ms: 2900, inp_ms: 150, cls: 0.04, origin_fallback: false } },
      { status: 'ok', url: 'https://acme.com/', score: 90, lcp_ms: 1500, inp_ms: null, cls: 0, field: null },
    ];
    const gscPages = [{
      page: 'https://acme.com/services/turf', clicks: 30, impressions: 2000, ctr: 0.015, position: 9,
      queries: Array.from({ length: 7 }, (_, i) => ({ query: `q${i}`, clicks: 7 - i, impressions: 100, ctr: 0.07, position: 5 + i })),
    }];
    const j = job({
      'pass:technical': { status: 'done' },
      'pass:content': { status: 'done' },
      'pass:local': { status: 'done' },
      'pass:conversion': { status: 'done' },
      synthesize: { status: 'running', attempts: 1 },
    }, {
      data: { crawl, sources: { inspection, pagespeed, gscPages }, gaps: [], sharedContext: 'ctx' },
      passes: {
        technical: { findings: [], tasks: [] },
        content: { findings: [], tasks: [], pages: [{ page: 'https://acme.com/services/turf', fixes: [{ change: 'Add prices', targets_queries: ['q0'] }] }] },
        local: { findings: [], tasks: [] },
        conversion: { skipped: true, findings: [], tasks: [] },
      },
    });
    const r = (await runStep(j, 'synthesize')).patch.result;
    expect(r.passes_completed).toEqual({ technical: true, content: true, local: true, conversion: true, reputation: false });
    expect(r.pages.map((p) => p.page)).toEqual(['/services/turf', '/about', '/']);
    const [turf, about, home] = r.pages;
    expect(turf.fixes).toHaveLength(1);
    expect(turf.index).toEqual({
      verdict: 'PASS', coverage_state: 'Submitted and indexed', canonical_mismatch: false,
      google_canonical: 'https://acme.com/services/turf', last_crawl: '2026-11-01T00:00:00Z',
    });
    expect(turf.speed).toEqual({ score: 62, lcp_ms: 3100, inp_ms: 180, cls: 0.05, field: { lcp_ms: 2900, inp_ms: 150, cls: 0.04, origin_fallback: false } });
    expect(turf.top_queries).toHaveLength(5);
    expect(turf.top_queries[0]).toEqual({ query: 'q0', clicks: 7, impressions: 100, position: 5 });
    expect(about).toMatchObject({ fixes: [], speed: null, top_queries: [] });
    expect(about.index.coverage_state).toBe('Crawled - currently not indexed');
    expect(home).toMatchObject({ fixes: [], index: null, top_queries: [] });
    expect(home.speed.score).toBe(90);
    expect(r.pages.find((p) => p.page.includes('broken'))).toBeUndefined();
  });

  it('when two addresses share a path, the page card shows the indexed one, not the redirect', async () => {
    const inspection = [
      { url: 'https://www.acme.com/', verdict: 'PASS', coverage_state: 'Submitted and indexed', canonical_mismatch: false },
      { url: 'https://acme.com/', verdict: 'NEUTRAL', coverage_state: 'Page with redirect', canonical_mismatch: false },
    ];
    const pagespeed = [
      { status: 'ok', url: 'https://www.acme.com/', score: 76 },
      { status: 'ok', url: 'https://acme.com/', score: 70 },
    ];
    const j = job({
      'pass:technical': { status: 'done' }, 'pass:content': { status: 'done' }, 'pass:local': { status: 'done' },
      'pass:conversion': { status: 'done' }, synthesize: { status: 'running', attempts: 1 },
    }, {
      data: { crawl, sources: { inspection, pagespeed }, gaps: [], sharedContext: 'ctx' },
      passes: {
        technical: { findings: [], tasks: [] }, content: { findings: [], tasks: [], pages: [] },
        local: { findings: [], tasks: [] }, conversion: { skipped: true, findings: [], tasks: [] },
      },
    });
    const home = (await runStep(j, 'synthesize')).patch.result.pages.find((p) => p.page === '/');
    expect(home.index.coverage_state).toBe('Submitted and indexed');
    expect(home.speed.score).toBe(76);
  });

  const chunkReply = (input, extra = {}) => ({
    output: { findings: [], tasks: [], pages: input.pages.map((p) => ({ page: p.url, fixes: [] })), ...extra },
  });

  it('content tasks get the exact text of the fixes they name', async () => {
    m.runStructured.mockImplementation(async ({ input }) => {
      if (input.chunk !== 1) return chunkReply(input);
      const pages = input.pages.map((p) => ({ page: p.url, fixes: [] }));
      pages[1].fixes = [
        { id: 'F1', change: 'Keep the current meta description.', targets_queries: [] },
        { id: 'F2', change: 'Replace the title with: "Turf Installation in Las Vegas, NV | Acme"', targets_queries: ['turf las vegas'] },
      ];
      return {
        output: {
          findings: [],
          pages,
          tasks: [{ ...task('Rewrite the p0 title', '/p0/', 'Rewrite the title. Exact text is in the page fixes.'), fix_ids: ['F2'] }],
        },
      };
    });
    const res = await runStep(job({}, { data: { crawl, sources: {}, sharedContext: 'ctx' } }), 'pass:content');
    const [t] = res.patch['passes.content'].tasks;
    expect(t.page).toBe('/p0');
    expect(t.change).toBe('Rewrite the title.\nReplace the title with: "Turf Installation in Las Vegas, NV | Acme"');
    expect(t).not.toHaveProperty('fix_ids');
  });

  it('a degenerate content chunk (no pages, empty task) is failed; the others still count', async () => {
    m.runStructured.mockImplementation(async ({ input }) => (input.chunk === 2
      ? { output: { findings: [], pages: [], tasks: [{ ...task('x'), change: '', why: '' }] } }
      : chunkReply(input, { tasks: [task('Rewrite the home title')] })));
    const res = await runStep(job({}, { data: { crawl, sources: {}, sharedContext: 'ctx' } }), 'pass:content');
    expect(res.ok).toBe(true);
    const out = res.patch['passes.content'];
    expect(out.tasks.map((t) => t.id)).toEqual(['CONT-1-1']);
    expect(out.pages.map((p) => p.page)).toEqual(['/', '/p0', '/p1', '/p2']);
    expect(res.gaps).toEqual(["Content & keywords analysis didn't cover /p3, /p4 — rerun to include them"]);
  });

  it('a chunk that errors is listed as uncovered when another chunk succeeded', async () => {
    m.runStructured.mockImplementation(async ({ input }) => {
      if (input.chunk === 1) throw Object.assign(new Error('Declined'), { code: 'refusal' });
      return chunkReply(input);
    });
    const res = await runStep(job({}, { data: { crawl, sources: {}, sharedContext: 'ctx' } }), 'pass:content');
    expect(res.ok).toBe(true);
    expect(res.gaps[0]).toBe("Content & keywords analysis didn't cover /, /p0, /p1, /p2 — rerun to include them");
  });

  it('every content chunk failing fails the step', async () => {
    m.runStructured.mockResolvedValue({ output: { findings: [], tasks: [], pages: [] } });
    const res = await runStep(job({}, { data: { crawl, sources: {}, sharedContext: 'ctx' } }), 'pass:content');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Content chunk 1 was incomplete/);
  });

  it('other passes get path pages and lose tasks without a change or reason', async () => {
    m.runStructured.mockResolvedValue({
      output: { findings: [], tasks: [task('Fix the canonical', 'https://acme.com/about/'), { ...task('Fix robots'), why: '' }] },
    });
    const res = await runStep(job({}, { data: { crawl, sources: {}, sharedContext: 'ctx' } }), 'pass:technical');
    const tasks = res.patch['passes.technical'].tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].page).toBe('/about');
  });

  it('synthesis cannot add data gaps and the list has no duplicates', async () => {
    m.runStructured.mockResolvedValue({
      output: { client_summary: 'S', top_moves: [], scores: {}, data_gaps: ['Invented gap.'], drop_task_ids: [] },
    });
    const j = job({
      'pass:technical': { status: 'done' }, 'pass:content': { status: 'done' }, 'pass:local': { status: 'done' },
      'pass:conversion': { status: 'done' }, synthesize: { status: 'running', attempts: 1 },
    }, {
      data: { crawl, sources: {}, gaps: [{ source: 'ga4', status: 'no_property' }], sharedContext: 'ctx' },
      passes: { technical: { tasks: [] }, content: { tasks: [], pages: [] }, local: { tasks: [] }, conversion: { skipped: true, tasks: [] } },
      gaps: ['ga4 unavailable', 'Crawl stopped early after 6 pages because the site responded slowly.'],
    });
    const r = (await runStep(j, 'synthesize')).patch.result;
    expect(r.data_gaps).toEqual(['ga4 unavailable', 'Crawl stopped early after 6 pages because the site responded slowly.']);
  });

  describe('result.reputation', () => {
    const base = (statuses, extra) => job({
      'pass:technical': { status: 'done' }, 'pass:content': { status: 'done' }, 'pass:local': { status: 'done' },
      'pass:conversion': { status: 'done' }, synthesize: { status: 'running', attempts: 1 }, ...statuses,
    }, {
      passes: { technical: { tasks: [] }, content: { tasks: [], pages: [] }, local: { tasks: [] }, conversion: { skipped: true, tasks: [] } },
      ...extra,
    });
    const synth = () => m.runStructured.mockResolvedValue({
      output: { client_summary: 'S', top_moves: [], scores: {}, drop_task_ids: [] },
    });
    const stats = { rating: 4.6, total: 120 };
    const reviews = [
      { source: 'places', id: 'p1', name: 'Acme Turf', city: 'Austin', coverage: 'sample', stats },
      { source: 'places', id: 'p2', name: 'Acme Lawn', city: 'Dallas', coverage: 'sample', stats },
    ];
    const aiSearch = {
      status: 'ok',
      queries: [
        { query: 'turf austin', you_appear: true, results: [
          { title: 'a', url: 'https://www.acme.com/', host: 'www.acme.com' },
          { title: 'b', url: 'https://b.com/x', host: 'b.com' },
          { title: 'c', url: 'https://b.com/y', host: 'b.com' },
          { title: 'd', url: 'https://c.com/', host: 'c.com' },
          { title: 'e', url: 'https://d.com/', host: 'd.com' },
          { title: 'f', url: 'https://e.com/', host: 'e.com' },
        ] },
        { query: 'turf dallas', you_appear: false, results: [] },
      ],
      notes: [],
    };
    const reputationPass = {
      findings: [{ title: 'rf' }], tasks: [],
      themes: [{ kind: 'praise', theme: 'Fast', count: 4, location: 'Acme Turf', quotes: ['Great'] }],
      search_summary: { summary: 'You show up in one of two.', competitors: [], cited_sites: [] },
    };

    it('result.reputation built from stats, themes and search', async () => {
      synth();
      const j = base({ 'pass:reputation': { status: 'done' } }, {
        data: { crawl, sources: { reviews, aiSearch }, sharedContext: 'ctx' },
        passes: { technical: { tasks: [] }, content: { tasks: [], pages: [] }, local: { tasks: [] }, conversion: { skipped: true, tasks: [] }, reputation: reputationPass },
      });
      const r = (await runStep(j, 'synthesize')).patch.result;
      expect(r.reputation.locations[0]).toEqual({ name: 'Acme Turf', city: 'Austin', source: 'places', coverage: 'sample', stats });
      expect(r.reputation.themes).toEqual(reputationPass.themes);
      expect(r.reputation.search).toEqual({
        appear_count: 1, total: 2, summary: 'You show up in one of two.',
        queries: [
          { query: 'turf austin', you_appear: true, others: ['b.com', 'c.com', 'd.com'] },
          { query: 'turf dallas', you_appear: false, others: [] },
        ],
      });
      expect(r.findings.reputation).toEqual([{ title: 'rf' }]);
      expect(r.passes_completed.reputation).toBe(true);
    });

    it('queries that errored are kept with their error and left out of the counts', async () => {
      synth();
      const mixed = { status: 'ok', notes: [], queries: [
        { query: 'turf austin', you_appear: true, results: [] },
        { query: 'turf dallas', you_appear: false, results: [] },
        { query: 'turf waco', you_appear: false, results: [], error: 'not searched' },
      ] };
      const j = base({ 'pass:reputation': { status: 'done' } }, {
        data: { crawl, sources: { reviews, aiSearch: mixed }, sharedContext: 'ctx' },
        passes: { technical: { tasks: [] }, content: { tasks: [], pages: [] }, local: { tasks: [] }, conversion: { skipped: true, tasks: [] }, reputation: reputationPass },
      });
      const s = (await runStep(j, 'synthesize')).patch.result.reputation.search;
      expect(s.appear_count).toBe(1);
      expect(s.total).toBe(2);
      expect(s.queries[2]).toEqual({ query: 'turf waco', you_appear: false, error: 'not searched', others: [] });
      expect(s.queries[0]).not.toHaveProperty('error');
    });

    it('tolerates review locations slimmed off the job (no stats, no city), e.g. a retried failed job', async () => {
      synth();
      const slim = [{ source: 'places', id: 'p1', name: 'Acme Turf', coverage: 'sample' }];
      const j = base({ 'pass:reputation': { status: 'done' } }, {
        data: { crawl, sources: { reviews: slim, aiSearch }, sharedContext: 'ctx' },
        passes: { technical: { tasks: [] }, content: { tasks: [], pages: [] }, local: { tasks: [] }, conversion: { skipped: true, tasks: [] }, reputation: reputationPass },
      });
      const res = await runStep(j, 'synthesize');
      expect(res.ok).toBe(true);
      expect(res.patch.result.reputation.locations).toEqual([{ name: 'Acme Turf', city: undefined, source: 'places', coverage: 'sample', stats: undefined }]);
    });

    it('every query erroring gives total 0', async () => {
      synth();
      const none = { status: 'ok', notes: [], queries: [{ query: 'a', you_appear: false, results: [], error: 'x' }] };
      const j = base({ 'pass:reputation': { status: 'done' } }, {
        data: { crawl, sources: { reviews, aiSearch: none }, sharedContext: 'ctx' },
        passes: { technical: { tasks: [] }, content: { tasks: [], pages: [] }, local: { tasks: [] }, conversion: { skipped: true, tasks: [] }, reputation: reputationPass },
      });
      const s = (await runStep(j, 'synthesize')).patch.result.reputation.search;
      expect(s.total).toBe(0);
      expect(s.appear_count).toBe(0);
    });

    it('quick result has reputation stats and no themes', async () => {
      synth();
      const j = base({ 'pass:reputation': { status: 'done', skipped: true } }, {
        auditType: 'quick', data: { crawl, sources: { reviews }, sharedContext: 'ctx' },
      });
      const r = (await runStep(j, 'synthesize')).patch.result;
      expect(r.reputation.locations).toHaveLength(2);
      expect(r.reputation.themes).toEqual([]);
      expect(r.reputation.search).toBeNull();
      expect(r.findings).not.toHaveProperty('reputation');
      expect(r.passes_completed).not.toHaveProperty('reputation');
    });

    it('a failed reputation pass keeps stats, drops summary and is reported incomplete', async () => {
      synth();
      const j = base({ 'pass:reputation': { status: 'failed_final' } }, {
        data: { crawl, sources: { reviews, aiSearch }, sharedContext: 'ctx' },
      });
      const r = (await runStep(j, 'synthesize')).patch.result;
      expect(r.reputation.search.summary).toBeNull();
      expect(r.reputation.themes).toEqual([]);
      expect(r.passes_completed.reputation).toBe(false);
    });

    it('attribution set only for public data', async () => {
      synth();
      const mk = (src) => base({ 'pass:reputation': { status: 'done', skipped: true } }, {
        data: { crawl, sources: { reviews: [{ ...reviews[0], source: src }] }, sharedContext: 'ctx' },
      });
      expect((await runStep(mk('places'), 'synthesize')).patch.result.reputation.attribution).toBe('Source: Google reviews');
      expect((await runStep(mk('gbp'), 'synthesize')).patch.result.reputation.attribution).toBeNull();
    });

    it('no reputation key when neither source exists', async () => {
      synth();
      const j = base({ 'pass:reputation': { status: 'done', skipped: true } }, { data: { crawl, sources: {}, sharedContext: 'ctx' } });
      const r = (await runStep(j, 'synthesize')).patch.result;
      expect(r).not.toHaveProperty('reputation');
    });

    it('an old job without the reputation step is not reported incomplete', async () => {
      synth();
      const j = base({}, { data: { crawl, sources: {}, sharedContext: 'ctx' } });
      j.steps = j.steps.filter((s) => s.key !== 'pass:reputation' && s.key !== 'search');
      const r = (await runStep(j, 'synthesize')).patch.result;
      expect(m.runStructured.mock.calls[0][0].input.passes_not_completed).toBeUndefined();
      expect(r.passes_completed).not.toHaveProperty('reputation');
    });
  });

  it('a sitemap read cut short becomes a job gap', async () => {
    m.seedPages.mockResolvedValue([]);
    m.crawlSite.mockResolvedValue({ ...crawl, sitemap_partial: true });
    const res = await runStep(job(), 'crawl');
    expect(res.gaps).toEqual(['Reading the sitemaps stopped early because they were slow to load, so the sitemap check is incomplete.']);
  });

  it('never throws', async () => {
    m.seedPages.mockRejectedValue(new Error('boom'));
    expect(await runStep(job(), 'crawl')).toEqual({ ok: false, error: 'boom' });
  });
});

describe('runStep with picked data sources', () => {
  it('passes a chosen Search Console property to seeding and gathering, and a chosen GA4 property to gathering', async () => {
    m.seedPages.mockResolvedValue([]);
    m.crawlSite.mockResolvedValue(crawl);
    const options = { pages: [], onlyListed: false, skip: [], pageCount: null, gscSite: 'sc-domain:acme.com', ga4Property: { id: 'properties/9', name: 'Acme', account: 'A' } };
    await runStep(job({}, { options }), 'crawl');
    expect(m.seedPages.mock.calls[0][3]).toEqual({ gscSite: 'sc-domain:acme.com' });
    m.gatherAll.mockResolvedValue({ data: {}, gaps: [] });
    await runStep(job({}, { data: { crawl }, options }), 'gather');
    expect(m.gatherAll.mock.calls[0][0]).toMatchObject({ gscSite: 'sc-domain:acme.com', ga4Property: { id: 'properties/9' } });
  });
});

describe('runStep gather reviews', () => {
  const reviewLoc = { source: 'places', id: 'p1', name: 'Acme', city: 'Tampa', region: 'FL', coverage: 'sample', stats: { rating: 4.5 } };

  it('caches review text by job id and keeps it out of the patch', async () => {
    const texts = { p1: [{ stars: 5, date: '2026-01-01', text: 'Great' }] };
    m.gatherAll.mockResolvedValue({ data: { reviews: [reviewLoc] }, gaps: [], reviewTexts: texts });
    const j = job({}, { data: { crawl } });
    const res = await runStep(j, 'gather');
    expect(m.saveReviewTexts).toHaveBeenCalledWith(j.id, texts);
    const stored = res.patch['data.sources'].reviews[0];
    expect(stored).not.toHaveProperty('reviews');
    expect(JSON.stringify(res.patch)).not.toContain('Great');
  });

  it('uses picked locations, else saved ones, and survives lookup and save failures', async () => {
    m.gatherAll.mockResolvedValue({ data: {}, gaps: [], reviewTexts: { p1: [] } });
    const picked = [{ source: 'places', id: 'a', name: 'A' }];
    await runStep(job({}, { data: { crawl }, options: { pages: [], skip: [], locations: picked } }), 'gather');
    expect(m.gatherAll.mock.calls[0][0].locations).toBe(picked);
    expect(m.getSavedLocations).not.toHaveBeenCalled();

    const saved = [{ source: 'places', id: 's', name: 'S' }];
    m.getSavedLocations.mockResolvedValue(saved);
    await runStep(job({}, { data: { crawl } }), 'gather');
    expect(m.gatherAll.mock.calls[1][0].locations).toBe(saved);

    // an explicit empty pick list means "no locations": neither saved picks nor auto-match
    m.getSavedLocations.mockClear();
    const none = [];
    await runStep(job({}, { data: { crawl }, options: { pages: [], skip: [], locations: none } }), 'gather');
    expect(m.gatherAll.mock.calls[2][0].locations).toBe(none);
    expect(m.getSavedLocations).not.toHaveBeenCalled();
    m.gatherAll.mockClear();
    m.gatherAll.mockResolvedValue({ data: {}, gaps: [], reviewTexts: { p1: [] } });
    m.getSavedLocations.mockRejectedValue(new Error('db down'));
    m.saveReviewTexts.mockRejectedValue(new Error('db down'));
    const res = await runStep(job({}, { data: { crawl } }), 'gather');
    expect(m.gatherAll.mock.calls[0][0].locations).toBeNull();
    expect(res.ok).toBe(true);
  });
});

describe('runStep search', () => {
  const sources = {
    gscPages: [{ page: 'https://acme.com/', queries: [{ query: 'turf installation', impressions: 50 }] }],
    reviews: [{ source: 'places', id: 'a', name: 'A', city: 'Austin', region: 'TX' }],
  };
  const searchJob = () => job({}, { data: { crawl, sources } });
  beforeEach(() => { m.buildSearchQueries.mockReturnValue(['turf installation Austin']); });

  it('runs the web search with queries, city and region and stores the result', async () => {
    const value = { status: 'ok', queries: [], notes: 'n' };
    m.runWebSearch.mockResolvedValue(value);
    const res = await runStep(searchJob(), 'search');
    const arg = m.runWebSearch.mock.calls[0][0];
    expect(arg).toMatchObject({ domain: 'acme.com', city: 'Austin', region: 'TX', email: 'a@lilikoiagency.com' });
    expect(arg.queries[0]).toBe('turf installation Austin');
    expect(res).toEqual({ ok: true, patch: { 'data.sources.aiSearch': value } });
  });

  it('falls back to the crawl contact address for city and region when no review location has one', async () => {
    m.runWebSearch.mockResolvedValue({ status: 'ok', queries: [], notes: '' });
    const withAddress = (address) => job({}, { data: {
      crawl: { ...crawl, site_wide: { contact_info: { addresses: [address] } } },
      sources: { ...sources, reviews: [] },
    } });
    await runStep(withAddress('123 Main St, Tampa, FL 33602'), 'search');
    expect(m.runWebSearch.mock.calls[0][0]).toMatchObject({ city: 'Tampa', region: 'FL' });
    await runStep(withAddress('Suite 4, Fort Worth, TX'), 'search');
    expect(m.runWebSearch.mock.calls[1][0]).toMatchObject({ city: 'Fort Worth', region: 'TX' });
    await runStep(withAddress('somewhere along the highway'), 'search');
    expect(m.runWebSearch.mock.calls[2][0]).toMatchObject({ city: null, region: null });
    await runStep(job({}, { data: { crawl, sources: { ...sources, reviews: null } } }), 'search');
    expect(m.runWebSearch.mock.calls[3][0]).toMatchObject({ city: null, region: null });
  });

  it('review location city wins over the crawl address', async () => {
    m.runWebSearch.mockResolvedValue({ status: 'ok', queries: [], notes: '' });
    await runStep(job({}, { data: { crawl: { ...crawl, site_wide: { contact_info: { addresses: ['1 A St, Tampa, FL 33602'] } } }, sources } }), 'search');
    expect(m.runWebSearch.mock.calls[0][0]).toMatchObject({ city: 'Austin', region: 'TX' });
  });

  it('turns an API error into a gap, not a failed step', async () => {
    m.runWebSearch.mockResolvedValue({ status: 'error', error: 'boom', queries: [], notes: '' });
    expect(await runStep(searchJob(), 'search')).toEqual({
      ok: true, patch: { 'data.sources.aiSearch': null }, gaps: ["Web search check didn't complete."],
    });
    m.runWebSearch.mockRejectedValue(new Error('network'));
    expect((await runStep(searchJob(), 'search')).ok).toBe(true);
  });

  it('fails the step on a timeout so it retries', async () => {
    m.runWebSearch.mockRejectedValue(Object.assign(new Error('The request timed out'), { code: 'timeout' }));
    const res = await runStep(searchJob(), 'search');
    expect(res.ok).toBe(false);
  });
});
