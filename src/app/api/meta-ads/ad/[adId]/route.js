import axios from 'axios';

export const GET = async (req, { params }) => {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const { adId } = params;

  if (!accessToken || !adId) {
    return new Response(JSON.stringify({ error: 'Missing access token or adId' }), {
      status: 400,
    });
  }

  try {
    // Step 1: Get the ad object with creative ID only
    const adRes = await axios.get(`https://graph.facebook.com/v19.0/${adId}`, {
      params: {
        fields: 'id,name,creative',
        access_token: accessToken,
      },
    });

    const adData = adRes.data;
    const creativeId = adData?.creative?.id;

    if (!creativeId) {
      return new Response(JSON.stringify({
        ad: {
          id: adId,
          name: adData?.name || null,
          note: 'No creative attached to this ad'
        }
      }), { status: 200 });
    }

    // Step 2: Try to fetch creative content
    try {
      const creativeRes = await axios.get(`https://graph.facebook.com/v19.0/${creativeId}`, {
        params: {
          fields: 'id,name,object_story_spec',
          access_token: accessToken,
        },
      });

      return new Response(JSON.stringify({
        ad: {
          id: adId,
          name: adData.name,
          creative_id: creativeId,
          creative: creativeRes.data,
        }
      }), { status: 200 });

    } catch (creativeErr) {
      console.warn('Creative fallback triggered:', creativeErr.response?.data || creativeErr.message);
      return new Response(JSON.stringify({
        ad: {
          id: adId,
          name: adData.name,
          creative_id: creativeId,
          note: 'Creative has no object_story_spec or was not accessible.'
        }
      }), { status: 200 });
    }

  } catch (err) {
    console.error('Meta ad fetch failed:', err.response?.data || err.message);
    return new Response(JSON.stringify({
      error: 'Failed to fetch ad/creative/story',
      details: err.response?.data || err.message,
    }), { status: 500 });
  }
};
