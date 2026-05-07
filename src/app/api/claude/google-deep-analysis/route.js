export const maxDuration = 120;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { getGoogleDeepAnalysisSystemPrompt } from '../../../../lib/googleDeepAnalysisPrompt';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.GOOGLE_DEEP_ANALYSIS_DAILY_LIMIT || '5');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.googleDeepAnalysisCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { googleDeepAnalysisCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true }
  );
}

function buildUserPrompt(campaigns, auditData) {
  const toArr = (v) => (Array.isArray(v) ? v : []);
  const keywords = toArr(auditData?.keywords);
  const campaignConfig = toArr(auditData?.campaignConfig);
  const adStrength = toArr(auditData?.adStrength);
  const conversionActions = toArr(auditData?.conversionActions);
  const searchTerms = toArr(auditData?.campaignSearchTerms);
  const geoPerformance = toArr(auditData?.geoPerformance);
  const daypartPerformance = toArr(auditData?.daypartPerformance);
  const pmaxAssetGroups = toArr(auditData?.pmaxAssetGroups);
  const pmaxBrandExclusions = toArr(auditData?.pmaxBrandExclusions);
  const campaignAssets = toArr(auditData?.campaignAssets);
  const accountAssetTypes = toArr(auditData?.accountAssetTypes);

  const campaignLines = campaigns.map((c) => {
    const spend = ((c.cost || 0) / 1_000_000).toFixed(0);
    const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : '0';
    const cvr = c.clicks > 0 ? (((c.conversions || 0) / c.clicks) * 100).toFixed(2) : '0';
    const cpa = c.conversions > 0 ? (((c.cost || 0) / 1_000_000) / c.conversions).toFixed(2) : 'no conv';
    const cfg = campaignConfig.find((cc) => String(cc.campaignId) === String(c.campaignId)) || {};
    const lostBudget = c.searchBudgetLostImpressionShare != null ? `${(c.searchBudgetLostImpressionShare * 100).toFixed(0)}% IS lost to budget` : '';
    const lostRank = c.searchRankLostImpressionShare != null ? `${(c.searchRankLostImpressionShare * 100).toFixed(0)}% IS lost to rank` : '';
    return `${c.campaignName} (${c.channelType || 'SEARCH'}): $${spend} spend | ${c.clicks || 0} clicks | ${c.conversions || 0} conv | CTR ${ctr}% | CVR ${cvr}% | CPA $${cpa} | bidding: ${cfg.biddingStrategy || 'unknown'} | budget: $${cfg.budgetAmountMicros ? (cfg.budgetAmountMicros / 1_000_000).toFixed(0) : 'N/A'}/day | targetCPA: ${cfg.targetCpaMicros ? '$' + (cfg.targetCpaMicros / 1_000_000).toFixed(0) : 'N/A'} | ${lostBudget} ${lostRank}`.trim();
  }).join('\n');

  const kwLines = keywords.slice(0, 40).map((k) =>
    `"${k.text}" [${k.matchType}] QS:${k.qualityScore ?? 'N/A'} (CTR:${k.expectedCtr || '-'}, Rel:${k.adRelevance || '-'}, LP:${k.lpExperience || '-'}) $${((k.cost || 0) / 1_000_000).toFixed(2)} | ${k.conversions || 0} conv | ${k.campaignName || ''}`
  ).join('\n');

  const wastedTerms = searchTerms
    .filter((t) => (t.conversions || 0) === 0 && (t.cost || 0) > 500_000)
    .sort((a, b) => (b.cost || 0) - (a.cost || 0))
    .slice(0, 20);
  const convertingTerms = searchTerms
    .filter((t) => (t.conversions || 0) > 0)
    .sort((a, b) => (b.conversions || 0) - (a.conversions || 0))
    .slice(0, 20);

  const strengthLines = adStrength.map((a) =>
    `${a.campaignName} / ${a.adGroupName || 'N/A'}: strength=${a.adStrength || 'N/A'} | headlines=${a.headlineCount ?? 'N/A'} | pinned=${a.pinnedHeadlines ?? 0}`
  ).join('\n');

  const convLines = conversionActions.map((a) =>
    `${a.name}: status=${a.status || 'N/A'} | attribution=${a.attributionModel || 'N/A'} | primary=${a.isPrimary ?? 'N/A'}`
  ).join('\n');

  const acctAssets = accountAssetTypes.length ? accountAssetTypes.join(', ') : 'none';
  const campAssetLines = campaignAssets.slice(0, 15).map((ca) =>
    `${ca.campaignName}: ${(ca.assetTypes || []).join(', ') || 'none'}`
  ).join('\n');

  const pmaxLines = pmaxAssetGroups.map((pg) => {
    const hasBrandEx = pmaxBrandExclusions.some((ex) => String(ex.campaignId) === String(pg.campaignId));
    return `${pg.campaignName}: ${pg.assetGroupCount ?? 'N/A'} asset groups | brand exclusions: ${hasBrandEx ? 'YES' : 'NO'}`;
  }).join('\n');

  const geoLines = [...geoPerformance]
    .sort((a, b) => (b.cost || 0) - (a.cost || 0))
    .slice(0, 6)
    .map((g) => `${g.countryCriterionId || g.country || 'Unknown'}: $${((g.cost || 0) / 1_000_000).toFixed(0)} | ${g.conversions || 0} conv`)
    .join('\n');

  const daypartLines = [...daypartPerformance]
    .sort((a, b) => (b.conversions || 0) - (a.conversions || 0))
    .slice(0, 10)
    .map((d) => `${d.dayOfWeek || ''} hour ${d.hourOfDay ?? d.hour ?? '?'}: ${d.conversions || 0} conv | $${((d.cost || 0) / 1_000_000).toFixed(2)}`)
    .join('\n');

  return `CAMPAIGNS (${campaigns.length} total):
${campaignLines || 'No campaign data'}

KEYWORDS (top ${Math.min(keywords.length, 40)} of ${keywords.length}):
${kwLines || 'No keyword data'}

WASTED SEARCH TERMS (0 conversions, spend >$0.50):
${wastedTerms.map((t) => `"${t.searchTerm || t.term || 'N/A'}": $${((t.cost || 0) / 1_000_000).toFixed(2)} | ${t.clicks || 0} clicks`).join('\n') || 'None identified'}

CONVERTING SEARCH TERMS (top 20 by conversions):
${convertingTerms.map((t) => `"${t.searchTerm || t.term || 'N/A'}": ${t.conversions} conv | $${((t.cost || 0) / 1_000_000).toFixed(2)}`).join('\n') || 'None'}

AD STRENGTH:
${strengthLines || 'No ad strength data'}

CONVERSION ACTIONS:
${convLines || 'No conversion action data'}

ACCOUNT-LEVEL ASSETS: ${acctAssets}
CAMPAIGN ASSETS:
${campAssetLines || 'No campaign asset data'}

PERFORMANCE MAX:
${pmaxLines || 'No PMax campaigns'}

GEO PERFORMANCE (top 6 by spend):
${geoLines || 'No geo data'}

DAYPART PERFORMANCE (top 10 by conversions):
${daypartLines || 'No daypart data'}`;
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

  const { customerId, campaigns, auditData } = body;

  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required', requestId }, { status: 400 });
  }
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return NextResponse.json({ error: 'campaigns must be a non-empty array', requestId }, { status: 400 });
  }
  if (campaigns.length > 50) {
    return NextResponse.json({ error: 'Too many campaigns. Maximum 50 per request.', requestId }, { status: 400 });
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
  const systemPrompt = getGoogleDeepAnalysisSystemPrompt();
  const userPrompt = buildUserPrompt(campaigns, auditData || {});

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('[google-deep-analysis] Claude error:', err?.message);
    return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
  }

  if (response.stop_reason === 'max_tokens') {
    console.error('[google-deep-analysis] Response truncated at max_tokens');
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
    console.error('[google-deep-analysis] JSON parse failed:', rawText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to parse AI response', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'google_deep_analysis',
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
