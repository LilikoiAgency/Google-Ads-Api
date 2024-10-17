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
                customer_client.client_customer,
                customer_client.level,
                customer_client.manager,
                customer_client.descriptive_name,
                customer_client.currency_code,
                customer_client.time_zone,
                customer_client.id
            FROM customer_client
            WHERE customer_client.level <= 1 AND customer_client.status = 'ENABLED'
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
                // console.log(`Fetching campaigns for customer ID: ${customerId}`);

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
                        campaign.start_date,
                        campaign.end_date,
                        campaign.advertising_channel_type,
                        campaign.advertising_channel_sub_type,
                        campaign.bidding_strategy_type,
                        campaign.tracking_url_template,
                        campaign.url_custom_parameters,
                        campaign.labels,
                        campaign.resource_name
                    FROM
                        campaign
                    WHERE
                        campaign.status = 'ENABLED'
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
                                ads: ads.map(ad => ({
                                    resource_name: ad.ad_group_ad.ad.resource_name,
                                    headlines: ad.ad_group_ad.ad.responsive_search_ad.headlines ? ad.ad_group_ad.ad.responsive_search_ad.headlines.map(headline => headline.text) : [],
                                    descriptions: ad.ad_group_ad.ad.responsive_search_ad.descriptions ? ad.ad_group_ad.ad.responsive_search_ad.descriptions.map(description => description.text) : [],
                                    final_urls: ad.ad_group_ad.ad.final_urls
                                }))
                            };
                        })
                    );

                    return {
                        customer: customerClient,
                        campaigns: adsData
                    };
                } else {
                    // console.log(`No campaigns found for customer ID ${customerId}`);
                    return {
                        customer: customerClient,
                        error: 'No campaigns found for this customer'
                    };
                }
            })
        );

        return NextResponse.json({ allCampaignData });

    } catch (error) {
        console.error('Error fetching data from Google Ads API:', error);
        return NextResponse.json({ error: 'Failed to fetch campaign data' }, { status: 500 });
    }
}
