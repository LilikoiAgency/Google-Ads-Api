import { NextResponse } from "next/server";
import { graphGet, getTimeRange, getMetaAccessToken } from "../../../lib/metaGraph";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Returns the equivalent previous period (same number of days, directly before)
function getPrevTimeRange(timeRange) {
  const since = new Date(timeRange.since + "T00:00:00Z");
  const until = new Date(timeRange.until + "T00:00:00Z");
  const days  = Math.round((until - since) / 86400000) + 1;
  const prevUntil = new Date(since.getTime() - 86400000);
  const prevSince = new Date(prevUntil.getTime() - (days - 1) * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { since: fmt(prevSince), until: fmt(prevUntil) };
}

// Sum specific action types from Meta's actions array
function sumActions(actions, ...keywords) {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((a) => keywords.some((k) => (a.action_type || "").includes(k)))
    .reduce((s, a) => s + parseFloat(a.value || 0), 0);
}

const CONVERSION_TYPES = ["purchase", "lead", "complete_registration", "offsite_conversion", "fb_pixel_purchase"];
const REVENUE_TYPES    = ["purchase", "offsite_conversion.fb_pixel_purchase", "offsite_conversion"];

function parseInsightRow(d) {
  if (!d) return null;
  const spend       = parseFloat(d.spend       || 0);
  const clicks      = parseInt(d.clicks        || 0, 10);
  const impressions = parseInt(d.impressions   || 0, 10);
  const reach       = parseInt(d.reach         || 0, 10);
  const ctr         = parseFloat(d.ctr         || 0);
  const cpc         = parseFloat(d.cpc         || 0);
  const cpm         = parseFloat(d.cpm         || 0);
  const frequency   = parseFloat(d.frequency   || 0);
  const conversions = sumActions(d.actions,      ...CONVERSION_TYPES);
  const revenue     = sumActions(d.action_values,...REVENUE_TYPES);
  const roas        = spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0;
  const costPerResult = conversions > 0 ? parseFloat((spend / conversions).toFixed(2)) : 0;
  return { spend, clicks, impressions, reach, ctr, cpc, cpm, frequency, conversions, revenue, roas, costPerResult };
}

const INSIGHT_FIELDS = "spend,clicks,impressions,reach,ctr,cpc,cpm,frequency,actions,action_values";
const ZERO_METRICS   = { spend: 0, clicks: 0, impressions: 0, reach: 0, ctr: 0, cpc: 0, cpm: 0, frequency: 0, conversions: 0, revenue: 0, roas: 0, costPerResult: 0 };

// ─── main route ───────────────────────────────────────────────────────────────

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  let token;
  try {
    token = await getMetaAccessToken();
  } catch {
    // Fall back to env var if Mongo credentials are not configured
    token = process.env.META_ACCESS_TOKEN;
  }

  if (!token) {
    return NextResponse.json({ error: "Meta access token not configured. Add META_ACCESS_TOKEN to the Tokens collection in MongoDB." }, { status: 500 });
  }

  const rawAccountId = searchParams.get("accountId") || process.env.META_AD_ACCOUNT_ID;
  if (!rawAccountId) {
    return NextResponse.json({ error: "No ad account specified. Pass ?accountId= or set META_AD_ACCOUNT_ID." }, { status: 400 });
  }

  const accountId = rawAccountId.replace(/^act_/, "");
  const range     = searchParams.get("range")     || "28d";
  const startDate = searchParams.get("startDate") || null;
  const endDate   = searchParams.get("endDate")   || null;
  const timeRange = getTimeRange(range, startDate, endDate);
  const actId     = `act_${accountId}`;

  // ── Ad Set mode: return ad sets for a specific campaign ───────────────────
  const campaignId = searchParams.get("campaignId");
  if (campaignId) {
    try {
      const adSetsRes = await graphGet(`${campaignId}/adsets`, {
        fields: `id,name,status,targeting,insights.time_range(${JSON.stringify(timeRange)}){${INSIGHT_FIELDS}}`,
        limit:  100,
      }, token);

      const adsets = (adSetsRes.data || [])
        .map((s) => {
          const insightData = s.insights?.data?.[0] || null;
          const metrics     = parseInsightRow(insightData) || { ...ZERO_METRICS };
          return {
            id:     s.id,
            name:   s.name,
            status: s.status,
            ...metrics,
          };
        })
        .filter((s) => s.spend > 0)
        .sort((a, b) => b.spend - a.spend);

      return NextResponse.json({ adsets });
    } catch (err) {
      console.error("[meta-ads] Ad sets error:", err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  try {
    const prevTimeRange = getPrevTimeRange(timeRange);

    // ── Fetch all data in parallel ──────────────────────────────────────────
    const [accountRes, totalsRes, prevTotalsRes, campaignsRes, trendRes] = await Promise.all([

      // 1. Account info
      graphGet(actId, { fields: "name,currency,account_status" }, token),

      // 2. Current period totals
      graphGet(`${actId}/insights`, {
        fields:     INSIGHT_FIELDS,
        time_range: timeRange,
      }, token),

      // 3. Previous period totals (for delta comparison)
      graphGet(`${actId}/insights`, {
        fields:     INSIGHT_FIELDS,
        time_range: prevTimeRange,
      }, token),

      // 4. All campaigns with nested insights
      graphGet(`${actId}/campaigns`, {
        fields: `id,name,status,objective,insights.time_range(${JSON.stringify(timeRange)}){${INSIGHT_FIELDS}}`,
        limit:  200,
      }, token),

      // 5. Daily trend
      graphGet(`${actId}/insights`, {
        fields:         "spend,clicks,impressions",
        time_range:     timeRange,
        time_increment: 1,
        limit:          180,
      }, token),
    ]);

    // ── Parse account info ─────────────────────────────────────────────────
    const account = {
      id:       accountId,
      name:     accountRes.name     || `Account ${accountId}`,
      currency: accountRes.currency || "USD",
      status:   accountRes.account_status,
    };

    // ── Parse totals ───────────────────────────────────────────────────────
    const totalsRow    = Array.isArray(totalsRes.data)     ? totalsRes.data[0]     : null;
    const prevTotalsRow= Array.isArray(prevTotalsRes.data) ? prevTotalsRes.data[0] : null;
    const totals       = parseInsightRow(totalsRow)     || { ...ZERO_METRICS };
    const prevTotals   = parseInsightRow(prevTotalsRow) || { ...ZERO_METRICS };

    // ── Parse campaigns — exclude $0 spend in the selected period ─────────
    const campaigns = (campaignsRes.data || [])
      .map((c) => {
        const insightData = c.insights?.data?.[0] || null;
        const metrics     = parseInsightRow(insightData) || { ...ZERO_METRICS };
        return {
          id:        c.id,
          name:      c.name,
          status:    c.status,
          objective: c.objective || null,
          ...metrics,
        };
      })
      .filter((c) => c.spend > 0)
      .sort((a, b) => b.spend - a.spend);

    // ── Parse daily trend ──────────────────────────────────────────────────
    const trend = (trendRes.data || [])
      .map((d) => ({
        date:        d.date_start,
        spend:       parseFloat(d.spend       || 0),
        clicks:      parseInt(d.clicks        || 0, 10),
        impressions: parseInt(d.impressions   || 0, 10),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      account,
      totals,
      prevTotals,
      campaigns,
      trend,
      startDate: timeRange.since,
      endDate:   timeRange.until,
    });

  } catch (err) {
    console.error("[meta-ads] Error:", err.message);
    return NextResponse.json({ error: err.message || "Failed to fetch Meta Ads data" }, { status: 500 });
  }
}
