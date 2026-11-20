// Saved SEO audits (collection SeoAudits in tokensApi): corrections the agency
// records on a finished audit, and whether its job can still be re-planned.

import { ObjectId } from 'mongodb';
import dbConnect from '../mongoose';

const DB = 'tokensApi';
const AUDITS = 'SeoAudits';
const JOBS = 'SeoAuditJobs';

async function col(name) {
  const client = await dbConnect();
  return client.db(DB).collection(name);
}

function oid(id) {
  try {
    return new ObjectId(String(id));
  } catch {
    return null;
  }
}

/** The saved audit, or null for an unknown or malformed id. */
export async function getAudit(id) {
  const _id = oid(id);
  if (!_id) return null;
  return (await col(AUDITS)).findOne({ _id });
}

/** Appends a correction; returns the updated corrections array (null when the audit is gone). */
export async function addCorrection(id, correction) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await (await col(AUDITS)).findOneAndUpdate(
    { _id },
    { $push: { corrections: correction } },
    { returnDocument: 'after', projection: { corrections: 1 } }
  );
  const updated = doc && 'value' in doc && !doc._id ? doc.value : doc;
  return updated ? updated.corrections || [] : null;
}

/** Removes a correction by id; returns the updated corrections array (null when the audit is gone). */
export async function removeCorrection(id, correctionId) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await (await col(AUDITS)).findOneAndUpdate(
    { _id },
    { $pull: { corrections: { id: correctionId } } },
    { returnDocument: 'after', projection: { corrections: 1 } }
  );
  const updated = doc && 'value' in doc && !doc._id ? doc.value : doc;
  return updated ? updated.corrections || [] : null;
}

/** True when the audit's job still holds its pass outputs, so a re-plan can run. */
export async function jobCanReplan(jobId) {
  const _id = oid(jobId);
  if (!_id) return false;
  const found = await (await col(JOBS)).findOne({ _id, passes: { $exists: true } }, { projection: { _id: 1 } });
  return Boolean(found);
}

// ── re-planning ──────────────────────────────────────────────────────────────

// A claim older than this is treated as abandoned (the request is capped at 300s).
const REPLAN_STALE_MS = 6 * 60 * 1000;
const KEEP_PREVIOUS = 3;

const scoreOf = (s) => (Number.isFinite(s?.score) ? s.score : null);

// The list scores, computed as saveFinished in jobStore does.
function scoresOf(result) {
  const sc = result?.scores || {};
  const seo = scoreOf(sc.seo);
  const geo = scoreOf(sc.geo);
  const aeo = scoreOf(sc.aeo);
  return { seo, geo, aeo, combined: [seo, geo, aeo].every((n) => n != null) ? seo + geo + aeo : null };
}

/** Marks the audit as being re-planned; false when another update is still running. */
export async function claimReplan(id, now) {
  const _id = oid(id);
  if (!_id) return false;
  const staleBefore = new Date(now.getTime() - REPLAN_STALE_MS).toISOString();
  const res = await (await col(AUDITS)).updateOne(
    { _id, $or: [{ replanning: { $exists: false } }, { replanning: { $lt: staleBefore } }] },
    { $set: { replanning: now.toISOString() } },
  );
  return res.modifiedCount === 1;
}

/** Saves the new plan, keeps the last few earlier results and clears the claim. */
export async function finishReplan(id, result) {
  const _id = oid(id);
  if (!_id) return;
  const c = await col(AUDITS);
  const current = await c.findOne({ _id }, { projection: { auditResult: 1 } });
  await c.updateOne(
    { _id },
    {
      $set: { auditResult: result, scores: scoresOf(result) },
      $push: { previousResults: { $each: [current?.auditResult ?? null], $slice: -KEEP_PREVIOUS } },
      $unset: { replanning: '' },
    },
  );
}

/** Clears the claim after a failed update. */
export async function releaseReplan(id) {
  const _id = oid(id);
  if (!_id) return;
  await (await col(AUDITS)).updateOne({ _id }, { $unset: { replanning: '' } });
}
