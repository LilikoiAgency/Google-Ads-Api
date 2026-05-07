export const maxDuration = 120;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { getMetaDeepAnalysisSystemPrompt } from '../../../../lib/metaDeepAnalysisPrompt';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.META_DEEP_ANALYSIS_DAILY_LIMIT || '5');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.metaDeepAnalysisCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { metaDeepAnalysisCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true }
  );
}

const toArr = (v) => (Array.isArray(v) ? v : []);

function buildUserPrompt(auditData) {
  const campaigns  = toArr(auditData?.campaigns);
  const adSets     = toArr(auditData?.adSets);
  const ads        = toArr(auditData?.ads);
  const pixels     = toArr(auditData?.pixels);
  const insights   = auditData?.accountInsights || {};

  const campaignLines = campaigns.map((c) =>
    `${c.name} (${c.status}): objective=${c.objective || 'N/A'} | spend=$${Number(c.spend || 0).toFixed(2)} | clicks=${c.clicks || 0} | impressions=${c.impressions || 0} | conversions=${c.conversions || 0} | ROAS=${Number(c.roas || 0).toFixed(2)}`
  ).join('\n');

  const adSetLines = adSets.slice(0, 30).map((a) => {
    const learningInfo = a.learning_stage_info?.status ? ` | learning=${a.learning_stage_info.status}` : '';
    const budget = a.daily_budget ? `$${(Number(a.daily_budget) / 100).toFixed(0)}/day` : a.lifetime_budget ? `$${(Number(a.lifetime_budget) / 100).toFixed(0)} lifetime` : 'N/A';
    return `${a.name} (${a.status}): campaign="${a.campaign_name || 'N/A'}" | budget=${budget} | opt_goal=${a.optimization_goal || 'N/A'} | bid=${a.bid_strategy || 'N/A'} | dco=${a.is_dynamic_creative ? 'YES' : 'NO'} | spend=$${Number(a.spend || 0).toFixed(2)} | freq=${Number(a.frequency || 0).toFixed(2)} | ctr=${Number(a.ctr || 0).toFixed(3)}%${learningInfo}`;
  }).join('\n');

  const adsPerSet = {};
  ads.forEach((ad) => {
    const key = ad.ad_set_id || 'unknown';
    adsPerSet[key] = (adsPerSet[key] || 0) + 1;
  });
  const adCountLines = Object.entries(adsPerSet).map(([id, count]) => {
    const set = adSets.find((a) => a.id === id);
    return `${set?.name || id}: ${count} ads`;
  }).join('\n');

  const creativeFormats = new Set();
  ads.forEach((ad) => {
    if (ad.creative?.video_id || ad.format === 'video') creativeFormats.add('video');
    else if (ad.format === 'carousel') creativeFormats.add('carousel');
    else if (ad.format === 'collection') creativeFormats.add('collection');
    else creativeFormats.add('image');
  });

  const pixelLines = pixels.map((p) =>
    `Pixel ${p.id}: name="${p.name}" | code=${p.code_status || 'N/A'} | emq=${p.data_use_setting || 'N/A'} | events=${(p.matched_entries || []).join(', ') || 'N/A'}`
  ).join('\n');

  const accountLine = `Spend: $${Number(insights.spend || 0).toFixed(2)} | Impressions: ${insights.impressions || 0} | Clicks: ${insights.clicks || 0} | CTR: ${Number(insights.ctr || 0).toFixed(3)}% | CPM: $${Number(insights.cpm || 0).toFixed(2)} | Conversions: ${insights.conversions || 0} | ROAS: ${Number(insights.roas || 0).toFixed(2)} | Frequency: ${Number(insights.frequency || 0).toFixed(2)}`;

  return `ACCOUNT OVERVIEW:
${accountLine}

CAMPAIGNS (${campaigns.length} total):
${campaignLines || 'No campaign data'}

AD SETS (${adSets.length} total, showing up to 30):
${adSetLines || 'No ad set data'}

ADS PER AD SET:
${adCountLines || 'No ad data'}

CREATIVE FORMATS DETECTED: ${Array.from(creativeFormats).join(', ') || 'unknown'}
TOTAL ADS: ${ads.length}

PIXELS / CAPI:
${pixelLines || 'No pixel data'}`;
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

  const { accountId, auditData } = body;
  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required', requestId }, { status: 400 });
  }
  if (!auditData || toArr(auditData.campaigns).length === 0) {
    return NextResponse.json({ error: 'auditData.campaigns must be a non-empty array', requestId }, { status: 400 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const usedToday = await getDailyUsageCount(db, email);
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json({
        error: `Daily deep analysis limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
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
  const systemPrompt = getMetaDeepAnalysisSystemPrompt();
  const userPrompt = buildUserPrompt(auditData);

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('[meta-deep-analysis] Claude error:', err?.message);
    return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
  }

  if (response.stop_reason === 'max_tokens') {
    console.error('[meta-deep-analysis] Response truncated at max_tokens');
    return NextResponse.json({ error: 'AI response was too long. Try again.', requestId }, { status: 500 });
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
    console.error('[meta-deep-analysis] JSON parse failed:', rawText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to parse AI response', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'meta_deep_analysis',
    email,
    accountId: String(accountId),
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
