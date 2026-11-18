import { describe, it, expect } from 'vitest';
import {
  STEP_KEYS, newJob, runnableSteps, applyStepResult, markRunning, effortForAttempt, shouldRefund,
} from '@/lib/seoAuditV2/jobs';

const T0 = 1_000_000;
const MIN = 60_000;
const PASSES = ['pass:technical', 'pass:content', 'pass:local', 'pass:conversion'];
const mk = () => newJob({ email: 'a@lilikoiagency.com', domain: 'x.com', auditType: 'full', now: T0 });
const ok = { ok: true };
const fail = { ok: false, error: 'boom' };
const step = (job, key) => job.steps.find((s) => s.key === key);

function finish(job, key, now = T0) {
  return applyStepResult(markRunning(job, key, now), key, ok, now);
}

describe('newJob', () => {
  it('starts queued with every step pending', () => {
    const job = mk();
    expect(job.version).toBe(2);
    expect(job.status).toBe('queued');
    expect(job.steps.map((s) => s.key)).toEqual(STEP_KEYS);
    expect(job.steps.every((s) => s.status === 'pending' && s.attempts === 0)).toBe(true);
    expect(job.gaps).toEqual([]);
  });
});

describe('runnableSteps order', () => {
  it('runs crawl, then gather, then passes, then synthesize', () => {
    let job = mk();
    expect(runnableSteps(job, T0)).toEqual(['crawl']);
    job = finish(job, 'crawl');
    expect(runnableSteps(job, T0)).toEqual(['gather']);
    job = finish(job, 'gather');
    expect(runnableSteps(job, T0)).toEqual(PASSES);
    for (const p of PASSES.slice(0, 3)) job = finish(job, p);
    expect(runnableSteps(job, T0)).toEqual(['pass:conversion']);
    job = finish(job, 'pass:conversion');
    expect(runnableSteps(job, T0)).toEqual(['synthesize']);
    job = finish(job, 'synthesize');
    expect(job.status).toBe('done');
    expect(runnableSteps(job, T0)).toEqual([]);
  });
});

describe('running steps', () => {
  it('running step under 6 minutes is not re-run', () => {
    let job = markRunning(mk(), 'crawl', T0);
    expect(step(job, 'crawl').status).toBe('running');
    expect(job.status).toBe('running');
    expect(runnableSteps(job, T0 + 6 * MIN - 1)).toEqual([]);
  });

  it('stale running step becomes runnable', () => {
    const job = markRunning(mk(), 'crawl', T0);
    expect(runnableSteps(job, new Date(T0 + 6 * MIN))).toEqual(['crawl']);
  });

  it('markRunning does not mutate its input', () => {
    const job = mk();
    markRunning(job, 'crawl', T0);
    expect(step(job, 'crawl').status).toBe('pending');
  });
});

describe('failures', () => {
  it('a failed attempt below the cap returns the step to pending', () => {
    let job = applyStepResult(markRunning(mk(), 'crawl', T0), 'crawl', fail, T0);
    expect(step(job, 'crawl')).toMatchObject({ status: 'pending', attempts: 1, error: 'boom' });
    expect(job.status).toBe('running');
    expect(runnableSteps(job, T0)).toEqual(['crawl']);
  });

  it('failed pass becomes a gap after retries', () => {
    let job = finish(finish(mk(), 'crawl'), 'gather');
    for (let i = 0; i < 3; i++) {
      job = applyStepResult(markRunning(job, 'pass:technical', T0), 'pass:technical', fail, T0);
    }
    expect(step(job, 'pass:technical').status).toBe('failed_final');
    expect(job.gaps).toEqual(["Technical & indexing analysis didn't complete — rerun to include it"]);
    for (const p of PASSES.slice(1)) job = finish(job, p);
    expect(runnableSteps(job, T0)).toEqual(['synthesize']);
    job = finish(job, 'synthesize');
    expect(job.status).toBe('done');
    expect(job.gaps).toHaveLength(1);
  });

  it('names each area in its gap', () => {
    let job = finish(finish(mk(), 'crawl'), 'gather');
    for (const p of PASSES) {
      for (let i = 0; i < 3; i++) job = applyStepResult(markRunning(job, p, T0), p, fail, T0);
    }
    expect(job.gaps).toEqual([
      "Technical & indexing analysis didn't complete — rerun to include it",
      "Content & keywords analysis didn't complete — rerun to include it",
      "Local & AI search analysis didn't complete — rerun to include it",
      "Conversion analysis didn't complete — rerun to include it",
    ]);
  });

  it('crawl failing 3 times fails the job and refunds', () => {
    let job = mk();
    for (let i = 0; i < 3; i++) {
      job = applyStepResult(markRunning(job, 'crawl', T0), 'crawl', fail, T0);
    }
    expect(step(job, 'crawl').status).toBe('failed_final');
    expect(job.status).toBe('failed');
    expect(runnableSteps(job, T0)).toEqual([]);
    expect(shouldRefund(job)).toBe(true);
  });

  it('does not refund a failed job that has a result', () => {
    expect(shouldRefund({ status: 'failed', result: { a: 1 } })).toBe(false);
    expect(shouldRefund({ status: 'done' })).toBe(false);
  });
});

describe('effortForAttempt', () => {
  it('steps down one level per retry', () => {
    expect(effortForAttempt('high', 0)).toBe('high');
    expect(effortForAttempt('high', 1)).toBe('medium');
    expect(effortForAttempt('high', 2)).toBe('low');
    expect(effortForAttempt('medium', 1)).toBe('low');
    expect(effortForAttempt('medium', 5)).toBe('low');
  });
});
