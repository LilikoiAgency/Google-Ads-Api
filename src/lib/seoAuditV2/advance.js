// Drives an SEO Audit v2 job one phase forward per call, and shapes the
// progress the page polls. Store writes are per step and guarded, so
// concurrent callers never run or overwrite the same step.

import * as store from './jobStore';
import { runStep } from './runStep';
import { describeGaps } from './gather';
import {
  STEP_KEYS, runnableSteps, applyStepResult, expireStale, resetFailed, jobStatus, shouldRefund,
} from './jobs';

export const STEP_LABELS = {
  crawl: 'Crawling pages',
  gather: 'Reading Search Console, Analytics & page speed',
  search: 'Searching the web for the business',
  'pass:technical': 'Technical & indexing',
  'pass:content': 'Content & keywords',
  'pass:local': 'Local & AI search',
  'pass:conversion': 'Conversion',
  'pass:reputation': 'Reviews & reputation',
  synthesize: 'Building action plan',
};

const UI_STATUS = { failed_final: 'failed' };

export function toProgress(job) {
  const progress = {
    jobId: job.id,
    domain: job.domain,
    auditType: job.auditType,
    status: job.status,
    createdAt: job.createdAt,
    steps: STEP_KEYS.flatMap((key) => {
      const s = job.steps.find((x) => x.key === key);
      if (!s || s.skipped) return []; // skipped (quick audit) or absent (job predates the step)
      const step = { key, label: STEP_LABELS[key], status: UI_STATUS[s.status] || s.status };
      if (step.status === 'failed' && s.error) step.error = s.error;
      return [step];
    }),
    dataGaps: [...new Set([...describeGaps(job.data?.gaps), ...(job.gaps || [])])],
  };
  if (job.status === 'done' && job.result) {
    progress.result = job.result;
    if (job.auditId) progress.auditId = job.auditId;
  }
  return progress;
}

const stepOf = (job, key) => job.steps.find((s) => s.key === key);

// Fields of a step as applyStepResult left them, for a guarded single-step write.
function stepFields(step) {
  const { key: _key, ...fields } = step;
  return fields;
}

const newGaps = (before, after) => (after.gaps || []).filter((g) => !(before.gaps || []).includes(g));

// Persists steps that expireStale turned failed_final.
async function persistExpired(id, job, expired) {
  for (const s of job.steps) {
    const now = stepOf(expired, s.key);
    if (s.status === 'running' && now.status === 'failed_final') {
      await store.saveStep(id, s.key, { step: stepFields(now), addGaps: newGaps(job, expired), attempts: s.attempts });
    }
  }
}

// Finalizes status after step writes: done -> history, failed -> refund.
async function settleJob(id, fresh, now) {
  const status = jobStatus(fresh);
  let job = fresh;
  if (status !== fresh.status) {
    await store.setJobStatus(id, status, now);
    job = { ...fresh, status };
  }
  return finishFollowUps(job);
}

// History save for a done job, refund for a failed one. Both are one-time in the
// store (historySaved / refunded flags), so calling again on every advance of a
// finished job retries a follow-up that failed earlier and is a no-op otherwise.
async function finishFollowUps(job) {
  if (job.status === 'done') {
    const auditId = await store.saveFinished(job);
    if (auditId) return { ...job, auditId };
  }
  if (job.status === 'failed' && shouldRefund(job)) await store.refundUsage(job);
  return job;
}

// The step as the atomic claim stored it, so effort and the guarded save use
// the stored attempt count rather than a local guess.
function withClaim(job, key, claim) {
  return {
    ...job,
    status: 'running',
    steps: job.steps.map((s) => (s.key === key
      ? { ...s, status: 'running', startedAt: claim.startedAt, finishedAt: null, attempts: claim.attempts }
      : s)),
  };
}

export async function advanceJob(id) {
  const loaded = await store.getJob(id);
  if (!loaded) return null;
  if (loaded.status === 'done' || loaded.status === 'failed') return toProgress(await finishFollowUps(loaded));

  const now = new Date();
  const expired = expireStale(loaded, now);
  if (expired !== loaded) await persistExpired(id, loaded, expired);

  let job = expired;
  const claimed = [];
  for (const key of runnableSteps(job, now)) {
    const claim = await store.claimStep(id, key, now);
    if (!claim) continue; // another caller has it
    job = withClaim(job, key, claim);
    claimed.push(key);
  }

  const settled = await Promise.allSettled(claimed.map((key) => runStep(job, key)));
  const finishedAt = new Date();
  let after = job;
  for (let i = 0; i < claimed.length; i += 1) {
    const key = claimed[i];
    const res = settled[i].status === 'fulfilled'
      ? settled[i].value
      : { ok: false, error: settled[i].reason?.message || String(settled[i].reason) };
    const before = after;
    after = applyStepResult(after, key, res, finishedAt);
    await store.saveStep(id, key, {
      step: stepFields(stepOf(after, key)),
      set: res.ok ? res.patch || {} : {},
      addGaps: [...newGaps(before, after), ...(res.ok && Array.isArray(res.gaps) ? res.gaps : [])],
      attempts: stepOf(job, key).attempts,
    });
  }

  // Progress needs no crawl or pass data, so the reload leaves them out.
  const fresh = (await store.getJob(id, { light: true })) || after;
  return toProgress(await settleJob(id, fresh, finishedAt));
}

// UI Retry on a failed job: resumes from the failed step; not a new daily use.
export async function retryJob(id) {
  const job = await store.getJob(id, { light: true });
  if (!job) return { notFound: true };
  if (job.status !== 'failed') return { conflict: true, progress: toProgress(job) };
  await store.resetJob(id, resetFailed(job, new Date()));
  const fresh = (await store.getJob(id, { light: true })) || job;
  return { progress: toProgress(fresh) };
}
