// Loading a saved audit for the results view: its result (as last re-planned),
// the corrections on it and whether "Update the plan" can run.

/** -> { id, doc, result, corrections, canReplan, changedAt }; throws when the load fails. */
export async function loadSavedAudit(auditId, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/seo-audit/history?id=${auditId}`);
  if (!res.ok) throw new Error("Couldn't load that audit. Try again.");
  const doc = await res.json();
  const result = doc.auditResult;
  return {
    id: doc._id || auditId,
    doc,
    result: doc.version === 2 && result && !result.version ? { ...result, version: 2 } : result,
    corrections: Array.isArray(doc.corrections) ? doc.corrections : [],
    canReplan: Boolean(doc.canReplan),
    changedAt: doc.correctionsChangedAt || null,
  };
}

// A finished job: a reused job may point at an audit that was corrected and
// re-planned since, so the saved audit wins; the job's own result is the fallback.
export async function finishedAuditView(jobResult, auditId, fetchImpl = fetch) {
  const fallback = { id: auditId || null, result: jobResult, corrections: [], canReplan: Boolean(auditId), changedAt: null };
  if (!auditId) return fallback;
  try {
    const { id, result, corrections, canReplan, changedAt } = await loadSavedAudit(auditId, fetchImpl);
    if (!result) return fallback;
    return { id, result, corrections, canReplan, changedAt };
  } catch {
    return fallback;
  }
}
