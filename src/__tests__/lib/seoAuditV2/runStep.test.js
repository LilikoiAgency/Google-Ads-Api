import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  crawlSite: vi.fn(),
  seedPages: vi.fn(),
  gatherAll: vi.fn(),
  runStructured: vi.fn(),
}));

vi.mock('@/lib/seoCrawler', () => ({ crawlSite: m.crawlSite }));
vi.mock('@/lib/seoAuditV2/gather', () => ({
  seedPages: m.seedPages,
  gatherAll: m.gatherAll,
  describeGaps: (gaps) => (gaps || []).map((g) => `${g.source} unavailable`),
  AUDIT_PROFILES: { quick: { effort: 'medium' }, full: { effort: 'high' } },
}));
vi.mock('@/lib/seoAuditV2/llm', () => ({ runStructured: m.runStructured }));

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

beforeEach(() => vi.clearAllMocks());

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
    expect(m.seedPages).toHaveBeenCalledWith('acme.com', 'full', 5);
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
      domain: 'acme.com', crawl, profile: 'full', priorityUrls: options.pages, onlyListed: false, skip: ['/blog/*'],
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
    expect(m.gatherAll).toHaveBeenCalledWith({ domain: 'acme.com', crawl, profile: 'full' });
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
    expect(r.passes_completed).toEqual({ technical: true, content: true, local: true, conversion: true });
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
