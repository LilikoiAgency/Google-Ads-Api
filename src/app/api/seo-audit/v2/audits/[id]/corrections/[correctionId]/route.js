import { NextResponse } from "next/server";
import { getAllowedSession } from "../../../../../../../../lib/routeAuth";
import { removeCorrection } from "../../../../../../../../lib/seoAuditV2/auditStore";

export const dynamic = "force-dynamic";

/** DELETE /api/seo-audit/v2/audits/:id/corrections/:correctionId -> { corrections, correctionsChangedAt } */
export async function DELETE(_request, { params }) {
  const { error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  try {
    const now = new Date();
    const corrections = await removeCorrection(params.id, params.correctionId, now);
    if (!corrections) return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    return NextResponse.json({ corrections, correctionsChangedAt: now.toISOString() });
  } catch (err) {
    console.error("[seo-audit/v2/corrections] remove failed:", err?.message);
    return NextResponse.json({ error: "Could not remove the correction" }, { status: 500 });
  }
}
