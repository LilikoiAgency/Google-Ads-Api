import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAllowedSession } from "../../../../../../../lib/routeAuth";
import { isUsablePhrase } from "../../../../../../../lib/seoAuditV2/corrections";
import { addExclusion } from "../../../../../../../lib/seoAuditV2/briefStore";
import { getAudit, addCorrection } from "../../../../../../../lib/seoAuditV2/auditStore";

export const dynamic = "force-dynamic";

const KINDS = ["not_offered", "not_relevant"];
const bad = (error) => NextResponse.json({ error }, { status: 400 });

/** POST /api/seo-audit/v2/audits/:id/corrections -> { corrections } */
export async function POST(request, { params }) {
  const { email, error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }

  const kind = body?.kind;
  if (!KINDS.includes(kind)) return bad("Unknown correction kind");
  const sourceIds = Array.isArray(body?.source_ids)
    ? body.source_ids.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : [];
  if (!sourceIds.length) return bad("Choose at least one finding");

  const service = typeof body?.service === "string" ? body.service.trim() : "";
  if (kind === "not_offered" && !isUsablePhrase(service)) return bad("Enter the service (4 to 80 characters)");

  try {
    const audit = await getAudit(params.id);
    if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });

    const correction = {
      id: randomUUID(),
      kind,
      ...(kind === "not_offered" ? { service } : {}),
      source_ids: sourceIds,
      by: email,
      at: new Date().toISOString(),
    };
    const corrections = await addCorrection(params.id, correction);
    if (!corrections) return NextResponse.json({ error: "Audit not found" }, { status: 404 });

    if (kind === "not_offered" && body?.saveToBrief) {
      await addExclusion(audit.domain, service, email);
    }
    return NextResponse.json({ corrections });
  } catch (err) {
    console.error("[seo-audit/v2/corrections] save failed:", err?.message);
    return NextResponse.json({ error: "Could not save the correction" }, { status: 500 });
  }
}
