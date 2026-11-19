import { describe, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ getJob: vi.fn(), saveFinished: vi.fn(), dropReviewTexts: vi.fn() }));
vi.mock('@/lib/seoAuditV2/jobStore', () => ({ getJob: m.getJob, saveFinished: m.saveFinished }));
vi.mock('@/lib/seoAuditV2/reputationStore', () => ({ dropReviewTexts: m.dropReviewTexts }));
vi.mock('@/lib/seoAuditV2/gather', () => ({ describeGaps: () => [] }));
vi.mock('@/lib/seoAuditV2/runStep', () => ({ runStep: vi.fn() }));

import { toProgress, advanceJob } from '@/lib/seoAuditV2/advance';
import { newJob } from '@/lib/seoAuditV2/jobs';

const mk = (auditType) => ({ ...newJob({ email: 'a@x.com', domain: 'x.com', auditType, now: 1_000_000 }), id: 'j1' });
const keys = (p) => p.steps.map((s) => s.key);

describe('toProgress', () => {
  it('lists the new steps for a full job', () => {
    const p = toProgress(mk('full'));
    expect(keys(p)).toContain('search');
    expect(p.steps.find((s) => s.key === 'pass:reputation').label).toBe('Reviews & reputation');
    expect(p.steps.find((s) => s.key === 'search').label).toBe('Searching the web for the business');
  });

  it('omits skipped steps on a quick job', () => {
    const p = toProgress(mk('quick'));
    expect(keys(p)).not.toContain('search');
    expect(keys(p)).not.toContain('pass:reputation');
    expect(keys(p)).toContain('crawl');
  });

  it('omits steps absent from a job created before them', () => {
    const job = mk('full');
    job.steps = job.steps.filter((s) => s.key !== 'search' && s.key !== 'pass:reputation');
    expect(keys(toProgress(job))).toEqual(
      ['crawl', 'gather', 'pass:technical', 'pass:content', 'pass:local', 'pass:conversion', 'synthesize'],
    );
  });
});

describe('advanceJob on a done job', () => {
  it('done job drops cached review text', async () => {
    m.getJob.mockResolvedValue({ ...mk('full'), status: 'done', result: { version: 2 } });
    m.saveFinished.mockResolvedValue('a1');
    m.dropReviewTexts.mockResolvedValue(undefined);
    const p = await advanceJob('j1');
    expect(m.dropReviewTexts).toHaveBeenCalledWith('j1');
    expect(p.auditId).toBe('a1');
  });

  it('a failed cache drop is logged and does not break the response', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.getJob.mockResolvedValue({ ...mk('full'), status: 'done', result: { version: 2 } });
    m.saveFinished.mockResolvedValue('a1');
    m.dropReviewTexts.mockRejectedValue(new Error('db down'));
    const p = await advanceJob('j1');
    expect(p.auditId).toBe('a1');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
