// src/app/api/streaming-pacing/reports/[id]/route.js
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getAllowedSession, getAdminSession } from '../../../../../lib/routeAuth';
import dbConnect from '../../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'StreamingPacingReports';

function parseId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

export async function GET(_request, { params }) {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const oid = parseId(id);
  if (!oid) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const client = await dbConnect();
  const doc = await client.db(DB).collection(COLL).findOne({ _id: oid });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: doc });
}

export async function DELETE(_request, { params }) {
  const auth = await getAdminSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const oid = parseId(id);
  if (!oid) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const client = await dbConnect();
  const result = await client.db(DB).collection(COLL).deleteOne({ _id: oid });
  if (result.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
