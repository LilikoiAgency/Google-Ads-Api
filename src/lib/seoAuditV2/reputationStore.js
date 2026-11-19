// Mongo persistence for the reviews check of SEO Audit v2 (db tokensApi):
// saved location picks per domain, and a short-lived cache of review texts
// that the reputation step hands to the later passes.

import dbConnect from '../mongoose';
import { bareHost } from './options';

const DB = 'tokensApi';
const LOCATIONS = 'SeoAuditLocations';
const REVIEW_CACHE = 'SeoAuditPlacesCache';
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
