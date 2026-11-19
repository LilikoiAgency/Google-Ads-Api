import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/seoAuditV2/jobStore', () => ({}));
vi.mock('@/lib/seoAuditV2/gather', () => ({ describeGaps: () => [] }));
vi.mock('@/lib/seoAuditV2/runStep', () => ({ runStep: vi.fn() }));

import { toProgress } from '@/lib/seoAuditV2/advance';
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
