import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../lib/auth';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLLECTION = 'GoogleAdsAudits';

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

  const { customerId, accountName, dateRange, dateWindow, dateLabel, summary, aiInsight } = body;
  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required', requestId }, { status: 400 });
  }

  const client = await dbConnect();
  const db = client.db(DB);

  const result = await db.collection(COLLECTION).insertOne({
    email,
    customerId: String(customerId),
    accountName: accountName || 'Account',
    dateRange: dateRange || 'LAST_30_DAYS',
    dateWindow: dateWindow || null,
    dateLabel: dateLabel || dateRange || 'LAST_30_DAYS',
    summary: summary || {},
    aiInsight: aiInsight || null,
    savedAt: new Date(),
  });

  return NextResponse.json({ id: result.insertedId, requestId });
}
