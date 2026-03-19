import { NextResponse } from 'next/server';
import { GoogleAdsApi } from 'google-ads-api';
import { getCredentials } from '../../lib/dbFunctions';
import util from 'node:util';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../lib/auth';

const ALLOWED_DATE_RANGES = new Set([
    'LAST_7_DAYS',
    'LAST_30_DAYS',
    'LAST_90_DAYS',
    'THIS_MONTH',
    'CUSTOM',
]);

const ALLOWED_CAMPAIGN_STATUS_FILTERS = new Set([
    'ACTIVE',
    'INACTIVE',
    'ALL',
]);

function formatDateLiteral(date) {
    return date.toISOString().slice(0, 10);
}

function isValidDateLiteral(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function getDateWindow(dateRange) {
    const endDate = new Date();
    const startDate = new Date(endDate);

    switch (dateRange) {
        case 'LAST_7_DAYS':
            startDate.setDate(endDate.getDate() - 6);
            break;
        case 'LAST_30_DAYS':
            startDate.setDate(endDate.getDate() - 29);
            break;
        case 'LAST_90_DAYS':
            startDate.setDate(endDate.getDate() - 89);
            break;
        case 'THIS_MONTH':
            startDate.setDate(1);
            break;
        default:
            startDate.setDate(endDate.getDate() - 6);
    }

    return {
        startDate: formatDateLiteral(startDate),
        endDate: formatDateLiteral(endDate),
    };
}

function buildDateFilter(dateRange, customStartDate, customEndDate) {
    let dateWindow;

    if (dateRange === 'CUSTOM') {
        if (!isValidDateLiteral(customStartDate) || !isValidDateLiteral(customEndDate)) {
            throw new Error('Invalid custom date range');
        }

        if (customStartDate > customEndDate) {
            throw new Error('Custom start date must be on or before the end date');
        }

        dateWindow = {
            startDate: customStartDate,
            endDate: customEndDate,
        };
    } else {
        dateWindow = getDateWindow(dateRange);
    }

    const { startDate, endDate } = dateWindow;
    return {
        dateFilter: `segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        dateWindow,
    };
}

function getCampaignStatusCondition(statusFilter, { includeServingStatus = true } = {}) {
    switch (statusFilter) {
        case 'INACTIVE':
            return "campaign.status IN ('PAUSED', 'REMOVED')";
        case 'ALL':
            return 'campaign.id IS NOT NULL';
        case 'ACTIVE':
        default:
            return includeServingStatus
                ? "campaign.status = 'ENABLED' AND campaign.serving_status = 'SERVING'"
                : "campaign.status = 'ENABLED'";
    }
}

function normalizeLandingPageUrl(value) {
    if (!value) return null;

    try {
        const url = new URL(String(value));
        url.search = '';
        url.hash = '';

        if (url.pathname !== '/' && url.pathname.endsWith('/')) {
            url.pathname = url.pathname.slice(0, -1);
        }

        return url.toString();
    } catch {
        return String(value).trim() || null;
    }
}

function sortPerformanceRows(a, b) {
    if ((b.conversions || 0) !== (a.conversions || 0)) {
        return (b.conversions || 0) - (a.conversions || 0);
    }
    if ((b.clicks || 0) !== (a.clicks || 0)) {
        return (b.clicks || 0) - (a.clicks || 0);
    }
    return (b.impressions || 0) - (a.impressions || 0);
}

function sortDeviceRows(a, b) {
    if ((b.conversions || 0) !== (a.conversions || 0)) {
        return (b.conversions || 0) - (a.conversions || 0);
    }
    if ((b.clicks || 0) !== (a.clicks || 0)) {
        return (b.clicks || 0) - (a.clicks || 0);
    }
    return (b.cost || 0) - (a.cost || 0);
}

export async function GET(request) {
    try {
        const session = await getServerSession(authOptions);
        const sessionEmail = session?.user?.email?.toLowerCase() || '';

        if (!sessionEmail.endsWith(`@${allowedEmailDomain}`)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const requestedDateRange = searchParams.get('dateRange');
        const dateRange = ALLOWED_DATE_RANGES.has(requestedDateRange)
            ? requestedDateRange
            : 'LAST_7_DAYS';
        const requestedStatusFilter = searchParams.get('statusFilter');
        const statusFilter = ALLOWED_CAMPAIGN_STATUS_FILTERS.has(requestedStatusFilter)
            ? requestedStatusFilter
            : 'ACTIVE';
        const customStartDate = searchParams.get('startDate');
        const customEndDate = searchParams.get('endDate');
        const { dateFilter, dateWindow } = buildDateFilter(
            dateRange,
            customStartDate,
            customEndDate
        );
        const campaignStatusCondition = getCampaignStatusCondition(statusFilter);
        const campaignStatusConditionWithoutServing = getCampaignStatusCondition(statusFilter, {
            includeServingStatus: false,
        });

        // Fetch credentials from MongoDB
        const credentials = await getCredentials();
        // console.log("Fetched Credentials:", credentials);
        const client = new GoogleAdsApi({
            client_id: credentials.client_id,
            client_secret: credentials.client_secret,
            developer_token: credentials.developer_token,
        });
        // Creating the MCC customer object to access child accounts
        const mccCustomer = client.Customer({
            customer_id: credentials.customer_id,
            refresh_token: credentials.refresh_token,
            login_customer_id: credentials.customer_id,
        });
        // Query to list all child accounts under the MCC
        const customerClientQuery = `
            SELECT
                customer_client.level,
                customer_client.descriptive_name,
                customer_client.id
            FROM customer_client
            WHERE customer_client.level = 1 AND customer_client.status = 'ENABLED'
        `;
        // Fetch the child accounts under the MCC
        const customerClients = await mccCustomer.query(customerClientQuery);
        // console.log("Accessible Customers:", customerClients);
        // If no child accounts are found, return an error
        if (!customerClients || customerClients.length === 0) {
            return NextResponse.json({ error: 'No accessible customers found' }, { status: 404 });
        }
        // Fetch campaigns and ads for each customer (client account)
        const allCampaignData = await Promise.all(
            customerClients.map(async (customerClient) => {
                const customerId = customerClient.customer_client.id;

                // ⛔️ Skip if it's the MCC account (manager)
                if (customerId === credentials.customer_id) {
                    console.log(`Skipping MCC account: ${customerId}`);
                    return null;
                }                
                // Creating the customer object for the selected child account
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

                try {
                    const customerSummary = await customer.query(`
                        SELECT
                            customer.id,
                            customer.optimization_score
                        FROM customer
                        LIMIT 1
                    `);

                    optimizationScore =
                        customerSummary?.[0]?.customer?.optimization_score ?? null;
                } catch (error) {
                    console.error(
                        `Error fetching optimization score for customer ID ${customerId}:`,
                        error
                    );
                }

                try {
                    const recommendationRows = await customer.query(`
                        SELECT
                            recommendation.resource_name,
                            recommendation.type,
                            recommendation.campaign
                        FROM recommendation
                        LIMIT 10
                    `);

                    recommendations = recommendationRows.map((recommendationRow) => ({
                        resource_name:
                            recommendationRow.recommendation.resource_name || '',
                        type: recommendationRow.recommendation.type || 'UNSPECIFIED',
                        campaign_resource_name:
                            recommendationRow.recommendation.campaign || '',
                    }));
                } catch (error) {
                    console.error(
                        `Error fetching recommendations for customer ID ${customerId}:`,
                        error
                    );
                }

                try {
                    trendRows = await customer.query(`
                        SELECT
                            campaign.id,
                            segments.date,
                            metrics.clicks,
                            metrics.all_conversions,
                            metrics.cost_micros
                        FROM campaign
                        WHERE
                            ${campaignStatusCondition}
                            AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
                            AND ${dateFilter}
                        ORDER BY segments.date
                    `);
                } catch (error) {
                    console.error(
                        `Error fetching trend data for customer ID ${customerId}:`,
                        error
                    );
                }

                try {
                    searchTermRows = await customer.query(`
                        SELECT
                            campaign.id,
                            campaign.name,
                            ad_group.id,
                            ad_group.name,
                            search_term_view.search_term,
                            metrics.clicks,
                            metrics.impressions,
                            metrics.ctr,
                            metrics.all_conversions,
                            metrics.cost_micros
                        FROM search_term_view
                        WHERE
                            ${campaignStatusConditionWithoutServing}
                            AND campaign.advertising_channel_type = 'SEARCH'
                            AND ${dateFilter}
                        ORDER BY metrics.clicks DESC
                        LIMIT 100
                    `);
                } catch (error) {
                    console.error(
                        `Error fetching search terms for customer ID ${customerId}:`,
                        error
                    );
                }

                try {
                    landingPageRows = await customer.query(`
                        SELECT
                            campaign.id,
                            campaign.name,
                            ad_group.id,
                            ad_group.name,
                            ad_group_ad.ad.final_urls,
                            metrics.clicks,
                            metrics.impressions,
                            metrics.ctr,
                            metrics.all_conversions,
                            metrics.cost_micros
                        FROM ad_group_ad
                        WHERE
                            ${campaignStatusCondition}
                            AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
                            AND ad_group.status = 'ENABLED'
                            AND ad_group_ad.status = 'ENABLED'
                            AND ${dateFilter}
                    `);
                } catch (error) {
                    console.error(
                        `Error fetching landing pages for customer ID ${customerId}:`,
                        error
                    );
                }

                try {
                    deviceRows = await customer.query(`
                        SELECT
                            campaign.id,
                            campaign.name,
                            segments.device,
                            metrics.clicks,
                            metrics.impressions,
                            metrics.ctr,
                            metrics.all_conversions,
                            metrics.cost_micros
                        FROM campaign
                        WHERE
                            ${campaignStatusCondition}
                            AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
                            AND ${dateFilter}
                    `);
                } catch (error) {
                    console.error(
                        `Error fetching device performance for customer ID ${customerId}:`,
                        error
                    );
                }

                // Fetch the campaigns for the selected customer
                const campaignQuery = `
                    SELECT
                        campaign.id,
                        campaign.name,
                        campaign.status,
                        campaign.optimization_score,
                        campaign.advertising_channel_type,
                        campaign.resource_name,
                        metrics.clicks,
                        metrics.all_conversions,
                        metrics.cost_micros
                    FROM
                        campaign
                    WHERE
                        ${campaignStatusCondition}
                        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
                        AND ${dateFilter}
                    ORDER BY campaign.name
                `;

            
            

                let campaigns = [];
                try {
                    campaigns = await customer.query(campaignQuery);
                } catch (error) {
                    console.error(`Error fetching campaigns for customer ID ${customerId}:`, error);
                }

                // console.log(`Campaign details for customer ID ${customerId}:`, campaigns);

                if (campaigns && campaigns.length > 0) {
                    let optimizationDetailsByCampaignId = {};
                    let impressionShareByCampaignId = {};
                    const trendDataByCampaignId = {};
                    const customerTrendMap = new Map();
                    const searchTermsByCampaignId = {};
                    const landingPagesByCampaignId = {};
                    const accountLandingPagesMap = new Map();
                    const devicesByCampaignId = {};
                    const accountDevicesMap = new Map();

                    searchTermRows.forEach((row) => {
                        const campaignId = row.campaign.id;
                        const searchTerm = {
                            term: row.search_term_view.search_term || '',
                            campaignId,
                            campaignName: row.campaign.name || '',
                            adGroupId: row.ad_group.id || null,
                            adGroupName: row.ad_group.name || '',
                            clicks: row.metrics.clicks || 0,
                            impressions: row.metrics.impressions || 0,
                            ctr: row.metrics.ctr || 0,
                            conversions: row.metrics.all_conversions || 0,
                            cost: row.metrics.cost_micros || 0,
                        };

                        if (!searchTermsByCampaignId[campaignId]) {
                            searchTermsByCampaignId[campaignId] = [];
                        }

                        searchTermsByCampaignId[campaignId].push(searchTerm);
                    });

                    landingPageRows.forEach((row) => {
                        const campaignId = row.campaign.id;
                        const normalizedUrl = normalizeLandingPageUrl(
                            row.ad_group_ad?.ad?.final_urls?.[0]
                        );

                        if (!normalizedUrl) {
                            return;
                        }

                        const baseRow = {
                            url: normalizedUrl,
                            campaignId,
                            campaignName: row.campaign.name || '',
                            adGroupId: row.ad_group.id || null,
                            adGroupName: row.ad_group.name || '',
                            clicks: row.metrics.clicks || 0,
                            impressions: row.metrics.impressions || 0,
                            ctr: row.metrics.ctr || 0,
                            conversions: row.metrics.all_conversions || 0,
                            cost: row.metrics.cost_micros || 0,
                        };

                        if (!landingPagesByCampaignId[campaignId]) {
                            landingPagesByCampaignId[campaignId] = new Map();
                        }

                        const campaignLandingPagesMap = landingPagesByCampaignId[campaignId];
                        const existingCampaignPage = campaignLandingPagesMap.get(normalizedUrl) || {
                            ...baseRow,
                            adGroupName: row.ad_group.name || '',
                            ctr: 0,
                            clicks: 0,
                            impressions: 0,
                            conversions: 0,
                            cost: 0,
                        };

                        existingCampaignPage.clicks += row.metrics.clicks || 0;
                        existingCampaignPage.impressions += row.metrics.impressions || 0;
                        existingCampaignPage.conversions += row.metrics.all_conversions || 0;
                        existingCampaignPage.cost += row.metrics.cost_micros || 0;
                        existingCampaignPage.ctr =
                            existingCampaignPage.impressions > 0
                                ? existingCampaignPage.clicks / existingCampaignPage.impressions
                                : 0;
                        campaignLandingPagesMap.set(normalizedUrl, existingCampaignPage);

                        const existingAccountPage = accountLandingPagesMap.get(normalizedUrl) || {
                            url: normalizedUrl,
                            campaignName: row.campaign.name || '',
                            adGroupName: row.ad_group.name || '',
                            clicks: 0,
                            impressions: 0,
                            conversions: 0,
                            cost: 0,
                            ctr: 0,
                        };

                        existingAccountPage.clicks += row.metrics.clicks || 0;
                        existingAccountPage.impressions += row.metrics.impressions || 0;
                        existingAccountPage.conversions += row.metrics.all_conversions || 0;
                        existingAccountPage.cost += row.metrics.cost_micros || 0;
                        existingAccountPage.ctr =
                            existingAccountPage.impressions > 0
                                ? existingAccountPage.clicks / existingAccountPage.impressions
                                : 0;
                        accountLandingPagesMap.set(normalizedUrl, existingAccountPage);
                    });

                    deviceRows.forEach((row) => {
                        const campaignId = row.campaign.id;
                        const device = row.segments.device || 'UNSPECIFIED';

                        if (!devicesByCampaignId[campaignId]) {
                            devicesByCampaignId[campaignId] = new Map();
                        }

                        const campaignDevicesMap = devicesByCampaignId[campaignId];
                        const existingCampaignDevice = campaignDevicesMap.get(device) || {
                            device,
                            campaignId,
                            campaignName: row.campaign.name || '',
                            clicks: 0,
                            impressions: 0,
                            conversions: 0,
                            cost: 0,
                            ctr: 0,
                        };

                        existingCampaignDevice.clicks += row.metrics.clicks || 0;
                        existingCampaignDevice.impressions += row.metrics.impressions || 0;
                        existingCampaignDevice.conversions += row.metrics.all_conversions || 0;
                        existingCampaignDevice.cost += row.metrics.cost_micros || 0;
                        existingCampaignDevice.ctr =
                            existingCampaignDevice.impressions > 0
                                ? existingCampaignDevice.clicks / existingCampaignDevice.impressions
                                : 0;
                        campaignDevicesMap.set(device, existingCampaignDevice);

                        const existingAccountDevice = accountDevicesMap.get(device) || {
                            device,
                            clicks: 0,
                            impressions: 0,
                            conversions: 0,
                            cost: 0,
                            ctr: 0,
                        };

                        existingAccountDevice.clicks += row.metrics.clicks || 0;
                        existingAccountDevice.impressions += row.metrics.impressions || 0;
                        existingAccountDevice.conversions += row.metrics.all_conversions || 0;
                        existingAccountDevice.cost += row.metrics.cost_micros || 0;
                        existingAccountDevice.ctr =
                            existingAccountDevice.impressions > 0
                                ? existingAccountDevice.clicks / existingAccountDevice.impressions
                                : 0;
                        accountDevicesMap.set(device, existingAccountDevice);
                    });

                    trendRows.forEach((row) => {
                        const campaignId = row.campaign.id;
                        const point = {
                            date: row.segments.date,
                            clicks: row.metrics.clicks || 0,
                            conversions: row.metrics.all_conversions || 0,
                            cost: row.metrics.cost_micros || 0,
                        };

                        if (!trendDataByCampaignId[campaignId]) {
                            trendDataByCampaignId[campaignId] = [];
                        }
                        trendDataByCampaignId[campaignId].push(point);

                        const customerPoint = customerTrendMap.get(row.segments.date) || {
                            date: row.segments.date,
                            clicks: 0,
                            conversions: 0,
                            cost: 0,
                        };
                        customerPoint.clicks += row.metrics.clicks || 0;
                        customerPoint.conversions += row.metrics.all_conversions || 0;
                        customerPoint.cost += row.metrics.cost_micros || 0;
                        customerTrendMap.set(row.segments.date, customerPoint);
                    });

                    try {
                        const campaignOptimizationRows = await customer.query(`
                            SELECT
                                campaign.id,
                                metrics.optimization_score_url,
                                metrics.optimization_score_uplift
                            FROM campaign
                            WHERE ${campaignStatusConditionWithoutServing}
                        `);

                        optimizationDetailsByCampaignId = Object.fromEntries(
                            campaignOptimizationRows.map((row) => [
                                row.campaign.id,
                                {
                                    optimizationScoreUrl:
                                        row.metrics?.optimization_score_url || '',
                                    optimizationScoreUplift:
                                        row.metrics?.optimization_score_uplift || null,
                                },
                            ])
                        );
                    } catch (error) {
                        console.error(
                            `Error fetching optimization metrics for customer ID ${customerId}:`,
                            error
                        );
                    }

                    try {
                        const campaignImpressionShareRows = await customer.query(`
                            SELECT
                                campaign.id,
                                metrics.search_impression_share,
                                metrics.search_budget_lost_impression_share,
                                metrics.search_rank_lost_impression_share
                            FROM campaign
                            WHERE
                                ${campaignStatusCondition}
                                AND campaign.advertising_channel_type = 'SEARCH'
                        `);

                        impressionShareByCampaignId = Object.fromEntries(
                            campaignImpressionShareRows.map((row) => [
                                row.campaign.id,
                                {
                                    searchImpressionShare:
                                        row.metrics?.search_impression_share ?? null,
                                    searchBudgetLostImpressionShare:
                                        row.metrics?.search_budget_lost_impression_share ?? null,
                                    searchRankLostImpressionShare:
                                        row.metrics?.search_rank_lost_impression_share ?? null,
                                },
                            ])
                        );
                    } catch (error) {
                        console.error(
                            `Error fetching impression share metrics for customer ID ${customerId}:`,
                            error
                        );
                    }

                    // If there are campaigns, fetch the ads for each campaign
                    const adsData = await Promise.all(
                        campaigns.map(async (campaign) => {
                            const campaignResourceName = campaign.campaign.resource_name;
                            const optimizationDetails =
                                optimizationDetailsByCampaignId[campaign.campaign.id] || {};
                            const impressionShareDetails =
                                impressionShareByCampaignId[campaign.campaign.id] || {};

                            // Fetch ads for the campaign
                            const adGroupAdsQuery = `
                                SELECT
                                    ad_group_ad.ad.responsive_search_ad.descriptions,
                                    ad_group_ad.ad.final_urls,
                                    ad_group_ad.ad.app_ad.headlines,
                                    ad_group_ad.ad.responsive_search_ad.headlines
                                FROM ad_group_ad
                                WHERE
                                    ad_group.campaign = '${campaignResourceName}' AND
                                    ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'
                            `;

                            let ads = [];
                            try {
                                ads = await customer.query(adGroupAdsQuery);
                            } catch (error) {
                                console.error(`Error fetching ads for campaign ${campaign.campaign.id}:`, error);
                            }

                            return {
                                campaignId: campaign.campaign.id,
                                campaignName: campaign.campaign.name,
                                resourceName: campaign.campaign.resource_name,
                                status: campaign.campaign.status || 'UNKNOWN',
                                channelType:
                                    campaign.campaign.advertising_channel_type || 'UNKNOWN',
                                optimizationScore:
                                    campaign.campaign.optimization_score ?? null,
                                optimizationScoreUrl:
                                    optimizationDetails.optimizationScoreUrl || '',
                                optimizationScoreUplift:
                                    optimizationDetails.optimizationScoreUplift || null,
                                searchImpressionShare:
                                    impressionShareDetails.searchImpressionShare ?? null,
                                searchBudgetLostImpressionShare:
                                    impressionShareDetails.searchBudgetLostImpressionShare ?? null,
                                searchRankLostImpressionShare:
                                    impressionShareDetails.searchRankLostImpressionShare ?? null,
                                conversions: campaign.metrics.all_conversions,
                                clicks: campaign.metrics.clicks,
                                cost: campaign.metrics.cost_micros,
                                trend: trendDataByCampaignId[campaign.campaign.id] || [],
                                searchTerms: (searchTermsByCampaignId[campaign.campaign.id] || [])
                                    .sort(sortPerformanceRows)
                                    .slice(0, 12),
                                landingPages: Array.from(
                                    (landingPagesByCampaignId[campaign.campaign.id] || new Map()).values()
                                )
                                    .sort(sortPerformanceRows)
                                    .slice(0, 12),
                                devices: Array.from(
                                    (devicesByCampaignId[campaign.campaign.id] || new Map()).values()
                                ).sort(sortDeviceRows),
                                ads: ads.map(ad => {
                                    const adData = ad.ad_group_ad?.ad || {};
                                    const rsa = adData.responsive_search_ad;

                                    return {
                                        resource_name: adData.resource_name || '',
                                        headlines: rsa?.headlines?.map(h => h.text) || [],
                                        descriptions: rsa?.descriptions?.map(d => d.text) || [],
                                        final_urls: adData.final_urls || []
                                    };
                                })
                            };
                        })
                    );

                    const campaignNameByResourceName = Object.fromEntries(
                        adsData.map((campaign) => [
                            campaign.resourceName,
                            campaign.campaignName,
                        ])
                    );

                    return {
                        accountSearchImpressionShareAverage:
                            adsData.length > 0
                                ? (() => {
                                      const values = adsData
                                          .map((campaign) => campaign.searchImpressionShare)
                                          .filter((value) => value !== null && value !== undefined);
                                      if (!values.length) return null;
                                      return (
                                          values.reduce((sum, value) => sum + Number(value || 0), 0) /
                                          values.length
                                      );
                                  })()
                                : null,
                        customer: customerClient,
                        optimizationScore,
                        recommendations: recommendations.map((recommendation) => ({
                            ...recommendation,
                            campaignName:
                                campaignNameByResourceName[
                                    recommendation.campaign_resource_name
                                ] || null,
                        })),
                        searchTerms: searchTermRows
                            .map((row) => ({
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
                            }))
                            .sort(sortPerformanceRows)
                            .slice(0, 20),
                        landingPages: Array.from(accountLandingPagesMap.values())
                            .sort(sortPerformanceRows)
                            .slice(0, 20),
                        devices: Array.from(accountDevicesMap.values()).sort(sortDeviceRows),
                        trend: Array.from(customerTrendMap.values()).sort((a, b) =>
                            a.date.localeCompare(b.date)
                        ),
                        campaigns: adsData
                    };
                } else {
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
                        campaigns: [],
                    };
                }
            })
        );


        // Filter out null results
        const validCampaignsData = allCampaignData.filter(campaign => campaign !== null && campaign !== undefined);

        const response = NextResponse.json({
            validCampaignsData,
            dateRange,
            dateWindow,
            statusFilter,
        });
        response.headers.set('Cache-Control', 's-maxage=3600, stale-while-revalidate');
        return response;
    

    } catch (error) {
        console.error(
            'Error fetching data from Google Ads API:',
            util.inspect(error, { depth: null, colors: false })
        );
        return NextResponse.json({ error: 'Failed to fetch campaign data' }, { status: 500 });
    }
}
