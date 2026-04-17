// src/app/api/googleads/preferences/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '@/lib/auth';
import { isAdmin } from '@/lib/admins';
import dbConnect from '@/lib/mongoose';

const DB = 'tokensApi';
const COLLECTION = 'GoogleAdsPreferences';

export const preferencesPostSchema = z.object({
  accountId: z.preprocess(
    (v) => (typeof v === 'number' ? String(v) : v),
    z.string().min(1)
  ),
});

export async function GET() {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  const client = await dbConnect();
  const doc = await client.db(DB).collection(COLLECTION).findOne({});

  return NextResponse.json({
    data: { pinnedAccountIds: doc?.pinnedAccountIds ?? [] },
    requestId,
  });
}

export async function POST(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }
  if (!isAdmin(email)) {
    return NextResponse.json({ error: 'Forbidden — admin only', requestId }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body', requestId }, { status: 400 });
  }

  const parsed = preferencesPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message, requestId },
      { status: 400 }
    );
  }

  const { accountId } = parsed.data;
  const client = await dbConnect();
  const col = client.db(DB).collection(COLLECTION);
  const existing = await col.findOne({});
  const current = existing?.pinnedAccountIds ?? [];

  const next = current.includes(accountId)
    ? current.filter((id) => id !== accountId)   // unpin
    : [...current, accountId];                    // pin

  await col.updateOne(
    {},
    { $set: { pinnedAccountIds: next, updatedAt: new Date(), updatedBy: email } },
    { upsert: true }
  );

  return NextResponse.json({ data: { pinnedAccountIds: next }, requestId });
}
