import { NextResponse } from 'next/server';
import { z } from 'zod';
import { GoogleAdsApi } from 'google-ads-api';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const googleAdsAdsQuerySchema = z.object({
  customerId: z.string().regex(/^\d+$/),
  campaignId: z.string().regex(/^\d+$/),
});

function mapAd(row) {
  const adData = row.ad_group_ad?.ad || {};
  const rsa = adData.responsive_search_ad;
  return {
    resource_name: adData.resource_name || '',
    headlines: rsa?.headlines?.map((headline) => headline.text).filter(Boolean) || [],
    descriptions: rsa?.descriptions?.map((description) => description.text).filter(Boolean) || [],
    final_urls: adData.final_urls || [],
  };
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
    const parsed = googleAdsAdsQuerySchema.safeParse({
      customerId: searchParams.get('customerId')?.replaceAll('-', '') ?? undefined,
      campaignId: searchParams.get('campaignId') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message, requestId },
        { status: 400 }
      );
    }

    const { customerId, campaignId } = parsed.data;
    const credentials = await getCredentials();
    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    });

    const customer = client.Customer({
      customer_id: customerId,
      refresh_token: credentials.refresh_token,
      login_customer_id: credentials.customer_id,
    });

    const rows = await customer.query(`
      SELECT ad_group_ad.ad.resource_name,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.app_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.headlines
      FROM ad_group_ad
      WHERE campaign.id = ${campaignId}
        AND ad_group.status = 'ENABLED'
        AND ad_group_ad.status = 'ENABLED'
    `);

    return NextResponse.json({ data: { ads: rows.map(mapAd) }, requestId });
  } catch (error) {
    console.error(`[googleads/ads] Error [${requestId}]:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch campaign ads', requestId },
      { status: 500 }
    );
  }
}
