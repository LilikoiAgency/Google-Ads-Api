// src/app/api/claude/meta-audit/route.js
export const maxDuration = 180;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { META_ADS_AUDIT_SYSTEM_PROMPT } from '../../../../lib/metaAuditPrompt';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.META_AI_AUDIT_DAILY_LIMIT || '5');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.metaAiAuditCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { metaAiAuditCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true },
  );
}

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

  const { accountId, payload } = body;
  if (!accountId || !payload) {
    return NextResponse.json({ error: 'accountId and payload are required', requestId }, { status: 400 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const usedToday = await getDailyUsageCount(db, email);
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json({
        error: `Daily AI audit limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
        limitReached: true,
        usage: { count: usedToday, limit: DAILY_LIMIT, remaining: 0 },
        requestId,
      }, { status: 429 });
    }
  }

  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, limitReached: true, requestId },
      { status: 429 },
    );
  }

  const credentials = await getCredentials();
  const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Anthropic API key not configured — add ANTHROPIC_API_KEY to your credentials.' },
      { status: 500 },
    );
  }

  const client = new Anthropic({ apiKey });
  const userPrompt = `Analyze this Meta Ads account data and return the structured JSON audit:\n\n${JSON.stringify(payload, null, 2)}`;

  const RETRY_DELAYS = [5_000, 15_000];
  let response;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: META_ADS_AUDIT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });
      break;
    } catch (err) {
      if (err?.status === 529 && attempt < 2) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      console.error('[claude/meta-audit] Claude error:', err?.message);
      return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
    }
  }

  const rawText = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let auditResult;
  try {
    const clean = rawText.replace(/^```json\s*/m, '').replace(/^```\s*$/m, '').trim();
    auditResult = JSON.parse(clean);
  } catch (err) {
    console.error('[claude/meta-audit] JSON parse failed:', rawText.slice(0, 500));
    return NextResponse.json({ error: 'Failed to parse AI response as JSON', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'meta_audit',
    email,
    accountId: String(accountId),
    model: 'claude-sonnet-4-6',
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateClaudeCost('claude-sonnet-4-6', inputTokens, outputTokens),
  }).catch(() => {});

  let remainingToday = DAILY_LIMIT;
  if (!isAdmin(email)) {
    await incrementDailyUsage(db, email).catch(() => {});
    const newCount = await getDailyUsageCount(db, email).catch(() => DAILY_LIMIT);
    remainingToday = Math.max(0, DAILY_LIMIT - newCount);
  }

  return NextResponse.json({
    data: auditResult,
    requestId,
    usage: { count: DAILY_LIMIT - remainingToday, limit: DAILY_LIMIT, remaining: remainingToday },
  });
}
