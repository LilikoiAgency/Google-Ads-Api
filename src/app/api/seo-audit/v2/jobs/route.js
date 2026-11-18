import { NextResponse } from "next/server";
import { z } from "zod";
import { getAllowedSession } from "../../../../../lib/routeAuth";
import { ADMIN_EMAILS } from "../../../../../lib/admins";
import { getMonthlyClaudeCost, getClaudeBudgetCap } from "../../../../../lib/usageLogger";
import { newJob } from "../../../../../lib/seoAuditV2/jobs";
import {
  findReusable, getDailyUsage, incrementUsage, createJob, refundUsage,
} from "../../../../../lib/seoAuditV2/jobStore";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DAILY_LIMIT = 5;

const bodySchema = z.object({
  domain: z.string().trim().min(1, "domain is required"),
  auditType: z.enum(["full", "quick"]),
  forceRerun: z.boolean().optional(),
});

function normalizeDomain(raw) {
  return raw.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

/**
 * POST /api/seo-audit/v2/jobs  { domain, auditType: 'full'|'quick', forceRerun? }
 * Returns { jobId, reused }. A new job counts as one daily audit use.
 */
export async function POST(request) {
  const { email, error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { auditType, forceRerun } = parsed.data;
  const domain = normalizeDomain(parsed.data.domain);
  if (!domain.includes(".")) {
    return NextResponse.json({ error: "Enter a valid domain" }, { status: 400 });
  }

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    if (!forceRerun) {
      const existing = await findReusable({ domain, auditType, todayStart });
      if (existing) return NextResponse.json({ jobId: existing.id, reused: true });
    }

    const usageDate = new Date().toISOString().slice(0, 10);
    const isAdmin = ADMIN_EMAILS.includes(email);
    const usedToday = await getDailyUsage(email, usageDate);
    if (!isAdmin && usedToday >= DAILY_LIMIT) {
      return NextResponse.json(
        { error: `Daily limit reached — you've used all ${DAILY_LIMIT} SEO audits for today. Resets at midnight.` },
        { status: 429 },
      );
    }
    const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
    if (monthlyCost >= budgetCap) {
      return NextResponse.json(
        { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, limitReached: true },
        { status: 429 },
      );
    }

    await incrementUsage(email, usageDate);
    const job = { ...newJob({ email, domain, auditType, now: new Date() }), usageDate };
    try {
      const jobId = await createJob(job);
      return NextResponse.json({ jobId, reused: false });
    } catch (err) {
      await refundUsage({ email, usageDate }).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error("[seo-audit/v2/jobs] create failed:", err?.message);
    return NextResponse.json({ error: err?.message || "Could not start the audit", code: err?.code }, { status: 500 });
  }
}
