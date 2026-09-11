// src/app/api/streaming-pacing/preview/route.js
// Dry-run: fetches the sheet + builds HTML, returns it without sending or persisting.
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import { runStreamingPacingReport } from '../../../../lib/streamingPacingPipeline';

export const maxDuration = 300;

export async function POST() {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await runStreamingPacingReport({ manual: true, dryRun: true, triggeredBy: auth.email });
    return NextResponse.json({ ok: true, html: result.html, summary: result.summary, reportDate: result.reportDate });
  } catch (err) {
    console.error('[streaming-pacing/preview]', err);
    return NextResponse.json({ error: err?.message || 'preview failed' }, { status: 500 });
  }
}
