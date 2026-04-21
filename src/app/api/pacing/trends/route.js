// src/app/api/pacing/trends/route.js
// Returns per-day per-client pacing % over the last N days.
// Used by the trend chart on /dashboard/pacing.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'PacingReports';

export async function GET(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(parseInt(searchParams.get('days') || '30', 10), 90);

  const since = new Date();
  since.setDate(since.getDate() - days);

  const client = await dbConnect();
  const docs = await client
    .db(DB)
    .collection(COLL)
    .find({ createdAt: { $gte: since }, dryRun: { $ne: true } })
    .sort({ reportDate: 1, createdAt: 1 })
    .project({ reportDate: 1, summary: 1 })
    .toArray();

  // One row per reportDate. If multiple sends in a day, take the last (latest createdAt for that date).
  const byDate = new Map();
  for (const d of docs) {
    byDate.set(d.reportDate, d);
  }

  const series = Array.from(byDate.values()).map((d) => {
    const row = { date: d.reportDate };
    for (const c of d.summary?.clients || []) {
      row[c.key + '_pct'] = c.pacingPct;
      row[c.key + '_spend'] = c.totalSpend;
      row[c.key + '_budget'] = c.totalBudget;
      row[c.key + '_eom'] = c.totalEomPacing;
      row[c.key + '_status'] = c.status;
    }
    return row;
  });

  // Discover client keys+names from most recent doc
  const latest = docs[docs.length - 1];
  const clients = (latest?.summary?.clients || []).map((c) => ({ key: c.key, name: c.name }));

  return NextResponse.json({ data: { series, clients, days } });
}
