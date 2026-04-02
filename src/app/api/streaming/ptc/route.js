import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import dbConnect from "../../../../lib/mongoose";

export const dynamic = "force-dynamic";

async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return session;
}

// GET /api/streaming/ptc?slug=xxx  → list reports for a client (no reportData)
// GET /api/streaming/ptc?id=xxx    → get full report by ID (includes reportData)
// GET /api/streaming/ptc           → list all reports
export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const id   = searchParams.get("id");

  try {
    const dbClient = await dbConnect();
    const db       = dbClient.db("tokensApi");

    if (id) {
      const { ObjectId } = await import("mongodb");
      const report = await db.collection("PtcReports").findOne({ _id: new ObjectId(id) });
      if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });
      return NextResponse.json({ report });
    }

    const query  = slug ? { slug } : {};
    const reports = await db.collection("PtcReports")
      .find(query, { projection: { reportData: 0 } })
      .sort({ uploadedAt: -1 })
      .toArray();

    return NextResponse.json({ reports });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/streaming/ptc  → save a new report
export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { slug, clientName, fileName, reportData } = body;

    if (!slug || !reportData) {
      return NextResponse.json({ error: "slug and reportData are required" }, { status: 400 });
    }

    const doc = {
      slug,
      clientName: clientName || slug,
      fileName:   fileName   || "unknown.csv",
      uploadedAt: new Date(),
      uploadedBy: session.user.email,
      reportData,
    };

    const client = await dbConnect();
    const db     = client.db("tokensApi");
    const result = await db.collection("PtcReports").insertOne(doc);

    return NextResponse.json({ ok: true, id: result.insertedId });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/streaming/ptc?id=xxx  → delete a report
export async function DELETE(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const { ObjectId } = await import("mongodb");
    const client = await dbConnect();
    const db     = client.db("tokensApi");
    await db.collection("PtcReports").deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
