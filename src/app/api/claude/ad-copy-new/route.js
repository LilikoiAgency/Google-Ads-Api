export const maxDuration = 120;

import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import dbConnect from '@/lib/mongoose';
import { getCredentials } from '@/lib/dbFunctions';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '@/lib/usageLogger';
import { getAdCopyNewSystemPrompt } from '@/lib/adCopyNewPrompt';
import { isAdmin } from '@/lib/admins';

const DAILY_LIMIT = parseInt(process.env.AD_COPY_NEW_DAILY_LIMIT || '10');
const DB = 'tokensApi';

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const record = await db.collection('UsageLimits').findOne({ email, date: today });
  return record?.adCopyNewCount || 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { adCopyNewCount: 1 } },
    { upsert: true }
  );
}

function buildUserPrompt({ product, keywords, usps, cta, goal, tone, pageContent }) {
  let prompt = `Product / service: ${product}
Target keywords: ${keywords}
What makes us different (USPs): ${usps}
Main offer / CTA: ${cta}`;

  if (goal) prompt += `\nCampaign goal: ${goal}`;
  if (tone) prompt += `\nTone: ${tone}`;
  if (pageContent) prompt += `\n\nLanding page content (use for additional context only — do not invent new claims):\n${pageContent.slice(0, 20000)}`;

  prompt += '\n\nGenerate the ad copy now.';
  return prompt;
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = session.user.email;
  if (!email.endsWith('@' + allowedEmailDomain)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { product, keywords, usps, cta, goal, tone, pageContent } = body;

  if (!product?.trim()) return Response.json({ error: 'product is required' }, { status: 400 });
  if (!keywords?.trim()) return Response.json({ error: 'keywords is required' }, { status: 400 });
  if (!usps?.trim()) return Response.json({ error: 'usps is required' }, { status: 400 });
  if (!cta?.trim()) return Response.json({ error: 'cta is required' }, { status: 400 });

  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return Response.json({ error: 'Monthly AI budget reached. Contact your admin.' }, { status: 429 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const dailyCount = await getDailyUsageCount(db, email);
    if (dailyCount >= DAILY_LIMIT) {
      return Response.json({ error: "You've used your daily AI limit. Try again tomorrow." }, { status: 429 });
    }
  }

  const credentials = await getCredentials();
  const client = new Anthropic({ apiKey: credentials.anthropic_api_key });

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: getAdCopyNewSystemPrompt(),
      messages: [{ role: 'user', content: buildUserPrompt({ product, keywords, usps, cta, goal, tone, pageContent }) }],
    });
  } catch (err) {
    console.error('[claude/ad-copy-new] Claude error:', err?.message);
    return Response.json({ error: 'Claude API error' }, { status: 502 });
  }

  const rawText = message.content[0]?.text || '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  let data;
  try {
    data = JSON.parse(jsonMatch[0]);
  } catch {
    return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  const inputTokens = message.usage?.input_tokens || 0;
  const outputTokens = message.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'ad_copy_new',
    email,
    model: 'claude-sonnet-4-6',
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateClaudeCost('claude-sonnet-4-6', inputTokens, outputTokens),
  }).catch(() => {});

  if (!isAdmin(email)) {
    await incrementDailyUsage(db, email).catch(() => {});
  }

  return Response.json({ data });
}
