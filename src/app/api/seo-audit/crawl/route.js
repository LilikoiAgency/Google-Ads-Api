import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, allowedEmailDomain } from "../../../../lib/auth";
import { crawlSite } from "../../../../lib/seoCrawler";
import { getCached, setCached } from "../../../../lib/serverCache";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || "";

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { domain, auditType = "full", pageUrls, forceRerun } = body;

  if (!domain || typeof domain !== "string") {
    return NextResponse.json(
      { error: "domain is required" },
      { status: 400 }
    );
  }

  // Normalize domain — strip protocol, trailing slash, www
  const cleanDomain = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .toLowerCase();

  if (!cleanDomain || cleanDomain.includes(" ")) {
    return NextResponse.json(
      { error: "Invalid domain format" },
      { status: 400 }
    );
  }

  // Check cache (skip if forcing rerun)
  const cacheKey = `seo-crawl:${cleanDomain}:${auditType}`;
  if (!forceRerun) {
    const cached = await getCached(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, fromCache: true });
    }
  }

  try {
    const crawlResult = await crawlSite(cleanDomain, auditType, pageUrls);

    // Cache the result
    await setCached(cacheKey, crawlResult, CACHE_TTL_MS);

    return NextResponse.json(crawlResult);
  } catch (err) {
    console.error("[seo-audit/crawl] Error:", err);
    return NextResponse.json(
      { error: err.message || "Crawl failed" },
      { status: 500 }
    );
  }
}
