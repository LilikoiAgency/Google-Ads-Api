import { NextResponse } from "next/server";
import { getLogsForSegment, getRecentLogs, getActivityLogs } from "../../../../lib/audienceLabSegments";

export const dynamic = "force-dynamic";

// GET /api/audience-lab/logs?type=sync              → last 50 sync runs (all segments)
// GET /api/audience-lab/logs?type=sync&key=xxx      → last N sync runs for one segment
// GET /api/audience-lab/logs?type=activity          → recent activity (who changed what)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type  = searchParams.get("type")  || "sync";
    const key   = searchParams.get("key");
    const limit = Math.min(Number(searchParams.get("limit") || 50), 200);

    if (type === "activity") {
      const logs = await getActivityLogs(limit);
      return NextResponse.json({ logs });
    }

    // sync logs
    const logs = key
      ? await getLogsForSegment(key, limit)
      : await getRecentLogs(limit);

    return NextResponse.json({ logs });
  } catch (err) {
    console.error("[logs] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
