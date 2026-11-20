import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { authOptions, allowedEmailDomain } from "../../../../lib/auth";
import dbConnect from "../../../../lib/mongoose";
import { listOpenJobs } from "../../../../lib/seoAuditV2/jobStore";
import { describeOptions } from "../../../../lib/seoAuditV2/options";
import { jobCanReplan } from "../../../../lib/seoAuditV2/auditStore";

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
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || "";

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
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
      return NextResponse.json({ error: "Invalid audit ID", requestId }, { status: 400 });
    }

    const doc = await db.collection(COLLECTION).findOne({ _id: objectId });
    if (!doc) {
      return NextResponse.json({ error: "Audit not found", requestId }, { status: 404 });
    }
    const canReplan = doc.jobId ? await jobCanReplan(doc.jobId).catch(() => false) : false;
    return NextResponse.json({ ...doc, canReplan, requestId });
  }

  // ── List audits (metadata only — exclude heavy fields) ─────────────────
  const query = {};
  if (domain) {
    query.domain = domain.toLowerCase().replace(/^www\./, "");
  }

  const [saved, openJobs] = await Promise.all([
    db
      .collection(COLLECTION)
      .find(query, { projection: { crawlData: 0, auditResult: 0, previousResults: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray(),
    listOpenJobs({ domain: query.domain }).catch((err) => {
      console.error("[seo-audit/history] job list failed:", err?.message);
      return [];
    }),
  ]);

  // v2 jobs that are not done (running / queued / failed) show next to saved audits;
  // the page resumes them through /api/seo-audit/v2/jobs/:id.
  const jobItems = openJobs.map((job) => ({
    _id: job.id,
    jobId: job.id,
    email: job.email,
    domain: job.domain,
    auditType: job.auditType,
    version: 2,
    status: job.status,
    scores: null,
    pagesCrawled: 0,
    ...(job.options ? { optionsSummary: describeOptions(job.options) } : {}),
    createdAt: job.createdAt,
  }));

  const audits = [...saved.map((a) => ({ ...a, status: "done" })), ...jobItems]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);

  return NextResponse.json({ audits, requestId });
}

/**
 * DELETE /api/seo-audit/history?id=xxx
 *
 * Delete a single audit by _id.
 */
export async function DELETE(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || "";

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required", requestId }, { status: 400 });
  }

  let objectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return NextResponse.json({ error: "Invalid audit ID", requestId }, { status: 400 });
  }

  const client = await dbConnect();
  const result = await client
    .db(DB)
    .collection(COLLECTION)
    .deleteOne({ _id: objectId });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Audit not found", requestId }, { status: 404 });
  }

  return NextResponse.json({ success: true, requestId });
}
