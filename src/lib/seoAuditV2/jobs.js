// Pure, resumable job state machine for SEO Audit v2. No I/O; `now` is always passed in.

export const STEP_KEYS = [
  'crawl', 'gather', 'pass:technical', 'pass:content', 'pass:local', 'pass:conversion', 'synthesize',
];

const PASS_KEYS = STEP_KEYS.filter((k) => k.startsWith('pass:'));
const MAX_ATTEMPTS = 3; // 1 try + 2 retries
const STALE_MS = 6 * 60 * 1000;
const EFFORTS = ['high', 'medium', 'low'];

const PASS_AREA = {
  'pass:technical': 'Technical & indexing',
  'pass:content': 'Content & keywords',
  'pass:local': 'Local & AI search',
  'pass:conversion': 'Conversion',
};

const ms = (now) => (now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now));
const iso = (now) => new Date(ms(now)).toISOString();

export function newJob({ email, domain, auditType, now }) {
  const t = iso(now);
  return {
    version: 2,
    email,
    domain,
    auditType,
    status: 'queued',
    steps: STEP_KEYS.map((key) => ({
      key, status: 'pending', attempts: 0, startedAt: null, finishedAt: null, error: null,
    })),
    gaps: [],
    createdAt: t,
    updatedAt: t,
  };
}

const find = (job, key) => job.steps.find((s) => s.key === key);

function isStale(step, now) {
  const started = step.startedAt == null ? NaN : ms(step.startedAt);
  return !Number.isFinite(started) || ms(now) - started >= STALE_MS;
}

function available(step, now) {
  if (step.status === 'pending') return true;
  return step.status === 'running' && isStale(step, now) && step.attempts < MAX_ATTEMPTS;
}

export function runnableSteps(job, now) {
  if (job.status === 'done' || job.status === 'failed') return [];
  const st = (k) => find(job, k);
  if (STEP_KEYS.some((k) => st(k).status === 'failed_final' && !k.startsWith('pass:'))) return [];

  if (st('crawl').status !== 'done') return available(st('crawl'), now) ? ['crawl'] : [];
  if (st('gather').status !== 'done') return available(st('gather'), now) ? ['gather'] : [];

  const open = PASS_KEYS.filter((k) => st(k).status !== 'done' && st(k).status !== 'failed_final');
  if (open.length) return open.filter((k) => available(st(k), now));
  return available(st('synthesize'), now) ? ['synthesize'] : [];
}

function withStep(job, key, patch, now) {
  return {
    ...job,
    steps: job.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    updatedAt: iso(now),
  };
}

export function markRunning(job, key, now) {
  const step = find(job, key);
  const next = withStep(job, key, {
    status: 'running', startedAt: iso(now), finishedAt: null, attempts: step.attempts + 1,
  }, now);
  return { ...next, status: 'running' };
}

function settle(job) {
  const status = (k) => find(job, k).status;
  if (['crawl', 'gather', 'synthesize'].some((k) => status(k) === 'failed_final')) job.status = 'failed';
  else if (status('synthesize') === 'done') job.status = 'done';
  else job.status = 'running';
  return job;
}

function failFinal(job, key, error, now) {
  const next = withStep(job, key, { status: 'failed_final', finishedAt: iso(now), error }, now);
  if (PASS_AREA[key]) {
    next.gaps = [...(job.gaps || []), `${PASS_AREA[key]} analysis didn't complete — rerun to include it`];
  }
  return next;
}

// Attempts are counted at start (markRunning), so a step killed mid-run still uses one.
export function applyStepResult(job, key, { ok, error } = {}, now) {
  const step = find(job, key);
  let next;
  if (ok) {
    next = withStep(job, key, { status: 'done', finishedAt: iso(now), error: null }, now);
  } else {
    const err = error == null ? null : String(error);
    next = step.attempts >= MAX_ATTEMPTS
      ? failFinal(job, key, err, now)
      : withStep(job, key, { status: 'pending', startedAt: null, finishedAt: null, error: err }, now);
  }
  return settle(next);
}

// Turns stale running steps that have used all attempts into failed_final.
export function expireStale(job, now) {
  let next = job;
  for (const s of job.steps) {
    if (s.status === 'running' && isStale(s, now) && s.attempts >= MAX_ATTEMPTS) {
      next = failFinal(next, s.key, 'timed out', now);
    }
  }
  return next === job ? job : settle(next);
}

export function effortForAttempt(baseEffort, attempts) {
  const base = Math.max(0, EFFORTS.indexOf(baseEffort));
  return EFFORTS[Math.min(EFFORTS.length - 1, base + Math.max(0, attempts))];
}

export function shouldRefund(job) {
  return job.status === 'failed' && !job.result;
}
