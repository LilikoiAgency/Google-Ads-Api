import { NextResponse } from 'next/server';
import { GoogleAdsApi } from 'google-ads-api';
import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../lib/auth';
import { getCredentials } from '../../../lib/dbFunctions';
import { createAuthedGscClient, getGscToken } from '../../../lib/gscClient';

// ─── helpers ────────────────────────────────────────────────────────────────

function normalizeKeyword(str) {
    return (str || '').toLowerCase().replace(/[+"\[\]]/g, '').trim();
}

function microsToDollars(micros) {
    return (Number(micros) || 0) / 1_000_000;
}

function safeCpa(cost, conversions) {
    return conversions > 0 ? cost / conversions : null;
}

// ─── cross-reference logic ───────────────────────────────────────────────────

function buildReport({ keywords, campaigns, gscQueries }) {
    const totalSpend = campaigns.reduce((s, c) => s + c.cost, 0);
    const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0);
    const blendedCpa = safeCpa(totalSpend, totalConversions);

    const organicClicks = gscQueries.reduce((s, q) => s + q.clicks, 0);
    const organicImpressions = gscQueries.reduce((s, q) => s + q.impressions, 0);

    // Build lookup maps (normalized keyword → data)
    const paidMap = new Map();
    for (const kw of keywords) {
        const key = normalizeKeyword(kw.text);
        if (!paidMap.has(key)) {
            paidMap.set(key, { ...kw, normalizedText: key });
        } else {
            // Aggregate duplicate keywords across ad groups
            const existing = paidMap.get(key);
            existing.cost += kw.cost;
            existing.clicks += kw.clicks;
            existing.impressions += kw.impressions;
            existing.conversions += kw.conversions;
        }
    }

    const gscMap = new Map();
    for (const q of gscQueries) {
        const key = normalizeKeyword(q.query);
        gscMap.set(key, q);
    }

    // ── Stop Bidding: paid keywords that rank organically ≤ 5 ──
    const stopBidding = [];
    for (const [key, paid] of paidMap) {
        const organic = gscMap.get(key);
        if (organic && organic.position <= 5) {
            stopBidding.push({
                keyword: paid.text,
                organicPosition: parseFloat(organic.position.toFixed(1)),
                organicImpressions: organic.impressions,
                paidSpend: paid.cost,
                paidClicks: paid.clicks,
                paidConversions: paid.conversions,
                paidCpa: safeCpa(paid.cost, paid.conversions),
                recommendation: organic.position <= 2
                    ? 'Pause — dominant organic rank'
                    : 'Reduce bids significantly',
            });
        }
    }
    stopBidding.sort((a, b) => b.paidSpend - a.paidSpend);

    // ── Wasted Spend: paid keywords with zero conversions, spend > $0 ──
    const wastedSpend = [];
    for (const [, paid] of paidMap) {
        if (paid.conversions === 0 && paid.cost > 0) {
            wastedSpend.push({
                keyword: paid.text,
                paidSpend: paid.cost,
                paidClicks: paid.clicks,
                campaignName: paid.campaignName,
                action: 'Pause or add as negative keyword',
            });
        }
    }
    wastedSpend.sort((a, b) => b.paidSpend - a.paidSpend);

    // ── Missed Opportunities: organic queries not in paid, with impressions ──
    const opportunities = [];
    for (const [key, organic] of gscMap) {
        if (!paidMap.has(key) && organic.impressions >= 50) {
            let priority = 'Low';
            if (organic.impressions >= 1000 && organic.position <= 10) priority = 'High';
            else if (organic.impressions >= 200 || organic.position <= 15) priority = 'Medium';

            opportunities.push({
                keyword: organic.query,
                organicPosition: parseFloat(organic.position.toFixed(1)),
                organicImpressions: organic.impressions,
                organicClicks: organic.clicks,
                organicCtr: parseFloat((organic.ctr * 100).toFixed(2)),
                priority,
            });
        }
    }
    opportunities.sort((a, b) => b.organicImpressions - a.organicImpressions);

    // ── Overlap: in both paid and organic ──
    const overlap = [];
    for (const [key, paid] of paidMap) {
        const organic = gscMap.get(key);
        if (organic) {
            let signal = '';
            if (organic.position <= 5) signal = 'Stop bidding — strong organic';
            else if (organic.position <= 10) signal = 'Monitor — decent organic rank';
            else signal = 'Keep bidding — weak organic';

            overlap.push({
                keyword: paid.text,
                organicPosition: parseFloat(organic.position.toFixed(1)),
                organicImpressions: organic.impressions,
                organicClicks: organic.clicks,
                paidSpend: paid.cost,
                paidConversions: paid.conversions,
                paidCpa: safeCpa(paid.cost, paid.conversions),
                signal,
            });
        }
    }
    overlap.sort((a, b) => b.paidSpend - a.paidSpend);

    // ── Campaigns with CPA rating ──
    const accountMedianCpa = blendedCpa || 0;
    const lowThreshold = accountMedianCpa * 0.75;
    const highThreshold = accountMedianCpa * 1.35;

    const campaignsWithRating = campaigns.map((c) => {
        const cpa = safeCpa(c.cost, c.conversions);
        let cpaRating = 'N/A';
        if (cpa !== null) {
            if (cpa <= lowThreshold) cpaRating = 'Good';
            else if (cpa <= highThreshold) cpaRating = 'Average';
            else cpaRating = 'Poor';
        }
        return { ...c, cpa, cpaRating };
    });

    const recoverableSpend =
        stopBidding.reduce((s, r) => s + r.paidSpend, 0) +
        wastedSpend.reduce((s, r) => s + r.paidSpend, 0);

    return {
        summary: {
            totalSpend,
            totalConversions,
            blendedCpa,
            organicClicks,
            organicImpressions,
            overlappingKeywords: overlap.length,
            recoverableSpend,
            stopBiddingCount: stopBidding.length,
            wastedSpendCount: wastedSpend.length,
            opportunitiesCount: opportunities.length,
            accountMedianCpa,
        },
        campaigns: campaignsWithRating,
        stopBidding,
        wastedSpend,
        opportunities,
        overlap,
        organic: gscQueries
            .slice()
            .sort((a, b) => b.clicks - a.clicks)
            .slice(0, 200)
            .map((q) => ({
                query: q.query,
                position: parseFloat(q.position.toFixed(1)),
                impressions: q.impressions,
                clicks: q.clicks,
                ctr: parseFloat((q.ctr * 100).toFixed(2)),
                inPaid: paidMap.has(normalizeKeyword(q.query)),
            })),
    };
}

// ─── route handler ───────────────────────────────────────────────────────────

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

    const { customerId, customerName, startDate, endDate, siteUrl } = body;

    if (!customerId || !startDate || !endDate || !siteUrl) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    try {
        const credentials = await getCredentials();
        const gscTokenDoc = await getGscToken();

        if (!gscTokenDoc?.refresh_token) {
            return NextResponse.json({ error: 'Search Console not connected' }, { status: 400 });
        }

        const adsClient = new GoogleAdsApi({
            client_id: credentials.client_id,
            client_secret: credentials.client_secret,
            developer_token: credentials.developer_token,
        });

        const customer = adsClient.Customer({
            customer_id: customerId,
            refresh_token: credentials.refresh_token,
            login_customer_id: credentials.customer_id,
        });

        const dateFilter = `segments.date BETWEEN '${startDate}' AND '${endDate}'`;

        // ── Fetch Google Ads data in parallel ──
        const [keywordRows, campaignRows] = await Promise.all([
            customer.query(`
                SELECT
                    ad_group_criterion.keyword.text,
                    ad_group_criterion.keyword.match_type,
                    campaign.name,
                    metrics.cost_micros,
                    metrics.clicks,
                    metrics.impressions,
                    metrics.conversions
                FROM keyword_view
                WHERE
                    ${dateFilter}
                    AND campaign.status IN ('ENABLED', 'PAUSED')
                    AND ad_group.status = 'ENABLED'
                    AND ad_group_criterion.status = 'ENABLED'
                    AND metrics.impressions > 0
            `).catch(() => []),

            customer.query(`
                SELECT
                    campaign.id,
                    campaign.name,
                    metrics.cost_micros,
                    metrics.clicks,
                    metrics.impressions,
                    metrics.ctr,
                    metrics.conversions
                FROM campaign
                WHERE
                    ${dateFilter}
                    AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
                    AND metrics.impressions > 0
            `).catch(() => []),
        ]);

        // ── Fetch GSC data ──
        const auth = await createAuthedGscClient();

        if (!auth) {
            return NextResponse.json({ error: 'Search Console not connected — please reconnect.' }, { status: 400 });
        }

        const webmasters = google.webmasters({ version: 'v3', auth });

        // Fetch all GSC datasets in parallel
        const [gscResponse, gscTrendResponse, gscPagesResponse] = await Promise.all([
            webmasters.searchanalytics.query({
                siteUrl,
                requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 5000, dataState: 'final' },
            }),
            webmasters.searchanalytics.query({
                siteUrl,
                requestBody: { startDate, endDate, dimensions: ['date'], rowLimit: 500, dataState: 'final' },
            }).catch(() => ({ data: { rows: [] } })),
            webmasters.searchanalytics.query({
                siteUrl,
                requestBody: { startDate, endDate, dimensions: ['page'], rowLimit: 50, dataState: 'final' },
            }).catch(() => ({ data: { rows: [] } })),
        ]);

        const gscRows = gscResponse.data.rows || [];
        const gscTrendRows = (gscTrendResponse.data.rows || []).map(r => ({
            date: r.keys[0],
            clicks: r.clicks || 0,
            impressions: r.impressions || 0,
        })).sort((a, b) => a.date.localeCompare(b.date));

        const gscPageRows = (gscPagesResponse.data.rows || []).map(r => ({
            page: r.keys[0].replace(/^https?:\/\/[^/]+/, '') || '/',
            clicks: r.clicks || 0,
            impressions: r.impressions || 0,
            ctr: parseFloat(((r.ctr || 0) * 100).toFixed(2)),
            position: parseFloat((r.position || 0).toFixed(1)),
        })).sort((a, b) => b.clicks - a.clicks);

        // ── Shape the data ──
        const keywords = keywordRows.map((r) => ({
            text: r.ad_group_criterion?.keyword?.text || '',
            matchType: r.ad_group_criterion?.keyword?.match_type || '',
            campaignName: r.campaign?.name || '',
            cost: microsToDollars(r.metrics?.cost_micros),
            clicks: Number(r.metrics?.clicks) || 0,
            impressions: Number(r.metrics?.impressions) || 0,
            conversions: Number(r.metrics?.conversions) || 0,
        }));

        const campaigns = campaignRows.map((r) => ({
            id: r.campaign?.id || '',
            name: r.campaign?.name || '',
            cost: microsToDollars(r.metrics?.cost_micros),
            clicks: Number(r.metrics?.clicks) || 0,
            impressions: Number(r.metrics?.impressions) || 0,
            ctr: parseFloat(((Number(r.metrics?.ctr) || 0) * 100).toFixed(2)),
            conversions: Number(r.metrics?.conversions) || 0,
        })).sort((a, b) => b.cost - a.cost);

        const gscQueries = gscRows.map((r) => ({
            query: r.keys[0],
            clicks: r.clicks || 0,
            impressions: r.impressions || 0,
            ctr: r.ctr || 0,
            position: r.position || 0,
        }));

        const reportData = buildReport({ keywords, campaigns, gscQueries });

        return NextResponse.json({
            meta: {
                customerName: customerName || customerId,
                siteUrl,
                startDate,
                endDate,
                generatedAt: new Date().toISOString(),
            },
            ...reportData,
            gscTrend: gscTrendRows,
            gscPages: gscPageRows,
        });
    } catch (err) {
        console.error('Report generation error:', err);
        return NextResponse.json({ error: err.message || 'Report generation failed' }, { status: 500 });
    }
}
