import { describe, it, expect } from 'vitest';
import {
  STEP_KEYS, newJob, runnableSteps, applyStepResult, markRunning, expireStale, effortForAttempt, shouldRefund, resetFailed, jobStatus,
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
  it('starts queued with every step pending except target keywords when there are no target pages', () => {
    const job = mk();
    expect(job.version).toBe(2);
    expect(job.status).toBe('queued');
    expect(job.steps.map((s) => s.key)).toEqual(STEP_KEYS);
    const pending = job.steps.filter((s) => s.key !== 'pass:targets');
    expect(pending.every((s) => s.status === 'pending' && s.attempts === 0)).toBe(true);
    expect(job.steps.find((s) => s.key === 'pass:targets')).toMatchObject({ status: 'done', skipped: true });
    expect(job.gaps).toEqual([]);
  });

  it('runs target keywords in quick and full audits when there are target pages', () => {
    for (const auditType of ['quick', 'full']) {
      const job = newJob({ email: 'a@lilikoiagency.com', domain: 'x.com', auditType, now: T0, targets: true });
      expect(job.steps.find((s) => s.key === 'pass:targets')).toMatchObject({ status: 'pending' });
    }
    const quick = newJob({ email: 'a@lilikoiagency.com', domain: 'x.com', auditType: 'quick', now: T0, targets: true });
    expect(quick.steps.find((s) => s.key === 'search').skipped).toBe(true);
  });

  it('a failed target keywords pass leaves a gap but the job still finishes', () => {
    let job = newJob({ email: 'a@lilikoiagency.com', domain: 'x.com', auditType: 'quick', now: T0, targets: true });
    for (const k of ['crawl', 'gather', 'pass:technical', 'pass:content', 'pass:local', 'pass:conversion']) job = finish(job, k);
    for (let i = 0; i < 3; i += 1) {
      job = markRunning(job, 'pass:targets', T0);
      job = applyStepResult(job, 'pass:targets', { ok: false, error: 'x' }, T0);
    }
    expect(job.gaps).toContain("Target keywords analysis didn't complete — rerun to include it");
    expect(runnableSteps(job, T0)).toEqual(['synthesize']);
  });
});

describe('runnableSteps order', () => {
  it('runs crawl, then gather, then passes, then synthesize', () => {
    let job = mk();
    expect(runnableSteps(job, T0)).toEqual(['crawl']);
    job = finish(job, 'crawl');
    expect(runnableSteps(job, T0)).toEqual(['gather']);
    job = finish(job, 'gather');
    expect(runnableSteps(job, T0)).toEqual(['search', ...PASSES]);
    for (const p of ['search', ...PASSES.slice(0, 3)]) job = finish(job, p);
    expect(runnableSteps(job, T0)).toEqual(['pass:conversion', 'pass:reputation']);
    job = finish(finish(job, 'pass:conversion'), 'pass:reputation');
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
    for (const p of [...PASSES.slice(1), 'search', 'pass:reputation']) job = finish(job, p);
    expect(runnableSteps(job, T0)).toEqual(['synthesize']);
    job = finish(job, 'synthesize');
    expect(job.status).toBe('done');
    expect(job.gaps).toHaveLength(1);
  });

  it('a search step that fails for good leaves a gap, once', () => {
    let job = finish(finish(mk(), 'crawl'), 'gather');
    for (let i = 0; i < 3; i++) job = applyStepResult(markRunning(job, 'search', T0), 'search', fail, T0);
    expect(step(job, 'search').status).toBe('failed_final');
    expect(job.gaps).toEqual(["Web search check didn't complete."]);
    const twice = { ...job, gaps: ["Web search check didn't complete."] };
    expect([...new Set(twice.gaps)]).toHaveLength(1);
  });

  it('does not repeat the search gap when the step already added it', () => {
    let job = { ...finish(finish(mk(), 'crawl'), 'gather'), gaps: ["Web search check didn't complete."] };
    for (let i = 0; i < 3; i++) job = applyStepResult(markRunning(job, 'search', T0), 'search', fail, T0);
    expect(job.gaps).toEqual(["Web search check didn't complete."]);
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
    // attemptNumber is 1-based (step.attempts after markRunning)
    expect(effortForAttempt('high', 1)).toBe('high');
    expect(effortForAttempt('high', 2)).toBe('medium');
    expect(effortForAttempt('high', 3)).toBe('low');
    expect(effortForAttempt('medium', 1)).toBe('medium');
    expect(effortForAttempt('medium', 2)).toBe('low');
    expect(effortForAttempt('medium', 5)).toBe('low');
  });
});

describe('stale expiry', () => {
  const stale = (job, key) => {
    for (let i = 0; i < 3; i++) job = markRunning(job, key, T0 + i * 7 * MIN);
    return job;
  };
  const later = T0 + 30 * MIN;

  it('stale step re-claimed counts an attempt', () => {
    let job = markRunning(mk(), 'crawl', T0);
    job = markRunning(job, 'crawl', T0 + 7 * MIN);
    expect(step(job, 'crawl').attempts).toBe(2);
  });

  it('third stale expiry becomes failed_final and is not runnable', () => {
    const job = stale(mk(), 'crawl');
    expect(runnableSteps(job, later)).toEqual([]);
    expect(step(expireStale(job, later), 'crawl').status).toBe('failed_final');
  });

  it('a pass expiring adds the gap', () => {
    const job = stale(finish(finish(mk(), 'crawl'), 'gather'), 'pass:content');
    const out = expireStale(job, later);
    expect(step(out, 'pass:content').status).toBe('failed_final');
    expect(out.gaps).toEqual(["Content & keywords analysis didn't complete — rerun to include it"]);
    expect(out.status).toBe('running');
  });

  it('crawl expiring fails the job', () => {
    const out = expireStale(stale(mk(), 'crawl'), later);
    expect(out.status).toBe('failed');
    expect(shouldRefund(out)).toBe(true);
  });

  it('leaves fresh running steps alone', () => {
    const job = stale(mk(), 'crawl');
    expect(expireStale(job, T0 + 14 * MIN + 1000)).toBe(job);
  });
});

const failPass = (job, p) => {
  for (let i = 0; i < 3; i++) job = applyStepResult(markRunning(job, p, T0), p, fail, T0);
  return job;
};

describe('late results are ignored', () => {
  it('late failure on a done step is ignored', () => {
    const job = finish(mk(), 'crawl');
    expect(applyStepResult(job, 'crawl', fail, T0)).toBe(job);
  });
  it('repeat failure on failed_final adds no duplicate gap', () => {
    const job = failPass(finish(finish(mk(), 'crawl'), 'gather'), 'pass:technical');
    const again = applyStepResult(job, 'pass:technical', fail, T0);
    expect(again.gaps).toHaveLength(1);
    expect(again).toBe(job);
  });
  it('ok on failed_final does not flip it', () => {
    const job = failPass(finish(finish(mk(), 'crawl'), 'gather'), 'pass:technical');
    expect(step(applyStepResult(job, 'pass:technical', ok, T0), 'pass:technical').status).toBe('failed_final');
  });
  it('result for a pending step is ignored', () => {
    const job = mk();
    expect(applyStepResult(job, 'crawl', ok, T0)).toBe(job);
  });
});

describe('markRunning guards', () => {
  it('throws on unknown step', () => {
    expect(() => markRunning(mk(), 'nope', T0)).toThrow('Unknown step: nope');
    expect(() => applyStepResult(mk(), 'nope', ok, T0)).toThrow('Unknown step: nope');
  });
  it('throws on done, fresh running, and failed_final steps', () => {
    const done = finish(mk(), 'crawl');
    expect(() => markRunning(done, 'crawl', T0)).toThrow();
    const running = markRunning(mk(), 'crawl', T0);
    expect(() => markRunning(running, 'crawl', T0 + MIN)).toThrow();
    const ff = failPass(finish(finish(mk(), 'crawl'), 'gather'), 'pass:local');
    expect(() => markRunning(ff, 'pass:local', T0)).toThrow();
  });
  it('throws when the job is done or failed', () => {
    expect(() => markRunning({ ...mk(), status: 'failed' }, 'crawl', T0)).toThrow();
    expect(() => markRunning({ ...mk(), status: 'done' }, 'crawl', T0)).toThrow();
  });
});

describe('job-level failure rules', () => {
  it('all four passes failed_final fails the job and refunds', () => {
    let job = finish(finish(mk(), 'crawl'), 'gather');
    for (const p of PASSES) job = failPass(job, p);
    expect(job.status).toBe('failed');
    expect(runnableSteps(job, T0)).toEqual([]);
    expect(shouldRefund(job)).toBe(true);
  });
  it('gather failed_final fails the job', () => {
    let job = finish(mk(), 'crawl');
    for (let i = 0; i < 3; i++) job = applyStepResult(markRunning(job, 'gather', T0), 'gather', fail, T0);
    expect(job.status).toBe('failed');
  });
  it('synthesize failed_final fails the job', () => {
    let job = finish(finish(mk(), 'crawl'), 'gather');
    for (const p of PASSES) job = finish(job, p);
    for (let i = 0; i < 3; i++) job = applyStepResult(markRunning(job, 'synthesize', T0), 'synthesize', fail, T0);
    expect(job.status).toBe('failed');
  });
});

describe('resetFailed', () => {
  it('resets a failed crawl and resumes', () => {
    let job = mk();
    for (let i = 0; i < 3; i++) job = applyStepResult(markRunning(job, 'crawl', T0), 'crawl', fail, T0);
    const out = resetFailed(job, T0 + MIN);
    expect(step(out, 'crawl')).toMatchObject({ status: 'pending', attempts: 0, error: null });
    expect(out.status).toBe('running');
    expect(runnableSteps(out, T0 + MIN)).toEqual(['crawl']);
    expect(job.status).toBe('failed');
  });
  it('resets synthesize but keeps done steps and gaps for a failed pass', () => {
    let job = finish(finish(mk(), 'crawl'), 'gather');
    job = failPass(job, 'pass:local');
    for (const p of PASSES.filter((x) => x !== 'pass:local')) job = finish(job, p);
    for (let i = 0; i < 3; i++) job = applyStepResult(markRunning(job, 'synthesize', T0), 'synthesize', fail, T0);
    const out = resetFailed(job, T0);
    expect(step(out, 'synthesize').status).toBe('pending');
    expect(step(out, 'pass:local').status).toBe('failed_final');
    expect(out.gaps).toHaveLength(1);
    expect(step(out, 'crawl').status).toBe('done');
  });
  it('resets all passes and removes their gaps when all four failed', () => {
    let job = finish(finish(mk(), 'crawl'), 'gather');
    for (const p of PASSES) job = failPass(job, p);
    const out = resetFailed(job, T0);
    expect(PASSES.every((p) => step(out, p).status === 'pending' && step(out, p).attempts === 0)).toBe(true);
    expect(out.gaps).toEqual([]);
    expect(out.status).toBe('running');
    expect(runnableSteps(out, T0)).toEqual(['search', ...PASSES]);
  });
  it('is a no-op for a job that is not failed', () => {
    const job = mk();
    expect(resetFailed(job, T0)).toBe(job);
  });
});

describe('search and reputation steps', () => {
  const mkQuick = () => newJob({ email: 'a@lilikoiagency.com', domain: 'x.com', auditType: 'quick', now: T0 });
  const oldJob = () => {
    const job = mk();
    return { ...job, steps: job.steps.filter((s) => s.key !== 'search' && s.key !== 'pass:reputation') };
  };
  const afterGather = (job) => finish(finish(job, 'crawl'), 'gather');

  it('quick jobs pre-skip search and reputation', () => {
    const quick = mkQuick();
    for (const k of ['search', 'pass:reputation']) {
      expect(step(quick, k)).toMatchObject({ status: 'done', skipped: true });
      expect(step(mk(), k).status).toBe('pending');
    }
    expect(step(quick, 'crawl').skipped).toBeUndefined();
    expect(runnableSteps(afterGather(quick), T0)).toEqual(PASSES);
  });

  it('search runs alongside passes after gather; reputation waits for search', () => {
    let job = afterGather(mk());
    const runnable = runnableSteps(job, T0);
    expect(runnable).toEqual(['search', ...PASSES]);
    expect(runnable).not.toContain('pass:reputation');
    job = finish(job, 'search');
    expect(runnableSteps(job, T0)).toContain('pass:reputation');
  });

  it('reputation becomes runnable when search fails for good', () => {
    let job = afterGather(mk());
    for (let i = 0; i < 3; i += 1) job = applyStepResult(markRunning(job, 'search', T0), 'search', fail, T0);
    expect(step(job, 'search').status).toBe('failed_final');
    expect(runnableSteps(job, T0)).toContain('pass:reputation');
  });

  it('search failing does not fail the job', () => {
    let job = afterGather(mk());
    for (let i = 0; i < 3; i += 1) job = applyStepResult(markRunning(job, 'search', T0), 'search', fail, T0);
    expect(job.status).toBe('running');
    for (const p of [...PASSES, 'pass:reputation']) job = finish(job, p);
    job = finish(job, 'synthesize');
    expect(job.status).toBe('done');
    expect(jobStatus(job)).toBe('done');
  });

  it('old job without new steps still runs and finishes', () => {
    let job = afterGather(oldJob());
    expect(runnableSteps(job, T0)).toEqual(PASSES);
    for (const p of PASSES) job = finish(job, p);
    expect(runnableSteps(job, T0)).toEqual(['synthesize']);
    job = finish(job, 'synthesize');
    expect(jobStatus(job)).toBe('done');
  });

  it('old job whose four passes all failed is still failed, and retry resets them', () => {
    let job = afterGather(oldJob());
    for (const p of PASSES) job = failPass(job, p);
    expect(jobStatus(job)).toBe('failed');
    expect(resetFailed(job, T0).status).toBe('running');
    expect(expireStale(job, T0)).toBe(job);
  });

  it('any other missing step still throws', () => {
    const job = { ...mk(), steps: mk().steps.filter((s) => s.key !== 'crawl') };
    expect(() => runnableSteps(job, T0)).toThrow('Unknown step: crawl');
  });
});
