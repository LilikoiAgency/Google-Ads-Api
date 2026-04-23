// src/app/api/meta-ads/ad/[adId]/preview/route.js
// Proxies Meta's /{adId}/previews endpoint. Returns raw HTML (an <iframe>
// snippet) for the requested ad format.
// Cache strategy: MongoDB (shared across instances, survives cold starts) with
// a 15-minute TTL, backed by an in-process Map for ultra-fast repeat hits within
// the same serverless instance.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../../../lib/auth';
import { graphGet, getMetaAccessToken } from '../../../../../../lib/metaGraph';
import dbConnect from '../../../../../../lib/mongoose';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DB = 'tokensApi';
const COLLECTION = 'AdPreviewCache';

// L1: in-process cache (fast, ephemeral)
const l1 = new Map(); // key → { html, expiresAt }
const L1_MAX = 500;

const ALLOWED_FORMATS = new Set([
  'MOBILE_FEED_STANDARD',
  'DESKTOP_FEED_STANDARD',
  'INSTAGRAM_STANDARD',
  'INSTAGRAM_STORY',
  'INSTAGRAM_REELS',
  'FACEBOOK_REELS_MOBILE',
  'FACEBOOK_STORY_MOBILE',
]);

async function getFromDb(db, key) {
  const doc = await db.collection(COLLECTION).findOne({ _id: key });
  if (!doc) return null;
  if (doc.expiresAt < new Date()) {
    db.collection(COLLECTION).deleteOne({ _id: key }).catch(() => {});
    return null;
  }
  return doc.html;
}

async function saveToDb(db, key, html) {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  await db.collection(COLLECTION).updateOne(
    { _id: key },
    { $set: { html, expiresAt, cachedAt: new Date() } },
    { upsert: true },
  );
}

function l1Set(key, html) {
  if (l1.size >= L1_MAX) {
    const first = l1.keys().next().value;
    if (first !== undefined) l1.delete(first);
  }
  l1.set(key, { html, expiresAt: Date.now() + CACHE_TTL_MS });
}

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

  // L1 hit
  const l1hit = l1.get(cacheKey);
  if (l1hit && l1hit.expiresAt > Date.now()) {
    return NextResponse.json({ html: l1hit.html, format, cached: true });
  }

  // L2 hit (MongoDB)
  let db;
  try {
    const client = await dbConnect();
    db = client.db(DB);
    const dbHtml = await getFromDb(db, cacheKey);
    if (dbHtml !== null) {
      l1Set(cacheKey, dbHtml); // warm L1
      return NextResponse.json({ html: dbHtml, format, cached: true });
    }
  } catch (dbErr) {
    console.warn('[meta/preview] DB cache read failed:', dbErr?.message);
    // non-fatal — fall through to live fetch
  }

  // Cache miss — fetch from Meta
  const t0 = Date.now();
  try {
    const token = await getMetaAccessToken();
    const resp = await graphGet(`${adId}/previews`, { ad_format: format }, token);
    const elapsed = Date.now() - t0;
    const html = resp?.data?.[0]?.body || null;
    console.log(`[meta/preview] ad=${adId} format=${format} elapsed=${elapsed}ms hasHtml=${!!html} bodyLen=${html?.length ?? 0}`);

    if (!html) {
      return NextResponse.json({ html: null, format, unsupported: true });
    }

    l1Set(cacheKey, html);
    if (db) saveToDb(db, cacheKey, html).catch((e) => console.warn('[meta/preview] DB cache write failed:', e?.message));

    return NextResponse.json({ html, format, cached: false });
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.warn(`[meta/preview] ad=${adId} format=${format} elapsed=${elapsed}ms ERROR: ${err?.message} (code ${err?.code}, status ${err?.status})`);
    const msg = err?.message || '';
    const isUnsupported =
      /unsupported|invalid|must be one of|not available|cannot (generate|preview)|no preview|nonexisting field/i.test(msg) ||
      err?.status === 400;
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
