import { NextResponse } from "next/server";
import { getAllowedSession } from "../../../../../../lib/routeAuth";
import { getJob } from "../../../../../../lib/seoAuditV2/jobStore";
import { toProgress } from "../../../../../../lib/seoAuditV2/advance";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** GET /api/seo-audit/v2/jobs/:id -> progress, plus result when done. */
export async function GET(_request, { params }) {
  const { error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  try {
    const job = await getJob(params.id);
    if (!job) return NextResponse.json({ error: "Audit job not found" }, { status: 404 });
    return NextResponse.json(toProgress(job));
  } catch (err) {
    console.error("[seo-audit/v2/jobs/:id] read failed:", err?.message);
    return NextResponse.json({ error: err?.message || "Could not load the audit", code: err?.code }, { status: 500 });
  }
}
