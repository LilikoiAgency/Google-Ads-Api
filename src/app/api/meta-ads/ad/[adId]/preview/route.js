// src/app/api/meta-ads/ad/[adId]/preview/route.js
// Proxies Meta's /{adId}/previews endpoint. Returns raw HTML (an <iframe>
// snippet) for the requested ad format. Cached in-memory for 15 minutes
// because preview HTML is deterministic until the ad itself is edited.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../../lib/auth';
import { graphGet, getMetaAccessToken } from '../../../../../../lib/metaGraph';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// Key: `${adId}:${format}` → { html, expiresAt }
const previewCache = new Map();
const CACHE_MAX = 500;

const ALLOWED_FORMATS = new Set([
  'MOBILE_FEED_STANDARD',
  'DESKTOP_FEED_STANDARD',
  'INSTAGRAM_STANDARD',
  'INSTAGRAM_STORY',
  'INSTAGRAM_REELS',
  'FACEBOOK_REELS_MOBILE',
  'FACEBOOK_STORY_MOBILE',
]);

export async function GET(request, { params }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { adId } = await params;
  if (!adId) return NextResponse.json({ error: 'adId required' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'MOBILE_FEED_STANDARD';
  if (!ALLOWED_FORMATS.has(format)) {
    return NextResponse.json({ error: `unsupported format: ${format}` }, { status: 400 });
  }

  const cacheKey = `${adId}:${format}`;
  const hit = previewCache.get(cacheKey);
  if (hit) {
    if (hit.expiresAt > Date.now()) {
      return NextResponse.json({ html: hit.html, format, cached: true });
    }
    previewCache.delete(cacheKey);
  }

  try {
    const token = await getMetaAccessToken();
    const resp = await graphGet(`${adId}/previews`, { ad_format: format }, token);
    // Meta returns { data: [{ body: "<iframe ...></iframe>" }] }
    const html = resp?.data?.[0]?.body || null;

    if (!html) {
      return NextResponse.json({ html: null, format, unsupported: true });
    }

    if (previewCache.size >= CACHE_MAX) {
      const firstKey = previewCache.keys().next().value;
      if (firstKey !== undefined) previewCache.delete(firstKey);
    }
    previewCache.set(cacheKey, { html, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ html, format, cached: false });
  } catch (err) {
    // Common: "Unsupported ad format" when an ad can't render in this placement.
    // Note: err.status===400 is also treated as unsupported here — adId comes from our own
    // route param so genuine 400s are unlikely, and the client's unsupported fallback
    // (show creative image + body) is preferable to leaking a 500.
    const msg = err?.message || '';
    const isUnsupported =
      /unsupported|invalid|must be one of|not available|cannot (generate|preview)|no preview|nonexisting field/i.test(msg) ||
      err?.status === 400; // Meta returns 400 for unrenderable previews on this endpoint; safer to classify as unsupported.
    if (isUnsupported) {
      return NextResponse.json({ html: null, format, unsupported: true });
    }
    const status = err?.status || 500;
    return NextResponse.json(
      { error: err?.message || 'Meta API error', code: err?.code },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
