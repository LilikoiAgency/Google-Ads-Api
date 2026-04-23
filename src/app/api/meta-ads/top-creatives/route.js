// src/app/api/meta-ads/top-creatives/route.js
// Returns the top N ads for an account by spend in the requested date range,
// with full creative details + insights shaped for MetaAdPreview consumption.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { graphGet, getTimeRange, getMetaAccessToken } from '../../../../lib/metaGraph';
import { apiCache } from '../../../../lib/apiCache';

const DATA_TTL = 10 * 60 * 1000; // 10 minutes

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Meta often returns the same event under multiple action_type rows
// (`purchase`, `omni_purchase`, `offsite_conversion.fb_pixel_purchase`…).
// Prefer the deduped `omni_*` roll-up if present, else fall back to the
// standard event, else fall back to an offsite_conversion.*.event row.
function pickDeduped(byType, omniKey, standardKey, offsiteSuffix) {
  if (byType[omniKey] !== undefined) return byType[omniKey];
  if (byType[standardKey] !== undefined) return byType[standardKey];
  if (offsiteSuffix) {
    const hit = Object.keys(byType).find((k) => k.endsWith('.' + offsiteSuffix));
    if (hit) return byType[hit];
  }
  return 0;
}

function tabulate(actions) {
  const byType = {};
  if (!Array.isArray(actions)) return byType;
  for (const a of actions) {
    if (!a?.action_type) continue;
    byType[a.action_type] = toNum(a.value);
  }
  return byType;
}

function shapeInsights(ins) {
  const spend = toNum(ins?.spend);
  const valueByType = tabulate(ins?.action_values);
  const countByType = tabulate(ins?.actions);

  // Revenue = purchase value only (deduped)
  const revenue = pickDeduped(valueByType, 'omni_purchase', 'purchase', 'purchase');

  // Conversions = purchases + leads + registrations (each deduped once)
  const purchaseCount = pickDeduped(countByType, 'omni_purchase', 'purchase', 'purchase');
  const leadCount = pickDeduped(countByType, 'omni_lead', 'lead', 'lead');
  const regCount = pickDeduped(countByType, 'omni_complete_registration', 'complete_registration', 'complete_registration');
  const conversions = purchaseCount + leadCount + regCount;

  return {
    spend,
    impressions: toNum(ins?.impressions),
    clicks: toNum(ins?.clicks),
    ctr: toNum(ins?.ctr) / 100,
    cpm: toNum(ins?.cpm),
    cpc: toNum(ins?.cpc),
    frequency: toNum(ins?.frequency),
    conversions,
    revenue,
    cost_per_conversion: conversions > 0 ? spend / conversions : null,
    roas: spend > 0 && revenue > 0 ? revenue / spend : null,
  };
}

export async function GET(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  const range = searchParams.get('range') || '28d';
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '3', 10), 500);
  const timeRange = getTimeRange(range, startDate, endDate);
  const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  const cacheKey = `top-creatives:${accountId}:${range}:${limit}:${startDate || ''}:${endDate || ''}`;
  const cached = await apiCache.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const token = await getMetaAccessToken();

    // One account-level insights call, sorted by spend desc, limited to top N.
    const insightsResp = await graphGet(`${actId}/insights`, {
      time_range: JSON.stringify(timeRange),
      level: 'ad',
      fields: 'ad_id,ad_name,spend,impressions,clicks,ctr,cpm,cpc,frequency,actions,action_values',
      sort: 'spend_descending',
      limit,
    }, token);

    const rows = insightsResp?.data || [];
    if (rows.length === 0) return NextResponse.json({ data: [] });

    // Batch-fetch creative details for the top ad IDs.
    const ids = rows.map((r) => r.ad_id).filter(Boolean).join(',');
    const adsResp = ids ? await graphGet('', {
      ids,
      fields: 'id,name,status,effective_status,creative{id,title,body,call_to_action_type,image_url,thumbnail_url,object_story_id,object_story_spec{link_data{message,name,call_to_action,picture}}}',
    }, token).catch(() => ({})) : {};

    const data = rows.map((r) => {
      const ad = adsResp?.[r.ad_id] || {};
      const cr = ad.creative || null;
      // For some ad formats (call ads, link ads) copy lives in object_story_spec.link_data
      const ld = cr?.object_story_spec?.link_data || {};
      return {
        id: r.ad_id,
        name: ad.name || r.ad_name || '',
        status: ad.status || 'ACTIVE',
        effective_status: ad.effective_status || 'ACTIVE',
        creative: cr
          ? {
              id: cr.id,
              title: cr.title || ld.name || null,
              body: cr.body || ld.message || null,
              call_to_action_type: cr.call_to_action_type || ld.call_to_action?.type || null,
              image_url: cr.image_url || cr.thumbnail_url || ld.picture || null,
              object_story_id: cr.object_story_id || null,
            }
          : null,
        insights: shapeInsights(r),
      };
    });

    const payload = { data };
    apiCache.setBackground(cacheKey, payload, DATA_TTL);
    return NextResponse.json(payload);
  } catch (err) {
    const status = err?.status || 500;
    return NextResponse.json(
      { error: err?.message || 'Meta API error', code: err?.code },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
