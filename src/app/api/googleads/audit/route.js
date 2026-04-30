// src/app/api/googleads/audit/route.js
import { NextResponse } from 'next/server';
import { GoogleAdsApi } from 'google-ads-api';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { buildDateFilter } from '../../../../lib/googleAdsHelpers';
import { logApiUsage } from '../../../../lib/usageLogger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const QS_COMPONENT_MAP = {
  UNKNOWN: null,
  UNSPECIFIED: null,
  BELOW_AVERAGE: 'BELOW_AVERAGE',
  AVERAGE: 'AVERAGE',
  ABOVE_AVERAGE: 'ABOVE_AVERAGE',
};

function mapQsComponent(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    const numMap = { 2: 'BELOW_AVERAGE', 3: 'AVERAGE', 4: 'ABOVE_AVERAGE' };
    return numMap[value] || null;
  }
  return QS_COMPONENT_MAP[String(value)] ?? null;
}

const AD_STRENGTH_NUM_MAP = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'PENDING',
  3: 'NO_ADS',
  4: 'POOR',
  5: 'AVERAGE',
  6: 'GOOD',
  7: 'EXCELLENT',
};

function enumValue(value, map = {}) {
  if (value == null) return null;
  if (typeof value === 'number') return map[value] || String(value);
  return String(value);
}

function clampChangeStatusStartDate(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return startDate;

  const maxLookback = new Date(end);
  maxLookback.setUTCDate(maxLookback.getUTCDate() - 89);
  return start < maxLookback ? maxLookback.toISOString().slice(0, 10) : startDate;
}

export async function GET(request) {
  const requestId = crypto.randomUUID();

  try {
    const session = await getServerSession(authOptions);
    const sessionEmail = session?.user?.email?.toLowerCase() || '';

    if (!sessionEmail.endsWith(`@${allowedEmailDomain}`)) {
      return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS';
    const startDateParam = searchParams.get('startDate') || undefined;
    const endDateParam = searchParams.get('endDate') || undefined;

    if (!customerId || String(customerId).trim() === '') {
      return NextResponse.json({ error: 'customerId is required', requestId }, { status: 400 });
    }

    const { dateWindow } = buildDateFilter(dateRange, startDateParam, endDateParam);
    const { startDate, endDate } = dateWindow;
    const changeStatusStartDate = clampChangeStatusStartDate(startDate, endDate);

    const credentials = await getCredentials();
    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    });

    const customer = client.Customer({
      customer_id: String(customerId),
      refresh_token: credentials.refresh_token,
      login_customer_id: credentials.customer_id,
    });

    const [
      keywordQsRaw,
      keywordMetricsRaw,
      campaignConfigRaw,
      campaignPerfRaw,
      campaignAssetsRaw,
      accountAssetsRaw,
      adStrengthRaw,
      pmaxAssetGroupsRaw,
      pmaxBrandExclusionsRaw,
      conversionActionsRaw,
      landingPagesRaw,
      campaignSearchTermsRaw,
      changeStatusRaw,
      geoPerformanceRaw,
      daypartRaw,
      conversionLagRaw,
    ] = await Promise.all([
      // QS + attributes — ad_group_criterion does NOT allow performance metrics with date filtering;
      // fetch criterion data only (no metrics) so quality_score is returned for all active keywords
      customer.query(`
        SELECT
          ad_group_criterion.criterion_id,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.status,
          ad_group_criterion.quality_info.quality_score,
          ad_group_criterion.quality_info.creative_quality_score,
          ad_group_criterion.quality_info.post_click_quality_score,
          ad_group_criterion.quality_info.search_predicted_ctr,
          campaign.id, campaign.name,
          ad_group.id, ad_group.name
        FROM ad_group_criterion
        WHERE ad_group_criterion.type = 'KEYWORD'
          AND ad_group_criterion.status != 'REMOVED'
          AND campaign.status != 'REMOVED'
          AND ad_group.status != 'REMOVED'
        LIMIT 5000
      `).catch((e) => { console.error('[audit] QS query failed:', e?.message || JSON.stringify(e)); return []; }),

      // Performance metrics — keyword_view supports date-ranged metrics
      customer.query(`
        SELECT
          ad_group_criterion.criterion_id,
          campaign.id,
          ad_group.id,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.all_conversions
        FROM keyword_view
        WHERE ad_group_criterion.status != 'REMOVED'
          AND campaign.status != 'REMOVED'
          AND ad_group.status != 'REMOVED'
          AND segments.date >= '${startDate}'
          AND segments.date <= '${endDate}'
        ORDER BY metrics.cost_micros DESC LIMIT 1000
      `).catch((e) => { console.error('[audit] keyword metrics query failed:', e?.message || JSON.stringify(e)); return []; }),

      // Campaign config — no date filter needed (bidding strategy is structural)
      customer.query(`
        SELECT
          campaign.id, campaign.name,
          campaign.bidding_strategy_type,
          campaign_budget.amount_micros,
          campaign.target_cpa.target_cpa_micros,
          campaign.target_roas.target_roas,
          campaign.maximize_conversions.target_cpa_micros,
          campaign.maximize_conversion_value.target_roas,
          campaign.manual_cpc.enhanced_cpc_enabled
        FROM campaign
        WHERE campaign.status != 'REMOVED'
      `).catch(() => []),

      // Campaign performance metrics for the selected date range
      customer.query(`
        SELECT
          campaign.id,
          campaign.advertising_channel_type,
          metrics.cost_micros,
          metrics.clicks,
          metrics.impressions,
          metrics.all_conversions,
          metrics.search_budget_lost_impression_share,
          metrics.search_rank_lost_impression_share
        FROM campaign
        WHERE campaign.status != 'REMOVED'
          AND segments.date >= '${startDate}'
          AND segments.date <= '${endDate}'
      `).catch(() => []),

      // Campaign-level assets — use field_type (AssetFieldType) not asset_type (AssetType)
      customer.query(`
        SELECT campaign.id, campaign_asset.field_type
        FROM campaign_asset
        WHERE campaign_asset.status != 'REMOVED'
          AND campaign.status != 'REMOVED'
      `).catch(() => []),

      // Account-level assets apply to all campaigns
      customer.query(`
        SELECT customer_asset.field_type
        FROM customer_asset
        WHERE customer_asset.status != 'REMOVED'
      `).catch(() => []),

      customer.query(`
        SELECT
          campaign.id,
          ad_group.id,
          ad_group_ad.ad_strength,
          ad_group_ad.status,
          ad_group_ad.ad.responsive_search_ad.headlines
        FROM ad_group_ad
        WHERE ad_group_ad.status = 'ENABLED'
          AND ad_group.status = 'ENABLED'
          AND campaign.status != 'REMOVED'
      `).catch(() => []),

      customer.query(`
        SELECT
          campaign.id,
          campaign.name,
          asset_group.id,
          asset_group.name,
          asset_group.ad_strength,
          asset_group.status
        FROM asset_group
        WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
          AND campaign.status != 'REMOVED'
          AND asset_group.status != 'REMOVED'
      `).catch(() => []),

      customer.query(`
        SELECT
          campaign.id,
          campaign_criterion.type,
          campaign_criterion.negative
        FROM campaign_criterion
        WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
          AND campaign.status != 'REMOVED'
          AND campaign_criterion.negative = TRUE
      `).catch(() => []),

      customer.query(`
        SELECT
          conversion_action.id,
          conversion_action.name,
          conversion_action.category,
          conversion_action.type,
          conversion_action.status,
          conversion_action.origin,
          conversion_action.include_in_conversions_metric,
          conversion_action.primary_for_goal,
          conversion_action.counting_type,
          conversion_action.attribution_model_settings.attribution_model,
          conversion_action.attribution_model_settings.data_driven_model_status,
          conversion_action.click_through_lookback_window_days,
          conversion_action.view_through_lookback_window_days,
          conversion_action.value_settings.default_value,
          conversion_action.value_settings.always_use_default_value,
          metrics.conversion_last_received_request_date_time,
          metrics.conversion_last_conversion_date,
          metrics.all_conversions,
          metrics.all_conversions_value
        FROM conversion_action
        WHERE conversion_action.status != 'REMOVED'
        LIMIT 200
      `).catch((e) => { console.error('[audit] conversion actions query failed:', e?.message || JSON.stringify(e)); return []; }),

      customer.query(`
        SELECT
          expanded_landing_page_view.expanded_final_url,
          campaign.id,
          campaign.name,
          segments.device,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.all_conversions,
          metrics.conversions,
          metrics.speed_score,
          metrics.mobile_friendly_clicks_percentage,
          metrics.valid_accelerated_mobile_pages_clicks_percentage
        FROM expanded_landing_page_view
        WHERE segments.date >= '${startDate}'
          AND segments.date <= '${endDate}'
        ORDER BY metrics.cost_micros DESC
        LIMIT 500
      `).catch((e) => { console.error('[audit] landing pages query failed:', e?.message || JSON.stringify(e)); return []; }),

      customer.query(`
        SELECT
          search_term_view.search_term,
          search_term_view.status,
          campaign.id,
          campaign.name,
          segments.search_term_match_type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.all_conversions,
          metrics.all_conversions_value
        FROM search_term_view
        WHERE segments.date >= '${startDate}'
          AND segments.date <= '${endDate}'
          AND campaign.advertising_channel_type = 'SEARCH'
        ORDER BY metrics.cost_micros DESC
        LIMIT 1000
      `).catch((e) => { console.error('[audit] campaign search terms query failed:', e?.message || JSON.stringify(e)); return []; }),

      customer.query(`
        SELECT
          change_status.resource_type,
          change_status.resource_status,
          change_status.last_change_date_time,
          change_status.campaign,
          change_status.ad_group,
          change_status.ad_group_ad,
          change_status.ad_group_criterion,
          change_status.asset,
          change_status.asset_group,
          change_status.campaign_budget,
          change_status.campaign_criterion
        FROM change_status
        WHERE change_status.last_change_date_time >= '${changeStatusStartDate} 00:00:00'
          AND change_status.last_change_date_time <= '${endDate} 23:59:59'
        ORDER BY change_status.last_change_date_time DESC
        LIMIT 300
      `).catch((e) => { console.error('[audit] change status query failed:', e?.message || JSON.stringify(e)); return []; }),

      customer.query(`
        SELECT
          campaign.id,
          campaign.name,
          geographic_view.country_criterion_id,
          geographic_view.location_type,
          segments.geo_target_region,
          segments.geo_target_city,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.all_conversions
        FROM geographic_view
        WHERE segments.date >= '${startDate}'
          AND segments.date <= '${endDate}'
        ORDER BY metrics.cost_micros DESC
        LIMIT 500
      `).catch((e) => { console.error('[audit] geo performance query failed:', e?.message || JSON.stringify(e)); return []; }),

      customer.query(`
        SELECT
          campaign.id,
          campaign.name,
          segments.day_of_week,
          segments.hour,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.all_conversions
        FROM campaign
        WHERE campaign.status != 'REMOVED'
          AND segments.date >= '${startDate}'
          AND segments.date <= '${endDate}'
        ORDER BY metrics.cost_micros DESC
        LIMIT 1000
      `).catch((e) => { console.error('[audit] daypart query failed:', e?.message || JSON.stringify(e)); return []; }),

      customer.query(`
        SELECT
          campaign.id,
          campaign.name,
          segments.conversion_lag_bucket,
          metrics.all_conversions
        FROM campaign
        WHERE campaign.status != 'REMOVED'
          AND segments.date >= '${startDate}'
          AND segments.date <= '${endDate}'
        ORDER BY metrics.all_conversions DESC
        LIMIT 500
      `).catch((e) => { console.error('[audit] conversion lag query failed:', e?.message || JSON.stringify(e)); return []; }),
    ]);

    console.log(`[audit] raw rows — kwQS:${(keywordQsRaw||[]).length} kwMetrics:${(keywordMetricsRaw||[]).length} campaigns:${(campaignConfigRaw||[]).length} accountAssets:${(accountAssetsRaw||[]).length}`);

    // Build metrics lookup keyed by criterion_id
    const metricsById = new Map();
    (keywordMetricsRaw || []).forEach((row) => {
      const id = String(row.ad_group_criterion?.criterion_id || '');
      if (id) metricsById.set(id, row.metrics || {});
    });

    const keywords = (keywordQsRaw || []).map((row) => {
      const crit = row.ad_group_criterion || {};
      const kw = crit.keyword || {};
      const qi = crit.quality_info || {};
      const criterionId = String(crit.criterion_id || '');
      const metrics = metricsById.get(criterionId) || {};
      return {
        text: kw.text || '',
        matchType: typeof kw.match_type === 'number'
          ? ({ 2: 'EXACT', 3: 'PHRASE', 4: 'BROAD' }[kw.match_type] || String(kw.match_type))
          : (kw.match_type || ''),
        status: typeof crit.status === 'number'
          ? ({ 2: 'ENABLED', 3: 'PAUSED', 4: 'REMOVED' }[crit.status] || String(crit.status))
          : (crit.status || ''),
        qualityScore: (qi.quality_score != null && qi.quality_score > 0) ? qi.quality_score : null,
        expectedCtr: mapQsComponent(qi.search_predicted_ctr),
        adRelevance: mapQsComponent(qi.creative_quality_score),
        lpExperience: mapQsComponent(qi.post_click_quality_score),
        campaignId: String(row.campaign?.id || ''),
        campaignName: row.campaign?.name || '',
        adGroupId: String(row.ad_group?.id || ''),
        adGroupName: row.ad_group?.name || '',
        impressions: Number(metrics.impressions || 0),
        clicks: Number(metrics.clicks || 0),
        cost: Number(metrics.cost_micros || 0),
        conversions: Number(metrics.all_conversions || 0),
      };
    });

    const campaignConfig = (campaignConfigRaw || []).map((row) => {
      const c = row.campaign || {};
      const budget = row.campaign_budget || {};
      const biddingType = typeof c.bidding_strategy_type === 'number'
        ? ({
            2: 'MANUAL_CPC',
            3: 'MANUAL_CPM',
            4: 'PAGE_ONE_PROMOTED',
            5: 'TARGET_SPEND',
            6: 'TARGET_CPA',
            7: 'TARGET_ROAS',
            8: 'MAXIMIZE_CONVERSIONS',
            9: 'MAXIMIZE_CONVERSION_VALUE',
            10: 'TARGET_IMPRESSION_SHARE',
            11: 'MANUAL_CPV',
            12: 'MAXIMIZE_CLICKS',
            13: 'PERCENT_CPC',
            14: 'TARGET_CPM',
            15: 'COMMISSION',
            16: 'ENHANCED_CPC',
          }[c.bidding_strategy_type] || `STRATEGY_${c.bidding_strategy_type}`)
        : (c.bidding_strategy_type || '');

      const targetCpa =
        c.target_cpa?.target_cpa_micros ||
        c.maximize_conversions?.target_cpa_micros ||
        null;

      const targetRoas =
        c.target_roas?.target_roas ||
        c.maximize_conversion_value?.target_roas ||
        null;

      return {
        campaignId: String(c.id || ''),
        campaignName: c.name || '',
        biddingStrategyType: biddingType,
        budget: Number(budget.amount_micros || 0),
        targetCpa: targetCpa ? Number(targetCpa) : null,
        targetRoas: targetRoas ? Number(targetRoas) : null,
        enhancedCpc: c.manual_cpc?.enhanced_cpc_enabled ?? false,
      };
    });

    // AssetFieldType enum — what role the asset plays (sitelink, callout, etc.)
    const assetFieldTypeMap = {
      2: 'HEADLINE', 3: 'DESCRIPTION', 4: 'MANDATORY_AD_TEXT',
      5: 'MARKETING_IMAGE', 6: 'MEDIA_BUNDLE', 7: 'YOUTUBE_VIDEO',
      8: 'BOOK_ON_GOOGLE', 9: 'LEAD_FORM', 10: 'PROMOTION',
      11: 'CALLOUT', 12: 'STRUCTURED_SNIPPET', 13: 'SITELINK',
      14: 'MOBILE_APP', 15: 'HOTEL_CALLOUT', 16: 'CALL',
      17: 'PRICE', 18: 'LONG_HEADLINE', 19: 'BUSINESS_NAME',
      20: 'PORTRAIT_MARKETING_IMAGE', 21: 'LOGO', 22: 'LANDSCAPE_LOGO',
      23: 'VIDEO', 24: 'CALL_TO_ACTION_SELECTION', 25: 'AD_IMAGE',
      26: 'BUSINESS_LOGO', 27: 'HOTEL_PROPERTY', 28: 'DISCOVERY_CAROUSEL_CARD',
    };

    function resolveFieldType(raw) {
      if (typeof raw === 'number') return assetFieldTypeMap[raw] || `FIELD_${raw}`;
      return raw || '';
    }

    // Account-level assets apply to ALL campaigns — collect them as a set
    const accountAssetTypes = new Set(
      (accountAssetsRaw || []).map((row) => resolveFieldType(row.customer_asset?.field_type)).filter(Boolean)
    );

    // Campaign-level assets
    const campaignAssets = (campaignAssetsRaw || []).map((row) => ({
      campaignId: String(row.campaign?.id || ''),
      assetType: resolveFieldType(row.campaign_asset?.field_type),
    }));

    const adStrength = (adStrengthRaw || []).map((row) => {
      const strengthRaw = row.ad_group_ad?.ad_strength;
      let strength;
      if (typeof strengthRaw === 'number') {
        strength = AD_STRENGTH_NUM_MAP[strengthRaw] || `STRENGTH_${strengthRaw}`;
      } else if (typeof strengthRaw === 'string') {
        strength = strengthRaw;
      } else {
        strength = 'UNKNOWN';
      }

      const headlines = row.ad_group_ad?.ad?.responsive_search_ad?.headlines || [];
      const headlineCount = headlines.length;
      const pinnedHeadlines = headlines.filter(
        (h) => h.pinnedField != null && h.pinnedField !== 0 && h.pinnedField !== 'UNSPECIFIED'
      ).length;

      return {
        campaignId: String(row.campaign?.id || ''),
        adGroupId: String(row.ad_group?.id || ''),
        strength,
        headlineCount,
        pinnedHeadlines,
      };
    });

    const pmaxAssetGroups = (pmaxAssetGroupsRaw || []).map((row) => {
      const strengthRaw = row.asset_group?.ad_strength;
      let adStrengthVal;
      if (typeof strengthRaw === 'number') {
        adStrengthVal = AD_STRENGTH_NUM_MAP[strengthRaw] || `STRENGTH_${strengthRaw}`;
      } else if (typeof strengthRaw === 'string') {
        adStrengthVal = strengthRaw;
      } else {
        adStrengthVal = 'UNKNOWN';
      }
      return {
        campaignId: String(row.campaign?.id || ''),
        campaignName: row.campaign?.name || '',
        assetGroupId: String(row.asset_group?.id || ''),
        assetGroupName: row.asset_group?.name || '',
        adStrength: adStrengthVal,
      };
    });

    const pmaxBrandExclusions = (pmaxBrandExclusionsRaw || []).map((row) => ({
      campaignId: String(row.campaign?.id || ''),
    }));

    const channelTypeMap = { 2: 'SEARCH', 3: 'DISPLAY', 4: 'SHOPPING', 5: 'HOTEL', 6: 'VIDEO', 7: 'MULTI_CHANNEL', 9: 'PERFORMANCE_MAX' };
    const campaignMetrics = (campaignPerfRaw || []).map((row) => {
      const c = row.campaign || {};
      const m = row.metrics || {};
      const channelRaw = c.advertising_channel_type;
      return {
        campaignId: String(c.id || ''),
        channelType: typeof channelRaw === 'number' ? (channelTypeMap[channelRaw] || `CHANNEL_${channelRaw}`) : (channelRaw || ''),
        cost: Number(m.cost_micros || 0),
        clicks: Number(m.clicks || 0),
        impressions: Number(m.impressions || 0),
        conversions: Number(m.all_conversions || 0),
        searchBudgetLostImpressionShare: m.search_budget_lost_impression_share ?? null,
        searchRankLostImpressionShare: m.search_rank_lost_impression_share ?? null,
      };
    });

    const conversionActions = (conversionActionsRaw || []).map((row) => {
      const ca = row.conversion_action || {};
      const m = row.metrics || {};
      const attribution = ca.attribution_model_settings || {};
      const valueSettings = ca.value_settings || {};
      return {
        id: String(ca.id || ''),
        name: ca.name || '',
        category: enumValue(ca.category),
        type: enumValue(ca.type),
        status: enumValue(ca.status),
        origin: enumValue(ca.origin),
        includeInConversionsMetric: Boolean(ca.include_in_conversions_metric),
        primaryForGoal: Boolean(ca.primary_for_goal),
        countingType: enumValue(ca.counting_type),
        attributionModel: enumValue(attribution.attribution_model),
        dataDrivenModelStatus: enumValue(attribution.data_driven_model_status),
        clickThroughLookbackWindowDays: ca.click_through_lookback_window_days ?? null,
        viewThroughLookbackWindowDays: ca.view_through_lookback_window_days ?? null,
        defaultValue: valueSettings.default_value ?? null,
        alwaysUseDefaultValue: valueSettings.always_use_default_value ?? null,
        lastReceivedRequestDateTime: m.conversion_last_received_request_date_time || null,
        lastConversionDate: m.conversion_last_conversion_date || null,
        allConversions: Number(m.all_conversions || 0),
        allConversionsValue: Number(m.all_conversions_value || 0),
      };
    });

    const deviceMap = { 2: 'MOBILE', 3: 'TABLET', 4: 'DESKTOP', 5: 'CONNECTED_TV', 6: 'OTHER' };
    const landingPages = (landingPagesRaw || []).map((row) => {
      const page = row.expanded_landing_page_view || {};
      const c = row.campaign || {};
      const m = row.metrics || {};
      const s = row.segments || {};
      const clicks = Number(m.clicks || 0);
      const conversions = Number(m.all_conversions || m.conversions || 0);
      return {
        url: page.expanded_final_url || '',
        campaignId: String(c.id || ''),
        campaignName: c.name || '',
        device: enumValue(s.device, deviceMap),
        impressions: Number(m.impressions || 0),
        clicks,
        cost: Number(m.cost_micros || 0),
        conversions,
        cvr: clicks > 0 ? conversions / clicks : null,
        speedScore: m.speed_score ?? null,
        mobileFriendlyClicksPercentage: m.mobile_friendly_clicks_percentage ?? null,
        validAmpClicksPercentage: m.valid_accelerated_mobile_pages_clicks_percentage ?? null,
      };
    });

    const campaignSearchTerms = (campaignSearchTermsRaw || []).map((row) => {
      const view = row.search_term_view || row.campaign_search_term_view || {};
      const c = row.campaign || {};
      const m = row.metrics || {};
      const s = row.segments || {};
      return {
        term: view.search_term || '',
        campaignId: String(c.id || ''),
        campaignName: c.name || '',
        matchSource: enumValue(s.search_term_match_source),
        matchType: enumValue(s.search_term_match_type),
        targetingStatus: enumValue(s.search_term_targeting_status || view.status),
        impressions: Number(m.impressions || 0),
        clicks: Number(m.clicks || 0),
        cost: Number(m.cost_micros || 0),
        conversions: Number(m.all_conversions || 0),
        conversionValue: Number(m.all_conversions_value || 0),
      };
    });

    const changeStatus = (changeStatusRaw || []).map((row) => {
      const change = row.change_status || {};
      return {
        resourceType: enumValue(change.resource_type),
        resourceStatus: enumValue(change.resource_status),
        lastChangeDateTime: change.last_change_date_time || null,
        campaign: change.campaign || null,
        adGroup: change.ad_group || null,
        adGroupAd: change.ad_group_ad || null,
        adGroupCriterion: change.ad_group_criterion || null,
        asset: change.asset || null,
        assetGroup: change.asset_group || null,
        campaignBudget: change.campaign_budget || null,
        campaignCriterion: change.campaign_criterion || null,
      };
    });

    const geoPerformance = (geoPerformanceRaw || []).map((row) => {
      const c = row.campaign || {};
      const g = row.geographic_view || {};
      const s = row.segments || {};
      const m = row.metrics || {};
      const clicks = Number(m.clicks || 0);
      const conversions = Number(m.all_conversions || 0);
      return {
        campaignId: String(c.id || ''),
        campaignName: c.name || '',
        countryCriterionId: String(g.country_criterion_id || ''),
        locationType: enumValue(g.location_type),
        region: s.geo_target_region || null,
        city: s.geo_target_city || null,
        impressions: Number(m.impressions || 0),
        clicks,
        cost: Number(m.cost_micros || 0),
        conversions,
        cvr: clicks > 0 ? conversions / clicks : null,
      };
    });

    const daypartPerformance = (daypartRaw || []).map((row) => {
      const c = row.campaign || {};
      const s = row.segments || {};
      const m = row.metrics || {};
      return {
        campaignId: String(c.id || ''),
        campaignName: c.name || '',
        dayOfWeek: enumValue(s.day_of_week),
        hour: s.hour ?? null,
        impressions: Number(m.impressions || 0),
        clicks: Number(m.clicks || 0),
        cost: Number(m.cost_micros || 0),
        conversions: Number(m.all_conversions || 0),
      };
    });

    const conversionLag = (conversionLagRaw || []).map((row) => {
      const c = row.campaign || {};
      const s = row.segments || {};
      const m = row.metrics || {};
      return {
        campaignId: String(c.id || ''),
        campaignName: c.name || '',
        lagBucket: enumValue(s.conversion_lag_bucket),
        cost: Number(m.cost_micros || 0),
        conversions: Number(m.all_conversions || 0),
      };
    });

    logApiUsage({
      type: 'google_ads_audit',
      email: sessionEmail,
      customerId: String(customerId),
      queriesRun: 16,
    }).catch(() => {});

    return NextResponse.json({
      data: {
        keywords,
        campaignConfig,
        campaignMetrics,
        campaignAssets,
        accountAssetTypes: [...accountAssetTypes],
        adStrength,
        pmaxAssetGroups,
        pmaxBrandExclusions,
        conversionActions,
        landingPages,
        campaignSearchTerms,
        changeStatus,
        geoPerformance,
        daypartPerformance,
        conversionLag,
        dateWindow,
      },
      requestId,
    });
  } catch (error) {
    console.error(`[googleads/audit] Error [${requestId}]:`, error?.message || error);
    return NextResponse.json(
      { error: 'Failed to fetch audit data', requestId },
      { status: 500 }
    );
  }
}
