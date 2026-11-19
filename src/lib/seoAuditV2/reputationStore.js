// Mongo persistence for the reviews check of SEO Audit v2 (db tokensApi):
// saved location picks per domain, and a short-lived cache of review texts
// that the reputation step hands to the later passes.

import { ObjectId } from 'mongodb';
import dbConnect from '../mongoose';
import { bareHost } from './options';

const DB = 'tokensApi';
const LOCATIONS = 'SeoAuditLocations';
const REVIEW_CACHE = 'SeoAuditPlacesCache';
const JOBS = 'SeoAuditJobs';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

async function col(name) {
  const client = await dbConnect();
  return client.db(DB).collection(name);
}

let ttlIndexReady = null;
function ensureTtlIndex(collection) {
  ttlIndexReady ||= collection
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: CACHE_TTL_SECONDS })
    .catch((err) => {
      ttlIndexReady = null; // try again on the next write
      throw err;
    });
  return ttlIndexReady;
}

export async function getSavedLocations(domain) {
  const doc = await (await col(LOCATIONS)).findOne({ domain: bareHost(domain) });
  return doc?.locations || null;
}

export async function saveLocations(domain, locations) {
  await (await col(LOCATIONS)).updateOne(
    { domain: bareHost(domain) },
    { $set: { domain: bareHost(domain), locations, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function saveReviewTexts(jobId, byLocation) {
  const c = await col(REVIEW_CACHE);
  await ensureTtlIndex(c);
  await c.updateOne(
    { jobId },
    { $set: { jobId, byLocation, createdAt: new Date() } },
    { upsert: true },
  );
}

export async function getReviewTexts(jobId) {
  const doc = await (await col(REVIEW_CACHE)).findOne({ jobId });
  return doc?.byLocation || null;
}

export async function dropReviewTexts(jobId) {
  await (await col(REVIEW_CACHE)).deleteOne({ jobId });
}

const SLIM_KEYS = ['source', 'id', 'name', 'coverage'];

// A finished job keeps only { source, id, name, coverage } for public (Places)
// locations; rating, count, city and the rest were public Google data and are not
// kept on the job (the saved result holds the audit-date numbers). Idempotent: a
// slim job is left alone. Managed ('gbp') entries are untouched.
export async function slimReviewSources(jobId) {
  let _id;
  try {
    _id = new ObjectId(String(jobId));
  } catch {
    return false;
  }
  const c = await col(JOBS);
  const doc = await c.findOne({ _id }, { projection: { 'data.sources.reviews': 1 } });
  const reviews = doc?.data?.sources?.reviews;
  if (!Array.isArray(reviews)) return false;
  let changed = false;
  const slim = reviews.map((l) => {
    if (l?.source !== 'places' || Object.keys(l).every((k) => SLIM_KEYS.includes(k))) return l;
    changed = true;
    return Object.fromEntries(SLIM_KEYS.filter((k) => l[k] !== undefined).map((k) => [k, l[k]]));
  });
  if (!changed) return false;
  const res = await c.updateOne({ _id, status: { $in: ['done', 'failed'] } }, { $set: { 'data.sources.reviews': slim } });
  return res.modifiedCount === 1;
}
