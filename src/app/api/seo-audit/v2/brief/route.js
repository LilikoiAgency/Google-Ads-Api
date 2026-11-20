import { NextResponse } from "next/server";
import { getAllowedSession } from "../../../../../lib/routeAuth";
import { parseBrief } from "../../../../../lib/seoAuditV2/briefs";
import { getBrief, saveBrief } from "../../../../../lib/seoAuditV2/briefStore";

export const dynamic = "force-dynamic";

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function normalizeDomain(raw) {
  return String(raw || "").trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

const invalidDomain = () => NextResponse.json({ error: "Enter a valid domain" }, { status: 400 });

/** GET /api/seo-audit/v2/brief?domain=acme.com -> { brief } (null when none saved). */
export async function GET(request) {
  const { error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain"));
  if (!domain || !HOST_RE.test(domain)) return invalidDomain();

  try {
    return NextResponse.json({ brief: await getBrief(domain) });
  } catch (err) {
    console.error("[seo-audit/v2/brief] read failed:", err?.message);
    return NextResponse.json({ error: "Could not load the brief" }, { status: 500 });
  }
}

/** PUT /api/seo-audit/v2/brief { domain, brief } -> { brief } (an empty brief deletes it). */
export async function PUT(request) {
  const { email, error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const domain = normalizeDomain(body?.domain);
  if (!domain || !HOST_RE.test(domain)) return invalidDomain();

  const parsed = parseBrief(body?.brief);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    await saveBrief(domain, parsed.brief, email);
    return NextResponse.json({ brief: parsed.brief });
  } catch (err) {
    console.error("[seo-audit/v2/brief] save failed:", err?.message);
    return NextResponse.json({ error: "Could not save the brief" }, { status: 500 });
  }
}
