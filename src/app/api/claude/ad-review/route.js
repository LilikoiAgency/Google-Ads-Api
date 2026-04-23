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

const DAILY_LIMIT = parseInt(process.env.META_AD_REVIEW_DAILY_LIMIT || '10');
const MAX_BATCH_SIZE = 20;
const DB = 'tokensApi';

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

function buildBatchUserMessage(ads, accountId) {
  const lines = [`Review these ${ads.length} ads for account ${accountId}:\n`];
  ads.forEach((ad, i) => {
    const ins = ad.metrics || {};
    lines.push(`--- Ad ${i + 1} ---`);
    lines.push(`ID: ${ad.id}`);
    lines.push(`Name: ${ad.name || '(none)'}`);
    lines.push(`Headline: ${ad.title || '(none)'}`);
    lines.push(`Copy: ${ad.body || '(none)'}`);
    lines.push(`CTA Button: ${ad.ctaType || '(none)'}`);
    lines.push(`Performance: $${(ins.spend || 0).toFixed(2)} spend · ${((ins.ctr || 0) * 100).toFixed(2)}% CTR · ${ins.conversions || 0} conversions · ${ins.roas != null ? ins.roas.toFixed(2) + 'x' : '—'} ROAS · ${(ins.frequency || 0).toFixed(2)}x frequency\n`);
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

  // Build messages array based on mode
  let messages;
  if (mode === 'batch') {
    messages = [{ role: 'user', content: buildBatchUserMessage(ads, accountId) }];
  } else {
    // single mode: text + optional image
    const ad = ads[0];
    const textBlock = { type: 'text', text: buildBatchUserMessage([ad], accountId) };
    const contentBlocks = [textBlock];
    if (ad.imageUrl) {
      let parsedImageUrl = null;
      try { parsedImageUrl = new URL(ad.imageUrl); } catch { parsedImageUrl = null; }
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
