// src/app/api/cron/pacing-report/route.js
// Invoked by Vercel Cron at 0 13 * * 1-5 UTC (9 AM EDT / 8 AM EST, Mon–Fri).

import { NextResponse } from 'next/server';
import { runPacingReport } from '../../../../lib/pacingPipeline';

export const maxDuration = 300;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}

export async function GET(request) {
  const requestId = crypto.randomUUID();
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  try {
    const result = await runPacingReport({ manual: false, triggeredBy: 'cron' });
    return NextResponse.json({
      ok: true,
      id: String(result._id),
      reportDate: result.reportDate,
      status: result.status,
      summary: result.summary,
      requestId,
    });
  } catch (err) {
    console.error('[cron/pacing-report]', err);
    return NextResponse.json({ error: err?.message || 'pipeline failed', requestId }, { status: 500 });
  }
}
