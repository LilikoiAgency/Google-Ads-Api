// src/app/api/pacing/reports/[id]/route.js
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../lib/auth';
import { isAdmin } from '../../../../../lib/admins';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'PacingReports';

async function assertAllowed() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) return null;
  return email;
}

export async function GET(_request, { params }) {
  const email = await assertAllowed();
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let oid;
  try { oid = new ObjectId(id); }
  catch { return NextResponse.json({ error: 'Invalid id' }, { status: 400 }); }

  const client = await dbConnect();
  const doc = await client.db(DB).collection(COLL).findOne({ _id: oid });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ data: doc });
}

export async function DELETE(_request, { params }) {
  const email = await assertAllowed();
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(email)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { id } = await params;
  let oid;
  try { oid = new ObjectId(id); }
  catch { return NextResponse.json({ error: 'Invalid id' }, { status: 400 }); }

  const client = await dbConnect();
  const result = await client.db(DB).collection(COLL).deleteOne({ _id: oid });
  if (result.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
