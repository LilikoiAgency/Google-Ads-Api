// src/lib/cronGuard.js
const IDEMPOTENCY_WINDOW_MS = 8 * 60 * 1000; // 8 minutes

/**
 * Returns true if a cron job should be skipped because one ran recently.
 * @param {Date|null} lastRun
 */
export function shouldSkipCronRun(lastRun) {
  if (!lastRun) return false;
  return Date.now() - new Date(lastRun).getTime() < IDEMPOTENCY_WINDOW_MS;
}

/**
 * Reads the lastRun timestamp for a named cron job from MongoDB.
 * @param {object} db - MongoDB Db instance
 * @param {string} jobName
 * @returns {Promise<Date|null>}
 */
export async function getCronLastRun(db, jobName) {
  const doc = await db.collection('CronLocks').findOne({ jobName });
  return doc?.lastRun ?? null;
}

/**
 * Upserts the lastRun timestamp after a successful cron run.
 * @param {object} db - MongoDB Db instance
 * @param {string} jobName
 */
export async function setCronLastRun(db, jobName) {
  await db.collection('CronLocks').updateOne(
    { jobName },
    { $set: { lastRun: new Date(), jobName } },
    { upsert: true }
  );
}
