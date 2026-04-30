import { describe, it, expect, vi } from 'vitest';
import { fetchCustomerData } from '@/lib/googleAdsCustomer.js';

function makeCampaign(id, name) {
  return {
    campaign: {
      id,
      name,
      status: 'ENABLED',
      optimization_score: 0.8,
      advertising_channel_type: 'SEARCH',
      resource_name: `customers/123/campaigns/${id}`,
    },
    metrics: {
      clicks: 10,
      all_conversions: 2,
      cost_micros: 1_000_000,
    },
  };
}

describe('fetchCustomerData', () => {
  it('fetches ads once per customer and groups them by campaign', async () => {
    const query = vi.fn(async (sql) => {
      if (sql.includes('FROM customer LIMIT 1')) {
        return [{ customer: { optimization_score: 0.7 } }];
      }
      if (sql.includes('FROM recommendation')) return [];
      if (sql.includes('FROM search_term_view')) return [];
      if (sql.includes('FROM ad_group_ad') && sql.includes('metrics.clicks')) return [];
      if (sql.includes('campaign.resource_name')) {
        return [makeCampaign('111', 'Campaign One'), makeCampaign('222', 'Campaign Two')];
      }
      if (sql.includes('FROM campaign') && sql.includes('segments.date')) return [];
      if (sql.includes('FROM campaign') && sql.includes('segments.device')) return [];
      if (sql.includes('FROM user_list')) return [];
      if (sql.includes('FROM offline_user_data_job')) return [];
      if (sql.includes('metrics.optimization_score_url')) return [];
      if (sql.includes('metrics.search_impression_share')) return [];
      if (sql.includes('FROM ad_group_ad')) {
        return [
          {
            campaign: { id: '111' },
            ad_group_ad: {
              ad: {
                resource_name: 'customers/123/ads/1',
                final_urls: ['https://example.com'],
                responsive_search_ad: {
                  headlines: [{ text: 'First headline' }],
                  descriptions: [{ text: 'First description' }],
                },
              },
            },
          },
          {
            campaign: { id: '222' },
            ad_group_ad: {
              ad: {
                resource_name: 'customers/123/ads/2',
                final_urls: ['https://example.org'],
                responsive_search_ad: {
                  headlines: [{ text: 'Second headline' }],
                  descriptions: [{ text: 'Second description' }],
                },
              },
            },
          },
        ];
      }
      return [];
    });

    const client = {
      Customer: vi.fn(() => ({ query })),
    };

    const result = await fetchCustomerData({
      client,
      customerClient: {
        customer_client: {
          id: '123',
          descriptive_name: 'Test Customer',
        },
      },
      credentials: {
        customer_id: '999',
        refresh_token: 'refresh-token',
      },
      dateFilter: "segments.date BETWEEN '2026-01-01' AND '2026-01-31'",
      campaignStatusCondition: "campaign.status = 'ENABLED'",
      campaignStatusConditionWithoutServing: "campaign.status = 'ENABLED'",
      includeAds: true,
    });

    const adQueries = query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes('FROM ad_group_ad') && !sql.includes('metrics.clicks'));

    expect(adQueries).toHaveLength(1);
    expect(adQueries[0]).toContain('SELECT campaign.id');
    expect(adQueries[0]).not.toContain('ad_group.campaign =');
    expect(result.campaigns).toHaveLength(2);
    expect(result.campaigns[0].ads).toHaveLength(1);
    expect(result.campaigns[0].ads[0].headlines).toEqual(['First headline']);
    expect(result.campaigns[1].ads[0].final_urls).toEqual(['https://example.org']);
  });

  it('skips ad asset query by default', async () => {
    const query = vi.fn(async (sql) => {
      if (sql.includes('FROM customer LIMIT 1')) {
        return [{ customer: { optimization_score: 0.7 } }];
      }
      if (sql.includes('FROM recommendation')) return [];
      if (sql.includes('FROM search_term_view')) return [];
      if (sql.includes('FROM ad_group_ad') && sql.includes('metrics.clicks')) return [];
      if (sql.includes('campaign.resource_name')) return [makeCampaign('111', 'Campaign One')];
      if (sql.includes('FROM campaign') && sql.includes('segments.date')) return [];
      if (sql.includes('FROM campaign') && sql.includes('segments.device')) return [];
      if (sql.includes('FROM user_list')) return [];
      if (sql.includes('FROM offline_user_data_job')) return [];
      if (sql.includes('metrics.optimization_score_url')) return [];
      if (sql.includes('metrics.search_impression_share')) return [];
      if (sql.includes('FROM ad_group_ad')) {
        throw new Error('ad asset query should not run');
      }
      return [];
    });

    const client = {
      Customer: vi.fn(() => ({ query })),
    };

    const result = await fetchCustomerData({
      client,
      customerClient: {
        customer_client: {
          id: '123',
          descriptive_name: 'Test Customer',
        },
      },
      credentials: {
        customer_id: '999',
        refresh_token: 'refresh-token',
      },
      dateFilter: "segments.date BETWEEN '2026-01-01' AND '2026-01-31'",
      campaignStatusCondition: "campaign.status = 'ENABLED'",
      campaignStatusConditionWithoutServing: "campaign.status = 'ENABLED'",
    });

    const adAssetQueries = query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes('FROM ad_group_ad') && !sql.includes('metrics.clicks'));

    expect(adAssetQueries).toHaveLength(0);
    expect(result.campaigns[0]).not.toHaveProperty('ads');
  });
});
