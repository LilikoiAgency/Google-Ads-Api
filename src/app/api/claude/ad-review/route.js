// src/app/api/claude/ad-review/route.js
export const maxDuration = 180;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { logApiUsage, estimateClaudeCost } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';
import { graphGet, getMetaAccessToken } from '../../../../lib/metaGraph';

const DAILY_LIMIT = parseInt(process.env.META_AD_REVIEW_DAILY_LIMIT || '10');
const MAX_BATCH_SIZE = 20;
const DB = 'tokensApi';

// Maps Meta's internal CTA enum values to the button label actually shown in the ad.
// Meta's API returns the enum (e.g. BOOK_TRAVEL) — not the display text ("Book Now").
const CTA_LABELS = {
  BOOK_TRAVEL:        'Book Now',
  SHOP_NOW:           'Shop Now',
  LEARN_MORE:         'Learn More',
  SIGN_UP:            'Sign Up',
  DOWNLOAD:           'Download',
  CONTACT_US:         'Contact Us',
  GET_QUOTE:          'Get Quote',
  SUBSCRIBE:          'Subscribe',
  WATCH_MORE:         'Watch More',
  APPLY_NOW:          'Apply Now',
  BUY_NOW:            'Buy Now',
  GET_OFFER:          'Get Offer',
  ORDER_NOW:          'Order Now',
  CALL_NOW:           'Call Now',
  MESSAGE_PAGE:       'Send Message',
  SEND_MESSAGE:       'Send Message',
  GET_DIRECTIONS:     'Get Directions',
  WATCH_VIDEO:        'Watch Video',
  LISTEN_NOW:         'Listen Now',
  OPEN_LINK:          'Learn More',
  USE_APP:            'Use App',
  INSTALL_APP:        'Install Now',
  PLAY_GAME:          'Play Game',
  REQUEST_TIME:       'Request Time',
  SEE_MENU:           'See Menu',
  SAVE:               'Save',
  LIKE_PAGE:          'Like Page',
  NO_BUTTON:          '(no button)',
  WHATSAPP_MESSAGE:   'WhatsApp Us',
  GET_SHOWTIMES:      'Get Showtimes',
  FIND_YOUR_GROUPS:   'Find Your Groups',
  VISIT_PAGES_FEED:   'Learn More',
};

function ctaLabel(raw) {
  if (!raw) return '(none)';
  return CTA_LABELS[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const SYSTEM_PROMPT = `You are an expert ad creative reviewer applying the LeadsIcon ad-review rubric.

Score each ad on four categories (25 pts each, 100 total):
- Hook (25): Stops scroll in 1–3s, creates curiosity, relevant to avatar, doesn't reveal product too soon
- Proof (25): Social proof, authority, results/data, believable demonstration
- CTA (25): Clear next step, natural urgency, risk reversal, correct placement (not too early)
- Visual (25): Platform-native quality (not over-produced), genuine/authentic feel, clear audio and text

Authenticity test: "Would comments call this fake?" If yes → needs work.
Platform native test: "Does this look like content or an ad?" Content = good.

Return ONLY a valid JSON array — no markdown, no explanation — with one object per ad.
Each object must have: adId, status ("APPROVED"|"REVISE"|"REJECT"), overallScore (0-100),
scores {hook, proof, cta, visual}, summary (one sentence), hook {strengths[], issues[], recommendation},
proof {elements[], missing[], recommendation}, cta {placement, clarity, urgency, recommendation},
visual {productionQuality, authenticity, issues[]}, platformFit (string[]),
actionItems {required[], recommended[]}, prediction ("High potential"|"Medium"|"Low").`;

// Fetch fresh creative data from Meta for the given ad IDs and merge into ads array.
// Covers all ad formats: standard link ads, call ads, video ads, DPA / asset_feed_spec.
async function enrichAdsWithCreativeData(ads) {
  let token;
  try { token = await getMetaAccessToken(); } catch { return ads; }

  const ids = ads.map((a) => a.id).filter(Boolean).join(',');
  if (!ids) return ads;

  let freshData = {};
  try {
    const creativeFields = 'id,creative{title,body,call_to_action_type,object_story_spec{link_data{message,name,description,call_to_action{type,value{link}}},photo_data{caption,url},video_data{title,message,call_to_action{type,value{link}}}},asset_feed_spec{bodies,titles,call_to_action_types},image_url,thumbnail_url}';
    freshData = await graphGet('', {
      ids,
      fields: creativeFields,
    }, token);
  } catch (err) {
    console.warn('[claude/ad-review] Meta creative enrich failed, using cached data:', err?.message);
    return ads;
  }

  return ads.map((ad) => {
    const fresh = freshData?.[ad.id];
    if (!fresh) return ad;
    const cr = fresh.creative || {};

    // Pull copy from whichever format has it
    const ld = cr.object_story_spec?.link_data || {};
    const pd = cr.object_story_spec?.photo_data || {};
    const vd = cr.object_story_spec?.video_data || {};
    const af = cr.asset_feed_spec || {};

    const title =
      cr.title ||
      ld.name ||
      vd.title ||
      (af.titles && af.titles[0]?.text) ||
      ad.title ||
      null;

    const body =
      cr.body ||
      ld.message ||
      pd.caption ||
      vd.message ||
      (af.bodies && af.bodies[0]?.text) ||
      ad.body ||
      null;

    const ctaType =
      cr.call_to_action_type ||
      ld.call_to_action?.type ||
      vd.call_to_action?.type ||
      (af.call_to_action_types && af.call_to_action_types[0]) ||
      ad.ctaType ||
      null;

    const imageUrl =
      cr.image_url || cr.thumbnail_url || ad.imageUrl || null;

    // Expose all copy variants for dynamic creative ads so Claude knows what's in rotation
    const allTitles = (af.titles || []).map((t) => t?.text).filter(Boolean);
    const allBodies = (af.bodies || []).map((b) => b?.text).filter(Boolean);

    return { ...ad, title, body, ctaType, imageUrl, allTitles, allBodies };
  });
}

// For single-mode reviews: extract the actual image shown in the Meta preview iframe.
// The iframe src is a public shareable URL that Meta SSR-renders with the full ad HTML,
// including the real image (which for "Related Media" ads differs from creative.image_url).
async function fetchImageFromPreviewIframe(previewHtml) {
  if (!previewHtml) return null;

  // Pull the iframe src out of the embed snippet
  const srcMatch = previewHtml.match(/\bsrc="([^"]*facebook\.com[^"]*)"/i)
    || previewHtml.match(/\bsrc='([^']*facebook\.com[^']*)'/i);
  if (!srcMatch) return null;

  const iframeSrc = srcMatch[1].replace(/&amp;/g, '&');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(iframeSrc, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const html = await res.text();

    // 1. og:image meta tag (most reliable)
    const ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
      || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogImg) return ogImg[1].replace(/&amp;/g, '&');

    // 2. Largest scontent (Meta CDN) image URL in the page
    const scontent = [...html.matchAll(/["'](https:\/\/scontent[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)/gi)];
    if (scontent.length) return scontent[scontent.length - 1][1].replace(/&amp;/g, '&');

    return null;
  } catch {
    return null;
  }
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
}

function buildBatchUserMessage(ads, accountId) {
  const lines = [`Review these ${ads.length} ads for account ${accountId}:\n`];
  ads.forEach((ad, i) => {
    const ins = ad.metrics || {};
    lines.push(`--- Ad ${i + 1} ---`);
    lines.push(`ID: ${ad.id}`);
    lines.push(`Name: ${ad.name || '(none)'}`);
    lines.push(`Headline: ${ad.title || '(none)'}`);
    lines.push(`Copy: ${ad.body || '(none)'}`);
    lines.push(`CTA Button: ${ctaLabel(ad.ctaType)}`);
    // If there are additional copy variants (dynamic creative / asset_feed_spec), list them
    if (ad.allBodies?.length > 1) lines.push(`Additional copy variants: ${ad.allBodies.slice(1).map((b) => `"${b}"`).join(' | ')}`);
    if (ad.allTitles?.length > 1) lines.push(`Additional headline variants: ${ad.allTitles.slice(1).map((t) => `"${t}"`).join(' | ')}`);
    lines.push(`Performance: $${(ins.spend || 0).toFixed(2)} spend · ${((ins.ctr || 0) * 100).toFixed(2)}% CTR · ${ins.conversions || 0} conversions · ${ins.roas != null ? ins.roas.toFixed(2) + 'x' : '—'} ROAS · ${(ins.frequency || 0).toFixed(2)}x frequency`);
    lines.push('');
  });
  return lines.join('\n');
}

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.adReviewCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { adReviewCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true },
  );
}

export async function POST(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body', requestId }, { status: 400 }); }

  const { ads, mode, accountId } = body;
  if (!Array.isArray(ads) || ads.length === 0 || !accountId) {
    return NextResponse.json({ error: 'ads (non-empty array) and accountId are required', requestId }, { status: 400 });
  }
  if (!['batch', 'single'].includes(mode)) {
    return NextResponse.json({ error: 'mode must be "batch" or "single"', requestId }, { status: 400 });
  }
  if (ads.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: `ads array exceeds maximum size of ${MAX_BATCH_SIZE}`, requestId }, { status: 400 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const usedToday = await getDailyUsageCount(db, email);
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json({
        error: `Daily ad review limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
        limitReached: true,
        usage: { count: usedToday, limit: DAILY_LIMIT, remaining: 0 },
        requestId,
      }, { status: 429 });
    }
  }

  const credentials = await getCredentials();
  const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured.', requestId }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });

  // Enrich ads with fresh creative data from Meta (covers all ad formats)
  const enrichedAds = await enrichAdsWithCreativeData(ads);

  // Build messages array based on mode
  const userMessageText = buildBatchUserMessage(enrichedAds, accountId);
  console.log('[claude/ad-review] prompt preview:\n', userMessageText.slice(0, 1000));

  let messages;
  if (mode === 'batch') {
    messages = [{ role: 'user', content: userMessageText }];
  } else {
    // single mode: text + optional image
    const ad = enrichedAds[0];
    const textBlock = { type: 'text', text: userMessageText };
    const contentBlocks = [textBlock];

    // Prefer the actual image shown in the preview iframe (matches what the user sees),
    // falling back to the creative's stored image_url.
    const previewIframeImageUrl = await fetchImageFromPreviewIframe(ads[0]?.previewHtml || null);
    const imageUrlToUse = previewIframeImageUrl || ad.imageUrl || null;
    console.log(`[claude/ad-review] single image source: ${previewIframeImageUrl ? 'preview-iframe' : ad.imageUrl ? 'creative-url' : 'none'}`);

    if (imageUrlToUse) {
      let parsedImageUrl = null;
      try { parsedImageUrl = new URL(imageUrlToUse); } catch { parsedImageUrl = null; }
      if (parsedImageUrl && (parsedImageUrl.protocol === 'https:' || parsedImageUrl.protocol === 'http:')) {
        // Fetch image server-side and pass as base64 — Meta CDN blocks Anthropic's direct URL fetches
        try {
          const imgRes = await fetch(parsedImageUrl.href, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (imgRes.ok) {
            const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
            const mediaType = contentType.split(';')[0].trim();
            const buffer = await imgRes.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            contentBlocks.unshift({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
          }
        } catch (imgErr) {
          console.warn('[claude/ad-review] Could not fetch image, proceeding text-only:', imgErr?.message);
        }
      }
    }
    messages = [{ role: 'user', content: contentBlocks }];
  }

  const RETRY_DELAYS = [5_000, 15_000];
  let response;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages,
      });
      break;
    } catch (err) {
      if (err?.status === 529 && attempt < 2) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      console.error('[claude/ad-review] Claude error:', err?.message);
      return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
    }
  }

  const rawText = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let reviews;
  try {
    const clean = rawText.replace(/^```json\s*/m, '').replace(/^```\s*$/m, '').trim();
    const parsed = JSON.parse(clean);
    reviews = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error('[claude/ad-review] JSON parse failed:', rawText.slice(0, 500));
    return NextResponse.json({ error: 'Failed to parse AI response as JSON', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'ad_review',
    email,
    accountId: String(accountId),
    model: 'claude-sonnet-4-6',
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateClaudeCost('claude-sonnet-4-6', inputTokens, outputTokens),
  }).catch(() => {});

  let remainingToday = DAILY_LIMIT;
  if (!isAdmin(email)) {
    await incrementDailyUsage(db, email).catch(() => {});
    const newCount = await getDailyUsageCount(db, email).catch(() => DAILY_LIMIT);
    remainingToday = Math.max(0, DAILY_LIMIT - newCount);
  }

  return NextResponse.json({
    reviews,
    requestId,
    usage: { count: DAILY_LIMIT - remainingToday, limit: DAILY_LIMIT, remaining: remainingToday },
  });
}
