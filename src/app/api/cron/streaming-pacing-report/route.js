// src/app/api/cron/streaming-pacing-report/route.js
// Invoked by Vercel Cron at 5 12 * * 1-5 UTC (five minutes after the Paid Search report).

import { NextResponse } from 'next/server';
import { runStreamingPacingReport } from '../../../../lib/streamingPacingPipeline';

export const maxDuration = 300;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (request.headers.get('authorization') || '') === `Bearer ${secret}`;
}

export async function GET(request) {
  const requestId = crypto.randomUUID();
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }
  try {
    const result = await runStreamingPacingReport({ manual: false, triggeredBy: 'cron' });
    return NextResponse.json({ ok: true, id: String(result._id), reportDate: result.reportDate, status: result.status, summary: result.summary, requestId });
  } catch (err) {
    console.error('[cron/streaming-pacing-report]', err);
    return NextResponse.json({ error: err?.message || 'pipeline failed', requestId }, { status: 500 });
  }
}
