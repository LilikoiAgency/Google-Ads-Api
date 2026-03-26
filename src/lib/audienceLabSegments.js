import dbConnect from "./mongoose";

const DB   = "tokensApi";
const COLL = "AudienceLabSegments";

// Slot → cron schedule mapping (10 slots, Monday 12:00–13:30 UTC)
export const SLOT_SCHEDULES = [
  "Mon 5:00 AM PT", "Mon 5:10 AM PT", "Mon 5:20 AM PT", "Mon 5:30 AM PT",
  "Mon 5:40 AM PT", "Mon 5:50 AM PT", "Mon 6:00 AM PT", "Mon 6:10 AM PT",
  "Mon 6:20 AM PT", "Mon 6:30 AM PT",
];

export const TOTAL_SLOTS = SLOT_SCHEDULES.length;

async function col() {
  const client = await dbConnect();
  return client.db(DB).collection(COLL);
}

/** Return all segments sorted by slot */
export async function getSegments() {
  const c = await col();
  return c.find({}).sort({ slot: 1 }).toArray();
}

/** Return the segment assigned to a given slot, or null */
export async function getSegmentBySlot(slot) {
  const c = await col();
  return c.findOne({ slot: Number(slot) });
}

/** Return set of occupied slot numbers */
export async function getOccupiedSlots() {
  const segments = await getSegments();
  return new Set(segments.map((s) => s.slot));
}

/** Insert a new segment. Auto-assigns next free slot if slot not specified. */
export async function createSegment({ slot, key, name, segmentId, tableId, active = true }) {
  const c = await col();

  // Auto-assign slot if not provided
  if (slot === undefined || slot === null) {
    const occupied = await getOccupiedSlots();
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (!occupied.has(i)) { slot = i; break; }
    }
    if (slot === undefined) throw new Error("All slots are occupied (max 10 segments).");
  }

  const now = new Date();
  const doc = {
    slot:            Number(slot),
    key:             key.trim().toLowerCase().replace(/\s+/g, "_"),
    name:            name.trim(),
    segmentId:       segmentId.trim(),
    tableId:         tableId.trim(),
    active:          Boolean(active),
    createdAt:       now,
    lastSyncedAt:    null,
    lastSyncStatus:  null,
    lastSyncMessage: null,
    lastSyncCount:   null,
  };

  await c.insertOne(doc);
  return doc;
}

/** Update a segment by its key */
export async function updateSegment(key, updates) {
  const c = await col();
  const allowed = ["name", "segmentId", "tableId", "active", "slot"];
  const $set = {};
  for (const field of allowed) {
    if (updates[field] !== undefined) $set[field] = updates[field];
  }
  if (updates.slot !== undefined) $set.slot = Number(updates.slot);
  return c.updateOne({ key }, { $set });
}

/** Update sync status after a run */
export async function updateSyncStatus(key, { status, message, count }) {
  const c = await col();
  return c.updateOne({ key }, {
    $set: {
      lastSyncedAt:    new Date(),
      lastSyncStatus:  status,
      lastSyncMessage: message || null,
      lastSyncCount:   count   ?? null,
    },
  });
}

// ─── Sync Logs ────────────────────────────────────────────────────────────────

const LOG_COLL = "AudienceLabSyncLogs";

async function logCol() {
  const client = await dbConnect();
  return client.db(DB).collection(LOG_COLL);
}

/**
 * Write a sync run log entry.
 * Call at the END of each sync with the final result.
 */
export async function writeSyncLog({
  segmentKey, segmentName, slot, runId, mode,
  startedAt, status, rowsInserted, sourceRecords,
  pagesFetched, durationMs, errorMessage, triggeredBy,
}) {
  const c = await logCol();
  await c.insertOne({
    segmentKey,
    segmentName:   segmentName  || segmentKey,
    slot:          Number(slot),
    runId:         runId        || null,
    mode:          mode         || "write",
    startedAt:     startedAt    || new Date(),
    completedAt:   new Date(),
    durationMs:    durationMs   ?? null,
    status,                               // "success" | "error" | "skipped"
    rowsInserted:  rowsInserted ?? 0,
    sourceRecords: sourceRecords ?? 0,
    pagesFetched:  pagesFetched  ?? 0,
    errorMessage:  errorMessage  || null,
    triggeredBy:   triggeredBy   || "cron",
  });
}

/** Return last N logs for a given segment key */
export async function getLogsForSegment(key, limit = 20) {
  const c = await logCol();
  return c.find({ segmentKey: key }).sort({ completedAt: -1 }).limit(limit).toArray();
}

/** Return last N logs across all segments (for dashboard overview) */
export async function getRecentLogs(limit = 50) {
  const c = await logCol();
  return c.find({}).sort({ completedAt: -1 }).limit(limit).toArray();
}

// ─── Activity Logs ────────────────────────────────────────────────────────────

const ACTIVITY_COLL = "AudienceLabActivityLogs";
export const ADMIN_EMAILS = ["frank@lilikoiagency.com"];

async function actCol() {
  const client = await dbConnect();
  return client.db(DB).collection(ACTIVITY_COLL);
}

export function isAdmin(email) {
  return ADMIN_EMAILS.includes((email || "").toLowerCase());
}

/**
 * Write an activity log entry whenever someone changes a segment.
 * action: "created" | "updated" | "paused" | "resumed" | "deleted"
 */
export async function writeActivityLog({ action, segmentKey, segmentName, userEmail, userName, details }) {
  const c = await actCol();
  await c.insertOne({
    action,
    segmentKey:  segmentKey  || null,
    segmentName: segmentName || segmentKey,
    userEmail:   (userEmail  || "unknown").toLowerCase(),
    userName:    userName    || userEmail?.split("@")[0] || "unknown",
    timestamp:   new Date(),
    details:     details     || {},
  });
}

/** Return recent activity across all segments */
export async function getActivityLogs(limit = 50) {
  const c = await actCol();
  return c.find({}).sort({ timestamp: -1 }).limit(limit).toArray();
}

/** Delete a segment by its key */
export async function deleteSegment(key) {
  const c = await col();
  return c.deleteOne({ key });
}

/**
 * Seed MongoDB from existing env vars on first run.
 * Only inserts if the collection is empty.
 */
export async function seedFromEnvIfEmpty() {
  const c = await col();
  const count = await c.countDocuments();
  if (count > 0) return { seeded: false };

  const legacy = [
    { slot: 0, key: "bbt_turf",              name: "BBT Interested – Turf",                  envVar: "AUDIENCE_LAB_BBT_TURF_SEGMENT_ID",              tableId: "bbt_interested_turf_segment" },
    { slot: 1, key: "cmk_kitchen_bath",       name: "CMK Kitchen & Bath Remodel",             envVar: "AUDIENCE_LAB_CMK_KITCHEN_BATH_SEGMENT_ID",      tableId: "cmk_interested_kitchen_bath_remodel_segment" },
    { slot: 2, key: "smp_roofing",            name: "SMP Interested – Roofing",               envVar: "AUDIENCE_LAB_SMP_ROOFING_SEGMENT_ID",           tableId: "smp_interested_roofing_segment" },
    { slot: 3, key: "smp_solar",              name: "SMP Interested – Solar",                 envVar: "AUDIENCE_LAB_SMP_SOLAR_SEGMENT_ID",             tableId: "smp_interested_solar_segment" },
    { slot: 4, key: "smp_windows_sd_sf",      name: "SMP Interested – Windows SD/SF",         envVar: "AUDIENCE_LAB_SMP_WINDOWS_SD_SF_SEGMENT_ID",     tableId: "smp_interested_windows_sd_sf_segment" },
    { slot: 5, key: "cmk_kitchen_bath_sar",   name: "CMK Kitchen & Bath Remodel SAR",         envVar: "AUDIENCE_LAB_CMK_KITCHEN_BATH_SAR_SEGMENT_ID",  tableId: "cmk_interested_kitchen_bath_remodel_sar_segment" },
    { slot: 6, key: "ranger_electric",        name: "Ranger Electric",                        envVar: "AUDIENCE_LAB_RANGER_ELECTRIC_SEGMENT_ID",       tableId: "ranger_interested_electric_segment" },
  ];

  const docs = legacy
    .filter((s) => process.env[s.envVar])
    .map((s) => ({
      slot:            s.slot,
      key:             s.key,
      name:            s.name,
      segmentId:       process.env[s.envVar],
      tableId:         s.tableId,
      active:          true,
      createdAt:       new Date(),
      lastSyncedAt:    null,
      lastSyncStatus:  null,
      lastSyncMessage: null,
      lastSyncCount:   null,
    }));

  if (docs.length) await c.insertMany(docs);
  return { seeded: true, count: docs.length };
}
