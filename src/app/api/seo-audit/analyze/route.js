import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions, allowedEmailDomain } from "../../../../lib/auth";
import { getCredentials } from "../../../../lib/dbFunctions";
import dbConnect from "../../../../lib/mongoose";
import { SEO_AUDIT_SYSTEM_PROMPT } from "../../../../lib/seoAuditPrompt";
import { ADMIN_EMAILS } from "../../../../lib/admins";
import { checkRateLimit } from '../../../../lib/seoRateLimit.js';
import { z } from 'zod';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';

const DAILY_LIMIT = 5;
const DB = "tokensApi";
const COLLECTION = "SeoAudits";

const analyzeBodySchema = z.object({
  crawlData: z.object({ pages_crawled: z.array(z.any()).min(1), domain: z.string().optional() }).passthrough(),
  gscData: z.any().optional(),
  adsData: z.any().optional(),
  seoToolData: z.any().optional(),
  forceRerun: z.boolean().optional(),
});

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.seoAuditCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { seoAuditCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true }
  );
}

export async function POST(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || "";

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", requestId },
      { status: 400 }
    );
  }

  const parsed = analyzeBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message, requestId },
      { status: 400 }
    );
  }

  const { crawlData, gscData, adsData, seoToolData, forceRerun } = parsed.data;

  const domain = crawlData.domain?.toLowerCase().replace(/^www\./, "") || "";

  // ── Check if this domain was already audited today ─────────────────────
  const mongoClient = await dbConnect();
  const db = mongoClient.db(DB);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (!forceRerun) {
    const existing = await db.collection(COLLECTION).findOne({
      domain,
      createdAt: { $gte: todayStart },
    });

    if (existing) {
      // Return the cached audit — no Claude call, no rate-limit charge
      return NextResponse.json({
        data: {
          audit: existing.auditResult,
          auditId: existing._id.toString(),
          remainingToday: null,
        },
        fromHistory: true,
        requestId,
      });
    }
  }

  // ── Rate limit: per-request 30s window ──────────────────────────────────
  const { limited, retryAfterSeconds } = checkRateLimit(email);
  if (limited) {
    return NextResponse.json(
      { error: `Too many requests — wait ${retryAfterSeconds}s before retrying.`, requestId },
      { status: 429 }
    );
  }

  // ── Daily limit: check before calling Claude (admins exempt) ────────────
  const isAdmin = ADMIN_EMAILS.includes(email);
  const usedToday = await getDailyUsageCount(db, email);
  if (!isAdmin && usedToday >= DAILY_LIMIT) {
    return NextResponse.json(
      { error: `Daily limit reached — you've used all ${DAILY_LIMIT} SEO audits for today. Resets at midnight.`, requestId },
      { status: 429 }
    );
  }
  await incrementDailyUsage(db, email);

  const credentials = await getCredentials();
  const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Anthropic API key not configured — add ANTHROPIC_API_KEY to your MongoDB Tokens document.",
        requestId,
      },
      { status: 500 }
    );
  }

  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, limitReached: true, requestId },
      { status: 429 },
    );
  }

  const client = new Anthropic({ apiKey });

  const auditRequest = {
    audit_request: {
      domain,
      audit_type: crawlData.audit_type || "full",
      audit_date: crawlData.audit_date || new Date().toISOString().split("T")[0],
      pages_crawled: crawlData.pages_crawled,
      site_wide: crawlData.site_wide || null,
      google_search_console: gscData || null,
      google_ads: adsData || null,
      seo_tool_data: seoToolData || null,
    },
  };

  const userPrompt = `Analyze this website data and return the structured JSON audit:\n\n${JSON.stringify(auditRequest, null, 2)}`;

  // ── Call Claude with retry on 529 overloaded ────────────────────────────
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [5_000, 15_000, 30_000]; // 5s, 15s, 30s

  async function callClaudeWithRetry() {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: SEO_AUDIT_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        });
      } catch (err) {
        const isOverloaded = err.status === 529 || err.error?.type === "overloaded_error";
        if (isOverloaded && attempt < MAX_RETRIES) {
          console.warn(`[seo-audit/analyze] 529 overloaded — retry ${attempt + 1}/${MAX_RETRIES} in ${RETRY_DELAYS[attempt] / 1000}s`);
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        throw err;
      }
    }
  }

  try {
    const message = await callClaudeWithRetry();

    logApiUsage({
      type: 'claude_tokens',
      email,
      model: 'claude-sonnet-4-20250514',
      feature: 'seo_audit',
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      totalTokens: (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0),
      estimatedCostUsd: estimateClaudeCost('claude-sonnet-4-20250514', message.usage?.input_tokens ?? 0, message.usage?.output_tokens ?? 0),
    }).catch(() => {});

    const responseText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parse JSON response — handle potential markdown fences
    let audit;
    try {
      audit = JSON.parse(responseText);
    } catch {
      const cleaned = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      try {
        audit = JSON.parse(cleaned);
      } catch (parseErr) {
        console.error("[seo-audit/analyze] JSON parse failed:", parseErr.message);
        return NextResponse.json(
          {
            error: "Failed to parse audit response as JSON",
            rawResponse: responseText.substring(0, 500),
            requestId,
          },
          { status: 502 }
        );
      }
    }

    // ── Save audit to SeoAudits collection ─────────────────────────────
    let auditId = null;
    try {
      const auditDoc = {
        email,
        domain,
        auditType: crawlData.audit_type || "full",
        scores: {
          seo: audit.audit_summary?.scores?.seo?.score ?? null,
          geo: audit.audit_summary?.scores?.geo?.score ?? null,
          aeo: audit.audit_summary?.scores?.aeo?.score ?? null,
          combined: audit.audit_summary?.scores?.combined?.score ?? null,
        },
        pagesCrawled: crawlData.pages_crawled?.length || 0,
        crawlData,
        auditResult: audit,
        createdAt: new Date(),
      };

      if (forceRerun) {
        const result = await db.collection(COLLECTION).findOneAndReplace(
          { domain, email, createdAt: { $gte: todayStart } },
          auditDoc,
          { upsert: true, returnDocument: 'after' }
        );
        auditId = result?._id?.toString() ?? null;
      } else {
        const insertResult = await db.collection(COLLECTION).insertOne(auditDoc);
        auditId = insertResult.insertedId.toString();
      }
    } catch (saveErr) {
      console.error("[seo-audit/analyze] Failed to save audit:", saveErr.message);
    }

    return NextResponse.json({ data: { audit, auditId, remainingToday: DAILY_LIMIT - usedToday - 1 }, requestId });
  } catch (err) {
    console.error("[seo-audit/analyze] Claude error:", err);
    return NextResponse.json(
      { error: err.message || "Analysis failed", requestId },
      { status: 500 }
    );
  }
}
