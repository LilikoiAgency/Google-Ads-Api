// Mongo persistence for the company brief of SEO Audit v2 (db tokensApi):
// one brief per website, keyed by the bare host.

import dbConnect from '../mongoose';
import { bareHost } from './options';

const DB = 'tokensApi';
const BRIEFS = 'SeoAuditBriefs';
const MAX_EXCLUDE = 30;

async function col(name) {
  const client = await dbConnect();
  return client.db(DB).collection(name);
}

let indexReady = null;
function ensureIndex(collection) {
  indexReady ||= collection
    .createIndex({ domain: 1 }, { unique: true })
    .catch((err) => {
      indexReady = null; // try again on the next write
      throw err;
    });
  return indexReady;
}

export async function getBrief(domain) {
  const doc = await (await col(BRIEFS)).findOne({ domain: bareHost(domain) });
  if (!doc) return null;
  return {
    services: doc.services || '',
    exclude: doc.exclude || [],
    areas: doc.areas || '',
    notes: doc.notes || '',
  };
}

export async function saveBrief(domain, brief, email) {
  const c = await col(BRIEFS);
  const key = bareHost(domain);
  if (!brief) {
    await c.deleteOne({ domain: key });
    return;
  }
  await ensureIndex(c);
  await c.updateOne(
    { domain: key },
    {
      $set: {
        domain: key,
        services: brief.services,
        exclude: brief.exclude,
        areas: brief.areas,
        notes: brief.notes,
        updatedAt: new Date(),
        updatedBy: email || null,
      },
    },
    { upsert: true },
  );
}

// Adds one phrase to the exclusions: a case-insensitive no-op when already
// listed, ignored once the list is full. Creates the brief when there is none.
export async function addExclusion(domain, phrase, email) {
  const value = String(phrase || '').trim();
  if (!value) return;
  const c = await col(BRIEFS);
  const key = bareHost(domain);
  const doc = await c.findOne({ domain: key });
  const current = doc?.exclude || [];
  if (current.some((p) => p.toLowerCase() === value.toLowerCase())) return;
  if (current.length >= MAX_EXCLUDE) return;
  await ensureIndex(c);
  await c.updateOne(
    { domain: key },
    {
      $addToSet: { exclude: value },
      $set: { updatedAt: new Date(), updatedBy: email || null },
      $setOnInsert: { domain: key, services: '', areas: '', notes: '' },
    },
    { upsert: true },
  );
}
