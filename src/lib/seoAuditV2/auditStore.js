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
