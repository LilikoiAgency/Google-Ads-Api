// src/lib/googleAdsCustomer.js
import {
  getCampaignStatusCondition,
  normalizeLandingPageUrl,
  sortPerformanceRows,
  sortDeviceRows,
  mapUserListType,
  mapJobStatus,
} from './googleAdsHelpers.js';

/**
 * Fetches all data for a single Google Ads customer account.
 * Returns the shaped response object or null if the customer should be skipped.
 */
export async function fetchCustomerData({
  client,
  customerClient,
  credentials,
  dateFilter,
  dateWindow,
  campaignStatusCondition,
  campaignStatusConditionWithoutServing,
}) {
  const customerId = customerClient.customer_client.id;

  if (customerId === credentials.customer_id) {
    console.log(`Skipping MCC account: ${customerId}`);
    return null;
  }

  const customer = client.Customer({
    customer_id: customerId,
    refresh_token: credentials.refresh_token,
    login_customer_id: credentials.customer_id,
  });

  let optimizationScore = null;
  let recommendations = [];
  let trendRows = [];
  let searchTermRows = [];
  let landingPageRows = [];
  let deviceRows = [];
  let userListRows = [];
  let offlineJobRows = [];

  try {
    const customerSummary = await customer.query(`
      SELECT customer.id, customer.optimization_score FROM customer LIMIT 1
    `);
    optimizationScore = customerSummary?.[0]?.customer?.optimization_score ?? null;
  } catch (err) {
    console.error(`Error fetching optimization score for ${customerId}:`, err);
  }

  try {
    const rows = await customer.query(`
      SELECT recommendation.resource_name, recommendation.type, recommendation.campaign
      FROM recommendation LIMIT 10
    `);
    recommendations = rows.map((r) => ({
      resource_name: r.recommendation.resource_name || '',
      type: r.recommendation.type || 'UNSPECIFIED',
      campaign_resource_name: r.recommendation.campaign || '',
    }));
  } catch (err) {
    console.error(`Error fetching recommendations for ${customerId}:`, err);
  }

  try {
    trendRows = await customer.query(`
      SELECT campaign.id, segments.date, metrics.clicks, metrics.all_conversions, metrics.cost_micros
      FROM campaign
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
        AND ${dateFilter}
      ORDER BY segments.date
    `);
  } catch (err) {
    console.error(`Error fetching trends for ${customerId}:`, err);
  }

  try {
    searchTermRows = await customer.query(`
      SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
        search_term_view.search_term, metrics.clicks, metrics.impressions,
        metrics.ctr, metrics.all_conversions, metrics.cost_micros
      FROM search_term_view
      WHERE ${campaignStatusConditionWithoutServing}
        AND campaign.advertising_channel_type = 'SEARCH'
        AND ${dateFilter}
      ORDER BY metrics.clicks DESC LIMIT 100
    `);
  } catch (err) {
    console.error(`Error fetching search terms for ${customerId}:`, err);
  }

  try {
    landingPageRows = await customer.query(`
      SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
        ad_group_ad.ad.final_urls, metrics.clicks, metrics.impressions,
        metrics.ctr, metrics.all_conversions, metrics.cost_micros
      FROM ad_group_ad
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
        AND ad_group.status = 'ENABLED'
        AND ad_group_ad.status = 'ENABLED'
        AND ${dateFilter}
    `);
  } catch (err) {
    console.error(`Error fetching landing pages for ${customerId}:`, err);
  }

  try {
    deviceRows = await customer.query(`
      SELECT campaign.id, campaign.name, segments.device,
        metrics.clicks, metrics.impressions, metrics.ctr,
        metrics.all_conversions, metrics.cost_micros
      FROM campaign
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
        AND ${dateFilter}
    `);
  } catch (err) {
    console.error(`Error fetching devices for ${customerId}:`, err);
  }

  try {
    userListRows = await customer.query(`
      SELECT user_list.resource_name, user_list.id, user_list.name,
        user_list.type, user_list.size_for_display, user_list.size_for_search,
        user_list.membership_status
      FROM user_list
      WHERE user_list.type IN ('CRM_BASED') AND user_list.membership_status = 'OPEN'
    `);
  } catch (err) {
    console.error(`Error fetching user lists for ${customerId}:`, err.message);
  }

  try {
    offlineJobRows = await customer.query(`
      SELECT offline_user_data_job.resource_name, offline_user_data_job.id,
        offline_user_data_job.status, offline_user_data_job.type,
        offline_user_data_job.failure_reason,
        offline_user_data_job.customer_match_user_list_metadata.user_list
      FROM offline_user_data_job
      WHERE offline_user_data_job.type = 'CUSTOMER_MATCH_USER_LIST'
      ORDER BY offline_user_data_job.id DESC LIMIT 200
    `);
  } catch (err) {
    console.error(`Error fetching offline jobs for ${customerId}:`, err.message);
  }

  // ── Build audience sync status ─────────────────────────────────────────
  const latestJobByUserList = new Map();
  offlineJobRows.forEach((row) => {
    const job = row.offline_user_data_job;
    const userListResourceName = job?.customer_match_user_list_metadata?.user_list;
    if (!userListResourceName || latestJobByUserList.has(userListResourceName)) return;
    latestJobByUserList.set(userListResourceName, {
      jobId: job.id,
      status: mapJobStatus(job.status),
      failureReason: job.failure_reason || null,
    });
  });

  const audiences = userListRows.map((row) => {
    const ul = row.user_list;
    const latestJob = latestJobByUserList.get(ul.resource_name) || null;
    return {
      id: ul.id,
      name: ul.name || 'Unnamed List',
      type: mapUserListType(ul.type),
      sizeForDisplay: ul.size_for_display ?? null,
      sizeForSearch: ul.size_for_search ?? null,
      membershipStatus: ul.membership_status || null,
      lastSyncStatus: latestJob?.status || null,
      lastSyncJobId: latestJob?.jobId || null,
      failureReason: latestJob?.failureReason || null,
    };
  });

  // ── Fetch campaigns ────────────────────────────────────────────────────
  let campaigns = [];
  try {
    campaigns = await customer.query(`
      SELECT campaign.id, campaign.name, campaign.status,
        campaign.optimization_score, campaign.advertising_channel_type,
        campaign.resource_name, metrics.clicks, metrics.all_conversions, metrics.cost_micros
      FROM campaign
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
        AND ${dateFilter}
      ORDER BY campaign.name
    `);
  } catch (err) {
    console.error(`Error fetching campaigns for ${customerId}:`, err);
  }

  if (!campaigns || campaigns.length === 0) {
    console.log(`No campaigns found for customer ID ${customerId}`);
    return {
      customer: customerClient,
      accountSearchImpressionShareAverage: null,
      optimizationScore,
      recommendations,
      searchTerms: [],
      landingPages: [],
      devices: [],
      trend: [],
      audiences,
      campaigns: [],
    };
  }

  // ── Build aggregation maps ─────────────────────────────────────────────
  const trendDataByCampaignId = {};
  const customerTrendMap = new Map();
  const searchTermsByCampaignId = {};
  const landingPagesByCampaignId = {};
  const accountLandingPagesMap = new Map();
  const devicesByCampaignId = {};
  const accountDevicesMap = new Map();

  searchTermRows.forEach((row) => {
    const id = row.campaign.id;
    if (!searchTermsByCampaignId[id]) searchTermsByCampaignId[id] = [];
    searchTermsByCampaignId[id].push({
      term: row.search_term_view.search_term || '',
      campaignId: id,
      campaignName: row.campaign.name || '',
      adGroupId: row.ad_group.id || null,
      adGroupName: row.ad_group.name || '',
      clicks: row.metrics.clicks || 0,
      impressions: row.metrics.impressions || 0,
      ctr: row.metrics.ctr || 0,
      conversions: row.metrics.all_conversions || 0,
      cost: row.metrics.cost_micros || 0,
    });
  });

  landingPageRows.forEach((row) => {
    const id = row.campaign.id;
    const normalizedUrl = normalizeLandingPageUrl(row.ad_group_ad?.ad?.final_urls?.[0]);
    if (!normalizedUrl) return;

    const base = {
      url: normalizedUrl, campaignId: id, campaignName: row.campaign.name || '',
      adGroupId: row.ad_group.id || null, adGroupName: row.ad_group.name || '',
      clicks: row.metrics.clicks || 0, impressions: row.metrics.impressions || 0,
      conversions: row.metrics.all_conversions || 0, cost: row.metrics.cost_micros || 0, ctr: 0,
    };

    if (!landingPagesByCampaignId[id]) landingPagesByCampaignId[id] = new Map();
    const camp = landingPagesByCampaignId[id];
    const existing = camp.get(normalizedUrl) || { ...base };
    existing.clicks += base.clicks; existing.impressions += base.impressions;
    existing.conversions += base.conversions; existing.cost += base.cost;
    existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
    camp.set(normalizedUrl, existing);

    const acct = accountLandingPagesMap.get(normalizedUrl) || { ...base };
    acct.clicks += base.clicks; acct.impressions += base.impressions;
    acct.conversions += base.conversions; acct.cost += base.cost;
    acct.ctr = acct.impressions > 0 ? acct.clicks / acct.impressions : 0;
    accountLandingPagesMap.set(normalizedUrl, acct);
  });

  deviceRows.forEach((row) => {
    const id = row.campaign.id;
    const device = row.segments.device || 'UNSPECIFIED';

    if (!devicesByCampaignId[id]) devicesByCampaignId[id] = new Map();
    const camp = devicesByCampaignId[id];
    const existing = camp.get(device) || {
      device, campaignId: id, campaignName: row.campaign.name || '',
      clicks: 0, impressions: 0, conversions: 0, cost: 0, ctr: 0,
    };
    existing.clicks += row.metrics.clicks || 0;
    existing.impressions += row.metrics.impressions || 0;
    existing.conversions += row.metrics.all_conversions || 0;
    existing.cost += row.metrics.cost_micros || 0;
    existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
    camp.set(device, existing);

    const acct = accountDevicesMap.get(device) || { device, clicks: 0, impressions: 0, conversions: 0, cost: 0, ctr: 0 };
    acct.clicks += row.metrics.clicks || 0;
    acct.impressions += row.metrics.impressions || 0;
    acct.conversions += row.metrics.all_conversions || 0;
    acct.cost += row.metrics.cost_micros || 0;
    acct.ctr = acct.impressions > 0 ? acct.clicks / acct.impressions : 0;
    accountDevicesMap.set(device, acct);
  });

  trendRows.forEach((row) => {
    const id = row.campaign.id;
    const point = {
      date: row.segments.date,
      clicks: row.metrics.clicks || 0,
      conversions: row.metrics.all_conversions || 0,
      cost: row.metrics.cost_micros || 0,
    };
    if (!trendDataByCampaignId[id]) trendDataByCampaignId[id] = [];
    trendDataByCampaignId[id].push(point);

    const cp = customerTrendMap.get(row.segments.date) || { date: row.segments.date, clicks: 0, conversions: 0, cost: 0 };
    cp.clicks += point.clicks; cp.conversions += point.conversions; cp.cost += point.cost;
    customerTrendMap.set(row.segments.date, cp);
  });

  // ── Fetch optimization + impression share per campaign ─────────────────
  let optimizationDetailsByCampaignId = {};
  let impressionShareByCampaignId = {};

  try {
    const rows = await customer.query(`
      SELECT campaign.id, metrics.optimization_score_url, metrics.optimization_score_uplift
      FROM campaign WHERE ${campaignStatusConditionWithoutServing}
    `);
    optimizationDetailsByCampaignId = Object.fromEntries(
      rows.map((r) => [r.campaign.id, {
        optimizationScoreUrl: r.metrics?.optimization_score_url || '',
        optimizationScoreUplift: r.metrics?.optimization_score_uplift || null,
      }])
    );
  } catch (err) {
    console.error(`Error fetching optimization metrics for ${customerId}:`, err);
  }

  try {
    const rows = await customer.query(`
      SELECT campaign.id, metrics.search_impression_share,
        metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
      FROM campaign
      WHERE ${campaignStatusCondition}
        AND campaign.advertising_channel_type = 'SEARCH'
    `);
    impressionShareByCampaignId = Object.fromEntries(
      rows.map((r) => [r.campaign.id, {
        searchImpressionShare: r.metrics?.search_impression_share ?? null,
        searchBudgetLostImpressionShare: r.metrics?.search_budget_lost_impression_share ?? null,
        searchRankLostImpressionShare: r.metrics?.search_rank_lost_impression_share ?? null,
      }])
    );
  } catch (err) {
    console.error(`Error fetching impression share for ${customerId}:`, err);
  }

  // ── Fetch ads per campaign ─────────────────────────────────────────────
  const adsData = await Promise.all(
    campaigns.map(async (campaign) => {
      const campaignResourceName = campaign.campaign.resource_name;
      const optDetails = optimizationDetailsByCampaignId[campaign.campaign.id] || {};
      const isDetails = impressionShareByCampaignId[campaign.campaign.id] || {};

      let ads = [];
      try {
        ads = await customer.query(`
          SELECT ad_group_ad.ad.responsive_search_ad.descriptions,
            ad_group_ad.ad.final_urls, ad_group_ad.ad.app_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.headlines
          FROM ad_group_ad
          WHERE ad_group.campaign = '${campaignResourceName}'
            AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'
        `);
      } catch (err) {
        console.error(`Error fetching ads for campaign ${campaign.campaign.id}:`, err);
      }

      return {
        campaignId: campaign.campaign.id,
        campaignName: campaign.campaign.name,
        resourceName: campaign.campaign.resource_name,
        status: campaign.campaign.status || 'UNKNOWN',
        channelType: campaign.campaign.advertising_channel_type || 'UNKNOWN',
        optimizationScore: campaign.campaign.optimization_score ?? null,
        optimizationScoreUrl: optDetails.optimizationScoreUrl || '',
        optimizationScoreUplift: optDetails.optimizationScoreUplift || null,
        searchImpressionShare: isDetails.searchImpressionShare ?? null,
        searchBudgetLostImpressionShare: isDetails.searchBudgetLostImpressionShare ?? null,
        searchRankLostImpressionShare: isDetails.searchRankLostImpressionShare ?? null,
        conversions: campaign.metrics.all_conversions,
        clicks: campaign.metrics.clicks,
        cost: campaign.metrics.cost_micros,
        trend: trendDataByCampaignId[campaign.campaign.id] || [],
        searchTerms: (searchTermsByCampaignId[campaign.campaign.id] || []).sort(sortPerformanceRows).slice(0, 12),
        landingPages: Array.from((landingPagesByCampaignId[campaign.campaign.id] || new Map()).values()).sort(sortPerformanceRows).slice(0, 12),
        devices: Array.from((devicesByCampaignId[campaign.campaign.id] || new Map()).values()).sort(sortDeviceRows),
        ads: ads.map((ad) => {
          const adData = ad.ad_group_ad?.ad || {};
          const rsa = adData.responsive_search_ad;
          return {
            resource_name: adData.resource_name || '',
            headlines: rsa?.headlines?.map((h) => h.text) || [],
            descriptions: rsa?.descriptions?.map((d) => d.text) || [],
            final_urls: adData.final_urls || [],
          };
        }),
      };
    })
  );

  const campaignNameByResourceName = Object.fromEntries(
    adsData.map((c) => [c.resourceName, c.campaignName])
  );

  const impressionValues = adsData.map((c) => c.searchImpressionShare).filter((v) => v != null);

  return {
    accountSearchImpressionShareAverage: impressionValues.length
      ? impressionValues.reduce((s, v) => s + Number(v || 0), 0) / impressionValues.length
      : null,
    customer: customerClient,
    optimizationScore,
    recommendations: recommendations.map((r) => ({
      ...r,
      campaignName: campaignNameByResourceName[r.campaign_resource_name] || null,
    })),
    searchTerms: searchTermRows.map((row) => ({
      term: row.search_term_view.search_term || '',
      campaignId: row.campaign.id,
      campaignName: row.campaign.name || '',
      adGroupId: row.ad_group.id || null,
      adGroupName: row.ad_group.name || '',
      clicks: row.metrics.clicks || 0,
      impressions: row.metrics.impressions || 0,
      ctr: row.metrics.ctr || 0,
      conversions: row.metrics.all_conversions || 0,
      cost: row.metrics.cost_micros || 0,
    })).sort(sortPerformanceRows).slice(0, 20),
    landingPages: Array.from(accountLandingPagesMap.values()).sort(sortPerformanceRows).slice(0, 20),
    devices: Array.from(accountDevicesMap.values()).sort(sortDeviceRows),
    trend: Array.from(customerTrendMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    audiences,
    campaigns: adsData,
  };
}
