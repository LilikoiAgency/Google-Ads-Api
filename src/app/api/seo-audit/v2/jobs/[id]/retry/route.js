import { NextResponse } from "next/server";
import { getAllowedSession } from "../../../../../../../lib/routeAuth";
import { retryJob } from "../../../../../../../lib/seoAuditV2/advance";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/seo-audit/v2/jobs/:id/retry -> resumes a failed job from its failed
 * step (not a new daily use). The page then keeps calling advance.
 */
export async function POST(_request, { params }) {
  const { error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  try {
    const res = await retryJob(params.id);
    if (res.notFound) return NextResponse.json({ error: "Audit job not found" }, { status: 404 });
    if (res.conflict) {
      return NextResponse.json({ error: "Only a failed audit can be retried", ...res.progress }, { status: 409 });
    }
    return NextResponse.json(res.progress);
  } catch (err) {
    console.error("[seo-audit/v2/jobs/:id/retry] failed:", err?.message);
    return NextResponse.json({ error: err?.message || "Could not retry the audit", code: err?.code }, { status: 500 });
  }
}
