export const maxDuration = 120;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { getMetaAdCopySystemPrompt } from '../../../../lib/metaAdCopyPrompt';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.META_AD_COPY_DAILY_LIMIT || '10');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.metaAdCopyCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { metaAdCopyCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true }
  );
}

function buildUserPrompt(context, campaign) {
  const offerLine = context.offer ? `- Current offer: ${context.offer}` : '';
  const creativeLine = campaign.currentTitle || campaign.currentBody
    ? `\nCurrent ad creative:\n  Title: ${campaign.currentTitle || '(none)'}\n  Body: ${campaign.currentBody || '(none)'}\n  CTA type: ${campaign.callToActionType || '(none)'}`
    : '';
  const flagsLine = campaign.flags?.length ? `\nPerformance flags: ${campaign.flags.join(', ')}` : '';
  const cpa = campaign.conversions > 0
    ? `$${(campaign.spend / campaign.conversions).toFixed(0)}`
    : 'no conversions';

  return `BUSINESS CONTEXT:
- Business: ${context.business}
- Target audience: ${context.audience}
- USPs: ${context.usps}
- Tone: ${context.tone || 'Professional'}
${offerLine}

CAMPAIGN DATA:
Campaign: ${campaign.campaignName}
Objective: ${campaign.objective || 'Unknown'}
Spend: $${Number(campaign.spend || 0).toFixed(0)} | CTR: ${(Number(campaign.ctr || 0) * 100).toFixed(2)}% | CPA: ${cpa} | ROAS: ${Number(campaign.roas || 0).toFixed(2)}x | Conversions: ${campaign.conversions || 0}${creativeLine}${flagsLine}`.trim();
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

  const { context, campaign } = body;

  if (!context?.business || !context?.audience || !context?.usps) {
    return NextResponse.json(
      { error: 'context.business, context.audience, and context.usps are required', requestId },
      { status: 400 }
    );
  }
  if (!campaign?.campaignName) {
    return NextResponse.json({ error: 'campaign.campaignName is required', requestId }, { status: 400 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const usedToday = await getDailyUsageCount(db, email);
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json({
        error: `Daily Meta ad copy limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
        limitReached: true,
        requestId,
      }, { status: 429 });
    }
  }

  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, code: 'NO_CREDITS', limitReached: true, requestId },
      { status: 429 }
    );
  }

  const credentials = await getCredentials();
  const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured.', requestId }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = getMetaAdCopySystemPrompt();
  const userPrompt = buildUserPrompt(context, campaign);

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('[claude/meta-ad-copy] Claude error:', err?.message);
    return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
  }

  if (response.stop_reason === 'max_tokens') {
    return NextResponse.json({ error: 'AI response was truncated. Please try again.', requestId }, { status: 500 });
  }

  const rawText = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let result;
  try {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object found');
    result = JSON.parse(rawText.slice(start, end + 1));
  } catch {
    console.error('[claude/meta-ad-copy] JSON parse failed:', rawText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to parse AI response', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'meta_ad_copy',
    email,
    model: 'claude-sonnet-4-6',
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateClaudeCost('claude-sonnet-4-6', inputTokens, outputTokens),
  }).catch(() => {});

  if (!isAdmin(email)) {
    await incrementDailyUsage(db, email).catch(() => {});
  }

  return NextResponse.json({ data: result, requestId });
}
