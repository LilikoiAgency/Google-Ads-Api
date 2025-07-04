import axios from 'axios';

export const GET = async (req) => {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const rawAccountId = process.env.META_AD_ACCOUNT_ID;
  const adAccountId = `act_${rawAccountId}`; // Meta requires this prefix in URLs

  if (!accessToken || !rawAccountId) {
    return new Response(JSON.stringify({ error: 'Missing Meta credentials' }), {
      status: 500,
    });
  }

  try {
    const response = await axios.get(
      `https://graph.facebook.com/v19.0/${adAccountId}/ads`,
      {
        params: {
          fields: 'id,name,status,adset_id,campaign_id,creative',
          access_token: accessToken,
        },
      }
    );

    return new Response(JSON.stringify({ ads: response.data.data }), {
      status: 200,
    });
  } catch (error) {
    console.error('Meta Ads API error:', error.response?.data || error.message);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch Meta ads',
        metaError: error.response?.data || error.message,
      }),
      { status: 500 }
    );
  }
};
