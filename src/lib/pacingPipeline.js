// src/lib/pacingPipeline.js
// Orchestrates: load config → fetch sheets → build HTML → send email → persist.

import { Resend } from 'resend';
import dbConnect from './mongoose';
import { fetchClientSheet } from './pacingSheets';
import { buildPacingReport } from './pacingReportBuilder';

const DB = 'tokensApi';
const REPORTS_COLL = 'PacingReports';
const CONFIG_COLL = 'PacingConfig';
const CONFIG_ID = 'singleton';

const DEFAULT_CLIENTS = [
  { key: 'BBT', name: 'Big Bully Turf',  sheetId: '1MSsCNhqCA53ToFAeAxIC45nxwETMWhg6Ip7eT9RBRgc', enabled: true },
  { key: 'SMP', name: 'Semper Solaris',  sheetId: '1xvWA1WWDHBrABYoWjMJJaaCCV3aQgofSV0m4GT4Eahw', enabled: true },
  { key: 'CMK', name: 'CMK Construction', sheetId: '14hQSB8fQjDxNQ21qSoNeqgzd9RcVU3SahV5AyvKDiwY', enabled: true },
  { key: 'MSP', name: 'More Space Place', sheetId: '1qzAYyXUbtZ1FwXRkznvlna5g2OMAmby6GcF1sNBqlXE', enabled: true },
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
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

export async function loadPacingConfig() {
  const client = await dbConnect();
  const coll = client.db(DB).collection(CONFIG_COLL);
  let doc = await coll.findOne({ _id: CONFIG_ID });
  if (!doc) {
    doc = {
      _id: CONFIG_ID,
      recipients: DEFAULT_RECIPIENTS,
      clients: DEFAULT_CLIENTS,
      subjectPrefix: 'Budget Pacing Report',
      fromAddress: process.env.PACING_REPORT_FROM || 'reports@updates.lilikoiagency.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await coll.insertOne(doc);
  }
  return doc;
}

export async function savePacingConfig(update) {
  const client = await dbConnect();
  const coll = client.db(DB).collection(CONFIG_COLL);
  const { _id, createdAt, ...rest } = update || {};
  await coll.updateOne(
    { _id: CONFIG_ID },
    {
      $set: { ...rest, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  return loadPacingConfig();
}

async function fetchAllClients(configClients) {
  const active = configClients.filter((c) => c.enabled && c.sheetId);
  console.log(`[pacing] fetching ${active.length} active clients: ${active.map((c) => c.key).join(', ')}`);
  return Promise.all(active.map(async (c) => {
    try {
      const { pacing, validation } = await fetchClientSheet(c.sheetId, c.key);
      return { key: c.key, name: c.name, pacing, validation };
    } catch (err) {
      console.error(`[pacing:${c.key}] fatal fetch error: ${err?.message}`);
      return {
        key: c.key,
        name: c.name,
        pacing: { header: {}, geos: [], lines: [], error: err?.message || 'fetch failed' },
        validation: { platforms: [] },
        error: err?.message || 'fetch failed',
      };
    }
  }));
}

async function sendEmail({ html, subject, recipients, fromAddress }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from: fromAddress,
    to: recipients,
    subject,
    html,
  });
  if (result?.error) throw new Error(result.error.message || 'Resend send failed');
  return result?.data?.id || null;
}

/**
 * Run the pacing pipeline end-to-end.
 * @param {{ manual?: boolean, dryRun?: boolean, triggeredBy?: string }} opts
 */
export async function runPacingReport(opts = {}) {
  const { manual = false, dryRun = false, triggeredBy = 'cron' } = opts;
  const reportDate = todayET();
  const config = await loadPacingConfig();

  console.log(`[pacing] runPacingReport date=${reportDate} manual=${manual} dryRun=${dryRun} by=${triggeredBy}`);
  const clients = await fetchAllClients(config.clients || []);
  const { html, summary } = buildPacingReport({ reportDate, clients });
  console.log(`[pacing] report summary:`, JSON.stringify(summary, null, 2));

  const subject = `${config.subjectPrefix || 'Budget Pacing Report'} — ${reportDate}`;
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

  const dbClient = await dbConnect();
  const coll = dbClient.db(DB).collection(REPORTS_COLL);
  const doc = {
    reportDate,
    subject,
    recipients,
    fromAddress,
    status: sendStatus,
    sendError,
    resendId,
    html,
    summary,
    parsedData: clients,
    manual,
    dryRun,
    triggeredBy,
    createdAt: new Date(),
  };

  if (dryRun) {
    return { ...doc, _id: null };
  }

  const inserted = await coll.insertOne(doc);
  return { ...doc, _id: inserted.insertedId };
}
