import axios from 'axios';

export const GET = async (req, { params }) => {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const { creativeId } = params;

  if (!accessToken || !creativeId) {
    return new Response(JSON.stringify({ error: 'Missing access token or creativeId' }), {
      status: 400,
    });
  }

  try {
    // Try fetching full creative with object_story_spec
    const creativeRes = await axios.get(
      `https://graph.facebook.com/v19.0/${creativeId}`,
      {
        params: {
          fields: 'id,name,object_story_spec',
          access_token: accessToken,
        },
      }
    );

    return new Response(JSON.stringify({ creative: creativeRes.data }), {
      status: 200,
    });
  } catch (primaryErr) {
    try {
      // Safe fallback: just get id and name
      const fallbackRes = await axios.get(
        `https://graph.facebook.com/v19.0/${creativeId}`,
        {
          params: {
            fields: 'id,name',
            access_token: accessToken,
          },
        }
      );

      const fallbackCreative = fallbackRes.data;
      let storyData = null;

      try {
        // Get the ad connected to this creative to find its story ID
        const adRes = await axios.get(
          `https://graph.facebook.com/v19.0/${creativeId}/ad`,
          {
            params: {
              fields: 'effective_object_story_id',
              access_token: accessToken,
            },
          }
        );

        const storyId = adRes.data?.effective_object_story_id;

        if (storyId) {
          const storyRes = await axios.get(
            `https://graph.facebook.com/v19.0/${storyId}`,
            {
              params: {
                fields: 'message,permalink_url,full_picture',
                access_token: accessToken,
              },
            }
          );

          storyData = storyRes.data;
        }
      } catch (storyErr) {
        console.warn('Could not fetch story:', storyErr.response?.data || storyErr.message);
      }

      return new Response(JSON.stringify({
        creative: {
          ...fallbackCreative,
          ...(storyData ? { story: storyData } : { note: 'No story data available' }),
        }
      }), { status: 200 });

    } catch (finalErr) {
      console.error('Meta creative fallback failed:', finalErr.response?.data || finalErr.message);
      return new Response(JSON.stringify({
        error: 'Meta creative lookup failed at all levels.',
        details: finalErr.response?.data || finalErr.message,
      }), { status: 500 });
    }
  }
};
