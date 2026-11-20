import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAllowedSession } from "@/lib/routeAuth";
import { getCached, setCached } from "@/lib/serverCache";
import { getSearchConsole, fetchSearchReport } from "@/lib/gscClient";
import { getSiteSettings, isValidSite } from "@/lib/gscSettings";
import { SEARCH_TYPES, cleanBrandTerms } from "@/lib/gscReport";
import { mapGscError } from "@/lib/gscErrors";
import { isValidRange } from "@/lib/ga4Dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COMPARES = ["prev", "yoy", "none"];
const TYPES = SEARCH_TYPES.map((t) => t.key);
const DAY = 24 * 60 * 60 * 1000;

const fail = (status, error, message) => NextResponse.json({ error, message }, { status });

export async function GET(request) {
  const auth = await getAllowedSession();
  if (auth.error) return fail(401, "unauthorized", auth.error);

  const sp = new URL(request.url).searchParams;
  const site = sp.get("siteUrl") || "";
  const startDate = sp.get("startDate") || "";
  const endDate = sp.get("endDate") || "";
  const compare = sp.get("compare") || "prev";
  const type = sp.get("type") || "web";
  const fresh = sp.get("refresh") === "1";

  if (!isValidSite(site)) return fail(400, "bad_params", "Invalid site");
  if (!COMPARES.includes(compare)) return fail(400, "bad_params", "Invalid compare");
  if (!TYPES.includes(type)) return fail(400, "bad_params", "Invalid search type");
  if (!isValidRange({ startDate, endDate })) return fail(400, "bad_params", "Invalid date range");

  try {
    const sc = await getSearchConsole();
    if (!sc) return fail(401, "gsc_not_connected", "Search Console isn't connected");

    const settings = await getSiteSettings(site);
    const brandTerms = cleanBrandTerms(settings.brandTerms);
    const brandHash = brandTerms.length
      ? createHash("sha1").update(brandTerms.join("|")).digest("hex").slice(0, 10)
      : "none";
    const key = `gsc:v1:report:${site}:${startDate}:${endDate}:${compare}:${type}:${brandHash}`;
    if (!fresh) {
      const cached = await getCached(key);
      if (cached) return NextResponse.json(cached);
    }

    const report = await fetchSearchReport(sc, { site, startDate, endDate, compare, type, brandTerms });
    const recent = new Date(Date.now() - 4 * DAY).toISOString().slice(0, 10);
    await setCached(key, report, endDate >= recent ? 30 * 60 * 1000 : 12 * 60 * 60 * 1000);
    return NextResponse.json(report);
  } catch (err) {
    const { status, error, message } = mapGscError(err, "gsc/report");
    return fail(status, error, message);
  }
}
