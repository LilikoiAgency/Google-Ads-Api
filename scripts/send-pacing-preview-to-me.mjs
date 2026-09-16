// One-off: build the Paid Search pacing report from a client's live sheet and email it
// to a single address (no Mongo insert, team recipients untouched).
// Run: node scripts/send-pacing-preview-to-me.mjs you@lilikoiagency.com [CLIENT_KEY ...]
import 'dotenv/config';
import { Resend } from 'resend';
import { fetchClientSheet } from '../src/lib/pacingSheets.js';
import { buildPacingReport } from '../src/lib/pacingReportBuilder.js';

const [to, ...keys] = process.argv.slice(2);
if (!to) { console.error('usage: node scripts/send-pacing-preview-to-me.mjs <email> [CLIENT_KEY ...]'); process.exit(1); }

// Mirrors DEFAULT_CLIENTS in pacingPipeline.js; live list lives in Mongo PacingConfig.
const CLIENTS = [
  { key: 'SMP', name: 'Semper Solaris', sheetId: '1xvWA1WWDHBrABYoWjMJJaaCCV3aQgofSV0m4GT4Eahw' },
];
const wanted = keys.length ? CLIENTS.filter((c) => keys.includes(c.key)) : CLIENTS;
const reportDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const clients = await Promise.all(wanted.map(async (c) => {
  const { pacing, validation, metaLocations } = await fetchClientSheet(c.sheetId, c.key);
  return { key: c.key, name: c.name, pacing, validation, metaLocations: metaLocations || null };
}));
const { html, summary } = buildPacingReport({ reportDate, clients });
console.log('summary:', JSON.stringify(summary, null, 2));

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.PACING_REPORT_FROM || 'reports@updates.lilikoiagency.com';
const result = await resend.emails.send({ from, to: [to], subject: `[${process.env.PREVIEW_TAG || "PREVIEW"}] Daily Budget Pacing Report — ${reportDate}`, html });
if (result?.error) throw new Error(result.error.message);
console.log(`sent to ${to}, resend id: ${result?.data?.id}`);
