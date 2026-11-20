import { NextResponse } from "next/server";
import { getAllowedSession } from "../../../../../../../lib/routeAuth";
import { getMonthlyClaudeCost, getClaudeBudgetCap } from "../../../../../../../lib/usageLogger";
import { replanAudit } from "../../../../../../../lib/seoAuditV2/replan";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/seo-audit/v2/audits/:id/replan -> { result } | { error }
 * Rebuilds the action plan after corrections. Not counted against the daily
 * audit limit, but blocked once the monthly budget cap is reached.
 */
export async function POST(_request, { params }) {
  const { error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  try {
    const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
    if (monthlyCost >= budgetCap) {
      return NextResponse.json(
        { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, limitReached: true },
        { status: 429 },
      );
    }

    const out = await replanAudit({ auditId: params.id, now: new Date() });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ result: out.result });
  } catch (err) {
    console.error("[seo-audit/v2/replan] failed:", err?.message);
    return NextResponse.json({ error: "Updating the plan failed. Try again." }, { status: 500 });
  }
}
