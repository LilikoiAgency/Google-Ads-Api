// src/app/api/meta-ads/ad-set/[adSetId]/ads/route.js
// Returns the ads within a given ad set with creative summary + insights
// for the requested date range.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../../lib/auth';
import { graphGet, getTimeRange, getMetaAccessToken } from '../../../../../../lib/metaGraph';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function sumActions(actions, ...keywords) {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, a) => {
    if (keywords.some((k) => a.action_type?.includes(k))) {
      return sum + parseFloat(a.value || 0);
    }
    return sum;
  }, 0);
}

function shapeAd(ad) {
  const ins = ad.insights?.data?.[0] || {};
  const spend = parseFloat(ins.spend || 0);
  const revenue = sumActions(ins.action_values, 'purchase', 'omni_purchase');
  const conversions = sumActions(ins.actions, 'purchase', 'omni_purchase', 'lead', 'complete_registration');

  return {
    id: ad.id,
    name: ad.name,
    status: ad.status,
    effective_status: ad.effective_status,
    creative: ad.creative
      ? {
          id: ad.creative.id,
          title: ad.creative.title || null,
          body: ad.creative.body || null,
          call_to_action_type: ad.creative.call_to_action_type || null,
          image_url: ad.creative.image_url || ad.creative.thumbnail_url || null,
          object_story_id: ad.creative.object_story_id || null,
        }
      : null,
    insights: {
      spend,
      impressions: parseInt(ins.impressions || 0, 10),
      clicks: parseInt(ins.clicks || 0, 10),
      ctr: parseFloat(ins.ctr || 0) / 100, // Meta returns % not ratio
      cpc: parseFloat(ins.cpc || 0),
      cpm: parseFloat(ins.cpm || 0),
      conversions,
      cost_per_conversion: conversions > 0 ? spend / conversions : null,
      revenue,
      roas: spend > 0 ? revenue / spend : null,
    },
  };
}

export async function GET(request, { params }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { adSetId } = await params;
  if (!adSetId) return NextResponse.json({ error: 'adSetId required' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || '28d';
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const timeRange = getTimeRange(range, startDate, endDate);

  try {
    const token = await getMetaAccessToken();

    // Fetch ads (up to 50) with creative details AND inline insights via the
    // `insights.time_range(...)` field expansion pattern so we do one round-trip.
    const insightsFields = 'spend,impressions,clicks,ctr,cpc,cpm,actions,action_values';
    const fields = [
      'id',
      'name',
      'status',
      'effective_status',
      'creative{id,title,body,call_to_action_type,image_url,thumbnail_url,object_story_id}',
      `insights.time_range(${JSON.stringify(timeRange)}){${insightsFields}}`,
    ].join(',');

    const resp = await graphGet(adSetId, { fields, limit: 50 }, token);

    // When calling the Node at `{adSetId}` with `fields=` Meta returns the
    // ad set object with no `.data` array. We need the edge call instead.
    // Fall back: if `resp.id === adSetId` without an `ads` edge, hit `/ads`.
    let adsRaw = Array.isArray(resp?.data) ? resp.data : resp?.ads?.data;
    if (!adsRaw) {
      const edgeResp = await graphGet(`${adSetId}/ads`, { fields, limit: 50 }, token);
      adsRaw = edgeResp?.data || [];
    }

    const data = adsRaw.map(shapeAd);
    return NextResponse.json({ data, dateRange: timeRange });
  } catch (err) {
    const status = err?.status || 500;
    return NextResponse.json(
      { error: err?.message || 'Meta API error', code: err?.code },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
