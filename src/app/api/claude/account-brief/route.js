// src/app/api/claude/account-brief/route.js
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { apiCache } from '../../../../lib/apiCache';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';

const MODEL = 'claude-haiku-4-5-20251001';
const CACHE_VERSION = 'v4';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function msUntilNextUtcDay() {
  const now = new Date();
  const nextDay = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));
  return nextDay.getTime() - now.getTime();
}

function temperUnsafeRecommendationText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/pause immediately/gi, 'temporarily tighten budget and audit before pausing')
    .replace(/shut off/gi, 'tighten spend controls on')
    .replace(/kill/gi, 'reassess')
    .replace(/completely unresponsive/gi, 'not converting in this date range')
    .replace(/\bdevice 4\b/gi, 'Desktop')
    .replace(/\bdevice 6\b/gi, 'Other devices');
}

function temperBriefing(briefing) {
  if (!briefing || typeof briefing !== 'object') return briefing;
  return {
    ...briefing,
    headline: temperUnsafeRecommendationText(briefing.headline),
    topPerformers: (briefing.topPerformers || []).map((item) => ({
      ...item,
      metric: temperUnsafeRecommendationText(item.metric),
      insight: temperUnsafeRecommendationText(item.insight),
    })),
    bottomPerformers: (briefing.bottomPerformers || []).map((item) => ({
      ...item,
      issue: temperUnsafeRecommendationText(item.issue),
      recommendation: temperUnsafeRecommendationText(item.recommendation),
    })),
    actions: (briefing.actions || []).map((item) => ({
      ...item,
      action: temperUnsafeRecommendationText(item.action),
      impact: temperUnsafeRecommendationText(item.impact),
    })),
  };
}

function moneyFromMicros(value) {
  return +((Number(value || 0) / 1_000_000).toFixed(2));
}

function formatDevice(value) {
  const deviceMap = {
    0: 'Unspecified',
    1: 'Unknown',
    2: 'Mobile',
    3: 'Tablet',
    4: 'Desktop',
    5: 'Connected TV',
    6: 'Other',
  };
  const normalizedValue = String(value || 'UNSPECIFIED');
  if (deviceMap[normalizedValue]) return deviceMap[normalizedValue];
  return normalizedValue
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function summarizeRows(rows = [], labelKey = 'term') {
  return rows
    .slice(0, 5)
    .map((row) => {
      const spend = moneyFromMicros(row.cost);
      const conversions = Number(row.conversions || 0);
      const clicks = Number(row.clicks || 0);
      const ctr = row.ctr != null ? `${(Number(row.ctr) * 100).toFixed(2)}% CTR` : 'CTR N/A';
      const cpa = conversions > 0 ? `$${(spend / conversions).toFixed(2)} CPA` : 'no conv';
      return `${row[labelKey] || row.url || row.device || 'Unknown'}: $${spend}, ${clicks} clicks, ${conversions.toFixed(1)} conv, ${ctr}, ${cpa}`;
    });
}

function summarizeDevices(rows = []) {
  return rows
    .slice(0, 4)
    .map((row) => {
      const spend = moneyFromMicros(row.cost);
      const conversions = Number(row.conversions || 0);
      const clicks = Number(row.clicks || 0);
      const cpa = conversions > 0 ? `$${(spend / conversions).toFixed(2)} CPA` : 'no conv';
      return `${formatDevice(row.device)}: $${spend}, ${clicks} clicks, ${conversions.toFixed(1)} conv, ${cpa}`;
    });
}

function trendSummary(points = []) {
  if (!Array.isArray(points) || points.length < 2) return 'not enough trend data';
  const midpoint = Math.floor(points.length / 2);
  const first = points.slice(0, midpoint);
  const second = points.slice(midpoint);
  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const firstSpend = moneyFromMicros(sum(first, 'cost'));
  const secondSpend = moneyFromMicros(sum(second, 'cost'));
  const firstConv = sum(first, 'conversions');
  const secondConv = sum(second, 'conversions');
  return `first half $${firstSpend}/${firstConv.toFixed(1)} conv vs second half $${secondSpend}/${secondConv.toFixed(1)} conv`;
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { customerId, customerName, campaigns, dateLabel } = body;
  if (!customerId || !Array.isArray(campaigns)) {
    return NextResponse.json({ error: 'customerId and campaigns required' }, { status: 400 });
  }

  // Spend gate — don't call Claude if account has no spend
  const totalSpendMicros = campaigns.reduce((sum, c) => sum + (c.cost || 0), 0);
  if (totalSpendMicros === 0) {
    return NextResponse.json({ skipped: true, reason: 'no_spend' });
  }

  const normalizedDateLabel = dateLabel || 'LAST_30_DAYS';
  const cacheKey = `account-brief:${CACHE_VERSION}:${email}:${customerId}:${normalizedDateLabel}:${todayKey()}`;
  const cached = await apiCache.get(cacheKey);
  if (cached) return NextResponse.json({ ...cached, fromCache: true });

  // Budget cap
  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached.`, limitReached: true },
      { status: 429 },
    );
  }

  // Pre-process campaigns into top/bottom performers
  const totalSpend = totalSpendMicros / 1_000_000;
  const totalConversions = campaigns.reduce((sum, c) => sum + Number(c.conversions || 0), 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + Number(c.clicks || 0), 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + Number(c.impressions || 0), 0);
  const accountCpa = totalConversions > 0 ? totalSpend / totalConversions : null;
  const accountCvr = totalClicks > 0 ? totalConversions / totalClicks : null;
  const withSpend = campaigns
    .filter((c) => c.cost > 0)
    .map((c) => ({
      id: c.campaignId,
      name: c.campaignName,
      spend: +(c.cost / 1_000_000).toFixed(2),
      conversions: +(c.conversions || 0).toFixed(1),
      clicks: c.clicks || 0,
      impressions: c.impressions || 0,
      ctr: c.impressions > 0 ? +(((c.clicks || 0) / c.impressions) * 100).toFixed(2) : null,
      conversionRate: c.clicks > 0 ? +(((c.conversions || 0) / c.clicks) * 100).toFixed(2) : null,
      cpa: c.conversions > 0 ? +((c.cost / 1_000_000) / c.conversions).toFixed(2) : null,
      spendShare: totalSpend > 0 ? +(((c.cost / 1_000_000) / totalSpend) * 100).toFixed(1) : 0,
      status: c.status === 2 ? 'ACTIVE' : c.status === 3 ? 'PAUSED' : 'OTHER',
      channelType: c.channelType || 'UNKNOWN',
      optimizationScore: c.optimizationScore != null ? Math.round(c.optimizationScore * 100) : null,
      searchImpressionShare: c.searchImpressionShare ?? null,
      lostBudgetIs: c.searchBudgetLostImpressionShare ?? null,
      lostRankIs: c.searchRankLostImpressionShare ?? null,
      searchTermSignals: summarizeRows(c.searchTerms || [], 'term'),
      landingPageSignals: summarizeRows(c.landingPages || [], 'url'),
      deviceSignals: summarizeDevices(c.devices || []),
      trendSignal: trendSummary(c.trend || []),
    }));

  if (withSpend.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no_campaigns_with_spend' });
  }

  const byConversions = [...withSpend].sort((a, b) => b.conversions - a.conversions);
  const topPerformers = byConversions.slice(0, 3);
  const cpaBenchmark = accountCpa ?? (totalSpend / Math.max(withSpend.length, 1));
  const bottomPerformers = [...withSpend]
    .sort((a, b) => {
      const aCpa = a.conversions > 0 ? a.spend / a.conversions : a.spend + cpaBenchmark;
      const bCpa = b.conversions > 0 ? b.spend / b.conversions : b.spend + cpaBenchmark;
      return bCpa - aCpa;
    })
    .filter((c) => !topPerformers.some((t) => t.id === c.id))
    .slice(0, 3);

  function guidanceForCampaign(c) {
    if (c.conversions > 0 && c.cpa !== null && accountCpa !== null && c.cpa > accountCpa * 1.75) {
      return 'High CPA versus account average. Recommend bid/budget tightening, query or asset review, or segmentation before pausing.';
    }
    if (c.conversions === 0) {
      const spendVsCpa = accountCpa ? c.spend / accountCpa : null;
      const largeSpendShare = c.spendShare >= 25;
      const hasMeaningfulClicks = c.clicks >= 25;
      if ((spendVsCpa && spendVsCpa >= 2) || largeSpendShare) {
        return 'Zero conversions with meaningful spend. Recommend urgent diagnosis plus temporary budget or bid control; do not say pause immediately unless tracking, query intent, and landing page checks also support it.';
      }
      if (hasMeaningfulClicks) {
        return 'Zero conversions with enough clicks to review intent. Recommend search term, landing page, audience/location, and conversion tracking review before budget cuts.';
      }
      return 'Zero conversions but limited evidence. Recommend monitoring and checking early signals; avoid strong pause or cut recommendations.';
    }
    return 'Underperforming relative to peers. Recommend a specific diagnostic next step, not a blanket pause.';
  }

  const userPrompt = `You are a senior Google Ads strategist. Analyze this account and return a JSON briefing.

ACCOUNT: ${customerName || customerId}
PERIOD: ${dateLabel || 'Last 30 days'}
TOTAL SPEND: $${totalSpend.toFixed(2)}
TOTAL CONVERSIONS: ${totalConversions.toFixed(1)}
TOTAL CLICKS: ${totalClicks}
TOTAL IMPRESSIONS: ${totalImpressions}
ACCOUNT AVG CPA: ${accountCpa ? '$' + accountCpa.toFixed(2) : 'N/A'}
ACCOUNT CONVERSION RATE: ${accountCvr ? (accountCvr * 100).toFixed(2) + '%' : 'N/A'}
ACTIVE CAMPAIGNS: ${withSpend.filter((c) => c.status === 'ACTIVE').length} of ${campaigns.length}

TOP PERFORMING CAMPAIGNS (by conversions):
${topPerformers.map((c) => `- ${c.name}: $${c.spend} spend (${c.spendShare}% of account), ${c.clicks} clicks, ${c.conversions} conv, CVR ${c.conversionRate ?? 'N/A'}%, CPA ${c.cpa ? '$' + c.cpa : 'N/A'}`).join('\n') || 'None with conversions'}

CAMPAIGNS TO REVIEW (zero conversions, high CPA, or high spend share):
${bottomPerformers.map((c) => `- ${c.name}: $${c.spend} spend (${c.spendShare}% of account), ${c.clicks} clicks, ${c.impressions} impressions, CTR ${c.ctr ?? 'N/A'}%, ${c.conversions} conv, CVR ${c.conversionRate ?? 'N/A'}%, CPA ${c.cpa ? '$' + c.cpa : 'N/A'}, status: ${c.status}. Guidance: ${guidanceForCampaign(c)}`).join('\n') || 'None identified'}

DIAGNOSTIC EVIDENCE FOR CAMPAIGNS TO REVIEW:
${bottomPerformers.map((c) => `- ${c.name}
  Channel: ${c.channelType}; optimization score: ${c.optimizationScore ?? 'N/A'}%; search IS: ${c.searchImpressionShare != null ? (Number(c.searchImpressionShare) * 100).toFixed(1) + '%' : 'N/A'}; lost IS budget: ${c.lostBudgetIs != null ? (Number(c.lostBudgetIs) * 100).toFixed(1) + '%' : 'N/A'}; lost IS rank: ${c.lostRankIs != null ? (Number(c.lostRankIs) * 100).toFixed(1) + '%' : 'N/A'}
  Trend: ${c.trendSignal}
  Costly search terms: ${c.searchTermSignals.length ? c.searchTermSignals.join(' | ') : 'not available'}
  Landing pages: ${c.landingPageSignals.length ? c.landingPageSignals.join(' | ') : 'not available'}
  Devices: ${c.deviceSignals.length ? c.deviceSignals.join(' | ') : 'not available'}`).join('\n') || 'None'}

Return ONLY valid JSON in this exact shape (no markdown, no explanation):
{
  "headline": "one sentence with dollar figure summarizing account health",
  "topPerformers": [
    { "name": "...", "metric": "short performance summary", "insight": "why it works, 1 sentence" }
  ],
  "bottomPerformers": [
    { "name": "...", "issue": "what is wrong, specific", "recommendation": "exact action to take" }
  ],
  "actions": [
    { "priority": 1, "action": "specific action", "impact": "expected result" }
  ]
}

Rules: reference specific campaign names and dollar amounts. topPerformers and bottomPerformers max 3 each. actions max 3. Be direct and specific, no filler.
Write for experienced Google Ads managers. Prioritize diagnostic insight over generic advice.
For each bottom performer, the recommendation must name the first concrete thing to inspect using the diagnostic evidence above (search terms, landing page, device, impression share, trend, tracking, or bid strategy).
If diagnostic evidence is not available, say what to verify before taking action rather than pretending to know the cause.

Recommendation guardrails:
- Do not recommend "pause immediately", "kill", "shut off", or call a campaign "completely unresponsive" based only on zero conversions.
- For zero-conversion campaigns, recommend investigation first: search terms/query intent, match types, conversion tracking, landing page relevance, geo/device/audience split, and bid strategy.
- If spend is materially high versus account CPA or spend share, say "temporarily reduce budget or tighten bids while auditing" rather than "pause immediately".
- Only recommend pausing when you explicitly state what evidence would justify it, such as sustained high spend, meaningful click volume, irrelevant search terms, and confirmed conversion tracking.
- Do not invent a replacement budget number unless it is derived from account CPA, current spend, or spend share.`;

  try {
    const credentials = await getCredentials();
    const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: 'You are a senior Google Ads strategist. You write sharp, specific analysis referencing exact campaign names and dollar amounts. You always respond with valid JSON only — no markdown, no explanation.',
      messages: [{ role: 'user', content: userPrompt }],
    });

    logApiUsage({
      type: 'claude_tokens',
      email,
      model: MODEL,
      feature: 'account_brief',
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      totalTokens: (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0),
      estimatedCostUsd: estimateClaudeCost(MODEL, message.usage?.input_tokens ?? 0, message.usage?.output_tokens ?? 0),
    }).catch(() => {});

    const raw = message.content[0]?.text || '';
    let briefing;
    try {
      briefing = JSON.parse(raw);
    } catch {
      try {
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        briefing = JSON.parse(cleaned);
      } catch {
        console.warn('[account-brief] JSON parse failed. Raw output:', raw.substring(0, 500));
        return NextResponse.json(
          { error: 'briefing_parse_failed', message: 'Claude returned an unexpected response format' },
          { status: 502 },
        );
      }
    }

    const result = { briefing: temperBriefing(briefing), generatedAt: new Date().toISOString() };
    apiCache.setBackground(cacheKey, result, msUntilNextUtcDay());
    return NextResponse.json(result);
  } catch (err) {
    console.error('[account-brief] Claude error:', err.message);
    const isCredits = err.message?.toLowerCase().includes('credit balance') || err.message?.toLowerCase().includes('too low');
    if (isCredits) {
      return NextResponse.json({ error: 'AI briefing unavailable', code: 'NO_CREDITS' }, { status: 503 });
    }
    return NextResponse.json({ error: err.message || 'Briefing failed' }, { status: 500 });
  }
}
