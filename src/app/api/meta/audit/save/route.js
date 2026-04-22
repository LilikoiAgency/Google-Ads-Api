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

  const { accountId, accountName, dateRange, dateWindow, dateLabel, summary, aiInsight, auditId } = body;
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
    aiInsight: aiInsight || null,
    savedAt: new Date(),
  };

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

  const result = await db.collection(COLLECTION).insertOne(doc);
  return NextResponse.json({ id: String(result.insertedId), requestId, updated: false });
}
