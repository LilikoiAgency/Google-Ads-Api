// src/app/api/streaming-pacing/reports/route.js
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'StreamingPacingReports';

export async function GET(request) {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100);

  const client = await dbConnect();
  const docs = await client.db(DB).collection(COLL)
    .find({}).sort({ createdAt: -1 }).limit(limit)
    .project({ html: 0, parsedData: 0 }).toArray();
  return NextResponse.json({ data: docs });
}
