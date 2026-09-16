// One-off: build the Targeted Streaming pacing report from the live sheet and email it
// to a single address (no Mongo insert, team recipients untouched).
// Run: node scripts/send-streaming-preview-to-me.mjs you@lilikoiagency.com
import 'dotenv/config';
import { Resend } from 'resend';
import { fetchStreamingSheet } from '../src/lib/streamingPacingSheets.js';
import { buildStreamingPacingReport } from '../src/lib/streamingPacingReportBuilder.js';

const to = process.argv[2];
if (!to) { console.error('usage: node scripts/send-streaming-preview-to-me.mjs <email>'); process.exit(1); }

const SHEET_ID = '1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU';
const CLIENTS = [
  { key: 'SMP', name: 'Semper Solaris' },
  { key: 'BBT', name: 'Big Bully Turf' },
];
const reportDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const { info, budgets, clients } = await fetchStreamingSheet(SHEET_ID, CLIENTS);
const { html, summary } = buildStreamingPacingReport({ reportDate, info, budgets, clients });
console.log('summary:', JSON.stringify(summary, null, 2));

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.PACING_REPORT_FROM || 'reports@updates.lilikoiagency.com';
const result = await resend.emails.send({ from, to: [to], subject: `[PREVIEW] Targeted Streaming Pacing Report — ${reportDate}`, html });
if (result?.error) throw new Error(result.error.message);
console.log(`sent to ${to}, resend id: ${result?.data?.id}`);
