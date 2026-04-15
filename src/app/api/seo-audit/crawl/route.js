import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, allowedEmailDomain } from "../../../../lib/auth";
import { crawlSite } from "../../../../lib/seoCrawler";
import { getCached, setCached } from "../../../../lib/serverCache";
import { z } from 'zod';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const crawlBodySchema = z.object({
  domain: z.string().min(1),
  auditType: z.enum(['full', 'quick']).default('full'),
  pageUrls: z.array(z.string().url()).optional(),
  forceRerun: z.boolean().optional(),
});

export async function POST(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || "";

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", requestId },
      { status: 400 }
    );
  }

  const parsed = crawlBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message, requestId },
      { status: 400 }
    );
  }

  const { domain, auditType, pageUrls, forceRerun } = parsed.data;

  // Normalize domain — strip protocol, trailing slash, www
  const cleanDomain = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .toLowerCase();

  if (!cleanDomain || cleanDomain.includes(" ")) {
    return NextResponse.json(
      { error: "Invalid domain format", requestId },
      { status: 400 }
    );
  }

  // Check cache (skip if forcing rerun)
  const cacheKey = `seo-crawl:${cleanDomain}:${auditType}`;
  if (!forceRerun) {
    const cached = await getCached(cacheKey);
    if (cached) {
      return NextResponse.json({ data: cached, fromCache: true, requestId });
    }
  }

  try {
    const crawlResult = await crawlSite(cleanDomain, auditType, pageUrls);

    // Cache the result
    await setCached(cacheKey, crawlResult, CACHE_TTL_MS);

    return NextResponse.json({ data: crawlResult, requestId });
  } catch (err) {
    console.error("[seo-audit/crawl] Error:", err);
    return NextResponse.json(
      { error: err.message || "Crawl failed", requestId },
      { status: 500 }
    );
  }
}
