import axios from 'axios';

export const GET = async (req, { params }) => {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const { adId } = params;

  if (!accessToken || !adId) {
    return new Response(JSON.stringify({ error: 'Missing access token or adId' }), { status: 400 });
  }

  try {
    const adRes = await axios.get(`https://graph.facebook.com/v23.0/${adId}`, {
      params: {
        fields: 'id,name,creative{id,name,body,title,image_url,object_story_spec{video_data{image_url,title,message},link_data{child_attachments{name,description,picture,link},picture}}}',
        access_token: accessToken,
      },
    });

    const adData = adRes.data;
    const creative = adData?.creative || {};
    const storySpec = creative?.object_story_spec || {};
    const videoData = storySpec?.video_data || {};
    const linkData = storySpec?.link_data || {};
    const childAttachments = linkData?.child_attachments || [];

    let format = 'image';
    let media = [];

    if (videoData?.image_url) {
      format = 'video';
      media.push({ type: 'video', thumbnail: videoData.image_url });
    } else if (childAttachments.length) {
      format = 'carousel';
      media = childAttachments
        .filter(item => item?.picture || item?.name || item?.description || item?.link)
        .map(item => ({
          type: 'image',
          url: item.picture,
          headline: item.name,
          description: item.description,
          link: item.link,
        }));
    } else if (linkData?.picture || creative?.image_url) {
      format = 'image';
      media.push({ type: 'image', url: linkData.picture || creative.image_url });
    }

    const responseData = {
      ad_id: adData?.id || null,
      ad_name: adData?.name || null,
      creative_id: creative?.id || null,
      creative_name: creative?.name || null,
      primary_text: creative?.body || videoData?.message || null,
      headline: creative?.title || videoData?.title || null,
      format,
      media,
    };

    return new Response(JSON.stringify({ ad: responseData }), { status: 200 });
  } catch (err) {
    console.error('Meta ad fetch failed:', err.response?.data || err.message);
    return new Response(JSON.stringify({
      error: 'Failed to fetch ad or creative content',
      details: err.response?.data || err.message,
    }), { status: 500 });
  }
};
