// src/lib/apiCallLogger.js
import dbConnect from './mongoose';

const DB = 'tokensApi';
const COLLECTION = 'ApiCallLog';

let indexEnsured = false;

async function ensureTtlIndex(col) {
  if (indexEnsured) return;
  await col.createIndex({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
  indexEnsured = true;
}

export async function logMetaCall(endpoint, status, durationMs, accountId = 'unknown') {
  try {
    const client = await dbConnect();
    const col = client.db(DB).collection(COLLECTION);
    await ensureTtlIndex(col);
    await col.insertOne({ api: 'meta', endpoint, status, durationMs, accountId, timestamp: new Date() });
  } catch (err) {
    console.error('[apiCallLogger]', err.message);
  }
}
