import { NextResponse } from "next/server";
import { validateClientAccess } from "../../../../../lib/clientPortal";
import dbConnect from "../../../../../lib/mongoose";

export const dynamic = "force-dynamic";

// GET /api/portal/[slug]/streaming?token=xxx          → list reports (metadata only)
// GET /api/portal/[slug]/streaming?token=xxx&id=xxx   → full report detail
export async function GET(request, { params }) {
  const { slug }         = params;
  const { searchParams } = new URL(request.url);
  const token            = searchParams.get("token");
  const id               = searchParams.get("id");

  const client = await validateClientAccess(slug, token);
  if (!client) return NextResponse.json({ error: "Invalid or expired link." }, { status: 401 });
  if (!client.targetedStreamingEnabled) return NextResponse.json({ reports: [] });

  // Build filter — restrict to selected report IDs if any are specified
  const allowedIds = client.targetedStreamingReportIds || [];

  try {
    const { ObjectId } = await import("mongodb");
    const dbClient = await dbConnect();
    const db       = dbClient.db("tokensApi");

    if (id) {
      // Block access to reports not in the allowed list
      if (allowedIds.length > 0 && !allowedIds.includes(id)) {
        return NextResponse.json({ error: "Report not found." }, { status: 404 });
      }
      const report = await db.collection("PtcReports").findOne({ _id: new ObjectId(id), slug });
      if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });
      return NextResponse.json({ report });
    }

    // List metadata only — filtered to selected IDs if specified
    const query = allowedIds.length > 0
      ? { slug, _id: { $in: allowedIds.map((i) => new ObjectId(i)) } }
      : { slug };

    const reports = await db.collection("PtcReports")
      .find(query, {
        projection: {
          slug: 1, clientName: 1, fileName: 1, uploadedAt: 1, uploadedBy: 1,
          "reportData.dateRange": 1,
          "reportData.summary": 1,
        },
      })
      .sort({ uploadedAt: -1 })
      .toArray();

    return NextResponse.json({ reports });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
