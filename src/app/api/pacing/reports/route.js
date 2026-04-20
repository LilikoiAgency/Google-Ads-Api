// src/app/api/pacing/reports/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'PacingReports';

async function assertAllowed() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) return null;
  return email;
}

export async function GET(request) {
  const email = await assertAllowed();
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100);

  const client = await dbConnect();
  const coll = client.db(DB).collection(COLL);
  const docs = await coll
    .find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({ html: 0, parsedData: 0 })
    .toArray();

  return NextResponse.json({ data: docs });
}
