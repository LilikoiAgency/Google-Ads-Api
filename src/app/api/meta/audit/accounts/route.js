import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../lib/auth';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLLECTION = 'MetaAudits';

export async function GET() {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  const client = await dbConnect();
  const db = client.db(DB);

  const accounts = await db.collection(COLLECTION).aggregate([
    { $sort: { savedAt: -1 } },
    {
      $group: {
        _id: '$accountId',
        accountName: { $first: '$accountName' },
        lastSavedAt: { $first: '$savedAt' },
        lastGrade: { $first: '$summary.accountGrade' },
        lastDateLabel: { $first: '$dateLabel' },
        auditCount: { $sum: 1 },
      },
    },
    { $sort: { lastSavedAt: -1 } },
    {
      $project: {
        _id: 0,
        accountId: '$_id',
        accountName: 1,
        lastSavedAt: 1,
        lastGrade: 1,
        lastDateLabel: 1,
        auditCount: 1,
      },
    },
  ]).toArray();

  return NextResponse.json({ data: accounts, requestId });
}
