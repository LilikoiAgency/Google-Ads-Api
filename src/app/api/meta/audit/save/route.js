import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions, allowedEmailDomain } from '../../../../../lib/auth';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLLECTION = 'MetaAudits';

export async function POST(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body', requestId }, { status: 400 }); }

  const { accountId, accountName, dateRange, dateWindow, dateLabel, summary, aiInsight, auditData, auditId } = body;
  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', requestId }, { status: 400 });
  }

  const client = await dbConnect();
  const db = client.db(DB);

  const doc = {
    email,
    accountId: String(accountId),
    accountName: accountName || 'Account',
    dateRange: dateRange || 'LAST_30_DAYS',
    dateWindow: dateWindow || null,
    dateLabel: dateLabel || dateRange || 'LAST_30_DAYS',
    summary: summary || {},
    auditData: auditData || null,
    aiInsight: aiInsight || null,
    savedAt: new Date(),
  };

  const auditDataSize = auditData ? JSON.stringify(auditData).length : 0;
  console.log(`[meta/audit/save] email=${email} accountId=${accountId} auditId=${auditId || 'NEW'} ` +
    `auditDataSize=${auditDataSize} bytes hasAI=${!!aiInsight} ` +
    `campaignCount=${auditData?.campaigns?.length ?? 0} adSetCount=${auditData?.adSets?.length ?? 0}`);

  if (auditId) {
    let oid;
    try { oid = new ObjectId(auditId); } catch { oid = null; }
    if (oid) {
      const update = await db.collection(COLLECTION).updateOne(
        { _id: oid, email, accountId: String(accountId) },
        { $set: doc },
      );
      if (update.matchedCount > 0) {
        return NextResponse.json({ id: String(oid), requestId, updated: true });
      }
    }
  }

  // Implicit dedup: if an audit already exists for this user + account + date range
  // in the last 24h, update it in place instead of creating a duplicate. Stops
  // "ran audit twice today = two records" from cluttering the history list.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db.collection(COLLECTION).findOne({
    email,
    accountId: String(accountId),
    dateRange: doc.dateRange,
    savedAt: { $gte: dayAgo },
  });
  if (existing) {
    await db.collection(COLLECTION).updateOne({ _id: existing._id }, { $set: doc });
    return NextResponse.json({ id: String(existing._id), requestId, updated: true, deduped: true });
  }

  const result = await db.collection(COLLECTION).insertOne(doc);
  return NextResponse.json({ id: String(result.insertedId), requestId, updated: false });
}
