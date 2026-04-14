import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { authOptions, allowedEmailDomain } from "../../../../lib/auth";
import dbConnect from "../../../../lib/mongoose";

const DB = "tokensApi";
const COLLECTION = "SeoAudits";

/**
 * GET /api/seo-audit/history
 *
 * Query params:
 *   ?id=xxx        → fetch full audit by _id (includes crawlData + auditResult)
 *   ?domain=xxx    → list audits for a specific domain (metadata only)
 *   (none)         → list all audits for the logged-in user (metadata only)
 */
export async function GET(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || "";

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const domain = searchParams.get("domain");

  const client = await dbConnect();
  const db = client.db(DB);

  // ── Fetch single audit by ID (full payload) ────────────────────────────
  if (id) {
    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Invalid audit ID" }, { status: 400 });
    }

    const doc = await db.collection(COLLECTION).findOne({ _id: objectId });
    if (!doc) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }
    return NextResponse.json(doc);
  }

  // ── List audits (metadata only — exclude heavy fields) ─────────────────
  const query = {};
  if (domain) {
    query.domain = domain.toLowerCase().replace(/^www\./, "");
  }

  const audits = await db
    .collection(COLLECTION)
    .find(query, { projection: { crawlData: 0, auditResult: 0 } })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  return NextResponse.json({ audits });
}

/**
 * DELETE /api/seo-audit/history?id=xxx
 *
 * Delete a single audit by _id.
 */
export async function DELETE(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || "";

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  let objectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return NextResponse.json({ error: "Invalid audit ID" }, { status: 400 });
  }

  const client = await dbConnect();
  const result = await client
    .db(DB)
    .collection(COLLECTION)
    .deleteOne({ _id: objectId });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Audit not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
