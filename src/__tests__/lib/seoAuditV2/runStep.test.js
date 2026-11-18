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
  title, page, category: 'technical', impact: 4, effort: 2, confidence: 'high', evidence: ['e'], change,
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
          pages: [{ page: `p${input.chunk}`, fixes: [] }],
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
    expect(out.pages.map((p) => p.page)).toEqual(['p1', 'p2']);
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
    expect(r.pages).toEqual([{ page: 'p1', fixes: [] }]);
    expect(r.findings.technical).toEqual([{ title: 'tf' }]);
    expect(r.findings.conversion).toEqual([]);
    expect(r.data_gaps).toEqual(['ga4 unavailable', "Conversion analysis didn't complete — rerun to include it", 'GA4 is missing.']);
    expect(r.data_sources.search_console.status).toBe('ok');
    expect(r.data_sources.ga4.status).toBe('no_property');
  });

  it('never throws', async () => {
    m.seedPages.mockRejectedValue(new Error('boom'));
    expect(await runStep(job(), 'crawl')).toEqual({ ok: false, error: 'boom' });
  });
});
