import { NextResponse } from "next/server";
import { getAllowedSession } from "../../../../../../../lib/routeAuth";
import { advanceJob } from "../../../../../../../lib/seoAuditV2/advance";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** POST /api/seo-audit/v2/jobs/:id/advance -> runs the next runnable step(s), returns progress. */
export async function POST(_request, { params }) {
  const { error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  try {
    const progress = await advanceJob(params.id);
    if (!progress) return NextResponse.json({ error: "Audit job not found" }, { status: 404 });
    return NextResponse.json(progress);
  } catch (err) {
    console.error("[seo-audit/v2/jobs/:id/advance] failed:", err?.message);
    return NextResponse.json({ error: err?.message || "Could not advance the audit", code: err?.code }, { status: 500 });
  }
}
