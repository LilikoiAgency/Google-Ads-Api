// src/app/api/streaming-pacing/latest/route.js
// Most recent non-dry-run report: id + date + summary only.
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'StreamingPacingReports';

export async function GET() {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const client = await dbConnect();
  const doc = await client.db(DB).collection(COLL)
    .find({ dryRun: { $ne: true } }).sort({ createdAt: -1 }).limit(1)
    .project({ html: 0, parsedData: 0 }).next();
  if (!doc) return NextResponse.json({ data: null });
  return NextResponse.json({ data: { _id: doc._id, reportDate: doc.reportDate, createdAt: doc.createdAt, summary: doc.summary, status: doc.status } });
}
