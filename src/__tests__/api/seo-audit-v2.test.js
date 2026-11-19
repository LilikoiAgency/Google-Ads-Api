import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/mongoose', () => ({ default: vi.fn() }));
vi.mock('@/lib/usageLogger', () => ({ getMonthlyClaudeCost: vi.fn(), getClaudeBudgetCap: vi.fn(), logApiUsage: vi.fn() }));
vi.mock('@/lib/seoAuditV2/gather', () => ({
  describeGaps: (gaps) => (gaps || []).map((g) => `${g.source} unavailable`),
  AUDIT_PROFILES: { quick: { effort: 'medium' }, full: { effort: 'high' } },
}));
vi.mock('@/lib/seoAuditV2/jobStore', () => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  claimStep: vi.fn(),
  saveStep: vi.fn(),
  setJobStatus: vi.fn(),
  resetJob: vi.fn(),
  findReusable: vi.fn(),
  saveFinished: vi.fn(),
  getDailyUsage: vi.fn(),
  incrementUsage: vi.fn(),
  refundUsage: vi.fn(),
  listOpenJobs: vi.fn(),
}));
vi.mock('@/lib/seoAuditV2/runStep', () => ({ runStep: vi.fn() }));

const { getServerSession } = await import('next-auth');
const { getMonthlyClaudeCost, getClaudeBudgetCap } = await import('@/lib/usageLogger');
const store = await import('@/lib/seoAuditV2/jobStore');
const { runStep } = await import('@/lib/seoAuditV2/runStep');
const { newJob, STEP_KEYS } = await import('@/lib/seoAuditV2/jobs');
const { resetRateLimitMap } = await import('@/lib/seoRateLimit');
const jobsRoute = await import('@/app/api/seo-audit/v2/jobs/route.js');
const jobRoute = await import('@/app/api/seo-audit/v2/jobs/[id]/route.js');
const advanceRoute = await import('@/app/api/seo-audit/v2/jobs/[id]/advance/route.js');
const retryRoute = await import('@/app/api/seo-audit/v2/jobs/[id]/retry/route.js');

const USER = 'a@lilikoiagency.com';
const post = (body) => ({ json: async () => body });
const params = (id = 'job1') => ({ params: { id } });

// A job with the given step statuses; unspecified steps are pending.
function makeJob(statuses = {}, extra = {}) {
  const job = newJob({ email: USER, domain: 'acme.com', auditType: 'full', now: '2026-11-18T10:00:00.000Z' });
  job.id = 'job1';
  job.steps = job.steps.map((s) => (statuses[s.key]
    ? { ...s, ...(typeof statuses[s.key] === 'string' ? { status: statuses[s.key] } : statuses[s.key]) }
    : s));
  job.status = Object.keys(statuses).length ? 'running' : 'queued';
  return { ...job, ...extra };
}

const allDone = (except = {}) => Object.fromEntries(STEP_KEYS.map((k) => [k, except[k] || 'done']));
const claimAs = (attempts) => async (id, key, now) => ({ attempts, startedAt: now.toISOString() });

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitMap();
  getServerSession.mockResolvedValue({ user: { email: USER } });
  getMonthlyClaudeCost.mockResolvedValue(10);
  getClaudeBudgetCap.mockResolvedValue(100);
  store.findReusable.mockResolvedValue(null);
  store.getDailyUsage.mockResolvedValue(0);
  store.createJob.mockResolvedValue('newjob');
  store.claimStep.mockImplementation(claimAs(1));
  store.saveStep.mockResolvedValue(true);
  store.refundUsage.mockResolvedValue(true);
  store.saveFinished.mockResolvedValue('audit1');
  store.listOpenJobs.mockResolvedValue([]);
});

describe('route config', () => {
  it('every v2 route allows 300s and is dynamic', () => {
    for (const r of [jobsRoute, jobRoute, advanceRoute, retryRoute]) {
      expect(r.maxDuration).toBe(300);
      expect(r.dynamic).toBe('force-dynamic');
    }
  });
});

describe('POST /api/seo-audit/v2/jobs', () => {
  it('401 when unauthenticated', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'x@gmail.com' } });
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full' }));
    expect(res.init.status).toBe(401);
    expect(store.createJob).not.toHaveBeenCalled();
  });

  it('400 for a bad body', async () => {
    const res = await jobsRoute.POST(post({ domain: '', auditType: 'huge' }));
    expect(res.init.status).toBe(400);
    expect(store.createJob).not.toHaveBeenCalled();
  });

  it('400 for unparseable JSON', async () => {
    const res = await jobsRoute.POST({ json: async () => { throw new Error('bad'); } });
    expect(res.init.status).toBe(400);
  });

  it('creates a job for a normalized domain and counts one use', async () => {
    const res = await jobsRoute.POST(post({ domain: 'https://WWW.Acme.com/about', auditType: 'quick' }));
    expect(res.body).toMatchObject({ jobId: 'newjob', reused: false });
    const job = store.createJob.mock.calls[0][0];
    expect(job).toMatchObject({ domain: 'acme.com', auditType: 'quick', email: USER, version: 2, status: 'queued' });
    expect(job.usageDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(store.incrementUsage).toHaveBeenCalledWith(USER, job.usageDate);
  });

  it('stores validated advanced options and never reuses an earlier job for them', async () => {
    store.findReusable.mockResolvedValue({ id: 'old1', status: 'done' });
    const res = await jobsRoute.POST(post({
      domain: 'acme.com', auditType: 'quick',
      options: { pages: ['/pet-turf', 'https://www.acme.com/vegas/'], skip: ['blog/*'], pageCount: 10, onlyListed: false },
    }));
    expect(res.body).toMatchObject({ jobId: 'newjob', reused: false });
    expect(store.findReusable).not.toHaveBeenCalled();
    expect(store.createJob.mock.calls[0][0].options).toEqual({
      pages: ['https://acme.com/pet-turf', 'https://acme.com/vegas'], onlyListed: false, skip: ['/blog/*'], pageCount: 10,
    });
  });

  it('400 lists pages that are not on the audited domain, without using an audit', async () => {
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full', options: { pages: ['https://other.com/x'] } }));
    expect(res.init.status).toBe(400);
    expect(res.body.error).toMatch(/other\.com\/x/);
    expect(store.incrementUsage).not.toHaveBeenCalled();
  });

  it('empty options behave like no options (reuse allowed, nothing stored)', async () => {
    await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full', options: { pages: [], skip: [] } }));
    expect(store.findReusable).toHaveBeenCalled();
    expect(store.createJob.mock.calls[0][0].options).toBeUndefined();
  });

  it('reuse returns the existing job without a new use', async () => {
    store.findReusable.mockResolvedValue({ id: 'old1', status: 'running' });
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full' }));
    expect(res.body).toMatchObject({ jobId: 'old1', reused: true });
    expect(store.findReusable.mock.calls[0][0]).toMatchObject({ domain: 'acme.com', auditType: 'full' });
    const { todayStart } = store.findReusable.mock.calls[0][0];
    expect(todayStart).toBeInstanceOf(Date);
    expect(todayStart.toISOString()).toBe(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    expect(store.createJob).not.toHaveBeenCalled();
    expect(store.incrementUsage).not.toHaveBeenCalled();
  });

  it('forceRerun creates a new job and leaves the earlier one untouched', async () => {
    store.findReusable.mockResolvedValue({ id: 'old1', status: 'done' });
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full', forceRerun: true }));
    expect(res.body).toMatchObject({ jobId: 'newjob', reused: false });
    expect(store.findReusable).not.toHaveBeenCalled();
    expect(store.createJob).toHaveBeenCalledTimes(1);
    expect(store.saveStep).not.toHaveBeenCalled();
    expect(store.setJobStatus).not.toHaveBeenCalled();
    expect(store.resetJob).not.toHaveBeenCalled();
  });

  it('a second new job within 30 seconds is rate-limited, but reuse is not', async () => {
    const first = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'quick' }));
    expect(first.body.jobId).toBe('newjob');
    const second = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full' }));
    expect(second.init.status).toBe(429);
    expect(second.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(second.body.error).toMatch(/Too many requests/);
    expect(store.createJob).toHaveBeenCalledTimes(1);
    expect(store.incrementUsage).toHaveBeenCalledTimes(1);
    store.findReusable.mockResolvedValue({ id: 'old1', status: 'running' });
    const reused = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'quick' }));
    expect(reused.body).toMatchObject({ jobId: 'old1', reused: true });
  });

  it('the daily limit blocks a non-admin at 5', async () => {
    store.getDailyUsage.mockResolvedValue(5);
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full' }));
    expect(res.init.status).toBe(429);
    expect(store.createJob).not.toHaveBeenCalled();
    expect(store.incrementUsage).not.toHaveBeenCalled();
  });

  it('allows a non-admin at 4', async () => {
    store.getDailyUsage.mockResolvedValue(4);
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full' }));
    expect(res.body.jobId).toBe('newjob');
  });

  it('admins are exempt from the daily limit', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'frank@lilikoiagency.com' } });
    store.getDailyUsage.mockResolvedValue(9);
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full' }));
    expect(res.body.jobId).toBe('newjob');
  });

  it('the monthly budget cap blocks the run', async () => {
    getMonthlyClaudeCost.mockResolvedValue(100);
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full' }));
    expect(res.init.status).toBe(429);
    expect(res.body.limitReached).toBe(true);
    expect(store.createJob).not.toHaveBeenCalled();
    expect(store.incrementUsage).not.toHaveBeenCalled();
  });

  it('refunds the use when the job cannot be created', async () => {
    store.createJob.mockRejectedValue(new Error('db down'));
    const res = await jobsRoute.POST(post({ domain: 'acme.com', auditType: 'full' }));
    expect(res.init.status).toBe(500);
    expect(res.body.error).toBe('db down');
    expect(store.refundUsage).toHaveBeenCalled();
  });
});

describe('POST /api/seo-audit/v2/jobs/[id]/advance', () => {
  it('401 when unauthenticated', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await advanceRoute.POST({}, params());
    expect(res.init.status).toBe(401);
  });

  it('404 for an unknown job', async () => {
    store.getJob.mockResolvedValue(null);
    const res = await advanceRoute.POST({}, params());
    expect(res.init.status).toBe(404);
  });

  it('runs the crawl first and persists its output', async () => {
    const job = makeJob();
    const after = makeJob({ crawl: { status: 'done', attempts: 1 } });
    store.getJob.mockResolvedValueOnce(job).mockResolvedValueOnce(after);
    runStep.mockResolvedValue({ ok: true, patch: { 'data.crawl': { pages_crawled: [] } } });
    const res = await advanceRoute.POST({}, params());
    expect(store.claimStep).toHaveBeenCalledWith('job1', 'crawl', expect.any(Date));
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(runStep.mock.calls[0][1]).toBe('crawl');
    expect(runStep.mock.calls[0][0].steps.find((s) => s.key === 'crawl')).toMatchObject({ status: 'running', attempts: 1 });
    const [id, key, patch] = store.saveStep.mock.calls[0];
    expect([id, key]).toEqual(['job1', 'crawl']);
    expect(patch.step).toMatchObject({ status: 'done' });
    expect(patch.set).toEqual({ 'data.crawl': { pages_crawled: [] } });
    expect(patch.attempts).toBe(1);
    expect(res.body).toMatchObject({ jobId: 'job1', status: 'running' });
    expect(store.getJob.mock.calls[1]).toEqual(['job1', { light: true }]);
  });

  it('uses the attempts and start time the claim stored, for effort and the guarded save', async () => {
    // Locally the step looks fresh, but the stored claim says this is attempt 2.
    const job = makeJob(allDone({ synthesize: 'pending' }));
    store.getJob.mockResolvedValue(job);
    store.claimStep.mockResolvedValue({ attempts: 2, startedAt: '2026-11-18T10:30:00.000Z' });
    runStep.mockResolvedValue({ ok: false, error: 'refusal' });
    await advanceRoute.POST({}, params());
    const step = runStep.mock.calls[0][0].steps.find((s) => s.key === 'synthesize');
    expect(step).toMatchObject({ status: 'running', attempts: 2, startedAt: '2026-11-18T10:30:00.000Z' });
    const { effortForAttempt } = await import('@/lib/seoAuditV2/jobs');
    expect(effortForAttempt('high', step.attempts)).toBe('medium');
    const [, key, patch] = store.saveStep.mock.calls[0];
    expect(key).toBe('synthesize');
    expect(patch.attempts).toBe(2);
    expect(patch.step).toMatchObject({ status: 'pending', error: 'refusal' });
  });

  it('a truncated crawl adds its gap to the job', async () => {
    const job = makeJob();
    store.getJob.mockResolvedValue(job);
    const gap = 'Crawl stopped early after 12 pages because the site responded slowly.';
    runStep.mockResolvedValue({ ok: true, patch: { 'data.crawl': { pages_crawled: [], crawl_truncated: true } }, gaps: [gap] });
    await advanceRoute.POST({}, params());
    expect(store.saveStep.mock.calls[0][2].addGaps).toEqual([gap]);
  });

  it('advance runs the passes in parallel when runnable', async () => {
    const job = makeJob({ crawl: 'done', gather: 'done' });
    store.getJob.mockResolvedValueOnce(job).mockResolvedValueOnce(job);
    let inFlight = 0;
    let maxInFlight = 0;
    runStep.mockImplementation(async (j, key) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return { ok: true, patch: { [`passes.${key.slice(5)}`]: { tasks: [] } } };
    });
    await advanceRoute.POST({}, params());
    expect(runStep.mock.calls.map((c) => c[1]).sort()).toEqual(['pass:content', 'pass:conversion', 'pass:local', 'pass:technical', 'search']);
    expect(maxInFlight).toBe(5);
    expect(store.saveStep).toHaveBeenCalledTimes(5);
  });

  it('one failing pass does not stop the others from being saved', async () => {
    const job = makeJob({ crawl: 'done', gather: 'done' });
    store.getJob.mockResolvedValue(job);
    runStep.mockImplementation(async (j, key) => {
      if (key === 'pass:local') throw new Error('boom');
      return { ok: true, patch: {} };
    });
    await advanceRoute.POST({}, params());
    const saved = Object.fromEntries(store.saveStep.mock.calls.map(([, key, patch]) => [key, patch]));
    expect(saved['pass:technical'].step.status).toBe('done');
    expect(saved['pass:local'].step).toMatchObject({ status: 'pending', error: 'boom' });
  });

  it('atomic claim prevents double run', async () => {
    const job = makeJob({ crawl: 'done', gather: 'done' });
    store.getJob.mockResolvedValue(job);
    // Another tab already claimed technical and content.
    store.claimStep.mockImplementation(async (id, key, now) => (['pass:technical', 'pass:content'].includes(key)
      ? null
      : { attempts: 1, startedAt: now.toISOString() }));
    runStep.mockResolvedValue({ ok: true, patch: {} });
    await advanceRoute.POST({}, params());
    expect(store.claimStep).toHaveBeenCalledTimes(5);
    expect(runStep.mock.calls.map((c) => c[1]).sort()).toEqual(['pass:conversion', 'pass:local', 'search']);
    expect(store.saveStep.mock.calls.map((c) => c[1]).sort()).toEqual(['pass:conversion', 'pass:local', 'search']);
  });

  it('the second of two concurrent claims returns false so the step runs once', async () => {
    const job = makeJob();
    store.getJob.mockResolvedValue(job);
    let claimed = false;
    store.claimStep.mockImplementation(async (id, key, now) => {
      if (claimed) return null;
      claimed = true;
      return { attempts: 1, startedAt: now.toISOString() };
    });
    runStep.mockResolvedValue({ ok: true, patch: {} });
    await Promise.all([advanceRoute.POST({}, params()), advanceRoute.POST({}, params())]);
    expect(runStep).toHaveBeenCalledTimes(1);
  });

  it('a failed job refunds usage once', async () => {
    // Two crawl attempts already failed; the third fails now.
    store.getJob.mockResolvedValueOnce(makeJob({ crawl: { status: 'pending', attempts: 2 } }, { usageDate: '2026-11-18' }));
    const failed = makeJob({ crawl: { status: 'failed_final', attempts: 3, error: 'no pages' } }, { usageDate: '2026-11-18' });
    store.getJob.mockResolvedValueOnce(failed);
    store.claimStep.mockImplementation(claimAs(3));
    runStep.mockResolvedValue({ ok: false, error: 'no pages' });
    const res = await advanceRoute.POST({}, params());
    expect(store.saveStep.mock.calls[0][2].step.status).toBe('failed_final');
    expect(store.setJobStatus).toHaveBeenCalledWith('job1', 'failed', expect.any(Date));
    expect(store.refundUsage).toHaveBeenCalledTimes(1);
    expect(store.refundUsage.mock.calls[0][0]).toMatchObject({ id: 'job1', email: USER, usageDate: '2026-11-18' });
    expect(res.body.status).toBe('failed');
    expect(res.body.result).toBeUndefined();
  });

  it('a finished job is saved to history', async () => {
    const job = makeJob(allDone({ synthesize: 'pending' }));
    const done = makeJob(allDone(), { result: { version: 2, client_summary: 'Hi' } });
    store.getJob.mockResolvedValueOnce(job).mockResolvedValueOnce(done);
    runStep.mockResolvedValue({ ok: true, patch: { result: { version: 2 } } });
    const res = await advanceRoute.POST({}, params());
    expect(runStep.mock.calls[0][1]).toBe('synthesize');
    expect(store.setJobStatus).toHaveBeenCalledWith('job1', 'done', expect.any(Date));
    expect(store.saveFinished).toHaveBeenCalledWith(expect.objectContaining({ id: 'job1', status: 'done' }));
    expect(res.body.status).toBe('done');
    expect(res.body.result).toEqual({ version: 2, client_summary: 'Hi' });
    expect(store.refundUsage).not.toHaveBeenCalled();
  });

  it('does nothing for a finished job', async () => {
    store.getJob.mockResolvedValue(makeJob(allDone(), { status: 'done', result: { version: 2 } }));
    store.saveFinished.mockResolvedValue(null); // already saved
    const res = await advanceRoute.POST({}, params());
    expect(store.claimStep).not.toHaveBeenCalled();
    expect(runStep).not.toHaveBeenCalled();
    expect(res.body.status).toBe('done');
    expect(res.body.auditId).toBeUndefined();
  });

  it('a done job whose history save failed earlier is saved on the next advance', async () => {
    const done = makeJob(allDone(), { status: 'done', result: { version: 2 } });
    store.getJob.mockResolvedValue(done);
    store.saveFinished.mockResolvedValue('audit9');
    const res = await advanceRoute.POST({}, params());
    expect(store.saveFinished).toHaveBeenCalledWith(expect.objectContaining({ id: 'job1', status: 'done' }));
    expect(store.claimStep).not.toHaveBeenCalled();
    expect(res.body.auditId).toBe('audit9');
    expect(store.refundUsage).not.toHaveBeenCalled();
  });

  it('a failed job whose refund was lost is refunded once on the next advance', async () => {
    const failed = makeJob({ crawl: { status: 'failed_final', attempts: 3 } }, { status: 'failed', usageDate: '2026-11-18' });
    store.getJob.mockResolvedValue(failed);
    // The store's refunded flag makes the second call a no-op.
    store.refundUsage.mockResolvedValueOnce(true).mockResolvedValue(false);
    await advanceRoute.POST({}, params());
    await advanceRoute.POST({}, params());
    expect(store.refundUsage).toHaveBeenCalledTimes(2);
    await expect(store.refundUsage.mock.results[0].value).resolves.toBe(true);
    await expect(store.refundUsage.mock.results[1].value).resolves.toBe(false);
    expect(store.refundUsage.mock.calls[0][0]).toMatchObject({ id: 'job1', usageDate: '2026-11-18' });
    expect(store.saveFinished).not.toHaveBeenCalled();
    expect(store.claimStep).not.toHaveBeenCalled();
  });

  it('expires a stale step that used every attempt and persists it', async () => {
    const old = '2026-11-18T09:00:00.000Z';
    const job = makeJob({ crawl: 'done', gather: 'done', 'pass:technical': { status: 'running', attempts: 3, startedAt: old } });
    store.getJob.mockResolvedValue(job);
    runStep.mockResolvedValue({ ok: true, patch: {} });
    await advanceRoute.POST({}, params());
    const tech = store.saveStep.mock.calls.find((c) => c[1] === 'pass:technical');
    expect(tech[2].step).toMatchObject({ status: 'failed_final', error: 'timed out' });
    expect(tech[2].addGaps[0]).toMatch(/Technical & indexing/);
    expect(runStep.mock.calls.map((c) => c[1])).not.toContain('pass:technical');
  });

  it('responds with only the error message when something throws', async () => {
    store.getJob.mockRejectedValue(Object.assign(new Error('db down'), { code: 'E1', secret: 'x' }));
    const res = await advanceRoute.POST({}, params());
    expect(res.init.status).toBe(500);
    expect(res.body).toEqual({ error: 'db down', code: 'E1' });
  });
});

describe('GET /api/seo-audit/v2/jobs/[id]', () => {
  it('401 when unauthenticated', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await jobRoute.GET({}, params());
    expect(res.init.status).toBe(401);
  });

  it('returns progress with labels and gap sentences, without result while running', async () => {
    store.getJob.mockResolvedValue(makeJob(
      { crawl: 'done', gather: 'done', 'pass:local': 'failed_final' },
      { data: { gaps: [{ source: 'ga4', status: 'no_property' }] }, gaps: ["Local & AI search analysis didn't complete — rerun to include it"], result: { partial: true } },
    ));
    const res = await jobRoute.GET({}, params());
    expect(store.getJob).toHaveBeenCalledWith('job1', { light: true });
    expect(res.body.result).toBeUndefined();
    expect(res.body.jobId).toBe('job1');
    expect(res.body.steps.map((s) => s.label)).toEqual([
      'Crawling pages', 'Reading Search Console, Analytics & page speed', 'Searching the web for the business', 'Technical & indexing',
      'Content & keywords', 'Local & AI search', 'Conversion', 'Reviews & reputation', 'Building action plan',
    ]);
    expect(res.body.steps.find((s) => s.key === 'pass:local').status).toBe('failed');
    expect(res.body.dataGaps).toEqual(['ga4 unavailable', "Local & AI search analysis didn't complete — rerun to include it"]);
  });

  it('GET returns result only when done', async () => {
    store.getJob.mockResolvedValue(makeJob(allDone(), { status: 'done', result: { version: 2, top_moves: [] } }));
    const res = await jobRoute.GET({}, params());
    expect(res.body.status).toBe('done');
    expect(res.body.result).toEqual({ version: 2, top_moves: [] });
  });

  it('404 for an unknown job', async () => {
    store.getJob.mockResolvedValue(null);
    const res = await jobRoute.GET({}, params());
    expect(res.init.status).toBe(404);
  });
});

describe('POST /api/seo-audit/v2/jobs/[id]/retry', () => {
  it('resets a failed job without a new use', async () => {
    const failed = makeJob({ crawl: 'done', gather: { status: 'failed_final', attempts: 3, error: 'x' } }, { status: 'failed' });
    store.getJob.mockResolvedValueOnce(failed).mockResolvedValueOnce({ ...failed, status: 'running' });
    store.resetJob.mockResolvedValue(true);
    const res = await retryRoute.POST({}, params());
    const [id, next] = store.resetJob.mock.calls[0];
    expect(id).toBe('job1');
    expect(next.status).toBe('running');
    expect(next.steps.find((s) => s.key === 'gather')).toMatchObject({ status: 'pending', attempts: 0 });
    expect(store.incrementUsage).not.toHaveBeenCalled();
    expect(res.body.status).toBe('running');
  });

  it('leaves a job that is not failed alone', async () => {
    store.getJob.mockResolvedValue(makeJob({ crawl: 'running' }));
    const res = await retryRoute.POST({}, params());
    expect(store.resetJob).not.toHaveBeenCalled();
    expect(res.init.status).toBe(409);
  });
});

const { ObjectId } = await import('mongodb');
const actual = await vi.importActual('@/lib/seoAuditV2/jobStore');
const dbConnect = (await import('@/lib/mongoose')).default;

describe('jobStore (Mongo calls)', () => {
  const colls = {};
  const coll = (name) => {
    colls[name] ||= {
      updateOne: vi.fn(async () => ({ modifiedCount: 1, matchedCount: 1 })),
      findOneAndUpdate: vi.fn(async () => null),
      insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
      findOne: vi.fn(async () => null),
      find: vi.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })),
    };
    return colls[name];
  };
  const id = new ObjectId().toString();

  beforeEach(() => {
    for (const k of Object.keys(colls)) delete colls[k];
    dbConnect.mockResolvedValue({ db: (name) => { expect(name).toBe('tokensApi'); return { collection: coll }; } });
  });

  it('claimStep matches only a pending or stale running step and bumps attempts atomically', async () => {
    const now = new Date('2026-11-18T10:10:00.000Z');
    coll('SeoAuditJobs').findOneAndUpdate.mockResolvedValueOnce({
      _id: new ObjectId(id),
      steps: [{ key: 'crawl', attempts: 1, startedAt: 'x' }, { key: 'pass:technical', status: 'running', attempts: 2, startedAt: now.toISOString() }],
    });
    expect(await actual.claimStep(id, 'pass:technical', now)).toEqual({ attempts: 2, startedAt: now.toISOString() });
    const [filter, update, options] = coll('SeoAuditJobs').findOneAndUpdate.mock.calls[0];
    expect(options).toMatchObject({ returnDocument: 'after' });
    expect(filter._id.toString()).toBe(id);
    expect(filter.status).toEqual({ $nin: ['done', 'failed'] });
    const elem = filter.steps.$elemMatch;
    expect(elem.key).toBe('pass:technical');
    expect(elem.$or).toEqual(expect.arrayContaining([
      { status: 'pending' },
      { status: 'running', startedAt: { $lt: '2026-11-18T10:04:00.000Z' }, attempts: { $lt: 3 } },
    ]));
    expect(update.$inc).toEqual({ 'steps.$.attempts': 1 });
    expect(update.$set).toMatchObject({ 'steps.$.status': 'running', 'steps.$.startedAt': now.toISOString(), status: 'running' });
  });

  it('claimStep returns null when another caller got there first', async () => {
    expect(await actual.claimStep(id, 'crawl', new Date())).toBeNull();
  });

  it('getJob light leaves out the crawl, source data and pass outputs', async () => {
    await actual.getJob(id, { light: true });
    const [, options] = coll('SeoAuditJobs').findOne.mock.calls[0];
    expect(options.projection).toEqual({ 'data.crawl': 0, 'data.sources': 0, 'data.sharedContext': 0, passes: 0 });
    await actual.getJob(id);
    expect(coll('SeoAuditJobs').findOne.mock.calls[1][1]).toBeUndefined();
  });

  it('saveStep only writes while the step is still running on the same attempt', async () => {
    await actual.saveStep(id, 'crawl', { step: { status: 'done' }, set: { 'data.crawl': { a: 1 } }, addGaps: ['g'], attempts: 2 });
    const [filter, update] = coll('SeoAuditJobs').updateOne.mock.calls[0];
    expect(filter.steps.$elemMatch).toEqual({ key: 'crawl', status: 'running', attempts: 2 });
    expect(update.$set).toMatchObject({ 'steps.$.status': 'done', 'data.crawl': { a: 1 } });
    expect(update.$addToSet).toEqual({ gaps: { $each: ['g'] } });
  });

  it('saveFinished inserts a version 2 audit once with v1 score names', async () => {
    const job = {
      id, email: USER, domain: 'acme.com', auditType: 'full',
      data: { crawl: { pages_crawled: [{}, {}] } },
      result: { version: 2, scores: { seo: { score: 6 }, geo: { score: 4 }, aeo: { score: 5 } } },
    };
    const auditId = await actual.saveFinished(job);
    expect(auditId).toBeTruthy();
    const doc = coll('SeoAudits').insertOne.mock.calls[0][0];
    expect(doc).toMatchObject({
      email: USER, domain: 'acme.com', auditType: 'full', version: 2, jobId: id,
      scores: { seo: 6, geo: 4, aeo: 5, combined: 15 }, pagesCrawled: 2, auditResult: job.result,
    });
    expect(doc.createdAt).toBeInstanceOf(Date);
    coll('SeoAuditJobs').updateOne.mockResolvedValueOnce({ modifiedCount: 0, matchedCount: 0 });
    expect(await actual.saveFinished(job)).toBeNull();
    expect(coll('SeoAudits').insertOne).toHaveBeenCalledTimes(1);
  });

  it('refundUsage decrements the day of the job once', async () => {
    expect(await actual.refundUsage({ id, email: USER, usageDate: '2026-11-18' })).toBe(true);
    const [filter, update] = coll('UsageLimits').updateOne.mock.calls[0];
    expect(filter).toEqual({ email: USER, date: '2026-11-18' });
    expect(update).toEqual({ $inc: { seoAuditCount: -1 } });
    coll('SeoAuditJobs').updateOne.mockResolvedValueOnce({ modifiedCount: 0, matchedCount: 0 });
    expect(await actual.refundUsage({ id, email: USER, usageDate: '2026-11-18' })).toBe(false);
    expect(coll('UsageLimits').updateOne).toHaveBeenCalledTimes(1);
  });

  it('findReusable only reuses an in-progress or finished job created today', async () => {
    const todayStart = new Date('2026-11-18T00:00:00.000Z');
    await actual.findReusable({ domain: 'acme.com', auditType: 'full', todayStart });
    const [filter] = coll('SeoAuditJobs').findOne.mock.calls[0];
    expect(filter).toEqual({
      domain: 'acme.com',
      auditType: 'full',
      options: null,
      status: { $in: ['queued', 'running', 'done'] },
      createdAt: { $gte: '2026-11-18T00:00:00.000Z' },
    });
  });

  it('getJob returns null for a malformed id', async () => {
    expect(await actual.getJob('not-an-id')).toBeNull();
  });
});

describe('GET /api/seo-audit/history with jobs', () => {
  it('lists open jobs with their status next to saved audits marked done', async () => {
    const historyRoute = await import('@/app/api/seo-audit/history/route.js');
    const saved = [
      { _id: 'a1', domain: 'acme.com', createdAt: new Date('2026-11-18T09:00:00.000Z'), scores: { combined: 20 } },
      { _id: 'a0', domain: 'acme.com', createdAt: new Date('2026-11-16T09:00:00.000Z'), scores: { combined: 18 } },
    ];
    const find = vi.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => saved }) }) }));
    dbConnect.mockResolvedValue({ db: () => ({ collection: () => ({ find }) }) });
    store.listOpenJobs.mockResolvedValue([
      { id: 'j2', email: USER, domain: 'acme.com', auditType: 'full', status: 'running', createdAt: '2026-11-18T10:00:00.000Z' },
      { id: 'j1', email: USER, domain: 'acme.com', auditType: 'quick', status: 'failed', createdAt: '2026-11-17T10:00:00.000Z' },
    ]);
    const res = await historyRoute.GET({ url: 'http://localhost/api/seo-audit/history?domain=www.Acme.com' });
    expect(store.listOpenJobs).toHaveBeenCalledWith({ domain: 'acme.com' });
    expect(res.body.audits.map((a) => [a._id, a.status])).toEqual([
      ['j2', 'running'], ['a1', 'done'], ['j1', 'failed'], ['a0', 'done'],
    ]);
    expect(res.body.audits[0]).toMatchObject({ jobId: 'j2', version: 2, auditType: 'full' });
  });
});
