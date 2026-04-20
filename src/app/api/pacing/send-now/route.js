// src/app/api/pacing/send-now/route.js
// Admin-only manual trigger for the pacing report.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { isAdmin } from '../../../../lib/admins';
import { runPacingReport } from '../../../../lib/pacingPipeline';

export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdmin(email)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  try {
    const result = await runPacingReport({ manual: true, triggeredBy: email });
    return NextResponse.json({
      ok: true,
      id: String(result._id),
      status: result.status,
      sendError: result.sendError,
      summary: result.summary,
    });
  } catch (err) {
    console.error('[pacing/send-now]', err);
    return NextResponse.json({ error: err?.message || 'pipeline failed' }, { status: 500 });
  }
}
