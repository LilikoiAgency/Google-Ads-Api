// src/app/api/pacing/latest/route.js
// Lightweight: returns just the most recent pacing report's id + date + summary.
// Used by the dashboard home widget.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'PacingReports';

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await dbConnect();
  const doc = await client
    .db(DB)
    .collection(COLL)
    .find({ dryRun: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(1)
    .project({ html: 0, parsedData: 0 })
    .next();

  if (!doc) return NextResponse.json({ data: null });

  return NextResponse.json({
    data: {
      _id: doc._id,
      reportDate: doc.reportDate,
      createdAt: doc.createdAt,
      summary: doc.summary,
      status: doc.status,
    },
  });
}
