// src/app/api/claude/account-brief/route.js
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { apiCache } from '../../../../lib/apiCache';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';

const MODEL = 'claude-haiku-4-5-20251001';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

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

  const { customerId, customerName, campaigns, dateLabel, forceRefresh } = body;
  if (!customerId || !Array.isArray(campaigns)) {
    return NextResponse.json({ error: 'customerId and campaigns required' }, { status: 400 });
  }

  // Spend gate — don't call Claude if account has no spend
  const totalSpendMicros = campaigns.reduce((sum, c) => sum + (c.cost || 0), 0);
  if (totalSpendMicros === 0) {
    return NextResponse.json({ skipped: true, reason: 'no_spend' });
  }

  // Cache check
  const cacheKey = `account-brief:${customerId}:${dateLabel || 'LAST_30_DAYS'}`;
  if (!forceRefresh) {
    const cached = await apiCache.get(cacheKey);
    if (cached) return NextResponse.json({ ...cached, fromCache: true });
  }

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
  const withSpend = campaigns
    .filter((c) => c.cost > 0)
    .map((c) => ({
      id: c.campaignId,
      name: c.campaignName,
      spend: +(c.cost / 1_000_000).toFixed(2),
      conversions: +(c.conversions || 0).toFixed(1),
      clicks: c.clicks || 0,
      cpa: c.conversions > 0 ? +((c.cost / 1_000_000) / c.conversions).toFixed(2) : null,
      status: c.status === 2 ? 'ACTIVE' : c.status === 3 ? 'PAUSED' : 'OTHER',
      optimizationScore: c.optimizationScore != null ? Math.round(c.optimizationScore * 100) : null,
    }));

  if (withSpend.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no_campaigns_with_spend' });
  }

  const byConversions = [...withSpend].sort((a, b) => b.conversions - a.conversions);
  const topPerformers = byConversions.slice(0, 3);
  const bottomPerformers = [...withSpend]
    .sort((a, b) => {
      const aCpa = a.conversions > 0 ? a.spend / a.conversions : a.spend * 100;
      const bCpa = b.conversions > 0 ? b.spend / b.conversions : b.spend * 100;
      return bCpa - aCpa;
    })
    .filter((c) => !topPerformers.some((t) => t.id === c.id))
    .slice(0, 3);

  const userPrompt = `You are a senior Google Ads strategist. Analyze this account and return a JSON briefing.

ACCOUNT: ${customerName || customerId}
PERIOD: ${dateLabel || 'Last 30 days'}
TOTAL SPEND: $${totalSpend.toFixed(2)}
TOTAL CONVERSIONS: ${withSpend.reduce((s, c) => s + c.conversions, 0).toFixed(1)}
ACTIVE CAMPAIGNS: ${withSpend.filter((c) => c.status === 'ACTIVE').length} of ${campaigns.length}

TOP PERFORMING CAMPAIGNS (by conversions):
${topPerformers.map((c) => `- ${c.name}: $${c.spend} spend, ${c.conversions} conv, CPA ${c.cpa ? '$' + c.cpa : 'N/A'}`).join('\n') || 'None with conversions'}

UNDERPERFORMING CAMPAIGNS (zero conv or high CPA):
${bottomPerformers.map((c) => `- ${c.name}: $${c.spend} spend, ${c.conversions} conv, CPA ${c.cpa ? '$' + c.cpa : 'N/A'}, status: ${c.status}`).join('\n') || 'None identified'}

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

Rules: reference specific campaign names and dollar amounts. topPerformers and bottomPerformers max 3 each. actions max 3. Be direct and specific, no filler.`;

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

    const result = { briefing, generatedAt: new Date().toISOString() };
    apiCache.setBackground(cacheKey, result, CACHE_TTL_MS);
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
