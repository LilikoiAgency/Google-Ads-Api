import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/seoAuditV2/jobStore', () => ({ getJob: vi.fn() }));
vi.mock('@/lib/seoAuditV2/auditStore', () => ({
  getAudit: vi.fn(),
  claimReplan: vi.fn(),
  finishReplan: vi.fn(),
  releaseReplan: vi.fn(),
}));
vi.mock('@/lib/seoAuditV2/briefStore', () => ({ getBrief: vi.fn() }));
vi.mock('@/lib/seoAuditV2/runStep', () => ({ runStep: vi.fn() }));

const jobs = await import('@/lib/seoAuditV2/jobStore');
const audits = await import('@/lib/seoAuditV2/auditStore');
const briefs = await import('@/lib/seoAuditV2/briefStore');
const { runStep } = await import('@/lib/seoAuditV2/runStep');
const { replanAudit } = await import('@/lib/seoAuditV2/replan');
const { BRIEF_HEADING } = await import('@/lib/seoAuditV2/briefs');

const NOW = new Date('2026-11-20T12:00:00Z');
const OLD_BRIEF = { services: 'Old services', exclude: [], areas: '', notes: '' };

function makeJob() {
  return {
    id: 'j1',
    domain: 'acme.com',
    steps: { synthesize: { status: 'done' } },
    data: { sharedContext: `Site facts\n\n${BRIEF_HEADING}\nServices: Old services` },
    passes: {
      technical: { findings: [], tasks: [{ id: 'TECH-1', title: 'Fix titles' }, { id: 'TECH-2', title: 'Fix canonicals' }] },
      content: {
        findings: [],
        tasks: [{ id: 'CONT-1-1', title: 'Add a solar panels page' }, { id: 'CONT-1-2', title: 'Expand the about page' }],
        pages: [{ page: '/', fixes: [] }],
      },
      local: { findings: [], tasks: [{ id: 'LOCAL-1', title: 'Create a pool cleaning page' }] },
      targets: { tasks: [{ id: 'KW-1', title: 'Rank for roof repair' }] },
    },
  };
}

function makeAudit(overrides = {}) {
  return {
    _id: 'aud1',
    domain: 'acme.com',
    jobId: 'j1',
    auditResult: { audit_date: '2026-11-01', action_plan: [] },
    corrections: [
      { id: 'c1', kind: 'not_relevant', source_ids: ['TECH-2'] },
      { id: 'c2', kind: 'not_offered', service: 'solar panel', source_ids: ['CONT-9-9'] },
    ],
    ...overrides,
  };
}

let job;
beforeEach(() => {
  vi.clearAllMocks();
  job = makeJob();
  audits.getAudit.mockResolvedValue(makeAudit());
  audits.claimReplan.mockResolvedValue(true);
  audits.finishReplan.mockResolvedValue(undefined);
  audits.releaseReplan.mockResolvedValue(undefined);
  jobs.getJob.mockResolvedValue(job);
  briefs.getBrief.mockResolvedValue({ services: 'Roofing', exclude: ['pool cleaning'], areas: 'Tampa', notes: '' });
  runStep.mockResolvedValue({ ok: true, patch: { result: { audit_date: '2026-11-20', action_plan: [{ title: 'new' }] } } });
});

describe('replanAudit', () => {
  it('404 when the audit is missing', async () => {
    audits.getAudit.mockResolvedValue(null);
    expect(await replanAudit({ auditId: 'nope', now: NOW })).toEqual({ ok: false, status: 404, error: 'Audit not found' });
    expect(audits.claimReplan).not.toHaveBeenCalled();
  });

  it('409 when the job is gone or has no pass outputs', async () => {
    const expected = { ok: false, status: 409, error: "This audit's analysis data is no longer available." };
    jobs.getJob.mockResolvedValue(null);
    expect(await replanAudit({ auditId: 'aud1', now: NOW })).toEqual(expected);
    jobs.getJob.mockResolvedValue({ ...makeJob(), passes: undefined });
    expect(await replanAudit({ auditId: 'aud1', now: NOW })).toEqual(expected);
    audits.getAudit.mockResolvedValue(makeAudit({ jobId: undefined }));
    expect(await replanAudit({ auditId: 'aud1', now: NOW })).toEqual(expected);
    expect(audits.claimReplan).not.toHaveBeenCalled();
    expect(runStep).not.toHaveBeenCalled();
  });

  it('409 when another update holds the claim', async () => {
    audits.claimReplan.mockResolvedValue(false);
    expect(await replanAudit({ auditId: 'aud1', now: NOW }))
      .toEqual({ ok: false, status: 409, error: 'The plan is already being updated.' });
    expect(audits.claimReplan).toHaveBeenCalledWith('aud1', NOW);
    expect(runStep).not.toHaveBeenCalled();
  });

  it('removes hidden pass tasks from the job copy and swaps the brief block', async () => {
    await replanAudit({ auditId: 'aud1', now: NOW });
    expect(runStep).toHaveBeenCalledTimes(1);
    const [copy, key] = runStep.mock.calls[0];
    expect(key).toBe('synthesize');
    const ids = (k) => copy.passes[k].tasks.map((t) => t.id);
    expect(ids('technical')).toEqual(['TECH-1']); // correction source id
    expect(ids('content')).toEqual(['CONT-1-2']); // not_offered service match
    expect(ids('local')).toEqual([]); // brief exclusion match
    expect(ids('targets')).toEqual(['KW-1']);
    expect(copy.passes.content.pages).toEqual([{ page: '/', fixes: [] }]);
    expect(copy.steps).toBe(job.steps);

    const ctx = copy.data.sharedContext;
    expect(ctx.startsWith('Site facts')).toBe(true);
    expect(ctx).not.toContain('Old services');
    expect(ctx).toContain('Services: Roofing');
    expect(ctx).toContain('Do not recommend: pool cleaning');
    expect(ctx.split(BRIEF_HEADING)).toHaveLength(2);
  });

  it('never mutates the loaded job', async () => {
    await replanAudit({ auditId: 'aud1', now: NOW });
    expect(job).toEqual(makeJob());
  });

  it('drops the brief block when the website has no brief any more', async () => {
    briefs.getBrief.mockResolvedValue(null);
    await replanAudit({ auditId: 'aud1', now: NOW });
    const ctx = runStep.mock.calls[0][0].data.sharedContext;
    expect(ctx).not.toContain(BRIEF_HEADING);
    expect(ctx).toContain('Site facts');
  });

  it('on success saves the new result with the original audit date and replanned_at', async () => {
    const out = await replanAudit({ auditId: 'aud1', now: NOW });
    const result = { audit_date: '2026-11-01', action_plan: [{ title: 'new' }], replanned_at: NOW.toISOString() };
    expect(out).toEqual({ ok: true, result });
    expect(audits.finishReplan).toHaveBeenCalledWith('aud1', result);
    expect(audits.releaseReplan).not.toHaveBeenCalled();
  });

  it('on a failed synthesis releases the claim and returns 502', async () => {
    runStep.mockResolvedValue({ ok: false, error: 'model down' });
    expect(await replanAudit({ auditId: 'aud1', now: NOW }))
      .toEqual({ ok: false, status: 502, error: 'Updating the plan failed. Try again.' });
    expect(audits.releaseReplan).toHaveBeenCalledWith('aud1');
    expect(audits.finishReplan).not.toHaveBeenCalled();
  });

  it('releases the claim when loading the brief or saving throws', async () => {
    briefs.getBrief.mockRejectedValue(new Error('db'));
    expect((await replanAudit({ auditId: 'aud1', now: NOW })).status).toBe(502);
    expect(audits.releaseReplan).toHaveBeenCalledTimes(1);

    briefs.getBrief.mockResolvedValue(null);
    audits.finishReplan.mockRejectedValue(new Error('db'));
    expect((await replanAudit({ auditId: 'aud1', now: NOW })).status).toBe(502);
    expect(audits.releaseReplan).toHaveBeenCalledTimes(2);
  });
});
