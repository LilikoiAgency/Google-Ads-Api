// Mongo persistence for SEO Audit v2 jobs (collection SeoAuditJobs in tokensApi).
// Writes target single steps with guarded filters so two tabs advancing the
// same job never run or overwrite a step twice.

import { ObjectId } from 'mongodb';
import dbConnect from '../mongoose';
import { describeOptions } from './options';

const DB = 'tokensApi';
const JOBS = 'SeoAuditJobs';
const AUDITS = 'SeoAudits';
const USAGE = 'UsageLimits';
const STALE_MS = 6 * 60 * 1000; // mirrors jobs.js
const MAX_ATTEMPTS = 3; // mirrors jobs.js

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

const iso = (now) => new Date(now).toISOString();

function withId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest, id: _id.toString() };
}

export async function createJob(job) {
  const { id: _ignored, ...doc } = job;
  const res = await (await col(JOBS)).insertOne(doc);
  return res.insertedId.toString();
}

// Fields only the step runner needs; progress reads leave them out.
const HEAVY_FIELDS = { 'data.crawl': 0, 'data.sources': 0, 'data.sharedContext': 0, passes: 0 };

// light: true skips the crawl, source data and pass outputs (keeps steps,
// gaps, data.gaps and result), for progress responses.
export async function getJob(id, { light = false } = {}) {
  const _id = oid(id);
  if (!_id) return null;
  const options = light ? { projection: HEAVY_FIELDS } : undefined;
  return withId(await (await col(JOBS)).findOne({ _id }, options));
}

// Atomic counterpart of markRunning: matches only a pending step, or a running
// step older than 6 minutes with attempts left, and bumps attempts in the same write.
// Returns the claimed step as stored ({ attempts, startedAt }), or null when
// another caller has it.
export async function claimStep(id, key, now) {
  const _id = oid(id);
  if (!_id) return null;
  const t = iso(now);
  const staleBefore = new Date(new Date(now).getTime() - STALE_MS).toISOString();
  const doc = await (await col(JOBS)).findOneAndUpdate(
    {
      _id,
      status: { $nin: ['done', 'failed'] },
      steps: {
        $elemMatch: {
          key,
          $or: [
            { status: 'pending' },
            { status: 'running', startedAt: { $lt: staleBefore }, attempts: { $lt: MAX_ATTEMPTS } },
            { status: 'running', startedAt: null, attempts: { $lt: MAX_ATTEMPTS } },
          ],
        },
      },
    },
    {
      $set: {
        'steps.$.status': 'running',
        'steps.$.startedAt': t,
        'steps.$.finishedAt': null,
        status: 'running',
        updatedAt: t,
      },
      $inc: { 'steps.$.attempts': 1 },
    },
    { returnDocument: 'after', projection: { steps: 1 } },
  );
  const step = doc?.steps?.find((s) => s.key === key);
  return step ? { attempts: step.attempts, startedAt: step.startedAt } : null;
}

// patch: { step: fields of the step, set: other dotted fields (step outputs),
// addGaps: gap sentences to add, attempts: the attempt this result belongs to }.
// Writes only while the step is still running on that attempt, so a late result
// from a run that was taken over is dropped.
export async function saveStep(id, key, { step = {}, set = {}, addGaps = [], attempts } = {}) {
  const _id = oid(id);
  if (!_id) return false;
  const elem = { key, status: 'running' };
  if (attempts != null) elem.attempts = attempts;
  const $set = { updatedAt: new Date().toISOString(), ...set };
  for (const [k, v] of Object.entries(step)) $set[`steps.$.${k}`] = v;
  const update = { $set };
  if (addGaps.length) update.$addToSet = { gaps: { $each: addGaps } };
  const res = await (await col(JOBS)).updateOne({ _id, steps: { $elemMatch: elem } }, update);
  return res.modifiedCount === 1;
}

export async function setJobStatus(id, status, now) {
  const _id = oid(id);
  if (!_id) return false;
  const res = await (await col(JOBS)).updateOne({ _id }, { $set: { status, updatedAt: iso(now) } });
  return res.modifiedCount === 1;
}

// Retry: replaces steps, gaps and status, only if the job is still failed.
export async function resetJob(id, job) {
  const _id = oid(id);
  if (!_id) return false;
  const res = await (await col(JOBS)).updateOne(
    { _id, status: 'failed' },
    { $set: { steps: job.steps, gaps: job.gaps || [], status: job.status, updatedAt: job.updatedAt } },
  );
  return res.modifiedCount === 1;
}

// A job for the domain and type created today (UTC) that is in progress or finished.
export async function findReusable({ domain, auditType, todayStart, brief }) {
  const doc = await (await col(JOBS)).findOne(
    {
      domain,
      auditType,
      // Never hand a custom-page audit to a plain request (matches missing or null).
      options: null,
      // Only an audit run with the same company brief (an old job without one matches null).
      brief: brief ?? null,
      status: { $in: ['queued', 'running', 'done'] },
      createdAt: { $gte: iso(todayStart) },
    },
    { sort: { createdAt: -1 }, projection: { data: 0, passes: 0, result: 0 } },
  );
  return withId(doc);
}

const scoreOf = (s) => (Number.isFinite(s?.score) ? s.score : null);

// Inserts the finished audit into SeoAudits once (guarded by historySaved).
export async function saveFinished(job) {
  const _id = oid(job.id);
  if (!_id) return null;
  const jobs = await col(JOBS);
  const claim = await jobs.updateOne({ _id, historySaved: { $ne: true } }, { $set: { historySaved: true } });
  if (claim.modifiedCount !== 1) return null;
  const sc = job.result?.scores || {};
  const seo = scoreOf(sc.seo);
  const geo = scoreOf(sc.geo);
  const aeo = scoreOf(sc.aeo);
  const doc = {
    email: job.email,
    domain: job.domain,
    auditType: job.auditType,
    version: 2,
    jobId: job.id,
    scores: { seo, geo, aeo, combined: [seo, geo, aeo].every((n) => n != null) ? seo + geo + aeo : null },
    // A light job has no data.crawl; the result carries the crawled page count.
    pagesCrawled: job.result?.data_sources?.crawl?.pages ?? job.data?.crawl?.pages_crawled?.length ?? 0,
    ...(job.options ? { optionsSummary: describeOptions(job.options) } : {}),
    auditResult: job.result,
    createdAt: new Date(),
  };
  try {
    const res = await (await col(AUDITS)).insertOne(doc);
    const auditId = res.insertedId.toString();
    await jobs.updateOne({ _id }, { $set: { auditId } });
    return auditId;
  } catch (err) {
    await jobs.updateOne({ _id }, { $set: { historySaved: false } });
    throw err;
  }
}

export async function getDailyUsage(email, date) {
  const doc = await (await col(USAGE)).findOne({ email, date });
  return doc?.seoAuditCount ?? 0;
}

export async function incrementUsage(email, date) {
  await (await col(USAGE)).updateOne(
    { email, date },
    { $inc: { seoAuditCount: 1 }, $setOnInsert: { email, date } },
    { upsert: true },
  );
}

// Gives back the daily use a job took, once per job (guarded by refunded).
// job.id may be absent when the job was never created.
export async function refundUsage(job) {
  const _id = job.id ? oid(job.id) : null;
  if (_id) {
    const res = await (await col(JOBS)).updateOne({ _id, refunded: { $ne: true } }, { $set: { refunded: true } });
    if (res.modifiedCount !== 1) return false;
  }
  await (await col(USAGE)).updateOne({ email: job.email, date: job.usageDate }, { $inc: { seoAuditCount: -1 } });
  return true;
}

// Jobs that are not done, for the history list (metadata only).
export async function listOpenJobs({ domain } = {}) {
  const query = { status: { $in: ['queued', 'running', 'failed'] } };
  if (domain) query.domain = domain;
  const docs = await (await col(JOBS))
    .find(query, { projection: { data: 0, passes: 0, result: 0 } })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return docs.map(withId);
}
