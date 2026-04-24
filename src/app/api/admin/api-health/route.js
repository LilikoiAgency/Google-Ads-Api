// src/app/api/admin/api-health/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DB = 'tokensApi';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdmin(email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = await dbConnect();
  const db = client.db(DB);

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const callLog = db.collection('ApiCallLog');
  const apiUsage = db.collection('ApiUsage');
  const settings = db.collection('Settings');

  const [
    metaLastHour,
    metaToday,
    metaDailyTrend,
    claudeMonthly,
    claudeByFeature,
    budgetCapDoc,
  ] = await Promise.all([
    callLog.countDocuments({ api: 'meta', timestamp: { $gte: oneHourAgo } }),
    callLog.countDocuments({ api: 'meta', timestamp: { $gte: todayStart } }),
    callLog.aggregate([
      { $match: { api: 'meta', timestamp: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, calls: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', calls: 1, _id: 0 } },
    ]).toArray(),
    apiUsage.aggregate([
      { $match: { type: 'claude_tokens', timestamp: { $gte: monthStart } } },
      { $group: { _id: null, totalCost: { $sum: '$estimatedCostUsd' }, calls: { $sum: 1 }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' } } },
    ]).toArray(),
    apiUsage.aggregate([
      { $match: { type: 'claude_tokens', timestamp: { $gte: monthStart } } },
      { $group: { _id: '$feature', cost: { $sum: '$estimatedCostUsd' }, calls: { $sum: 1 } } },
      { $sort: { cost: -1 } },
      { $project: { feature: '$_id', cost: 1, calls: 1, _id: 0 } },
    ]).toArray(),
    settings.findOne({ key: 'claude_monthly_budget_usd' }),
  ]);

  const budgetCap = budgetCapDoc?.value ?? 50;
  const monthly = claudeMonthly[0] ?? { totalCost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };

  return NextResponse.json({
    meta: {
      callsLastHour: metaLastHour,
      callsToday: metaToday,
      hourlyLimit: 200,
      dailyTrend: metaDailyTrend,
    },
    claude: {
      monthlySpend: monthly.totalCost,
      monthlyCalls: monthly.calls,
      monthlyInputTokens: monthly.inputTokens,
      monthlyOutputTokens: monthly.outputTokens,
      budgetCap,
      budgetUsedPct: budgetCap > 0 ? (monthly.totalCost / budgetCap) * 100 : 0,
      byFeature: claudeByFeature,
    },
  });
}
