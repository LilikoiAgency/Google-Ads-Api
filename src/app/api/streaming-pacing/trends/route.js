// src/app/api/streaming-pacing/trends/route.js
// Per-day per-client pacing % over the last N days for the trend chart.
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';
const COLL = 'StreamingPacingReports';

export async function GET(request) {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const rawDays = parseInt(searchParams.get('days') || '30', 10);
  const days = Math.min(Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30, 90);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const client = await dbConnect();
  const docs = await client.db(DB).collection(COLL)
    .find({ createdAt: { $gte: since }, dryRun: { $ne: true } })
    .sort({ reportDate: 1, createdAt: 1 })
    .project({ reportDate: 1, summary: 1 }).toArray();

  const byDate = new Map();
  for (const d of docs) byDate.set(d.reportDate, d);

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

  const latest = docs[docs.length - 1];
  const clients = (latest?.summary?.clients || []).map((c) => ({ key: c.key, name: c.name }));
  return NextResponse.json({ data: { series, clients, days } });
}
