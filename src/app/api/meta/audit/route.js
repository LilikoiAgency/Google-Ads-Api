// src/app/api/meta/audit/route.js
// Fetches campaigns + ad sets + ads + insights + pixels for an audit.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { graphGet, getTimeRange, getMetaAccessToken } from '../../../../lib/metaGraph';
import { apiCache } from '../../../../lib/apiCache';

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

  const cacheKey = `meta-audit:${actId}:${range}:${startDate || ''}:${endDate || ''}`;
  const cached = await apiCache.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const token = await getMetaAccessToken();

    const insightsFields = 'spend,impressions,clicks,ctr,cpm,cpc,frequency,actions,action_values';
    const timeRangeJson = JSON.stringify(timeRange);
    // Meta rejects deep combined expansions (code 1 "data too big") so we:
    // 1) Filter entities to active-only to trim the result set.
    // 2) Fetch entity metadata without inline insights.
    // 3) Pull insights in one batch per level (campaign / adset) and merge by id.
    const activeFilter = JSON.stringify([
      { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] },
    ]);

    const [
      accountRow,
      campaignsResp,
      adSetsResp,
      adsResp,
      pixelsResp,
      accountInsightsResp,
      campaignInsightsResp,
      adSetInsightsResp,
      adInsightsResp,
    ] = await Promise.all([
      graphGet(actId, { fields: 'name,currency,account_status,business' }, token),
      graphGet(`${actId}/campaigns`, {
        fields: 'id,name,objective,status,effective_status,buying_type,special_ad_categories,bid_strategy,daily_budget,lifetime_budget',
        filtering: activeFilter,
        limit: 200,
      }, token),
      graphGet(`${actId}/adsets`, {
        fields: 'id,name,campaign_id,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,frequency_control_specs,learning_stage_info,is_dynamic_creative,targeting{flexible_spec,custom_audiences,targeting_automation,publisher_platforms}',
        filtering: activeFilter,
        limit: 300,
      }, token),
      graphGet(`${actId}/ads`, {
        fields: 'id,name,ad_set_id,status,effective_status,creative{id,title,body,call_to_action_type,image_url,thumbnail_url,object_story_id}',
        filtering: activeFilter,
        limit: 500,
      }, token),
      graphGet(`${actId}/adspixels`, { fields: 'id,name,last_fired_time' }, token).catch(() => ({ data: [] })),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        fields: insightsFields,
      }, token),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        level: 'campaign',
        fields: `campaign_id,${insightsFields}`,
        limit: 500,
      }, token).catch((err) => {
        console.warn('[meta/audit] campaign-level insights fetch failed:', err?.message);
        return { data: [] };
      }),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        level: 'adset',
        fields: `adset_id,${insightsFields}`,
        limit: 1000,
      }, token).catch((err) => {
        console.warn('[meta/audit] adset-level insights fetch failed:', err?.message);
        return { data: [] };
      }),
      graphGet(`${actId}/insights`, {
        time_range: timeRangeJson,
        level: 'ad',
        fields: `ad_id,${insightsFields}`,
        limit: 1000,
      }, token).catch((err) => {
        console.warn('[meta/audit] ad-level insights fetch failed:', err?.message);
        return { data: [] };
      }),
    ]);

    const campaignNameById = Object.fromEntries((campaignsResp.data || []).map((c) => [c.id, c.name]));

    const campaignInsightsById = {};
    for (const row of campaignInsightsResp.data || []) {
      if (row.campaign_id) campaignInsightsById[row.campaign_id] = shapeInsights(row);
    }
    const adSetInsightsById = {};
    for (const row of adSetInsightsResp.data || []) {
      if (row.adset_id) adSetInsightsById[row.adset_id] = shapeInsights(row);
    }
    const adInsightsById = {};
    for (const row of adInsightsResp.data || []) {
      if (row.ad_id) adInsightsById[row.ad_id] = shapeInsights(row);
    }

    const zeroInsights = shapeInsights({});

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
      ...(campaignInsightsById[c.id] || zeroInsights),
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
      ...(adSetInsightsById[as.id] || zeroInsights),
    }));

    const ads = (adsResp.data || []).map((ad) => {
      const ins = adInsightsById[ad.id] || zeroInsights;
      return {
        id: ad.id,
        name: ad.name,
        ad_set_id: ad.ad_set_id,
        status: ad.status,
        effective_status: ad.effective_status,
        creative_id: ad.creative?.id || null,
        creative: ad.creative
          ? {
              id: ad.creative.id,
              title: ad.creative.title || null,
              body: ad.creative.body || null,
              call_to_action_type: ad.creative.call_to_action_type || null,
              image_url: ad.creative.image_url || ad.creative.thumbnail_url || null,
              object_story_id: ad.creative.object_story_id || null,
            }
          : null,
        // Spread insights into top-level fields so audit logic keeps working,
        // and also keep them under `insights` so MetaAdPreview can consume them.
        ...ins,
        insights: ins,
      };
    });

    const pixels = (pixelsResp.data || []);
    const accountInsights = shapeInsights(accountInsightsResp.data?.[0]);

    const responseData = {
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
    };
    apiCache.setBackground(cacheKey, responseData, 10 * 60 * 1000);
    return NextResponse.json(responseData);
  } catch (err) {
    console.error('[meta/audit] Meta API error:', {
      message: err?.message,
      status: err?.status,
      code: err?.code,
      subcode: err?.subcode,
      stack: err?.stack?.split('\n').slice(0, 3).join(' | '),
    });
    const status = err?.status || 500;
    return NextResponse.json(
      { error: err?.message || 'Meta API error', code: err?.code, subcode: err?.subcode, waitMinutes: err?.waitMinutes },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
