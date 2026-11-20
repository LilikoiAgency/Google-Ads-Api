import { NextResponse } from "next/server";
import { getAllowedSession } from "@/lib/routeAuth";
import { getSiteSettings, saveSiteSettings, isValidSite } from "@/lib/gscSettings";
import { invalidateCacheByPrefix } from "@/lib/serverCache";

export const dynamic = "force-dynamic";

const fail = (status, error, message) => NextResponse.json({ error, message }, { status });

export async function GET(request) {
  const auth = await getAllowedSession();
  if (auth.error) return fail(401, "unauthorized", auth.error);
  const site = new URL(request.url).searchParams.get("siteUrl") || "";
  if (!isValidSite(site)) return fail(400, "bad_params", "Invalid site");
  try {
    return NextResponse.json(await getSiteSettings(site));
  } catch (err) {
    console.error("[gsc/settings] get failed", err);
    return fail(500, "server_error", "Couldn't load site settings");
  }
}

export async function PUT(request) {
  const auth = await getAllowedSession();
  if (auth.error) return fail(401, "unauthorized", auth.error);
  let body;
  try { body = await request.json(); } catch { return fail(400, "bad_params", "Invalid JSON"); }
  const site = body?.siteUrl || "";
  if (!isValidSite(site)) return fail(400, "bad_params", "Invalid site");
  const patch = {};
  for (const k of ["brandTerms", "annotations", "ga4Property"]) if (k in body) patch[k] = body[k];
  if ("brandTerms" in patch && !Array.isArray(patch.brandTerms)) return fail(400, "bad_params", "brandTerms must be a list");
  if ("annotations" in patch && !Array.isArray(patch.annotations)) return fail(400, "bad_params", "annotations must be a list");
  try {
    const saved = await saveSiteSettings(site, patch, auth.email);
    // Brand terms are part of the report cache key; the GA4 join caches per site + property.
    if ("ga4Property" in patch) await invalidateCacheByPrefix(`gsc:v1:ga4pages:${site}:`);
    return NextResponse.json(saved);
  } catch (err) {
    console.error("[gsc/settings] save failed", err);
    return fail(500, "server_error", "Couldn't save site settings");
  }
}
