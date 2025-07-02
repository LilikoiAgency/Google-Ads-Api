import { NextResponse } from 'next/server';
import { GoogleAdsApi } from 'google-ads-api';
import { getCredentials } from '../../lib/dbFunctions';

export async function GET() {
    try {
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

                // Fetch the campaigns for the selected customer
                const campaignQuery = `
                    SELECT
                        campaign.id,
                        campaign.name,
                        campaign.status,
                        campaign.advertising_channel_type,
                        campaign.resource_name,
                        metrics.clicks,
                        metrics.all_conversions
                    FROM
                        campaign
                    WHERE
                        campaign.status = 'ENABLED'
                        AND campaign.advertising_channel_type != 'LOCAL_SERVICES'
                        AND campaign.serving_status = 'SERVING'
                        AND segments.date DURING LAST_7_DAYS
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
                    // If there are campaigns, fetch the ads for each campaign
                    const adsData = await Promise.all(
                        campaigns.map(async (campaign) => {
                            const campaignResourceName = campaign.campaign.resource_name;

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
                                conversions: campaign.metrics.all_conversions,
                                clicks: campaign.metrics.clicks,
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

                    return {
                        customer: customerClient,
                        campaigns: adsData
                    };
                } else {
                    console.log(`No campaigns found for customer ID ${customerId}`);
                    return null;
                }
            })
        );


        // Filter out null results
        const validCampaignsData = allCampaignData.filter(campaign => campaign !== null && campaign !== undefined);

        const response = NextResponse.json({ validCampaignsData });
        response.headers.set('Cache-Control', 's-maxage=3600, stale-while-revalidate');
        return response;
    

    } catch (error) {
        console.error('Error fetching data from Google Ads API:', error);
        return NextResponse.json({ error: 'Failed to fetch campaign data' }, { status: 500 });
    }
}
