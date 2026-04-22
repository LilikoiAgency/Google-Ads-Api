// src/app/api/meta/audit/route.js
// Fetches campaigns + ad sets + ads + insights + pixels for an audit.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { graphGet, getTimeRange, getMetaAccessToken } from '../../../../lib/metaGraph';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

function sumActions(actions, ...keywords) {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, a) => {
    if (keywords.some((k) => a.action_type?.includes(k))) {
      return sum + parseFloat(a.value || 0);
    }
    return sum;
  }, 0);
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function shapeInsights(ins) {
  const spend = toNum(ins?.spend);
  const revenue = sumActions(ins?.action_values, 'purchase', 'omni_purchase');
  const conversions = sumActions(ins?.actions, 'purchase', 'omni_purchase', 'lead', 'complete_registration');
  return {
    spend,
    impressions: toNum(ins?.impressions),
    clicks: toNum(ins?.clicks),
    ctr: toNum(ins?.ctr) / 100,
    cpm: toNum(ins?.cpm),
    cpc: toNum(ins?.cpc),
    frequency: toNum(ins?.frequency),
    conversions,
    revenue,
    cost_per_conversion: conversions > 0 ? spend / conversions : null,
    roas: spend > 0 ? revenue / spend : null,
  };
}

export async function GET(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  const range = searchParams.get('range') || '28d';
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const timeRange = getTimeRange(range, startDate, endDate);
  const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  try {
    const token = await getMetaAccessToken();

    const insightsFields = 'spend,impressions,clicks,ctr,cpm,cpc,frequency,actions,action_values';
    const timeRangeJson = JSON.stringify(timeRange);

    const [accountRow, campaignsResp, adSetsResp, adsResp, pixelsResp, accountInsightsResp] = await Promise.all([
      graphGet(actId, { fields: 'name,currency,account_status,business' }, token),
      graphGet(`${actId}/campaigns`, {
        fields: `id,name,objective,status,effective_status,buying_type,special_ad_categories,bid_strategy,daily_budget,lifetime_budget,insights.time_range(${timeRangeJson}){${insightsFields}}`,
        limit: 200,
      }, token),
      graphGet(`${actId}/adsets`, {
        fields: `id,name,campaign_id,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,frequency_control_specs,learning_stage_info,is_dynamic_creative,targeting{flexible_spec,custom_audiences,targeting_automation,publisher_platforms},insights.time_range(${timeRangeJson}){${insightsFields}}`,
        limit: 500,
      }, token),
      graphGet(`${actId}/ads`, {
        fields: 'id,name,ad_set_id,status,effective_status,creative{id}',
        limit: 1000,
      }, token),
      graphGet(`${actId}/adspixels`, { fields: 'id,name,last_fired_time' }, token).catch(() => ({ data: [] })),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        fields: insightsFields,
      }, token),
    ]);

    const campaignNameById = Object.fromEntries((campaignsResp.data || []).map((c) => [c.id, c.name]));

    const campaigns = (campaignsResp.data || []).map((c) => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effective_status: c.effective_status,
      buying_type: c.buying_type,
      special_ad_categories: c.special_ad_categories,
      bid_strategy: c.bid_strategy,
      daily_budget: toNum(c.daily_budget) / 100,
      lifetime_budget: toNum(c.lifetime_budget) / 100,
      ...shapeInsights(c.insights?.data?.[0]),
    }));

    const adSets = (adSetsResp.data || []).map((as) => ({
      id: as.id,
      name: as.name,
      campaign_id: as.campaign_id,
      campaign_name: campaignNameById[as.campaign_id] || null,
      status: as.status,
      effective_status: as.effective_status,
      optimization_goal: as.optimization_goal,
      billing_event: as.billing_event,
      bid_strategy: as.bid_strategy,
      daily_budget: toNum(as.daily_budget) / 100,
      lifetime_budget: toNum(as.lifetime_budget) / 100,
      targeting: as.targeting || {},
      learning_stage_info: as.learning_stage_info || null,
      is_dynamic_creative: !!as.is_dynamic_creative,
      ...shapeInsights(as.insights?.data?.[0]),
    }));

    const ads = (adsResp.data || []).map((ad) => ({
      id: ad.id,
      name: ad.name,
      ad_set_id: ad.ad_set_id,
      status: ad.status,
      effective_status: ad.effective_status,
      creative_id: ad.creative?.id || null,
    }));

    const pixels = (pixelsResp.data || []);
    const accountInsights = shapeInsights(accountInsightsResp.data?.[0]);

    return NextResponse.json({
      data: {
        account: {
          id: accountRow.id,
          name: accountRow.name,
          currency: accountRow.currency,
          accountStatus: accountRow.account_status,
          business: accountRow.business,
        },
        campaigns,
        adSets,
        ads,
        pixels,
        accountInsights,
        dateRange: timeRange,
      },
    });
  } catch (err) {
    const status = err?.status || 500;
    return NextResponse.json(
      { error: err?.message || 'Meta API error', code: err?.code },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
