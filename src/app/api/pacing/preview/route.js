// src/app/api/pacing/preview/route.js
// Dry-run: fetches sheets + builds HTML, returns it without sending or persisting.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { runPacingReport } from '../../../../lib/pacingPipeline';

export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runPacingReport({ manual: true, dryRun: true, triggeredBy: email });
    return NextResponse.json({
      ok: true,
      html: result.html,
      summary: result.summary,
      reportDate: result.reportDate,
    });
  } catch (err) {
    console.error('[pacing/preview]', err);
    return NextResponse.json({ error: err?.message || 'preview failed' }, { status: 500 });
  }
}
