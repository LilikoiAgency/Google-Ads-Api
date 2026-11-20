// Pure, resumable job state machine for SEO Audit v2. No I/O; `now` is always passed in.

export const STEP_KEYS = [
  'crawl', 'gather', 'search', 'pass:technical', 'pass:content', 'pass:local', 'pass:conversion',
  'pass:reputation', 'synthesize',
];

const PASS_KEYS = STEP_KEYS.filter((k) => k.startsWith('pass:'));
// Passes every audit has; "all failed" means nothing to synthesize only across these.
const CORE_PASS_KEYS = PASS_KEYS.filter((k) => k !== 'pass:reputation');
// Steps added later: jobs created before them lack the key and treat it as skipped.
const OPTIONAL_KEYS = ['search', 'pass:reputation'];
const MAX_ATTEMPTS = 3; // 1 try + 2 retries
const STALE_MS = 6 * 60 * 1000;
const EFFORTS = ['high', 'medium', 'low'];

const SEARCH_GAP = "Web search check didn't complete."; // same text runStep adds on a soft failure

const PASS_AREA = {
  'pass:technical': 'Technical & indexing',
  'pass:content': 'Content & keywords',
  'pass:local': 'Local & AI search',
  'pass:conversion': 'Conversion',
  'pass:reputation': 'Reputation',
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
      key,
      ...(auditType === 'quick' && OPTIONAL_KEYS.includes(key)
        ? { status: 'done', skipped: true }
        : { status: 'pending' }),
      attempts: 0, startedAt: null, finishedAt: null, error: null,
    })),
    gaps: [],
    createdAt: t,
    updatedAt: t,
  };
}

const find = (job, key) => {
  const step = job.steps.find((s) => s.key === key);
  if (!step) {
    if (OPTIONAL_KEYS.includes(key)) return { key, status: 'done', skipped: true };
    throw new Error(`Unknown step: ${key}`);
  }
  return step;
};

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
  if (STEP_KEYS.some((k) => st(k).status === 'failed_final' && !k.startsWith('pass:') && k !== 'search')) return [];

  if (st('crawl').status !== 'done') return available(st('crawl'), now) ? ['crawl'] : [];
  if (st('gather').status !== 'done') return available(st('gather'), now) ? ['gather'] : [];

  const finished = (k) => st(k).status === 'done' || st(k).status === 'failed_final';
  // Reputation reads the search result, so it waits until search has settled.
  const open = ['search', ...PASS_KEYS]
    .filter((k) => !finished(k) && (k !== 'pass:reputation' || finished('search')));
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
  if (job.status === 'done' || job.status === 'failed') {
    throw new Error(`Cannot start ${key}: job is ${job.status}`);
  }
  if (!available(step, now)) throw new Error(`Step ${key} is not startable (status ${step.status})`);
  const next = withStep(job, key, {
    status: 'running', startedAt: iso(now), finishedAt: null, attempts: step.attempts + 1,
  }, now);
  return { ...next, status: 'running' };
}

// Status implied by the steps of a job that has started.
export function jobStatus(job) {
  const status = (k) => find(job, k).status;
  if (['crawl', 'gather', 'synthesize'].some((k) => status(k) === 'failed_final')) return 'failed';
  if (CORE_PASS_KEYS.every((k) => status(k) === 'failed_final')) return 'failed'; // nothing to synthesize
  if (status('synthesize') === 'done') return 'done';
  return 'running';
}

function settle(job) {
  job.status = jobStatus(job);
  return job;
}

function failFinal(job, key, error, now) {
  const next = withStep(job, key, { status: 'failed_final', finishedAt: iso(now), error }, now);
  if (PASS_AREA[key]) {
    next.gaps = [...(job.gaps || []), `${PASS_AREA[key]} analysis didn't complete — rerun to include it`];
  }
  if (key === 'search' && !(job.gaps || []).includes(SEARCH_GAP)) next.gaps = [...(job.gaps || []), SEARCH_GAP];
  return next;
}

// Attempts are counted at start (markRunning), so a step killed mid-run still uses one.
export function applyStepResult(job, key, { ok, error } = {}, now) {
  const step = find(job, key);
  if (step.status !== 'running') return job; // late/duplicate result
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

// attemptNumber is 1-based (step.attempts after markRunning): 1 -> base, 2 -> one level down, 3 -> two (floor 'low').
export function effortForAttempt(baseEffort, attemptNumber) {
  const base = Math.max(0, EFFORTS.indexOf(baseEffort));
  return EFFORTS[Math.min(EFFORTS.length - 1, base + Math.max(0, attemptNumber - 1))];
}

// Backs UI Retry on a failed job: resets blocking failed_final steps so it resumes (not a new use).
export function resetFailed(job, now) {
  if (job.status !== 'failed') return job;
  const resetKeys = new Set(
    ['crawl', 'gather', 'synthesize'].filter((k) => find(job, k).status === 'failed_final'),
  );
  if (CORE_PASS_KEYS.every((k) => find(job, k).status === 'failed_final')) CORE_PASS_KEYS.forEach((k) => resetKeys.add(k));
  const gapFor = new Set([...resetKeys].filter((k) => PASS_AREA[k]).map((k) => `${PASS_AREA[k]} analysis didn't complete — rerun to include it`));
  return {
    ...job,
    status: 'running',
    steps: job.steps.map((s) => (resetKeys.has(s.key)
      ? { ...s, status: 'pending', attempts: 0, startedAt: null, finishedAt: null, error: null }
      : s)),
    gaps: (job.gaps || []).filter((g) => !gapFor.has(g)),
    updatedAt: iso(now),
  };
}

export function shouldRefund(job) {
  return job.status === 'failed' && !job.result;
}
