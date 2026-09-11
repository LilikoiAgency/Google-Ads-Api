// src/lib/streamingPacingPipeline.js
// Orchestrates the Targeted Streaming pacing report:
// load config → fetch shared sheet → build HTML → send email → persist.

import { Resend } from 'resend';
import dbConnect from './mongoose';
import { fetchStreamingSheet } from './streamingPacingSheets';
import { buildStreamingPacingReport } from './streamingPacingReportBuilder';

const DB = 'tokensApi';
const REPORTS_COLL = 'StreamingPacingReports';
const CONFIG_COLL = 'StreamingPacingConfig';
const CONFIG_ID = 'singleton';

export const DEFAULT_STREAMING_SHEET_ID = '1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU';

const DEFAULT_CLIENTS = [
  { key: 'SMP', name: 'Semper Solaris', enabled: true },
  { key: 'BBT', name: 'Big Bully Turf',  enabled: true },
];

const DEFAULT_RECIPIENTS = [
  'kevinw@lilikoiagency.com',
  'lance@lilikoiagency.com',
  'pierre@lilikoiagency.com',
  'danielle@lilikoiagency.com',
  'sophia@lilikoiagency.com',
  'nicole@lilikoiagency.com',
];

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export async function loadStreamingPacingConfig() {
  const client = await dbConnect();
  const coll = client.db(DB).collection(CONFIG_COLL);
  let doc = await coll.findOne({ _id: CONFIG_ID });
  if (!doc) {
    doc = {
      _id: CONFIG_ID,
      sheetId: DEFAULT_STREAMING_SHEET_ID,
      clients: DEFAULT_CLIENTS,
      recipients: DEFAULT_RECIPIENTS,
      subjectPrefix: 'Targeted Streaming Pacing Report',
      fromAddress: process.env.PACING_REPORT_FROM || 'reports@updates.lilikoiagency.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await coll.insertOne(doc);
  }
  return doc;
}

export async function saveStreamingPacingConfig(update) {
  const client = await dbConnect();
  const coll = client.db(DB).collection(CONFIG_COLL);
  const { _id, createdAt, ...rest } = update || {};
  await coll.updateOne(
    { _id: CONFIG_ID },
    { $set: { ...rest, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  return loadStreamingPacingConfig();
}

async function sendEmail({ html, subject, recipients, fromAddress }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({ from: fromAddress, to: recipients, subject, html });
  if (result?.error) throw new Error(result.error.message || 'Resend send failed');
  return result?.data?.id || null;
}

/**
 * @param {{ manual?: boolean, dryRun?: boolean, triggeredBy?: string }} opts
 */
export async function runStreamingPacingReport(opts = {}) {
  const { manual = false, dryRun = false, triggeredBy = 'cron' } = opts;
  const reportDate = todayET();
  const config = await loadStreamingPacingConfig();
  const sheetId = config.sheetId || DEFAULT_STREAMING_SHEET_ID;
  const active = (config.clients || []).filter((c) => c.enabled && c.key);

  console.log(`[streaming-pacing] run date=${reportDate} manual=${manual} dryRun=${dryRun} by=${triggeredBy} clients=${active.map((c) => c.key).join(',')}`);
  const { info, budgets, clients } = await fetchStreamingSheet(sheetId, active);
  const { html, summary } = buildStreamingPacingReport({ reportDate, info, budgets, clients });
  console.log('[streaming-pacing] summary:', JSON.stringify(summary));

  const subject = `${config.subjectPrefix || 'Targeted Streaming Pacing Report'} — ${reportDate}`;
  const recipients = config.recipients || [];
  const fromAddress = config.fromAddress || process.env.PACING_REPORT_FROM || 'reports@updates.lilikoiagency.com';

  let sendStatus = 'skipped';
  let sendError = null;
  let resendId = null;
  if (!dryRun && recipients.length) {
    try {
      resendId = await sendEmail({ html, subject, recipients, fromAddress });
      sendStatus = 'sent';
    } catch (err) {
      sendError = err?.message || 'send failed';
      sendStatus = 'failed';
    }
  }

  const doc = {
    reportDate, subject, recipients, fromAddress,
    status: sendStatus, sendError, resendId,
    html, summary,
    parsedData: { info, budgets, clients },
    manual, dryRun, triggeredBy,
    createdAt: new Date(),
  };

  if (dryRun) return { ...doc, _id: null };

  const dbClient = await dbConnect();
  const inserted = await dbClient.db(DB).collection(REPORTS_COLL).insertOne(doc);
  return { ...doc, _id: inserted.insertedId };
}
