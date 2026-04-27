import { NextResponse } from "next/server";
import {
  getClients, createClient, updateClient,
  deleteClient, regenerateToken,
} from "../../../../lib/clientPortal";
import dbConnect from "../../../../lib/mongoose";
import { getAdminSession } from "../../../../lib/routeAuth";

async function requireAdmin() {
  const auth = await getAdminSession();
  return auth.error
    ? NextResponse.json({ error: auth.error }, { status: auth.status })
    : null;
}

// GET /api/admin/clients — list all clients with streaming report counts
export async function GET() {
  const authError = await requireAdmin();
  if (authError) return authError;
  const clients = await getClients();

  // Attach streaming report counts
  try {
    const dbClient = await dbConnect();
    const db = dbClient.db("tokensApi");
    const counts = await db.collection("PtcReports").aggregate([
      { $group: { _id: "$slug", count: { $sum: 1 } } },
    ]).toArray();
    const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]));
    clients.forEach((c) => { c.streamingReportCount = countMap[c.slug] || 0; });
  } catch (_) {}

  return NextResponse.json({ clients });
}

// POST /api/admin/clients — create client
export async function POST(request) {
  const authError = await requireAdmin();
  if (authError) return authError;
  try {
    const data   = await request.json();
    const client = await createClient(data);
    return NextResponse.json({ client });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// PUT /api/admin/clients?slug=xxx — update or regenerate token
export async function PUT(request) {
  const authError = await requireAdmin();
  if (authError) return authError;
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  const data = await request.json();

  if (data._action === "regenerateToken") {
    const token = await regenerateToken(slug);
    return NextResponse.json({ token });
  }

  await updateClient(slug, data);
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/clients?slug=xxx
export async function DELETE(request) {
  const authError = await requireAdmin();
  if (authError) return authError;
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  await deleteClient(slug);
  return NextResponse.json({ ok: true });
}
