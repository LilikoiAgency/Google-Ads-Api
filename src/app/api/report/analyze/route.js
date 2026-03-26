import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = 10;

async function checkAndIncrementUsage(email) {
    const mongoClient = await dbConnect();
    const db = mongoClient.db('tokensApi');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const doc = await db.collection('UsageLimits').findOneAndUpdate(
        { email, date: today },
        { $inc: { aiAnalysisCount: 1 }, $setOnInsert: { email, date: today } },
        { upsert: true, returnDocument: 'before' }
    );

    const countBefore = doc?.aiAnalysisCount ?? 0;
    return countBefore;
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

    // ── Rate limit check ──
    const usedToday = await checkAndIncrementUsage(email);
    if (usedToday >= DAILY_LIMIT) {
        return NextResponse.json(
            { error: `Daily limit reached — you've used all ${DAILY_LIMIT} AI analyses for today. Resets at midnight.` },
            { status: 429 }
        );
    }

    const credentials = await getCredentials();
    const client = new Anthropic({ apiKey: credentials.anthropic_api_key });

    const { meta, summary, campaigns, stopBidding, wastedSpend, opportunities, overlap } = body;

    // ── Computed aggregates Claude can reference directly ──
    const totalWastedSpend   = wastedSpend.reduce((s, k) => s + k.paidSpend, 0);
    const totalRecoverable   = stopBidding.reduce((s, k) => s + k.paidSpend, 0);
    const wasteAsPercent     = summary.totalSpend > 0 ? ((totalWastedSpend / summary.totalSpend) * 100).toFixed(1) : '0';
    const recoverablePercent = summary.totalSpend > 0 ? ((totalRecoverable / summary.totalSpend) * 100).toFixed(1) : '0';

    // ── Format each section with richer fields ──
    const topStopBidding = stopBidding.slice(0, 15).map(k =>
        `  - "${k.keyword}" | Organic pos: ${k.organicPosition} | Organic impressions: ${(k.organicImpressions || 0).toLocaleString()} | Paid spend: $${k.paidSpend.toFixed(2)} | Paid convs: ${k.paidConversions} | Paid CPA: ${k.paidCpa ? '$' + k.paidCpa.toFixed(2) : 'none'} | Rec: ${k.recommendation}`
    ).join('\n');

    const topWaste = wastedSpend.slice(0, 15).map(k =>
        `  - "${k.keyword}" | Spend: $${k.paidSpend.toFixed(2)} | Clicks: ${k.paidClicks} | Impressions: ${(k.paidImpressions || 0).toLocaleString()} | Campaign: ${k.campaignName}`
    ).join('\n');

    const topOpportunities = opportunities.slice(0, 15).map(k =>
        `  - "${k.keyword}" | Organic pos: ${k.organicPosition} | Impressions: ${(k.organicImpressions || 0).toLocaleString()} | Organic CTR: ${k.organicCtr != null ? (k.organicCtr * 100).toFixed(1) + '%' : 'N/A'} | Organic clicks: ${k.organicClicks || 0} | Priority: ${k.priority}`
    ).join('\n');

    const topCampaigns = campaigns.slice(0, 10).map(c => {
        const spendShare = summary.totalSpend > 0 ? ((c.cost / summary.totalSpend) * 100).toFixed(0) : '0';
        const convShare  = summary.totalConversions > 0 ? ((c.conversions / summary.totalConversions) * 100).toFixed(0) : '0';
        return `  - "${c.name}" | Spend: $${c.cost.toFixed(2)} (${spendShare}% of total) | Conversions: ${c.conversions} (${convShare}% of total) | CPA: ${c.cpa ? '$' + c.cpa.toFixed(2) : 'N/A'} | CTR: ${c.ctr ? (c.ctr * 100).toFixed(2) + '%' : 'N/A'} | Rating: ${c.cpaRating}`;
    }).join('\n');

    const topOverlap = overlap.slice(0, 10).map(k =>
        `  - "${k.keyword}" | Organic pos: ${k.organicPosition} | Paid spend: $${k.paidSpend.toFixed(2)} | Paid convs: ${k.paidConversions} | Signal: ${k.signal}`
    ).join('\n');

    const systemPrompt = `You are a senior paid search and SEO strategist at a digital marketing agency. You specialize in identifying cross-channel inefficiencies between Google Ads and organic search. You write sharp, direct analysis — no filler, no generic advice. Every insight you give references specific keywords, dollar amounts, campaign names, or percentages from the data provided. You think like an account manager presenting to a client who wants to know exactly what to do and why.`;

    const userPrompt = `Analyze this paid vs. organic cross-channel report and return prioritized insights.

CLIENT: ${meta.customerName}
PERIOD: ${meta.startDate} → ${meta.endDate}
SITE: ${meta.siteUrl}

## ACCOUNT SUMMARY
- Total Ad Spend: $${summary.totalSpend.toFixed(2)}
- Total Conversions: ${summary.totalConversions}
- Blended CPA: ${summary.blendedCpa ? '$' + summary.blendedCpa.toFixed(2) : 'N/A'}
- Organic Clicks (GSC): ${summary.organicClicks.toLocaleString()}
- Organic Impressions: ${summary.organicImpressions.toLocaleString()}
- Overlapping Keywords: ${summary.overlappingKeywords}
- Recoverable Spend (stop bidding): $${totalRecoverable.toFixed(2)} (${recoverablePercent}% of total spend)
- Wasted Spend (zero conversions): $${totalWastedSpend.toFixed(2)} (${wasteAsPercent}% of total spend)

## STOP BIDDING CANDIDATES — ${stopBidding.length} keywords, $${totalRecoverable.toFixed(2)} recoverable
These keywords rank organically in the top 5 but are still receiving paid spend.
${topStopBidding || '  None identified.'}

## WASTED SPEND — ${wastedSpend.length} keywords, $${totalWastedSpend.toFixed(2)} total waste
Zero conversions over the reporting period.
${topWaste || '  None identified.'}

## MISSED OPPORTUNITIES — ${opportunities.length} keywords with organic presence but no paid coverage
Low organic CTR or weak position despite meaningful impressions — paid support could help.
${topOpportunities || '  None identified.'}

## CAMPAIGN PERFORMANCE — top 10 by spend
Spend share and conversion share highlight budget/output imbalances.
${topCampaigns || '  No campaign data.'}

## PAID + ORGANIC OVERLAP — ${overlap.length} keywords in both channels
${topOverlap || '  None identified.'}

---

Respond in exactly this format. Use real numbers, keyword names, and campaign names throughout. Do not be vague or generic.

## Executive Summary
3 sentences max. State the overall account health, the single biggest inefficiency (with dollar figure), and the single biggest untapped opportunity.

## Top 3 Priority Actions
Numbered. Each action must: name the specific keywords or campaigns, state the expected dollar impact or efficiency gain, and say exactly what to do (pause, reduce bid, add keyword, shift budget).

## Quick Wins (do this week)
Bullet list. Actions that take under 30 minutes with immediate impact. Reference specific keywords or campaigns.

## Strategic Recommendations (next 30–60 days)
Bullet list. Structural changes backed by data from this report. Explain the why for each.

## Risks to Watch
Bullet list. Specific red flags or trends that will worsen if ignored. State what to monitor and why.`;

    try {
        const message = await client.messages.create({
            model: 'claude-opus-4-6',
            max_tokens: 2000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        });

        const analysis = message.content[0]?.text || '';
        return NextResponse.json({ analysis, remainingToday: DAILY_LIMIT - usedToday - 1 });
    } catch (err) {
        console.error('Claude analyze error:', err);
        return NextResponse.json({ error: err.message || 'Analysis failed' }, { status: 500 });
    }
}
