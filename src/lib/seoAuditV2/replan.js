// Re-runs the synthesis of a finished audit from its job's saved pass outputs,
// leaving out what the agency corrected and following the current company brief.

import { getJob } from './jobStore';
import { getAudit, claimReplan, finishReplan, releaseReplan } from './auditStore';
import { getBrief } from './briefStore';
import { withBrief } from './briefs';
import { runStep } from './runStep';
import { matchesExclusion } from './corrections';

const FAILED = { ok: false, status: 502, error: 'Updating the plan failed. Try again.' };

// Pass task ids to leave out: corrected source ids, plus tasks that name a
// service the business does not offer or one the brief excludes.
function hiddenIds(passes, corrections, brief) {
  const hidden = new Set();
  for (const c of corrections || []) for (const id of c.source_ids || []) hidden.add(id);
  const phrases = [
    ...(corrections || []).filter((c) => c.kind === 'not_offered' && c.service).map((c) => c.service),
    ...(brief?.exclude || []),
  ];
  if (phrases.length) {
    for (const pass of Object.values(passes)) {
      for (const t of pass?.tasks || []) if (t?.id && matchesExclusion(t, phrases)) hidden.add(t.id);
    }
  }
  return hidden;
}

// A copy of the job for the synthesis step; the loaded job is never changed.
function jobForReplan(job, hidden, brief) {
  const passes = Object.fromEntries(Object.entries(job.passes).map(([k, pass]) => [
    k,
    Array.isArray(pass?.tasks) ? { ...pass, tasks: pass.tasks.filter((t) => !hidden.has(t?.id)) } : pass,
  ]));
  return {
    ...job,
    passes,
    data: { ...job.data, sharedContext: withBrief(job.data?.sharedContext, brief) },
  };
}

/** -> { ok: true, result } | { ok: false, status, error } */
export async function replanAudit({ auditId, now = new Date() }) {
  const audit = await getAudit(auditId);
  if (!audit) return { ok: false, status: 404, error: 'Audit not found' };

  const job = audit.jobId ? await getJob(audit.jobId) : null;
  if (!job?.passes) return { ok: false, status: 409, error: "This audit's analysis data is no longer available." };

  if (!(await claimReplan(auditId, now))) return { ok: false, status: 409, error: 'The plan is already being updated.' };

  try {
    const brief = await getBrief(audit.domain);
    const copy = jobForReplan(job, hiddenIds(job.passes, audit.corrections, brief), brief);
    const step = await runStep(copy, 'synthesize');
    if (!step?.ok || !step.patch?.result) {
      console.error('[seo-audit-v2] replan failed:', step?.error);
      await releaseReplan(auditId);
      return FAILED;
    }
    const fresh = step.patch.result;
    const result = {
      ...fresh,
      audit_date: audit.auditResult?.audit_date ?? fresh.audit_date,
      replanned_at: now.toISOString(),
    };
    await finishReplan(auditId, result);
    return { ok: true, result };
  } catch (err) {
    console.error('[seo-audit-v2] replan failed:', err?.message);
    await releaseReplan(auditId).catch(() => {});
    return FAILED;
  }
}
