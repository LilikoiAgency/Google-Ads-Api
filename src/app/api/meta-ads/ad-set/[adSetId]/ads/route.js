// src/app/api/meta-ads/ad-set/[adSetId]/ads/route.js
// Returns the ads within a given ad set with creative summary + insights
// for the requested date range.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../../lib/auth';
import { graphGet, getTimeRange, getMetaAccessToken } from '../../../../../../lib/metaGraph';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// NaN/Infinity-safe numeric helpers
function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

// Exact action-type matching — mirrors CONVERSION_TYPES / REVENUE_TYPES in
// src/app/api/meta-ads/route.js to avoid double-counting when both
// omni_purchase and platform-specific purchase events are present.
const CONVERSION_TYPES = ['purchase', 'lead', 'complete_registration', 'offsite_conversion', 'fb_pixel_purchase'];
const REVENUE_TYPES    = ['purchase', 'offsite_conversion.fb_pixel_purchase', 'offsite_conversion'];

function sumActions(actions, types) {
  if (!Array.isArray(actions) || !Array.isArray(types)) return 0;
  const set = new Set(types);
  return actions.reduce((sum, a) => set.has(a.action_type) ? sum + toNum(a.value) : sum, 0);
}

function shapeAd(ad) {
  const ins = ad.insights?.data?.[0] || {};
  const spend = toNum(ins.spend);
  const revenue = sumActions(ins.action_values, REVENUE_TYPES);
  const conversions = sumActions(ins.actions, CONVERSION_TYPES);

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
      impressions: toInt(ins.impressions),
      clicks: toInt(ins.clicks),
      ctr: toNum(ins.ctr) / 100, // Meta returns % not ratio
      cpc: toNum(ins.cpc),
      cpm: toNum(ins.cpm),
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

    const resp = await graphGet(`${adSetId}/ads`, { fields, limit: 50 }, token);
    const adsRaw = resp?.data || [];

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
