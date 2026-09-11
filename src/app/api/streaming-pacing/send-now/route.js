// src/app/api/streaming-pacing/send-now/route.js
// Admin-only manual trigger.
import { NextResponse } from 'next/server';
import { getAdminSession } from '../../../../lib/routeAuth';
import { runStreamingPacingReport } from '../../../../lib/streamingPacingPipeline';

export const maxDuration = 300;

export async function POST() {
  const auth = await getAdminSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await runStreamingPacingReport({ manual: true, triggeredBy: auth.email });
    return NextResponse.json({ ok: true, id: String(result._id), status: result.status, sendError: result.sendError, summary: result.summary });
  } catch (err) {
    console.error('[streaming-pacing/send-now]', err);
    return NextResponse.json({ error: err?.message || 'pipeline failed' }, { status: 500 });
  }
}
