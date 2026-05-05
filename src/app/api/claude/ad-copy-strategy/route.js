export const maxDuration = 120;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { getAdCopyStrategySystemPrompt } from '../../../../lib/adCopyStrategyPrompt';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.AD_COPY_STRATEGY_DAILY_LIMIT || '10');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.adCopyStrategyCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { adCopyStrategyCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true }
  );
}

function buildUserPrompt(context, campaigns) {
  const offerLine = context.offer ? `- Current offer: ${context.offer}` : '';
  const header = `BUSINESS CONTEXT:
- Business: ${context.business}
- Target audience: ${context.audience}
- USPs: ${context.usps}
- Tone: ${context.tone || 'Professional'}
${offerLine}

CAMPAIGN DATA:
`;

  const campaignBlocks = campaigns.map((c) => {
    const ctr = c.clicks > 0 ? ((c.clicks / (c.impressions || 1)) * 100).toFixed(2) : '0';
    const cpa = c.conversions > 0 ? `$${((c.cost || 0) / 1_000_000 / c.conversions).toFixed(0)}` : 'no conversions';
    const spend = `$${((c.cost || 0) / 1_000_000).toFixed(0)}`;

    const headlines = c.currentHeadlines?.length
      ? c.currentHeadlines.join(' | ')
      : 'No headlines available';
    const descriptions = c.currentDescriptions?.length
      ? c.currentDescriptions.join(' | ')
      : 'No descriptions available';

    const searchTermsBlock = c.topConvertingTerms?.length
      ? `Top converting search terms: ${c.topConvertingTerms.join(', ')}`
      : 'No converting search terms';

    const bottomKwBlock = c.bottomKeywords?.length
      ? `Bottom QS keywords:\n${c.bottomKeywords.map((k) => `  - "${k.text}" QS ${k.qs} — failing: ${k.failingComponent}`).join('\n')}`
      : 'No QS data available';

    const matchBlock = c.matchTypeSpend
      ? `Match type spend: Exact ${Math.round((c.matchTypeSpend.EXACT || 0) * 100)}% / Phrase ${Math.round((c.matchTypeSpend.PHRASE || 0) * 100)}% / Broad ${Math.round((c.matchTypeSpend.BROAD || 0) * 100)}%`
      : '';

    const flagsBlock = c.flags?.length ? `Flags: ${c.flags.join(', ')}` : '';

    return `---
Campaign: ${c.campaignName}
Verdict: ${c.verdict}
Spend: ${spend} | CTR: ${ctr}% | CPA: ${cpa} | Conversions: ${c.conversions || 0}

Current headlines: ${headlines}
Current descriptions: ${descriptions}

${searchTermsBlock}
${bottomKwBlock}
${matchBlock}
${flagsBlock}`.trim();
  });

  return header + campaignBlocks.join('\n\n');
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

  const { customerId, context, campaigns } = body;

  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required', requestId }, { status: 400 });
  }
  if (!context?.business || !context?.audience || !context?.usps) {
    return NextResponse.json({ error: 'context.business, context.audience, and context.usps are required', requestId }, { status: 400 });
  }
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return NextResponse.json({ error: 'campaigns must be a non-empty array', requestId }, { status: 400 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const usedToday = await getDailyUsageCount(db, email);
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json({
        error: `Daily ad copy limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
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
  const systemPrompt = getAdCopyStrategySystemPrompt();
  const userPrompt = buildUserPrompt(context, campaigns);

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('[claude/ad-copy-strategy] Claude error:', err?.message);
    return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
  }

  if (response.stop_reason === 'max_tokens') {
    console.error('[claude/ad-copy-strategy] Response truncated — increase max_tokens or reduce campaigns');
    return NextResponse.json({ error: 'AI response was too long. Try selecting fewer campaigns.', requestId }, { status: 500 });
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
    console.error('[claude/ad-copy-strategy] JSON parse failed:', rawText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to parse AI response', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'ad_copy_strategy',
    email,
    customerId: String(customerId),
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
