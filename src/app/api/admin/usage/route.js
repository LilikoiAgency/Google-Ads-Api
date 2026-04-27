import { NextResponse } from "next/server";
import dbConnect from "../../../../lib/mongoose";
import { getAdminSession, getAllowedSession } from "../../../../lib/routeAuth";

const DB = "tokensApi";
const COLLECTION = "PageViews";

// ── Map paths to human-readable tool names ───────────────────────────────────

const TOOL_MAP = {
  "/dashboard":                "Dashboard Hub",
  "/dashboard/google/ads":     "Google Ads",
  "/dashboard/google/organic": "Search Console",
  "/dashboard/bing":           "Bing Ads",
  "/dashboard/meta":           "Meta Ads",
  "/dashboard/seo-audit":      "SEO Audit",
  "/dashboard/audience-lab":   "Audience Lab",
  "/dashboard/streaming":      "Streaming",
  "/dashboard/admin/clients":  "Client Portals",
  "/dashboard/admin/usage":    "Usage Analytics",
  "/report":                   "Paid vs Organic Report",
  "/dashboard/report":         "Paid vs Organic Report",
};

function pathToTool(path) {
  // Try exact match first, then strip trailing segments for nested paths
  if (TOOL_MAP[path]) return TOOL_MAP[path];
  const segments = path.replace(/\/$/, "").split("/");
  while (segments.length > 1) {
    segments.pop();
    const parent = segments.join("/");
    if (TOOL_MAP[parent]) return TOOL_MAP[parent];
  }
  return path; // fallback to raw path
}

// ── POST — Log a page view (called from middleware) ──────────────────────────

export async function POST(request) {
  const auth = await getAllowedSession();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { path } = body;
  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  try {
    const client = await dbConnect();
    await client.db(DB).collection(COLLECTION).insertOne({
      email: auth.email,
      path,
      tool: pathToTool(path),
      timestamp: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[usage/log]", err.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// ── GET — Aggregated usage stats (admin only) ────────────────────────────────

export async function GET(request) {
  const auth = await getAdminSession();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const client = await dbConnect();
  const col = client.db(DB).collection(COLLECTION);

  const now = new Date();
  const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);

  try {
    // 1. By tool — all time + 7d + 30d
    const [byToolAll, byTool7d, byTool30d] = await Promise.all([
      col.aggregate([
        { $group: { _id: "$tool", visits: { $sum: 1 }, lastVisit: { $max: "$timestamp" } } },
        { $sort: { visits: -1 } },
      ]).toArray(),
      col.aggregate([
        { $match: { timestamp: { $gte: d7 } } },
        { $group: { _id: "$tool", visits: { $sum: 1 } } },
        { $sort: { visits: -1 } },
      ]).toArray(),
      col.aggregate([
        { $match: { timestamp: { $gte: d30 } } },
        { $group: { _id: "$tool", visits: { $sum: 1 } } },
        { $sort: { visits: -1 } },
      ]).toArray(),
    ]);

    // Merge into single tool array
    const tool7dMap = Object.fromEntries(byTool7d.map((t) => [t._id, t.visits]));
    const tool30dMap = Object.fromEntries(byTool30d.map((t) => [t._id, t.visits]));
    const byTool = byToolAll.map((t) => ({
      tool: t._id,
      visitsAll: t.visits,
      visits7d: tool7dMap[t._id] || 0,
      visits30d: tool30dMap[t._id] || 0,
      lastVisit: t.lastVisit,
    }));

    // 2. By user — 7d + 30d + last active + most used tool
    const byUser = await col.aggregate([
      { $match: { timestamp: { $gte: d30 } } },
      {
        $group: {
          _id: "$email",
          visits30d: { $sum: 1 },
          lastActive: { $max: "$timestamp" },
          tools: { $push: "$tool" },
        },
      },
      { $sort: { visits30d: -1 } },
    ]).toArray();

    // Compute 7d visits and most used tool per user
    const user7dCounts = await col.aggregate([
      { $match: { timestamp: { $gte: d7 } } },
      { $group: { _id: "$email", visits7d: { $sum: 1 } } },
    ]).toArray();
    const user7dMap = Object.fromEntries(user7dCounts.map((u) => [u._id, u.visits7d]));

    const users = byUser.map((u) => {
      // Find most used tool
      const toolCounts = {};
      for (const t of u.tools) { toolCounts[t] = (toolCounts[t] || 0) + 1; }
      const topTool = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

      return {
        email: u._id,
        visits30d: u.visits30d,
        visits7d: user7dMap[u._id] || 0,
        lastActive: u.lastActive,
        topTool,
      };
    });

    // 3. Daily trend — last 30 days
    const dailyTrend = await col.aggregate([
      { $match: { timestamp: { $gte: d30 } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
          visits: { $sum: 1 },
          uniqueUsers: { $addToSet: "$email" },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          date: "$_id",
          visits: 1,
          uniqueUsers: { $size: "$uniqueUsers" },
          _id: 0,
        },
      },
    ]).toArray();

    // 4. Summary KPIs
    const total7d = byTool.reduce((s, t) => s + t.visits7d, 0);
    const uniqueUsers7d = new Set(user7dCounts.map((u) => u._id)).size;
    const topTool7d = byTool.sort((a, b) => b.visits7d - a.visits7d)[0]?.tool || "—";
    const topUser7d = users.sort((a, b) => b.visits7d - a.visits7d)[0]?.email || "—";

    // 5. Token usage stats
    const apiUsageCol = client.db(DB).collection("ApiUsage");

    const [tokenStats7d, tokenStats30d, tokenByFeature30d, tokenDailyTrend, auditCallStats] = await Promise.all([
      apiUsageCol.aggregate([
        { $match: { type: "claude_tokens", timestamp: { $gte: d7 } } },
        { $group: { _id: null, inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, totalCost: { $sum: "$estimatedCostUsd" }, calls: { $sum: 1 } } },
      ]).toArray(),
      apiUsageCol.aggregate([
        { $match: { type: "claude_tokens", timestamp: { $gte: d30 } } },
        { $group: { _id: null, inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, totalCost: { $sum: "$estimatedCostUsd" }, calls: { $sum: 1 } } },
      ]).toArray(),
      apiUsageCol.aggregate([
        { $match: { type: "claude_tokens", timestamp: { $gte: d30 } } },
        { $group: { _id: "$feature", inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, totalCost: { $sum: "$estimatedCostUsd" }, calls: { $sum: 1 } } },
        { $sort: { totalCost: -1 } },
      ]).toArray(),
      apiUsageCol.aggregate([
        { $match: { type: "claude_tokens", timestamp: { $gte: d30 } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, cost: { $sum: "$estimatedCostUsd" }, calls: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { date: "$_id", inputTokens: 1, outputTokens: 1, cost: 1, calls: 1, _id: 0 } },
      ]).toArray(),
      apiUsageCol.aggregate([
        { $match: { feature: "google_ads_audit", timestamp: { $gte: d30 } } },
        { $group: { _id: "$email", calls: { $sum: 1 }, lastAudit: { $max: "$timestamp" } } },
        { $sort: { calls: -1 } },
      ]).toArray(),
    ]);

    const tokens = {
      last7d:  tokenStats7d[0]  ? { inputTokens: tokenStats7d[0].inputTokens,  outputTokens: tokenStats7d[0].outputTokens,  estimatedCost: tokenStats7d[0].totalCost,  calls: tokenStats7d[0].calls  } : { inputTokens: 0, outputTokens: 0, estimatedCost: 0, calls: 0 },
      last30d: tokenStats30d[0] ? { inputTokens: tokenStats30d[0].inputTokens, outputTokens: tokenStats30d[0].outputTokens, estimatedCost: tokenStats30d[0].totalCost, calls: tokenStats30d[0].calls } : { inputTokens: 0, outputTokens: 0, estimatedCost: 0, calls: 0 },
      byFeature: tokenByFeature30d.map((f) => ({ feature: f._id, inputTokens: f.inputTokens, outputTokens: f.outputTokens, estimatedCost: f.totalCost, calls: f.calls })),
      dailyTrend: tokenDailyTrend,
      auditCalls: auditCallStats.map((u) => ({ email: u._id, calls: u.calls, lastAudit: u.lastAudit })),
    };

    return NextResponse.json({
      kpis: { total7d, uniqueUsers7d, topTool7d, topUser7d },
      byTool,
      users,
      dailyTrend,
      tokens,
    });
  } catch (err) {
    console.error("[usage/stats]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
