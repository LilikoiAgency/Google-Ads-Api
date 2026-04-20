import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions, allowedEmailDomain } from '../../../../../lib/auth';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLLECTION = 'GoogleAdsAudits';
const DAILY_LIMIT = parseInt(process.env.GOOGLE_ADS_AI_AUDIT_DAILY_LIMIT || '5');

async function getUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  const used = doc?.googleAdsAiAuditCount ?? 0;
  return { count: used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used) };
}

export async function GET(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const customerId = searchParams.get('customerId');

  const client = await dbConnect();
  const db = client.db(DB);
  const usage = await getUsage(db, email);

  if (id) {
    let oid;
    try { oid = new ObjectId(id); }
    catch { return NextResponse.json({ error: 'Invalid id', requestId }, { status: 400 }); }
    const doc = await db.collection(COLLECTION).findOne({ _id: oid, email });
    if (!doc) return NextResponse.json({ error: 'Not found', requestId }, { status: 404 });
    return NextResponse.json({ data: doc, usage, requestId });
  }

  if (customerId) {
    const docs = await db.collection(COLLECTION)
      .find({ email, customerId: String(customerId) })
      .sort({ savedAt: -1 })
      .limit(20)
      .project({ aiInsight: 0 })
      .toArray();
    return NextResponse.json({ data: docs, usage, requestId });
  }

  return NextResponse.json({ error: 'customerId or id required', requestId }, { status: 400 });
}

export async function DELETE(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required', requestId }, { status: 400 });

  let oid;
  try { oid = new ObjectId(id); }
  catch { return NextResponse.json({ error: 'Invalid id', requestId }, { status: 400 }); }

  const client = await dbConnect();
  const result = await client.db(DB).collection(COLLECTION).deleteOne({ _id: oid, email });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: 'Not found', requestId }, { status: 404 });
  }
  return NextResponse.json({ ok: true, requestId });
}
